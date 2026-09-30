import type { PushResult } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

/**
 * How many times a RETRYABLE rejection is re-pushed before it is surfaced to a person.
 *
 * `stale_allocations` is the only retryable reason (invariant 24) and it resolves itself:
 * the device re-pulls, sees the allocations that won the race, and re-pushes. But a reason
 * that keeps recurring under an unbounded retry is a tablet in a loop with a collector
 * watching it, so the retry is bounded and exhaustion is visible.
 */
const MAX_RETRYABLE_ATTEMPTS = 5;

export interface OutboxRow {
  id: string;
  type: "collection" | "spoiled_form" | "shift_open" | "shift_close";
  payload: unknown;
  collectorId: string;
  state: "pending" | "in_flight" | "acked" | "rejected";
  attempts: number;
  seq: number;
}

export async function enqueue(
  driver: SqliteDriver,
  entry: {
    id: string;
    type: OutboxRow["type"];
    payload: unknown;
    collectorId: string;
  },
): Promise<void> {
  await driver.execute(
    `insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
     values (?, ?, ?, ?, ?, 'pending', 0,
             coalesce((select max(seq) from outbox), 0) + 1)
     on conflict (id) do nothing`,
    [
      entry.id,
      entry.type,
      JSON.stringify(entry.payload),
      entry.collectorId,
      new Date().toISOString(),
    ],
  );
}

/**
 * Everything the next push must carry, in insertion order.
 *
 * TWO STATES, NOT ONE. `pending` is obvious. `in_flight` is spec E11: a push whose response
 * was lost left the entry here with an unknown server outcome, and the only safe reading of
 * unknown is "send it again" -- the client UUID makes that idempotent, and the server
 * answers `duplicate` if the first attempt did commit. Skipping in_flight drops precisely
 * the receipts a dropped connection created.
 *
 * ORDER IS `seq`, NOT `created_at`. Two entries written in the same millisecond have the
 * same timestamp, and a shift_open that sorts after its own collections fails their foreign
 * key.
 *
 * A SHIFT CLOSE IS A BARRIER. The push stops after the first unsettled shift_close, and
 * nothing queued behind it goes up until the server has accepted it. A tablet closed out
 * offline hands over and opens the next shift; if the old close and the new shift_open went
 * up together and the close was refused, the server's old shift would stay open,
 * shifts_one_open_per_device would refuse the new one, and every receipt of the new shift
 * would be filed as an exception (production, 2026-09-29). Held back, they wait on the
 * device instead, and go up once the old shift is put right.
 *
 * A REFUSED CLOSE IS RE-SENT. Unlike a refused receipt, which a supervisor corrects on the
 * web, a refused close settles only when the server's shift is put right -- and the tablet
 * can only learn that by asking again (`already_closed` settles it). One quarantined for its
 * own shape (`invalid_payload`) is not: no server change can make it pass.
 */
export async function pushable(driver: SqliteDriver): Promise<OutboxRow[]> {
  const rows = await driver.select<{
    id: string;
    type: OutboxRow["type"];
    payload: string;
    collector_id: string;
    state: OutboxRow["state"];
    attempts: number;
    seq: number;
  }>(
    `select id, type, payload, collector_id, state, attempts, seq
       from outbox
      where state in ('pending', 'in_flight')
         or (type = 'shift_close' and state = 'rejected'
             and coalesce(reason_code, '') <> 'invalid_payload')
      order by seq asc`,
  );

  const barrier = rows.findIndex((row) => row.type === "shift_close");
  const batch = barrier === -1 ? rows : rows.slice(0, barrier + 1);

  return batch.map((row) => ({
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload) as unknown,
    collectorId: row.collector_id,
    state: row.state,
    attempts: row.attempts,
    seq: row.seq,
  }));
}

/**
 * How many receipts and spoiled forms exist only on this tablet.
 *
 * NOT `pushable().length`. That list stops at the first unsettled close, and it leaves out
 * an entry quarantined for its own shape -- but both are receipts the server has no row for,
 * and both are exactly what a cleared app or an uninstall would destroy. This is the count
 * a collector is warned with, so it answers "what would a wipe lose", not "what goes up next".
 *
 * A receipt the SERVER refused is not counted: it sits in sync_exceptions for a supervisor,
 * and the office already has it. Shift entries are not counted either; they are not money.
 */
