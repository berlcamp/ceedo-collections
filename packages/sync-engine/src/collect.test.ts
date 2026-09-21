import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { CollectionPayload, fromCentavos, orKey } from "@ceedo/shared";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { commitReceipt, orEntryContext, type DraftReceipt } from "./collect";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table booklets (
    id text primary key, form_type_id text, serial_prefix text,
    start_no integer, end_no integer, status text
  );
  create table booklet_assignments (
    id text primary key, booklet_id text, collector_id text, returned_at text
  );
  create table consumed_serials (booklet_id text, or_no integer, primary key (booklet_id, or_no));
  create table spoiled_forms (id text primary key, booklet_id text, or_no integer, reason text);
  create table local_collections (
    id text primary key, or_no integer, booklet_id text, collector_id text,
    shift_id text, collected_at text, fee_type_id text, lease_id text,
    gross_amount text, payer_ref text, notes text, created_at text
  );
  create table local_allocations (
    collection_id text, charge_id text, amount text,
    primary key (collection_id, charge_id)
  );
  create table local_lines (
    id text primary key, collection_id text, fee_type_id text, rate_class text,
    quantity integer, unit_rate text, amount text
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
`;

const draft = (over: Partial<DraftReceipt> = {}): DraftReceipt => ({
  id: "k1",
  orNo: 1005,
  bookletId: "b1",
  collectorId: "c1",
  shiftId: "sh1",
  collectedAt: "2026-09-21T01:00:00.000Z",
  feeTypeId: "f1",
  leaseId: "L1",
  grossAmount: fromCentavos(154_500),
  ranks: [1],
  allocations: [
    { chargeId: "r1", amount: fromCentavos(150_000) },
    { chargeId: "s1", amount: fromCentavos(4_500) },
  ],
  lines: [],
  payerRef: null,
  notes: null,
  ...over,
});

describe("orEntryContext", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    db.exec(`
      insert into booklets (id, serial_prefix, start_no, end_no, status)
      values ('b1','OR51',1001,1050,'in_use'), ('b2','OR51',2001,2050,'in_use');
      insert into booklet_assignments (id, booklet_id, collector_id, returned_at)
      values ('ba1','b1','c1',null), ('ba2','b2','c2',null);
      insert into consumed_serials (booklet_id, or_no) values ('b1',1001);
    `);
  });

  it("carries only booklets still assigned to this collector", async () => {
    const ctx = await orEntryContext(driver, "c1");
    expect(ctx.booklets.map((b) => b.id)).toEqual(["b1"]);
  });

  it("treats a serial spent offline as spent", async () => {
    // The union of pulled consumed_serials and this device's own unsynced receipts. A
    // receipt written an hour ago has not round-tripped, and reissuing its serial would
    // put two receipts on one number.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k0', 1002, 'b1', 'c1', 'sh1', '2026-09-21T00:00:00.000Z', 'f1', 'L1',
              '100.00', '2026-09-21T00:00:00.000Z');
    `);
    const ctx = await orEntryContext(driver, "c1");
    expect([...ctx.consumed].sort()).toEqual([orKey("b1", 1001), orKey("b1", 1002)].sort());
  });

  it("carries spoiled serials", async () => {
    db.exec(`insert into spoiled_forms (id, booklet_id, or_no, reason) values ('sp1','b1',1003,'torn');`);
    const ctx = await orEntryContext(driver, "c1");
    expect([...ctx.spoiled]).toEqual([orKey("b1", 1003)]);
  });

  it("keeps a serial consumed in a DIFFERENT booklet from colliding with this one (ruling R9)", async () => {
    // b2 is assigned to a different collector (c2) and shares the same numeric range as
    // b1. Serial 1001 consumed under b2 must not read as b1's own 1001 being spent --
    // that is exactly the confusion booklet-scoped keys exist to prevent. A bare-number
    // set would collapse orKey("b1", 1001) and orKey("b2", 1001) into the single value
    // 1001, so this test would pass on a `new Set([1001, 1001])` regression too.
    db.exec(`insert into consumed_serials (booklet_id, or_no) values ('b2', 1001);`);
    const ctx = await orEntryContext(driver, "c1");
    expect([...ctx.consumed].sort()).toEqual([orKey("b1", 1001), orKey("b2", 1001)].sort());
  });
});

