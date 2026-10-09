// tests/db/receipt-account-lines.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL, createCollectionFixture, createOutsiderClient, postCollectionAsOwner, resetCutover,
  uniqueCode, type CollectionFixture,
} from "../helpers/supabase";
import { accountId, createAccount, createRule } from "../helpers/accounts";

let db: Client;
let fx: CollectionFixture;
let facilityId: string;
let sectionId: string;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, { accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00" });
  const { rows } = await db.query(
    `select s.id as section_id, s.facility_id from ceedo_collections.stalls st
       join ceedo_collections.sections s on s.id = st.section_id where st.id = $1`,
    [fx.stallId],
  );
  ({ section_id: sectionId, facility_id: facilityId } = rows[0]);
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const linesOf = async (collectionId: string) =>
  (await db.query(
    `select portion, account_id, amount::text as amount, cancelled
       from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31')
      where collection_id = $1 order by portion, amount`,
    [collectionId],
  )).rows;

async function charge(due: string, amount = "50.00", type = "rental", parent: string | null = null) {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, parent_charge_id, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, $3::ceedo_collections.charge_type, $4, $5::date, $5::date, $5::date, $6, 0, 'manual') returning id`,
    [fx.leaseId, fx.feeTypeId, type, parent, due, amount],
  );
  return rows[0].id as string;
}

async function ownFee(mode = "rate", rate = "10.00"): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode, facility_id)
     values ($1, $1, 'market', $2, $3) returning id`,
    [uniqueCode("FT"), mode, facilityId],
  );
  if (mode === "rate") {
    await db.query(
      `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
       values ($1, '', '2026-01-01', $2, 'per_head'), ($1, 'big', '2026-01-01', 20, 'per_head')`,
      [rows[0].id, rate],
    );
  }
  return rows[0].id as string;
}