export async function unsentCount(driver: SqliteDriver): Promise<number> {
  const rows = await driver.select<{ n: number }>(
    `select count(*) as n
       from outbox
      where type in ('collection', 'spoiled_form')
        and (state in ('pending', 'in_flight')
             or (state = 'rejected' and reason_code = 'invalid_payload'))`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function markInFlight(driver: SqliteDriver, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await driver.execute(
    `update outbox set state = 'in_flight'
      where id in (${ids.map(() => "?").join(", ")})`,
    ids,
  );
}

/**
 * Settles each pushed entry against the server's answer for it.
 *
 * Results are matched BY `index`, which sync_push assigns from its own loop counter, and
 * the rows are passed in the same order they were pushed. Matching by position in the
 * results array instead would silently mis-attribute every entry if the server ever
 * returned them out of order.
 */
export async function applyResults(
  driver: SqliteDriver,
  rows: OutboxRow[],
  results: PushResult[],
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const result of results) {
      const row = rows[result.index];
      if (!row) continue;

      const attempts = row.attempts + 1;

      // `closed` and `already_closed` are close_shift's successful answers; `mismatch` is
      // not a rejection of the entry but a refusal to close, and the shift stays open.
      if (
        result.status === "accepted" ||
        result.status === "duplicate" ||
        result.status === "closed" ||
        result.status === "already_closed"
      ) {
        await tx.execute(
          `update outbox set state = 'acked', attempts = ?, last_result = ? where id = ?`,
          [attempts, JSON.stringify(result), row.id],
        );
        continue;
      }

      if (result.status === "mismatch") {
        // Stays pushable: the device will reconcile and try again. It is not an error
        // about this entry, it is the server saying the two sides disagree on records.
        await tx.execute(
          `update outbox set state = 'pending', attempts = ?, last_result = ? where id = ?`,
          [attempts, JSON.stringify(result), row.id],
        );
        continue;
      }

      const retryable = result.retryable === true && attempts < MAX_RETRYABLE_ATTEMPTS;
      await tx.execute(
        `update outbox
            set state = ?, attempts = ?, reason_code = ?, retryable = ?, last_result = ?
          where id = ?`,
        [
          retryable ? "pending" : "rejected",
          attempts,
          result.reason ?? null,
          result.retryable === true ? 1 : 0,
          JSON.stringify(result),
          row.id,
        ],
      );
    }
  });
}

/**
 * Takes an entry out of the push queue permanently, for a reason no retry can change.
 *
 * WHY THIS IS NOT A RETRY, AND WHY IT IS NOT A DELETE EITHER.
 *
 * The device and the server validate against the SAME contract -- packages/shared's
 * sync-contract.ts, copied to the Edge Functions by `pnpm edge:contract` with a staleness
 * test holding the copy honest. So an entry the device cannot validate is one the server
 * would refuse with `400 invalid_body`, every time, forever. Re-pushing it is not
 * resilience; it is a loop with a collector watching it, and because the Function refuses
 * the WHOLE body, it takes every other receipt in the round down with it.
 *
 * But the row STAYS. Parent §6.3: "a server rejection must never mean discard the record."
 * A malformed entry may still be a receipt a vendor is holding. It stops being pushed; it
 * does not stop existing, and `last_result` records which fields were wrong so a person can
 * see why without a debugger.
 */
export async function quarantine(
  driver: SqliteDriver,
  id: string,
  detail: unknown,
): Promise<void> {
  await driver.execute(
    `update outbox
        set state = 'rejected', reason_code = 'invalid_payload', retryable = 0,
            last_result = ?
      where id = ?`,
    [JSON.stringify(detail), id],
  );
}

/**
 * Parent §6.4: "Acked entries are retained for closeout reconciliation and purged after 30
 * days. Rejected entries are retained until resolved."
 *
 * ACKED ONLY, AND THE ASYMMETRY IS THE POINT. A rejected entry is a paper receipt a vendor
 * is holding and money a collector has taken, waiting on a supervisor in `sync_exceptions`;
 * age is not evidence it stopped mattering. An acked entry has a server-side row that is
 * now the record, so the device's copy is a convenience with a shelf life.
 *
 * `in_flight` and `pending` are never purged at any age -- an entry the server may not have
 * is the one thing that must never be deleted on a timer.
 */
export async function purgeAcked(driver: SqliteDriver, olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const doomed = await driver.select<{ n: number }>(
    "select count(*) as n from outbox where state = 'acked' and created_at < ?",
    [cutoff],
  );
  await driver.execute("delete from outbox where state = 'acked' and created_at < ?", [
    cutoff,
  ]);
  return doomed[0]?.n ?? 0;
}
