// tests/db/collections-detail-reads.test.ts
// The Collections detail reads a month one day at a time from receipt_account_lines. The
// select strings, filters and orderings below are copied verbatim from
// apps/web/lib/reports/detail-data.ts and must be kept in step with it: a wrong column or
// embedded relation passes the typecheck's escape hatches only to fail at runtime.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createCollectionFixture, postCollectionAsOwner, resetCutover,
  type CollectionFixture,
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

async function charge(due: string) {
  await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, 'rental', $3::date, $3::date, $3::date, 50.00, 0, 'manual')`,
    [fx.leaseId, fx.feeTypeId, due],
  );
}

async function cancel(collectionId: string) {
  await db.query(
    `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2)`,
    [collectionId, fx.collectorId],
  );
}

const supervisor = async () => (await createAppUser({ email: "cdr-supervisor", role: "supervisor" })).client;

/** The reader's per-day call, as detail-data.ts makes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dayLines = (supabase: any, day: string) =>
  supabase
    .rpc("receipt_account_lines", { p_from: day, p_to: day })
    .eq("cancelled", false)
    .order("or_no").order("collection_id").order("cash_ticket_id").order("line_id")
    .order("portion").order("account_id");

describe("Collections detail reads", () => {
  it("the reader's selects resolve against the live schema", async () => {
    const supabase = await supervisor();
    const results = await Promise.all([
      dayLines(supabase, "2026-10-05").range(0, 0),
      supabase.from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id").range(0, 0),
      supabase.from("facilities").select("id, name").order("name").order("id").range(0, 0),
      supabase.from("app_users").select("id, full_name").order("full_name").order("id").range(0, 0),
      supabase.from("fee_types").select("id").eq("code", "OCCUPANCY"),
      supabase.from("leases").select("id, tenant_id, stalls(stall_no), tenants(full_name)").in("id", [fx.leaseId]),
      supabase.from("tenants").select("full_name").eq("id", fx.tenantId).maybeSingle(),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  }, 30_000);

  it("does not return a cancelled receipt through the reader's call", async () => {
    await charge("2026-10-01");
    await charge("2026-10-02");
    const live = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const gone = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T03:00:00+00:00" });
    await cancel(gone);

    const supabase = await supervisor();
    const { data, error } = await dayLines(supabase, "2026-10-05").in("collection_id", [live, gone]);
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((r: { collection_id: string }) => r.collection_id))).toEqual(new Set([live]));
  }, 30_000);

  it("a month read day by day equals the Monthly summary's month", async () => {
    const rent = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[rent, 10000]] });
    for (const due of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) await charge(due);
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-01T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-15T02:00:00+00:00" });
    const gone = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-20T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-31T02:00:00+00:00" });
    await cancel(gone);

    const { rows: [r] } = await db.query(
      `select (select sum(l.amount)
                 from generate_series('2026-10-01'::date, '2026-10-31'::date, interval '1 day') d,
                      ceedo_collections.receipt_account_lines(d::date, d::date) l
                where not l.cancelled and l.account_id = $1)::text as by_day,
              (select sum(t.amount) from ceedo_collections.monthly_account_totals('2026-10-01', '2026-10-31') t
                where t.account_id = $1)::text as summary`,
      [rent],
    );
    expect(Number(r.by_day)).toBe(150);
    expect(Number(r.summary)).toBe(Number(r.by_day));
  });
});
