import { PULLED_TABLES, DEVICE_AUTHORED_TABLES } from "@ceedo/db-local";
import type { SqliteDriver } from "./driver";
import type { SyncStateRow } from "./apply";

/**
 * Empties every pulled table and rewinds the cursor. Spec E8.
 *
 * WHAT IS NOT TOUCHED, AND WHY THAT IS THE POINT. The outbox, local shifts and the PIN
 * attempt counter are device-AUTHORED. Nothing the device wrote itself is ever discarded
 * by a sync operation. A reassignment is a supervisor's administrative act; a collector's
 * unsynced receipts are cash already taken from a vendor who is holding a paper receipt.
 *
 * The table list comes from @ceedo/db-local, where a test forbids a table appearing in
 * both halves -- so a table added later is classified deliberately rather than defaulting
 * into the wipe.
 */
export async function resetScopedData(
  driver: SqliteDriver,
  businessDate: string,
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const table of PULLED_TABLES) {
      // `delete from <table>` with no WHERE is correct here and is not the unqualified-
      // DELETE hazard that bit Phase 3a's sync_pull: pg_safeupdate is a Postgres
      // extension loaded for the `authenticator` role, and this runs in SQLite on the
      // device. There is no equivalent guard and nothing to work around.
      await tx.execute(`delete from ${table}`);
    }
    await tx.execute(
      "update sync_state set cursor = 0, last_full_sync_date = ? where id = 1",
      [businessDate],
    );
  });
}

/**
 * Whether the next sync must be a full re-sync rather than a delta.
 *
 * Three reasons, and they are different failures:
 *
 *   epoch changed   -- D7. The device was reassigned and holds a section's worth of data
 *                      it must no longer show. A cursor delta cannot express "this left
 *                      your scope", because nothing about those rows changed.
 *   new day         -- E9. A cursor delta cannot express a deletion either: a deleted row
 *                      has no row_version to report. DELETE is granted to `authenticated`
 *                      on ten master-data tables the device caches, so a ghost row is a
 *                      real possibility and only a full re-sync clears it.
 *   never synced    -- there is no delta to take.
 *
 * A null serverEpoch means the pull did not return one -- a transport failure, not a
 * reassignment. Treating unknown as changed would wipe and re-pull on every flaky moment
 * of a market round, which is the opposite of what an offline-first device needs.
 */
export function needsFullSync(
  state: SyncStateRow,
  serverEpoch: number | null,
  businessDate: string,
): boolean {
  if (state.lastFullSyncDate === null) return true;
  if (state.lastFullSyncDate !== businessDate) return true;
  if (serverEpoch !== null && serverEpoch !== state.epoch) return true;
  return false;
}

export { DEVICE_AUTHORED_TABLES };
