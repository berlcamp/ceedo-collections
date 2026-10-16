// tests/db/monthly-reads.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

async function charge(due: string, amount = "50.00") {
  await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, 'rental', $3::date, $3::date, $3::date, $4, 0, 'manual')`,
    [fx.leaseId, fx.feeTypeId, due, amount],
  );
}

/** A walk-in fee at the fixture's facility, 10.00 per head. */
async function walkInFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode, facility_id)
     values ($1, $1, 'market', 'rate', $2) returning id`,
    [uniqueCode("FT"), facilityId],
  );
  await db.query(
    `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
     values ($1, '', '2026-01-01', 10, 'per_head')`,
    [rows[0].id],
  );
  return rows[0].id as string;
}

describe("monthly_account_totals", () => {
  it("sums each account per month and leaves cancelled receipts out", async () => {
    const acct = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[acct, 10000]] });
    await charge("2026-10-01");
    await charge("2026-10-02");
    await charge("2026-10-03");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-11-03T02:00:00+00:00" });
    const gone = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-11-04T02:00:00+00:00" });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2)`,
      [gone, fx.collectorId],
    );
    const { rows } = await db.query(
      `select month::text, amount::text from ceedo_collections.monthly_account_totals('2026-01-01', '2026-12-31')
        where account_id = $1 order by month`,
      [acct],
    );
    expect(rows).toEqual([{ month: "2026-10-01", amount: "50.00" }, { month: "2026-11-01", amount: "50.00" }]);
  });
});

describe("tenant_payment_portions", () => {
  it("adds up one payer's walk-in lines per account and day", async () => {
    const fee = await walkInFee();
    const nm = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[nm, 10000]] });
    const payer = uniqueCode("Vendor");
    for (const quantity of [1, 2]) {
      await postCollectionAsOwner(db, fx, {
        leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity }],
        payerRef: payer, collectedAt: "2026-10-07T02:00:00+00:00",
      });
    }
    const { rows } = await db.query(
      `select lease_id, payer_ref, portion, business_date::text as d, amount::text
         from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31', array[$1]::uuid[]) where account_id = $1`,
      [nm],
    );
    expect(rows).toEqual([{ lease_id: null, payer_ref: payer, portion: "base", d: "2026-10-07", amount: "30.00" }]);
  });

  it("leaves out a lease-less portion on an account that is not a payer account", async () => {
    const fee = await walkInFee();
    const other = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[other, 10000]] });
    await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity: 1 }],
      payerRef: uniqueCode("Vendor"), collectedAt: "2026-10-07T02:00:00+00:00",
    });
    const { rows } = await db.query(
      `select 1 from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31', '{}'::uuid[]) where account_id = $1`,
      [other],
    );
    expect(rows).toEqual([]);
  });

  it("keys a lease receipt by its lease, with no payer name", async () => {
    const acct = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[acct, 10000]] });
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], payerRef: "ignored", collectedAt: "2026-10-05T02:00:00+00:00" });
    const { rows } = await db.query(
      `select lease_id, payer_ref, amount::text from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31', '{}'::uuid[])
        where account_id = $1`,
      [acct],
    );
    expect(rows).toEqual([{ lease_id: fx.leaseId, payer_ref: null, amount: "50.00" }]);
  });
});

describe("lease_home_accounts", () => {
  it("places a lease by the base rule for its latest rental charge's fee type and section", async () => {
    const byFacility = await createAccount(db);
    const bySection = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, shares: [[byFacility, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[bySection, 10000]] });
    await charge("2026-10-01");
    const { rows } = await db.query(
      `select account_id from ceedo_collections.lease_home_accounts('2026-10-01', '2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows).toEqual([{ account_id: bySection }]);
  });

  it("falls back to UNCLASSIFIED when no rule places the lease", async () => {
    await charge("2026-10-01");
    const { rows } = await db.query(
      `select account_id from ceedo_collections.lease_home_accounts('2026-10-01', '2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows).toEqual([{ account_id: await accountId(db, "UNCLASSIFIED") }]);
  });
});

describe("access", () => {
  it("returns nothing to a user outside the system", async () => {
    const outsider = await createOutsiderClient();
    const range = { p_from: "2026-10-01", p_to: "2026-10-31" };
    for (const { data, error } of [
      await outsider.rpc("monthly_account_totals", range),
      await outsider.rpc("tenant_payment_portions", { ...range, p_payer_accounts: [] }),
      await outsider.rpc("lease_home_accounts", range),
    ]) {
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    }
  });
});
