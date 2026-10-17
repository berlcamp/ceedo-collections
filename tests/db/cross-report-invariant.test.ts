// tests/db/cross-report-invariant.test.ts
// The reports agree because they all read receipt_account_lines: every live receipt's portions
// sum to its gross, the Monthly summary's account totals are those portions summed, and the
// tenant grid's base portions for a lease on its rent account are that same line.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createCollectionFixture, postCollectionAsOwner, resetCutover,
  uniqueCode, type CollectionFixture,
} from "../helpers/supabase";
import { createAccount, createRule } from "../helpers/accounts";

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

async function charge(due: string, amount = "50.00", type = "rental", parent: string | null = null) {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, parent_charge_id, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, $3::ceedo_collections.charge_type, $4, $5::date, $5::date, $5::date, $6, 0, 'manual') returning id`,
    [fx.leaseId, fx.feeTypeId, type, parent, due, amount],
  );
  return rows[0].id as string;
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

const num = (v: string | null) => Number(v ?? 0);

describe("cross-report invariant", () => {
  it("portions sum to gross, and the summary and the tenant grid read the same pesos", async () => {
    const rentAcct = await createAccount(db);
    const feeAcct = await createAccount(db);
    const surAcct = await createAccount(db);
    const fee = await walkInFee();
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[rentAcct, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, portion: "surcharge", shares: [[surAcct, 10000]] });
    await createRule(db, { feeTypeId: fee, shares: [[feeAcct, 10000]] });

    await charge("2026-10-01");
    const second = await charge("2026-10-02");
    await charge("2026-10-02", "1.50", "surcharge", second);
    await charge("2026-10-03");

    // A plain rent receipt; a mixed one (rent + its surcharge + a fee line); a cancelled rent receipt.
    const plain = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const mixed = await postCollectionAsOwner(db, fx, {
      groupRanks: [1], lines: [{ fee_type_id: fee, quantity: 2 }], collectedAt: "2026-10-06T02:00:00+00:00",
    });
    const gone = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-07T02:00:00+00:00" });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2)`,
      [gone, fx.collectorId],
    );
    const ids = [plain, mixed, gone];

    // (a) Every live receipt's portions sum to its gross.
    const { rows: [a] } = await db.query(
      `select (select sum(r.amount) from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31') r
                where r.collection_id = any($1::uuid[]) and not r.cancelled)::text as portions,
              (select sum(c.gross_amount) from ceedo_collections.collections c
                where c.id = any($1::uuid[])
                  and not exists (select 1 from ceedo_collections.standing_cancellations x where x.collection_id = c.id))::text as gross`,
      [ids],
    );
    expect(num(a.gross)).toBe(121.5); // 50.00 + (50.00 + 1.50 + 20.00)
    expect(num(a.portions)).toBe(num(a.gross));

    // (b) The Monthly summary's total per account is that account's live portions.
    const expected: [string, number][] = [[rentAcct, 100], [feeAcct, 20], [surAcct, 1.5]];
    for (const [account, pesos] of expected) {
      const { rows: [b] } = await db.query(
        `select (select sum(t.amount) from ceedo_collections.monthly_account_totals('2026-10-01', '2026-10-31') t
                  where t.account_id = $1)::text as summary,
                (select sum(r.amount) from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31') r
                  where r.account_id = $1 and not r.cancelled)::text as portions`,
        [account],
      );
      expect(num(b.portions)).toBe(pesos);
      expect(num(b.summary)).toBe(num(b.portions));
    }

    // (c) The tenant grid's base portions for the lease on its rent account equal the summary line.
    const { rows: [c] } = await db.query(
      `select (select sum(p.amount) from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31', '{}'::uuid[]) p
                where p.lease_id = $1 and p.account_id = $2 and p.portion = 'base')::text as grid,
              (select sum(t.amount) from ceedo_collections.monthly_account_totals('2026-10-01', '2026-10-31') t
                where t.account_id = $2)::text as summary`,
      [fx.leaseId, rentAcct],
    );
    expect(num(c.summary)).toBe(100);
    expect(num(c.grid)).toBe(num(c.summary));
  });
});