describe("lease receipts", () => {
  it("splits base and surcharge and places each by the section rule", async () => {
    const rent = await charge("2026-10-01");
    await charge("2026-10-01", "1.50", "surcharge", rent);
    const base = await createAccount(db);
    const sur = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[base, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, portion: "surcharge", shares: [[sur, 10000]] });
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect(await linesOf(id)).toEqual([
      { portion: "base", account_id: base, amount: "50.00", cancelled: false },
      { portion: "surcharge", account_id: sur, amount: "1.50", cancelled: false },
    ]);
  });

  it("emits no zero base row for a surcharge-only receipt", async () => {
    // A rent already paid by an earlier receipt, its surcharge raised later and paid alone.
    const rent = await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    await charge("2026-10-01", "1.50", "surcharge", rent);
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const rows = await linesOf(id);
    expect(rows.map((r) => r.portion)).toEqual(["surcharge"]);
  });

  it("prefers section over facility over fee type, and falls to UNCLASSIFIED", async () => {
    await charge("2026-10-01");
    const byFacility = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, shares: [[byFacility, 10000]] });
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect((await linesOf(id))[0].account_id).toBe(byFacility);

    const bySection = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[bySection, 10000]] });
    expect((await linesOf(id))[0].account_id).toBe(bySection);
  });

  it("sends a portion with no rule at any level to UNCLASSIFIED", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect((await linesOf(id))[0].account_id).toBe(await accountId(db, "UNCLASSIFIED"));
  });

  it("uses the rule in force on the business date", async () => {
    await charge("2026-10-01");
    await charge("2026-10-02");
    const oct = await createAccount(db);
    const later = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, to: "2026-10-05", shares: [[oct, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, from: "2026-10-06", shares: [[later, 10000]] });
    const a = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const b = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-06T02:00:00+00:00" });
    expect((await linesOf(a))[0].account_id).toBe(oct);
    expect((await linesOf(b))[0].account_id).toBe(later);
  });

  it("returns a cancelled receipt flagged, and unflags it on reinstatement", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2) returning id`,
      [id, fx.collectorId],
    );
    expect((await linesOf(id))[0].cancelled).toBe(true);
    await db.query(
      `insert into ceedo_collections.collection_reinstatements (cancellation_id, reason, reinstated_by) values ($1, 'x', $2)`,
      [rows[0].id, fx.collectorId],
    );
    expect((await linesOf(id))[0].cancelled).toBe(false);
  });
});

describe("line receipts", () => {
  it("matches a rate class over a class-less rule, and the fee's own facility", async () => {
    const fee = await ownFee();
    const any = await createAccount(db);
    const big = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[any, 10000]] });
    await createRule(db, { feeTypeId: fee, rateClass: "big", shares: [[big, 10000]] });
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee,
      lines: [{ fee_type_id: fee, quantity: 1 }, { fee_type_id: fee, rate_class: "big", quantity: 1 }],
    });
    const rows = await linesOf(id);
    expect(rows.map((r) => [r.account_id, r.amount])).toEqual([[any, "10.00"], [big, "20.00"]]);
    const { rows: f } = await db.query(
      `select distinct facility_id from ceedo_collections.receipt_account_lines('2026-10-01','2026-10-31') where collection_id = $1`,
      [id],
    );
    expect(f).toEqual([{ facility_id: facilityId }]);
  });

  it("splits by share and gives the rounding remainder to the largest share", async () => {
    const fee = await ownFee("rate", "0.01");
    const big = await createAccount(db);
    const small = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[big, 7500], [small, 2500]] });
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity: 1 }],
    });
    expect((await linesOf(id)).map((r) => [r.account_id, r.amount])).toEqual([[big, "0.01"]]);
  });

  it("places an occupancy fee on a lease by the lease's section, once, and keeps it out of the rent grid", async () => {
    const fee = await ownFee("keyed");
    await charge("2026-10-01");
    const balance = async () =>
      (await db.query(
        `select outstanding::text from ceedo_collections.lease_balances where lease_id = $1`,
        [fx.leaseId],
      )).rows[0].outstanding as string;
    const before = await balance();
    const occ = await createAccount(db);
    await createRule(db, { feeTypeId: fee, facilityId, sectionId, shares: [[occ, 10000]] });
    const { rows } = await db.query(`select ceedo_collections.post_collection($1::jsonb) r`, [JSON.stringify({
      id: randomUUID(), or_no: 1990, booklet_id: fx.bookletId, collector_id: fx.collectorId, device_id: fx.deviceId,
      collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: fee, lease_id: fx.leaseId,
      allocations: [], lines: [{ fee_type_id: fee, quantity: 1, amount: "200" }],
    })]);
    const id = rows[0].r.collection_id as string;
    expect(await linesOf(id)).toEqual([{ portion: "base", account_id: occ, amount: "200.00", cancelled: false }]);
    const grid = await db.query(
      `select * from ceedo_collections.lease_receipts_by_day('2026-10-01','2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(grid.rows).toEqual([]);
    expect(await balance()).toBe(before);
  });

  it("sends an unmatched line to UNCLASSIFIED", async () => {
    const fee = await ownFee();
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity: 3 }],
    });
    expect(await linesOf(id)).toEqual([
      { portion: "base", account_id: await accountId(db, "UNCLASSIFIED"), amount: "30.00", cancelled: false },
    ]);
  });
});

describe("cash tickets and access", () => {
  it("returns a live cash ticket as source cash_ticket, and drops a cancelled one", async () => {
    const fee = await ownFee("keyed");
    const shiftId = randomUUID();
    await db.query(
      `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status)
       values ($1, $2, $3, '2026-10-05', now(), 'open')`,
      [shiftId, fx.collectorId, fx.deviceId],
    );
    const ins = async () =>
      (await db.query(
        `insert into ceedo_collections.cash_ticket_sales (shift_id, collector_id, business_date, fee_type_id, amount, entered_by)
         values ($1, $2, '2026-10-05', $3, 470, $2) returning id`,
        [shiftId, fx.collectorId, fee],
      )).rows[0].id as string;
    const live = await ins();
    const gone = await ins();
    await db.query(
      `update ceedo_collections.cash_ticket_sales set cancelled_at = now(), cancelled_by = collector_id, cancel_reason = 'x' where id = $1`,
      [gone],
    );
    const { rows } = await db.query(
      `select source, cash_ticket_id, collection_id, amount::text from ceedo_collections.receipt_account_lines('2026-10-01','2026-10-31')
        where fee_type_id = $1`,
      [fee],
    );
    expect(rows).toEqual([{ source: "cash_ticket", cash_ticket_id: live, collection_id: null, amount: "470.00" }]);
  });

  it("shows nothing to a non-staff user", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.rpc("receipt_account_lines", { p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
