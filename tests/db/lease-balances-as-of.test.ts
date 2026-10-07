// tests/db/lease-balances-as-of.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createCollectionFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00",
  });
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

/** A rental charge with explicit dates; run_accrual is not under test here. */
async function charge(due: string, amount = "50.00", periodEnd = due): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount,
        surcharge_bps, source)
     values ($1, $2, 'rental', $3::date, $3::date, $4::date, $5, 0, 'manual')
     returning id`,
    [fx.leaseId, fx.feeTypeId, periodEnd, due, amount],
  );
  return rows[0].id as string;
}

async function asOf(date: string) {
  const { rows } = await db.query(
    `select * from ceedo_collections.lease_balances_as_of($1::date) where lease_id = $2`,
    [date, fx.leaseId],
  );
  return rows;
}

const owed = async (date: string) => {
  const rows = await asOf(date);
  return rows.length === 0 ? 0 : Number(rows[0].outstanding);
};

describe("lease_balances_as_of", () => {
  it("counts only charges due by the date and receipts dated by it", async () => {
    await charge("2026-10-01");
    await charge("2026-10-02");
    // business date 2026-10-05; pays the oldest group (10-01)
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });

    expect(await owed("2026-09-30")).toBe(0);
    expect(await owed("2026-10-01")).toBe(50);
    expect(await owed("2026-10-04")).toBe(100);
    expect(await owed("2026-10-05")).toBe(50);
  });

  it("keeps a receipt cancelled after the date as paid on that date, and honours reinstatement", async () => {
    await charge("2026-10-01");
    const collectionId = await postCollectionAsOwner(db, fx, {
      groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00",
    });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by, cancelled_at)
       values ($1, 'test', $2, '2026-10-06T02:00:00+00:00') returning id`,
      [collectionId, fx.collectorId],
    );
    expect(await owed("2026-10-05")).toBe(0);
    expect(await owed("2026-10-06")).toBe(50);

    await db.query(
      `insert into ceedo_collections.collection_reinstatements
         (cancellation_id, reason, reinstated_by, reinstated_at)
       values ($1, 'test', $2, '2026-10-07T02:00:00+00:00')`,
      [rows[0].id, fx.collectorId],
    );
    expect(await owed("2026-10-06")).toBe(50);
    expect(await owed("2026-10-07")).toBe(0);
  });

  it("applies a condonation only from the day it was recorded", async () => {
    const id = await charge("2026-10-01");
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by, condoned_at)
       values ($1, 50.00, 'Ord. 1', 'test', $2, '2026-10-08T02:00:00+00:00')`,
      [id, fx.collectorId],
    );
    expect(await owed("2026-10-07")).toBe(50);
    expect(await owed("2026-10-08")).toBe(0);
  });

  it("ages each charge from the as-of date, not from today", async () => {
    await charge("2026-09-01", "40.00");
    await charge("2026-10-01", "10.00");

    const [oct] = await asOf("2026-10-31");
    expect(Number(oct.bucket_31_60)).toBe(40); // 60 days
    expect(Number(oct.bucket_1_30)).toBe(10); // 30 days
    expect(oct.unpaid_charges).toBe(2);

    const [dec] = await asOf("2026-12-15");
    expect(Number(dec.bucket_over_90)).toBe(40); // 105 days
    expect(Number(dec.bucket_61_90)).toBe(10); // 75 days
    expect(dec.unpaid_charges).toBe(2);
  });

  it("shows an elapsed-but-not-yet-due monthly charge as not yet due", async () => {
    await charge("2026-11-05", "300.00", "2026-10-31");
    expect(await owed("2026-10-31")).toBe(0); // period not over yet
    const [row] = await asOf("2026-11-03");
    expect(Number(row.not_yet_due)).toBe(300);
    expect(Number(row.outstanding)).toBe(300);
  });

  it("omits a lease that owes nothing on the date", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    expect(await asOf("2026-10-05")).toHaveLength(0);
  });

  it("carries the lease's facility, section, stall, tenant and rate", async () => {
    await charge("2026-10-01");
    const [row] = await asOf("2026-10-01");
    const { rows: meta } = await db.query(
      `select f.id as facility_id, s.id as section_id, st.stall_no, t.full_name
         from ceedo_collections.leases l
         join ceedo_collections.stalls st on st.id = l.stall_id
         join ceedo_collections.sections s on s.id = st.section_id
         join ceedo_collections.facilities f on f.id = s.facility_id
         join ceedo_collections.tenants t on t.id = l.tenant_id
        where l.id = $1`,
      [fx.leaseId],
    );
    expect(row.facility_id).toBe(meta[0].facility_id);
    expect(row.section_id).toBe(meta[0].section_id);
    expect(row.stall_no).toBe(meta[0].stall_no);
    expect(row.tenant_name).toBe(meta[0].full_name);
    expect(Number(row.rate_amount)).toBe(50);
    expect(row.accrual_period).toBe("daily");
  });

  it("agrees with lease_balances and aging_of_receivables at today", async () => {
    for (const [days, amount] of [[0, "5.00"], [10, "10.00"], [45, "20.00"], [75, "30.00"], [120, "40.00"]] as const) {
      await db.query(
        `insert into ceedo_collections.charges
           (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount,
            surcharge_bps, source)
         values ($1, $2, 'rental',
           ceedo_collections.business_date() - $3::int, ceedo_collections.business_date() - $3::int,
           ceedo_collections.business_date() - $3::int, $4, 0, 'manual')`,
        [fx.leaseId, fx.feeTypeId, days, amount],
      );
    }
    const { rows } = await db.query(
      `select a.*, lb.outstanding as lb_outstanding
         from ceedo_collections.lease_balances_as_of(ceedo_collections.business_date()) a
         join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
         join ceedo_collections.aging_of_receivables ag on ag.lease_id = a.lease_id
        where a.lease_id = $1
          and a.not_yet_due = ag.not_yet_due and a.bucket_1_30 = ag.bucket_1_30
          and a.bucket_31_60 = ag.bucket_31_60 and a.bucket_61_90 = ag.bucket_61_90
          and a.bucket_over_90 = ag.bucket_over_90`,
      [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].outstanding)).toBe(Number(rows[0].lb_outstanding));
    expect(Number(rows[0].outstanding)).toBe(105);
  });

  it("returns nothing to an authenticated user who is not staff", async () => {
    await charge("2026-10-01");
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.rpc("lease_balances_as_of", { p_date: "2026-10-31" });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
