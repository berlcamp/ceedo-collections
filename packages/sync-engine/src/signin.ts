import type { SqliteDriver } from "./driver";

/** Parent spec §11.5: "five failed attempts lock the device until it next syncs". */
const MAX_PIN_FAILURES = 5;

export type SignInBlock = "locked" | "no_pin" | "never_synced" | "other_shift_open";

/**
 * Whether this collector may sign in on this tablet, and if not, WHICH of four reasons.
 *
 * FOUR VALUES RATHER THAN A BOOLEAN, DELIBERATELY. Every one of these refusals looks like
 * "sign-in failed" to a collector standing in a market at 5am, and each needs a different
 * action: sync the tablet, phone the office for a PIN, wait for a sync to clear the lock,
 * or find the person whose shift is still open. Collapsing them into one message makes
 * three of the four undiagnosable in the field.
 *
 * NOTE WHAT THIS DOES NOT DO: it never checks the PIN. Verification is the caller's, and it
 * goes through the native module (~482 ms) rather than bcryptjs (~22 s under Hermes).
 */
export async function canSignIn(
  driver: SqliteDriver,
  collectorId: string,
): Promise<{ ok: true } | { ok: false; reason: SignInBlock }> {
  const collectors = await driver.select<{ id: string; pin_hash: string | null }>(
    "select id, pin_hash from collectors",
  );
  if (collectors.length === 0) return { ok: false, reason: "never_synced" };

  const me = collectors.find((c) => c.id === collectorId);
  if (!me) return { ok: false, reason: "never_synced" };
  if (!me.pin_hash) return { ok: false, reason: "no_pin" };

  const locks = await driver.select<{ failures: number }>(
    "select failures from pin_attempts where collector_id = ?",
    [collectorId],
  );
  if ((locks[0]?.failures ?? 0) >= MAX_PIN_FAILURES) return { ok: false, reason: "locked" };

  // `status = 'open'` SPECIFICALLY, never `status <> 'closed'`. See signin.test.ts's
  // "does NOT block on a closed_unsynced shift" for what the other spelling costs.
  const open = await driver.select<{ collector_id: string }>(
    "select collector_id from local_shifts where status = 'open'",
  );
  const other = open.find((s) => s.collector_id !== collectorId);
  if (other) return { ok: false, reason: "other_shift_open" };

  return { ok: true };
}

/**
 * Counts one failed PIN attempt and returns the new total.
 *
 * IN SQLITE, NOT IN MEMORY. A lock that resets when the app restarts is not a lock, and
 * force-quitting an app is not a skill a thief has to acquire.
 */
export async function recordPinFailure(
  driver: SqliteDriver,
  collectorId: string,
): Promise<number> {
  await driver.execute(
    `insert into pin_attempts (collector_id, failures, locked_at)
     values (?, 1, null)
     on conflict (collector_id) do update
       set failures = pin_attempts.failures + 1,
           locked_at = case
             when pin_attempts.failures + 1 >= ? then ?
             else pin_attempts.locked_at
           end`,
    [collectorId, MAX_PIN_FAILURES, new Date().toISOString()],
  );
  const rows = await driver.select<{ failures: number }>(
    "select failures from pin_attempts where collector_id = ?",
    [collectorId],
  );
  return rows[0]?.failures ?? 0;
}

export async function clearPinFailures(
  driver: SqliteDriver,
  collectorId: string,
): Promise<void> {
  await driver.execute("delete from pin_attempts where collector_id = ?", [collectorId]);
}
