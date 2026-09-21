import { PULLED_TABLES } from "@ceedo/db-local";
import type { SqliteDriver } from "./driver";

/**
 * Rows per INSERT statement.
 *
 * SQLITE_MAX_VARIABLE_NUMBER is 999 on older SQLite builds and 32766 on newer ones. At the
 * widest mirrored table (~16 columns) 50 rows is 800 parameters, inside the older ceiling
 * with room to spare. Chunking is not an optimisation here: an unchunked first sync works
 * on a development machine and fails on whichever tablets ship the older limit.
 */
const CHUNK = 50;

export interface SyncStateRow {
  cursor: number;
  epoch: number;
  lastFullSyncDate: string | null;
}

export async function readSyncState(driver: SqliteDriver): Promise<SyncStateRow> {
  const rows = await driver.select<{
    cursor: number;
    epoch: number;
    last_full_sync_date: string | null;
  }>("select cursor, epoch, last_full_sync_date from sync_state where id = 1");
  const row = rows[0];
  if (!row) throw new Error("sync_state row 1 is missing; the device schema is not migrated");
  return { cursor: row.cursor, epoch: row.epoch, lastFullSyncDate: row.last_full_sync_date };
}

/**
 * Applies a pull envelope and advances the cursor IN ONE TRANSACTION (spec E7).
 *
 * Splitting them has two possible outcomes after a crash and only one is safe. Advancing
 * the cursor first loses every row in the failed batch permanently, because the next delta
 * starts past them and only a full re-sync recovers. Committing together makes every crash
 * the redundant kind.
 *
 * Rows upsert by primary key: the cursor can legitimately re-deliver a row (a row whose
 * row_version advanced again between two pulls), and a plain insert would abort the batch.
 */
export async function applyPull(
  driver: SqliteDriver,
  response: Record<string, unknown>,
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const table of PULLED_TABLES) {
      const rows = response[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      await insertRows(tx, table, rows as Record<string, unknown>[]);
    }

    await tx.execute(
      "update sync_state set cursor = ?, epoch = ? where id = 1",
      [Number(response.cursor ?? 0), Number(response.epoch ?? 0)],
    );
  });
}

async function insertRows(
  tx: SqliteDriver,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  // Column names come from the first row of each chunk, so a server that adds a column
  // lands it without a schema change here -- and a server that omits one does not write
  // nulls over data the device already holds.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const first = chunk[0];
    if (!first) continue;
    const columns = Object.keys(first);
    if (columns.length === 0) continue;

    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const sql =
      `insert into ${table} (${columns.join(", ")}) values ` +
      chunk.map(() => placeholders).join(", ") +
      ` on conflict do update set ` +
      columns.map((c) => `${c} = excluded.${c}`).join(", ");

    const params = chunk.flatMap((row) => columns.map((c) => normalise(row[c])));
    await tx.execute(sql, params);
  }
}

/**
 * SQLite binds only null, number, bigint, string and Buffer. A boolean or a nested object
 * from jsonb would throw at bind time, which inside applyPull's transaction means the whole
 * batch rolls back -- correct, but an unhelpful place to discover a type mismatch.
 */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
