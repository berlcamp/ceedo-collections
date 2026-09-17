import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createCollectionFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
let fx: any;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
  });
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

/**
 * Inserts a charge directly, bypassing run_accrual, with due_date pinned to
 * `ceedo_collections.business_date() - p_daysOverdue` days.
 *
 * Every fixture in this suite pins its cutover/accrual dates to 2026-10-01 forward, which
 * this file's other tests exploit for FIFO ordering -- but charge_balances.days_overdue is
 * computed from the REAL Manila wall-clock date (`business_date()`), not from whatever
 * date run_accrual was told to pretend it was. Confirmed by querying
 * `ceedo_collections.business_date()` directly: it returns the actual "today", which on
 * this project's fixed 2026-10-01 cutover is always in the FUTURE. A charge produced by
 * run_accrual('2026-10-03') therefore always has days_overdue = 0 (clamped by
 * `greatest(0, ...)`), never the "far enough back to land in the over-90 bucket" the
 * original plan assumed. Aging and delinquency logic can only be exercised with charges
 * genuinely older than today, which this inserts directly -- the same technique
 * surcharge.test.ts uses to plant an opening balance outside run_accrual's reach.
 */
async function insertChargeDaysOverdue(
  leaseId: string,
  feeTypeId: string,
  daysOverdue: number,
  amount: string,
): Promise<{ id: string; dueDate: string }> {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount,
        surcharge_bps, source)
     values (
       $1, $2, 'rental',
       ceedo_collections.business_date() - $3::int,
       ceedo_collections.business_date() - $3::int,
       ceedo_collections.business_date() - $3::int,
       $4, 0, 'manual'
     )
     returning id, due_date::text as due_date`,
    [leaseId, feeTypeId, daysOverdue, amount],
  );
  return { id: rows[0].id as string, dueDate: rows[0].due_date as string };
}

describe("lease_balances", () => {
  it("totals what a lease owes and names the oldest due date", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const { rows } = await db.query(
      "select * from ceedo_collections.lease_balances where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].outstanding)).toBe(150);
    // ::text cast in SQL rather than round-tripping through Date#toISOString(), which has
    // been observed shifting a calendar day back on this machine.
    const { rows: dateRows } = await db.query(
      "select oldest_due_date::text as d from ceedo_collections.lease_balances where lease_id = $1",
      [fx.leaseId],
    );
    expect(dateRows[0].d).toBe("2026-10-01");
    expect(rows[0].unpaid_charges).toBe(3);
  });

  it("drops a lease once everything is settled", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows } = await db.query(
      "select * from ceedo_collections.lease_balances where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("aging_of_receivables", () => {
  it("buckets each charge by its own days overdue, not one age per lease", async () => {
    // One lease, five charges, five different ages -- exactly what a tenant paying
    // sporadically produces, and what collapsing to a single per-lease age would hide.
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 0, "5.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 10, "10.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 45, "20.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 75, "30.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 120, "40.00");

    const { rows } = await db.query(
      "select * from ceedo_collections.aging_of_receivables where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(Number(row.not_yet_due)).toBe(5);
    expect(Number(row.bucket_1_30)).toBe(10);
    expect(Number(row.bucket_31_60)).toBe(20);
    expect(Number(row.bucket_61_90)).toBe(30);
    expect(Number(row.bucket_over_90)).toBe(40);
    expect(Number(row.total)).toBe(105);

    const bucketSum =
      Number(row.not_yet_due) + Number(row.bucket_1_30) + Number(row.bucket_31_60) +
      Number(row.bucket_61_90) + Number(row.bucket_over_90);
    expect(bucketSum).toBe(Number(row.total));
  });

  it("agrees with lease_balances on the total -- two surfaces, one number", async () => {
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 10, "10.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 120, "40.00");

    const { rows } = await db.query(
      `select a.total, lb.outstanding
         from ceedo_collections.aging_of_receivables a
         join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
        where a.lease_id = $1`, [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total)).toBe(Number(rows[0].outstanding));
    expect(Number(rows[0].total)).toBe(50);
  });
});

describe("delinquency_list", () => {
  it("omits a lease at exactly 30 days overdue", async () => {
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 30, "40.00");
    const { rows } = await db.query(
      "select * from ceedo_collections.delinquency_list where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(0);
  });

  it("includes a lease over 30 days overdue, carrying the tenant's address and contact for the demand letter", async () => {
    await db.query(
      "update ceedo_collections.tenants set address = $2, contact_no = $3 where id = $1",
      [fx.tenantId, "123 Rizal St., Poblacion", "0917-000-0000"],
    );
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 31, "77.00");

    const { rows } = await db.query(
      "select * from ceedo_collections.delinquency_list where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe("123 Rizal St., Poblacion");
    expect(rows[0].contact_no).toBe("0917-000-0000");
    expect(Number(rows[0].outstanding)).toBe(77);
    expect(rows[0].days_overdue).toBe(31);
    expect(rows[0].unpaid_charges).toBe(1);
  });
});

describe("subsidiary_ledger", () => {
  it("interleaves charges and payments with a running balance", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });

    const { rows } = await db.query(
      `select * from ceedo_collections.subsidiary_ledger
        where lease_id = $1 order by entry_date, entry_type, source_id`, [fx.leaseId],
    );
    expect(rows.filter((r: any) => r.entry_type === "charge")).toHaveLength(2);
    expect(rows.filter((r: any) => r.entry_type === "collection")).toHaveLength(1);
    expect(Number(rows[rows.length - 1].running_balance)).toBe(50);
  });

  it("shows a cancelled receipt as issued and voided, not as absent", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: admin } = await createAppUser({
      email: "reporting-views-admin@example.com", role: "admin",
    });
    const { error } = await admin.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select * from ceedo_collections.subsidiary_ledger
        where lease_id = $1 and entry_type = 'collection'`, [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cancelled).toBe(true);
    expect(Number(rows[0].credit)).toBe(0);
    expect(rows[0].detail).toMatch(/cancelled/);
  });
});

