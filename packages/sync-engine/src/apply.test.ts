import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { applyPull, readSyncState } from "./apply";
import type { SqliteDriver } from "./driver";

/**
 * A schema small enough to reason about, carrying the two properties that matter: a table
 * the pull writes, and the sync_state row it advances alongside.
 */
const SCHEMA = `
  create table sync_state (
    id integer primary key,
    cursor integer not null default 0,
    epoch integer not null default 0,
    last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 0, 0);
  create table charges (
    id text primary key, lease_id text, amount text, row_version integer
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
`;

function pull(cursor: number, charges: unknown[]) {
  return { cursor, epoch: 0, charges };
}

describe("applyPull", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("inserts rows and advances the cursor", async () => {
    await applyPull(driver, pull(42, [{ id: "c1", lease_id: "l1", amount: "100.00", row_version: 7 }]));

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 1 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 42, epoch: 0 });
  });

  it("upserts by primary key rather than failing on a re-delivered row", async () => {
    await applyPull(driver, pull(1, [{ id: "c1", lease_id: "l1", amount: "100.00", row_version: 1 }]));
    await applyPull(driver, pull(2, [{ id: "c1", lease_id: "l1", amount: "250.00", row_version: 2 }]));

    const row = db.prepare("select amount, row_version from charges where id = 'c1'").get();
    expect(row).toEqual({ amount: "250.00", row_version: 2 });
  });

  /**
   * SPEC E7, AND THE REASON IT IS A REQUIREMENT RATHER THAN A PREFERENCE.
   *
   * If apply and the cursor advance are two transactions, a crash between them has two
   * possible outcomes and only one is safe. Cursor-first loses every row in the failed
   * batch permanently -- the next delta starts past them, and nothing but a full re-sync
   * recovers, which may not happen for months. Committing them together makes every crash
   * the redundant kind: the batch is re-delivered and re-applied harmlessly.
   *
   * This test drives a failure mid-apply and asserts the cursor did NOT move. It is the
   * falsifiable form: against a two-transaction implementation the cursor reads 99.
   */
  it("leaves the cursor untouched when the apply fails partway", async () => {
    // POISON FIRST, AND THE ORDER IS load-bearing. insertRows derives its column list from
    // the FIRST row of each chunk, so a bad row in second position contributes no columns,
    // binds nothing, and the insert SUCCEEDS -- the test would pass while proving nothing.
    // First position puts `nonexistent_column` in the statement and SQLite rejects it.
    const poison = { id: "c2", nonexistent_column: "boom" };
    const good = { id: "c1", lease_id: "l1", amount: "100.00", row_version: 1 };

    await expect(applyPull(driver, pull(99, [poison, good]))).rejects.toThrow(
      /no column named nonexistent_column/i,
    );

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 0 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 0 });
  });

  it("chunks a batch larger than SQLite's bound-parameter ceiling", async () => {
    /**
     * SQLITE_MAX_VARIABLE_NUMBER is 999 on older builds and 32766 on newer ones. A first
     * sync of a long-delinquent stall is ~730 charge rows at 4 bound parameters each --
     * 2,920 parameters in one statement, which is over the older ceiling and under the
     * newer one. That is the worst possible position: it works on the developer's machine
     * and fails on some tablets.
     *
     * 1,500 rows is chosen to exceed BOTH ceilings when unchunked (6,000 parameters), so
     * this test fails against an unchunked implementation on every build of SQLite rather
     * than only on the unlucky ones.
     */
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${i}`,
      lease_id: "l1",
      amount: "100.00",
      row_version: i,
    }));

    await applyPull(driver, pull(1500, rows));

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 1500 });
  });

  it("ignores envelope keys that are not tables", async () => {
    // `cursor` and `epoch` are siblings of the table arrays in the same envelope. An apply
    // that walked every key would try to insert into a table named "cursor".
    await applyPull(driver, { cursor: 5, epoch: 2, charges: [] });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 5, epoch: 2 });
  });
});
