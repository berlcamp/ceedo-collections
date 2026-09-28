import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { leaseLedger, leaseLedgerDetail } from "./ledger";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table charges (
    id text primary key, lease_id text, charge_type text, due_date text,
    period_start text, period_end text, amount text
  );
  create table collection_allocations (
    id text primary key, collection_id text, charge_id text, amount text
  );
  create table collection_cancellations (
    id text primary key, collection_id text
  );
  create table collection_reinstatements (
    id text primary key, cancellation_id text
  );
  create table charge_condonations (id text primary key, charge_id text, amount text);
  create table local_collections (
    id text primary key, or_no integer, booklet_id text, collector_id text,
    shift_id text, collected_at text, fee_type_id text, lease_id text,
    gross_amount text, payer_ref text, notes text, created_at text
  );
  create table local_allocations (
    collection_id text, charge_id text, amount text,
    primary key (collection_id, charge_id)
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
  create table sync_state (
    id integer primary key, cursor integer, epoch integer, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 10, 0);
`;

describe("leaseLedger", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    db.exec(`
      insert into charges (id, lease_id, charge_type, due_date, period_start, period_end, amount)
      values
        ('r1','L1','rental','2026-03-05','2026-03-01','2026-03-31','1500.00'),
        ('s1','L1','surcharge','2026-03-05','2026-03-01','2026-03-31','45.00'),
        ('r2','L1','rental','2026-04-05','2026-04-01','2026-04-30','1500.00'),
        ('r3','L1','rental','2026-05-05','2026-05-01','2026-05-31','1500.00');
    `);
  });

  it("ranks unpaid groups oldest first, rental before its surcharge", async () => {
    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.groupRank)).toEqual([1, 2, 3]);
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
    expect(groups[0]!.outstanding).toBe(154_500);
  });

  it("subtracts THIS DEVICE's unsynced allocations", async () => {
    // Without this the collector settles March offline, walks back an hour later, is shown
    // March as unpaid, and takes the money a second time -- after the paper receipt is
    // already written and the serial already spent.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','pending',0,1);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
    expect(groups[0]!.groupRank).toBe(1);
  });

  it("keeps subtracting when the entry was REJECTED", async () => {
    // Parent §6.3: a rejection never means discard. The collector has handed over a paper
    // receipt and taken the money; that serial is spent. A rejected receipt is an
    // exception for a supervisor, not a period that became payable again.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq, reason_code)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','rejected',1,1,'serial_spent');
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
  });

  it("does not subtract twice once the server's own row arrives", async () => {
    // The same collection from both sides. Deduplicated per COLLECTION, not on charge_id
    // alone: charge_balances deliberately SUMS two different collections against one
    // charge, because that is the double payment migration 0032's row lock exists to make
    // visible -- see the "TWO DIFFERENT collections" test below, which stays green under
    // the per-collection key precisely because k2 has no pulled row of its OWN.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k1','r1','1500.00'), ('a2','k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','acked',1,1);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
  });

  it("drops ALL of a collection's local rows once the server names its charges (F7)", async () => {
    // The F7 race, and the reason the overlay cannot deduplicate on the PAIR.
    //
    // The device recorded k1 against ranks [1] and resolved that to charges r1 + s1.
    // Before the push landed, another tablet settled group 1 and the nightly accrual
    // raised a new period, so post_collection -- which resolves ranks POSITIONALLY at post
    // time -- allocated k1 to a DIFFERENT charge (r2). The count still matched, so the
    // server accepted: that is F7's own "third way it goes wrong".
    //
    // Under a (collection_id, charge_id) dedup key, neither (k1,r1) nor (k1,s1) is
    // suppressed by the pulled (k1,r2), so the ledger subtracts THREE settlements from one
    // receipt and r1/s1 read as paid on this device FOREVER -- nothing deletes
    // local_allocations, and an epoch reset only wipes the pulled tables. The collector is
    // never shown those periods again, so they are never collected.
    //
    // Once the server's rows for a receipt arrive, the server's set is authoritative FOR
    // THAT RECEIPT and the device's guesses must be dropped entirely.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k1','r2','1500.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','acked',1,1);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r1", "s1"], ["r3"]]);

    const { perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(perCharge.get("r1")).toBe(150_000);
    expect(perCharge.get("s1")).toBe(4_500);
    expect(perCharge.has("r2")).toBe(false);
  });

  it("counts TWO DIFFERENT collections against one charge, pulled and local both", async () => {
    // The point of this test is that k9 and k2 are DIFFERENT collection ids allocating to
    // the SAME charge (r1). A dedup key of charge_id alone would treat k2's local row as
    // "already seen" because k9's pulled row already claimed r1, and silently drop it --
    // reporting r1 as still owing 500.00 when it is actually fully paid. Do not "simplify"
    // this back to one collection id: that collapses exactly the distinction this test
    // exists to pin. See migration 20260918000032_stale_allocations.sql's row lock, which
    // exists because two collections settling one charge is a real double-payment race,
    // and charge_balances deliberately SUMS them so that race stays visible rather than
    // being reported as correctly settled.
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1000.00');
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k2', 2, 'b1', 'c1', 'sh1', '2026-09-21T02:00:00.000Z', 'f1', 'L1',
              '500.00', '2026-09-21T02:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k2','r1','500.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k2','collection','{}','c1','2026-09-21T02:00:00.000Z','pending',0,2);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["s1"], ["r2"], ["r3"]]);

    const { perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(perCharge.has("r1")).toBe(false);
  });

  it("reports each unpaid charge's own outstanding", async () => {
    // The lease screen settles a GROUP, but local_allocations stores one row per CHARGE
    // (spec F1), so the device needs the split the group hides. One reader produces both.
    const { groups, perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
    expect(perCharge.get("r1")).toBe(150_000);
    expect(perCharge.get("s1")).toBe(4_500);
  });

  it("omits settled charges from the per-charge map", async () => {
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1500.00');
    `);
    const { perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(perCharge.has("r1")).toBe(false);
    expect(perCharge.get("s1")).toBe(4_500);
  });

  it("stops counting a cancelled collection's allocations", async () => {
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1500.00');
      insert into collection_cancellations (id, collection_id) values ('x1','k9');
    `);
    const groups = await leaseLedger(driver, "L1");
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
  });

  it("counts a reinstated collection's allocations again", async () => {
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1500.00');
      insert into collection_cancellations (id, collection_id) values ('x1','k9');
      insert into collection_reinstatements (id, cancellation_id) values ('u1','x1');
    `);
    const { perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(perCharge.has("r1")).toBe(false);
  });
});