describe("commitReceipt", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("writes the local rows and the outbox entry together", async () => {
    await commitReceipt(driver, draft(), []);

    expect(db.prepare("select count(*) as n from local_collections").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from local_allocations").get()).toEqual({ n: 2 });
    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
  });

  it("stores the device's gross as a 2dp string", async () => {
    await commitReceipt(driver, draft(), []);
    expect(
      db.prepare("select gross_amount from local_collections where id = 'k1'").get(),
    ).toEqual({ gross_amount: "1545.00" });
  });

  it("sends group ranks and NEVER an amount", async () => {
    // CollectionPayload forbids gross_amount outright. The device proposes WHICH periods;
    // the server decides what that costs (invariant #3).
    await commitReceipt(driver, draft(), []);
    const row = db.prepare("select payload from outbox where id = 'k1'").get() as {
      payload: string;
    };
    const payload = JSON.parse(row.payload);

    expect(payload.allocations).toEqual([{ group_rank: 1 }]);
    expect(payload).not.toHaveProperty("gross_amount");
    expect(payload).not.toHaveProperty("device_id");
    expect(payload.shift_id).toBe("sh1");
  });

  it("writes lines with their ids and sends quantities only", async () => {
    const lines = [
      {
        feeTypeId: "f-ambulant",
        rateClass: "vegetable",
        quantity: 3,
        unitRate: fromCentavos(2_000),
        amount: fromCentavos(6_000),
      },
    ];
    await commitReceipt(
      driver,
      draft({ leaseId: null, ranks: [], allocations: [], lines, grossAmount: fromCentavos(6_000) }),
      ["line-1"],
    );

    expect(db.prepare("select count(*) as n from local_lines").get()).toEqual({ n: 1 });
    const row = db.prepare("select payload from outbox where id = 'k1'").get() as {
      payload: string;
    };
    expect(JSON.parse(row.payload).lines).toEqual([
      { fee_type_id: "f-ambulant", rate_class: "vegetable", quantity: 3 },
    ]);
  });

  it("omits rate_class from the payload when the line has none", async () => {
    // CollectionPayload declares `rate_class: z.string().optional()` -- optional, NOT
    // nullable. Sending `rate_class: null` would be refused by the server's `.strict()`
    // parse even though collect.ts's own line-mapping logic correctly omits the key for a
    // null rateClass. Nothing exercised that branch before: "requires an id per line"
    // throws before a payload exists, and the contract-parse test below uses `lines: []`.
    // A regression that emitted the key as `null` would have passed every existing test
    // and failed only against the real server.
    const lines = [
      {
        feeTypeId: "550e8400-e29b-41d4-a716-446655440010",
        rateClass: null,
        quantity: 2,
        unitRate: fromCentavos(500),
        amount: fromCentavos(1_000),
      },
    ];
    await commitReceipt(
      driver,
      draft({
        id: "550e8400-e29b-41d4-a716-446655440011",
        bookletId: "550e8400-e29b-41d4-a716-446655440012",
        collectorId: "550e8400-e29b-41d4-a716-446655440013",
        shiftId: "550e8400-e29b-41d4-a716-446655440014",
        feeTypeId: "550e8400-e29b-41d4-a716-446655440015",
        leaseId: null,
        ranks: [],
        allocations: [],
        lines,
        grossAmount: fromCentavos(1_000),
      }),
      ["line-null-rate-class"],
    );

    const row = db
      .prepare("select payload from outbox where id = '550e8400-e29b-41d4-a716-446655440011'")
      .get() as { payload: string };
    const payload = JSON.parse(row.payload);

    expect(payload.lines).toEqual([
      { fee_type_id: "550e8400-e29b-41d4-a716-446655440010", quantity: 2 },
    ]);
    expect(payload.lines[0]).not.toHaveProperty("rate_class");
    // The contract itself is the judge: a `rate_class: null` regression is refused here,
    // not just by a hand-written assertion.
    expect(() => CollectionPayload.parse(payload)).not.toThrow();
  });

  it("refuses a duplicate id rather than clobbering the earlier receipt", async () => {
    // NOT an atomicity test. `enqueue` is `on conflict (id) do nothing` (outbox.ts), so a
    // second commitReceipt under the SAME id makes the second enqueue a silent no-op
    // regardless of whether the write is transactional -- local_collections' own primary
    // key is what throws, in both the correct implementation and a split one. This test
    // only pins the idempotency-by-id behaviour; see "rolls back every table when a later
    // write in the same commit fails" below for the actual atomicity guarantee.
    await commitReceipt(driver, draft(), []);

    await expect(
      commitReceipt(driver, draft({ orNo: 1006 }), []),
    ).rejects.toThrow();

    expect(db.prepare("select or_no from local_collections where id = 'k1'").get()).toEqual({
      or_no: 1005,
    });
    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
  });

  it("rolls back every table when a later write in the same commit fails", async () => {
    // Spec F5, and the property this whole task exists for. A FRESH id is used deliberately
    // -- nothing here may be idempotent, or the failure could be masked exactly as it was in
    // the duplicate-id test above (enqueue's `on conflict (id) do nothing` no-ops on a
    // repeated id and hides a split write).
    //
    // The SAME chargeId appears twice in `allocations`. A real draft could never do this --
    // one charge cannot be allocated against twice in one receipt -- so this is not a
    // validation scenario. It is deliberate failure injection: `local_allocations`' primary
    // key is (collection_id, charge_id) (packages/db-local/drizzle/0001_true_bedlam.sql), so
    // the second allocation insert throws AFTER local_collections and the outbox row have
    // already been written by a non-transactional implementation. Do not "fix" this fixture
    // by de-duplicating it -- that would silently delete the one test that can fail here.
    const fresh = draft({
      id: "fresh-1",
      orNo: 2001,
      allocations: [
        { chargeId: "dup", amount: fromCentavos(1_000) },
        { chargeId: "dup", amount: fromCentavos(1_000) },
      ],
    });

    await expect(commitReceipt(driver, fresh, [])).rejects.toThrow();

    expect(db.prepare("select count(*) as n from local_collections").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from local_allocations").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 0 });
  });

  it("produces a payload the shared contract accepts", async () => {
    // The contract's `uuid` fields refuse the short fixture ids used elsewhere in this
    // file -- that refusal is the contract doing its job, so this one test gets real UUIDs.
    await commitReceipt(
      driver,
      draft({
        id: "550e8400-e29b-41d4-a716-446655440000",
        bookletId: "550e8400-e29b-41d4-a716-446655440001",
        collectorId: "550e8400-e29b-41d4-a716-446655440002",
        shiftId: "550e8400-e29b-41d4-a716-446655440003",
        feeTypeId: "550e8400-e29b-41d4-a716-446655440004",
        leaseId: null,
      }),
      [],
    );
    const row = db.prepare("select payload from outbox").get() as { payload: string };
    expect(() => CollectionPayload.parse(JSON.parse(row.payload))).not.toThrow();
  });

  it("requires an id per line", async () => {
    const lines = [
      {
        feeTypeId: "f1",
        rateClass: null,
        quantity: 1,
        unitRate: fromCentavos(100),
        amount: fromCentavos(100),
      },
    ];
    await expect(
      commitReceipt(driver, draft({ lines }), []),
    ).rejects.toThrow(/one id per line/);
  });
});