/**
 * Ruling: the property that matters most on every one of these views is
 * `security_invoker = true`. Without it, a view runs with its owner's rights and RLS on
 * the underlying tables (charges, collections, leases, tenants, ...) never applies to
 * whoever queries it -- and auth.users on this Supabase project is shared with unrelated
 * systems, so a definer-rights view over the ledger is a hole straight through the
 * app_users membership gate.
 *
 * Verified over PostgREST as an authenticated user with NO app_users row
 * (`createOutsiderClient()`), never over the owner `db` connection, which is the table
 * owner and bypasses RLS entirely -- proving nothing about policy.
 *
 * Two charges are seeded, not one: an older, 45-day-overdue charge that IS settled
 * through post_collection (feeds subsidiary_ledger's "collection" half with a real row)
 * and a younger, 40-day-overdue charge left UNPAID (feeds
 * lease_balances/aging_of_receivables/delinquency_list, still comfortably > 30 days). The
 * settled charge has to be the older one -- post_collection only accepts a contiguous
 * oldest-first prefix of unpaid groups. Both matter for the mutation test this file's
 * report describes:
 * subsidiary_ledger's collection branch reads ceedo_collections.collections directly, not
 * through another security_invoker view, so it is the one branch that can leak even when
 * every *other* view still filters correctly by construction (each of the other three
 * views' own FROM clause is `charge_balances` or another security_invoker view, which
 * enforces the real caller's RLS regardless of the outer view's own flag -- confirmed by
 * experiment: dropping security_invoker from delinquency_list alone did not leak a row,
 * because it never returns anything charge_balances/aging_of_receivables/lease_balances
 * did not already filter out first). Without a genuine collection row here, a mutation on
 * subsidiary_ledger's own security_invoker would go undetected for exactly the same
 * reason -- the missing branch would still be "empty" whether or not RLS was applied to
 * it.
 */
describe("reporting views respect RLS", () => {
  beforeEach(async () => {
    // Oldest-first FIFO (post_collection only accepts a contiguous prefix of unpaid
    // groups) means the charge actually settled must be the OLDEST one, not the one left
    // behind. So the older of the two (45 days overdue) is the one paid off, and the
    // younger (40 days, still comfortably > 30) is the one left unpaid for
    // lease_balances/aging_of_receivables/delinquency_list to report.
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 45, "45.00");
    await insertChargeDaysOverdue(fx.leaseId, fx.feeTypeId, 40, "40.00");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });
  });

  it("lets a registered accounting user see all four views for the lease", async () => {
    const { client } = await createAppUser({
      email: "reporting-views-accounting@example.com", role: "accounting",
    });
    const [lb, aging, delinq, subs] = await Promise.all([
      client.from("lease_balances").select("*").eq("lease_id", fx.leaseId),
      client.from("aging_of_receivables").select("*").eq("lease_id", fx.leaseId),
      client.from("delinquency_list").select("*").eq("lease_id", fx.leaseId),
      client.from("subsidiary_ledger").select("*").eq("lease_id", fx.leaseId),
    ]);
    expect(lb.error).toBeNull();
    expect(aging.error).toBeNull();
    expect(delinq.error).toBeNull();
    expect(subs.error).toBeNull();
    expect(lb.data!.length).toBeGreaterThan(0);
    expect(aging.data!.length).toBeGreaterThan(0);
    expect(delinq.data!.length).toBeGreaterThan(0);
    expect(subs.data!.length).toBeGreaterThan(0);
  });

  it("shows nothing on lease_balances to an authenticated user with no app_users row", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.from("lease_balances").select("*").eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("shows nothing on aging_of_receivables to an authenticated user with no app_users row", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider
      .from("aging_of_receivables").select("*").eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("shows nothing on delinquency_list to an authenticated user with no app_users row", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider
      .from("delinquency_list").select("*").eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("shows nothing on subsidiary_ledger to an authenticated user with no app_users row", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider
      .from("subsidiary_ledger").select("*").eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
