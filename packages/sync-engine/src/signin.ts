import type { SqliteDriver } from "./driver";

/** Parent spec §11.5: "five failed attempts lock the device until it next syncs". */
const MAX_PIN_FAILURES = 5;

export type SignInBlock =
  | "locked"
  | "no_pin"
  | "never_synced"
  | "not_assigned"
  | "other_shift_open"
  | "close_refused";

/**
 * Whether this collector may sign in on this tablet, and if not, WHICH reason.
 *
 * FIVE VALUES RATHER THAN A BOOLEAN, DELIBERATELY. Every one of these refusals looks like
 * "sign-in failed" to a collector standing in a market at 5am, and each needs a different
 * action: sync the tablet, get collectors a collection area, phone the office for a PIN, wait
 * for a sync to clear the lock, or find the person whose shift is still open. Collapsing
 * them into one message makes four of the five undiagnosable in the field.
 *
 * `not_assigned` was the fifth, and it was added after a real tablet hit it: an enrolled
 * device that synced cleanly still had no collectors, because `sync_pull` sends only
 * collectors with a collection area (originally: only those in the device's facility,
 * before migration 20260929000055). Reporting that as `never_synced` denied the one thing
 * the person had just watched succeed and sent them to look at the network.
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

  if (collectors.length === 0) {
    // Two causes, two different actions. `last_full_sync_date` is written by every sync
    // (see reset.ts), so its presence is the device's own record of having talked to the
    // server -- which is exactly the fact that tells the two apart.
    const state = await driver.select<{ last_full_sync_date: string | null }>(
      "select last_full_sync_date from sync_state where id = 1",
    );
    return {
      ok: false,
      reason: state[0]?.last_full_sync_date ? "not_assigned" : "never_synced",
    };
  }

  const me = collectors.find((c) => c.id === collectorId);
  if (!me) return { ok: false, reason: "not_assigned" };
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

  // A closeout the server has ANSWERED and not accepted -- refused, or a records mismatch --
  // for a shift this tablet has already let go of (closed_unsynced). Its shift is still open
  // there, so the next shift this tablet opens would be refused, and its receipts with it.
  // One not yet sent at all does not block: handing over without signal is what
  // closed_unsynced exists for. Nor does one whose shift is still OPEN here -- its own
  // collector must be able to come back and retry, and `other_shift_open` above already
  // stops everyone else. The close is re-sent every sync (see outbox.ts), and this lifts as
  // soon as one is accepted.
  const refused = await driver.select<{ id: string }>(
    `select o.id from outbox o
      where o.type = 'shift_close'
        and (o.state = 'rejected'
             or (o.state <> 'acked' and json_extract(o.last_result, '$.status') = 'mismatch'))
        and not exists (select 1 from local_shifts s
                         where s.id = json_extract(o.payload, '$.id') and s.status = 'open')
      limit 1`,
  );
  if (refused.length > 0) return { ok: false, reason: "close_refused" };

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
