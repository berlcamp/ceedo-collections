import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { resetScopedData, needsFullSync } from "./reset";
import { readSyncState } from "./apply";
import type { SqliteDriver } from "./driver";
import { PULLED_TABLES } from "@ceedo/db-local";

/**
 * `charges` and `leases` are spelled out because rows are inserted into them below;
 * the other fifteen pulled tables are stubbed from PULLED_TABLES itself. The reset empties
 * every table in that list, so a fixture that names only two would fail on the third -- and
 * stubbing from the list rather than by hand means a table added to the schema later is
 * covered here without anyone remembering to add it.
 */
const SPELLED_OUT = ["charges", "leases"];
const STUBS = PULLED_TABLES.filter((t) => !SPELLED_OUT.includes(t))
  .map((t) => `create table ${t} (id text primary key);`)
  .join("\n  ");

const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 500, 3);
  create table charges (id text primary key, amount text);
  create table leases (id text primary key);
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
  create table local_shifts (
    id text primary key, collector_id text, business_date text, opened_at text,
    status text, closed_at text, declared_total text, device_count integer,
    device_total text
  );
  create table pin_attempts (
    collector_id text primary key, failures integer, locked_at text
  );
  ${STUBS}
`;

describe("resetScopedData", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);

    db.exec(`
      insert into charges (id, amount) values ('c1', '100.00'), ('c2', '250.00');
      insert into leases (id) values ('l1');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
        values ('o1', 'collection', '{}', 'col1', '2026-10-05T09:00:00+08:00', 'pending', 0, 1);
      insert into local_shifts (id, collector_id, business_date, opened_at, status)
        values ('s1', 'col1', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open');
      insert into pin_attempts (collector_id, failures) values ('col1', 3);
    `);
  });

  it("empties every pulled table and rewinds the cursor to zero", async () => {
    await resetScopedData(driver, "2026-10-05");

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from leases").get()).toEqual({ n: 0 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 0 });
  });

  /**
   * SPEC E8, AND THE WHOLE REASON IT IS WRITTEN DOWN AS A DECISION.
   *
   * Phase 3a's D7 says a device whose assignment_epoch differs "discards its scoped data
   * and pulls from cursor 0". Parent spec §6.4 says outbox entries "survive a change of
   * collector" and that signing out "clears a session, never data". Read carelessly, D7
   * destroys what §6.4 protects: a reassignment mid-round would discard a collector's
   * unsynced receipts -- cash taken, no record, which is exactly the failure §6.3 exists
   * to prevent.
   *
   * THIS TEST STAGES A NON-EMPTY OUTBOX ON PURPOSE. The tempting version of it -- reset a
   * device and assert the outbox is still there -- passes against an implementation that
   * wipes the outbox, because an empty table is still empty afterwards. That is the exact
   * shape of Phase 3a's Task 16 tautology (`outstanding >= 0` with no collections posted),
   * which passed against no implementation at all.
   */
  it("never touches device-authored state", async () => {
    await resetScopedData(driver, "2026-10-05");

    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from local_shifts").get()).toEqual({ n: 1 });
    expect(db.prepare("select failures from pin_attempts where collector_id = 'col1'").get())
      .toEqual({ failures: 3 });
  });

  it("records the business date it ran for, so E9 does not repeat it", async () => {
    await resetScopedData(driver, "2026-10-05");
    expect(await readSyncState(driver)).toMatchObject({ lastFullSyncDate: "2026-10-05" });
  });
});

describe("needsFullSync", () => {
  const base = { cursor: 500, epoch: 3, lastFullSyncDate: "2026-10-05" };

  it("is false on a normal delta on the same day with a matching epoch", () => {
    expect(needsFullSync(base, 3, "2026-10-05")).toBe(false);
  });

  it("is true when the server's epoch differs — D7's reassignment", () => {
    expect(needsFullSync(base, 4, "2026-10-05")).toBe(true);
  });

  it("is true on the first sync of a new business date — spec E9", () => {
    // A cursor delta cannot express a deletion: a deleted row has no row_version to
    // report. DELETE is granted to `authenticated` on ten master-data tables the device
    // caches, so an admin deleting a stall leaves a ghost until an epoch bump that may
    // never come. A daily full re-sync bounds that to one working day.
    expect(needsFullSync(base, 3, "2026-10-06")).toBe(true);
  });

  it("is true on a device that has never fully synced", () => {
    expect(needsFullSync({ ...base, lastFullSyncDate: null }, 3, "2026-10-05")).toBe(true);
  });

  it("is false when the server's epoch is unknown, rather than assuming a reset", () => {
    // A pull that failed before returning an envelope tells us nothing about the epoch.
    // Treating unknown as "changed" would wipe and re-pull on every transient error.
    expect(needsFullSync(base, null, "2026-10-05")).toBe(false);
  });
});
