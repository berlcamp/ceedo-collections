// tests/db/monthly-summary-reads.test.ts
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser } from "../helpers/supabase.js";
import { createAccount } from "../helpers/accounts.js";

// The select strings, filters and orderings below are copied verbatim from
// apps/web/lib/reports/summary-data.ts (and, in the last test, data.ts's tenantPaymentData)
// and must be kept in step with them: a wrong column or embedded relation passes the
// typecheck's escape hatches only to fail at runtime.
describe("Monthly summary reads resolve against the live schema", () => {
  const client = async () => (await createAppUser({ email: "msr-supervisor", role: "supervisor" })).client;

  it("summary reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.rpc("monthly_account_totals", { p_from: "2026-10-01", p_to: "2026-10-31" })
        .order("month").order("account_id").range(0, 0),
      supabase.from("collection_accounts")
        .select("id, code, name, facility_id, group_name, sort_order, kind, active").order("sort_order").order("id").range(0, 0),
      supabase.from("facilities").select("id, name").order("name").order("id").range(0, 0),
      supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
        .gte("month", "2026-01-01").lte("month", "2026-12-01").is("cancelled_at", null)
        .order("month").order("id").range(0, 0),
      supabase.from("monthly_control_totals").select("id, month, amount, note, entered_at")
        .gte("month", "2026-01-01").lte("month", "2026-12-01").order("month").order("id").range(0, 0),
      supabase.from("report_signatories").select("label, name, title")
        .eq("report_key", "monthly-summary").eq("active", true).order("sort_order").range(0, 999),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  });

  it("tenant-payments reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.rpc("leases_active_between", { p_from: "2026-10-01", p_to: "2026-10-31" }).order("lease_id").range(0, 0),
      supabase.rpc("lease_home_accounts", { p_from: "2026-10-01", p_to: "2026-10-31" }).order("lease_id").range(0, 0),
      supabase.rpc("tenant_payment_portions", { p_from: "2026-10-01", p_to: "2026-10-31", p_payer_accounts: [] })
        .order("lease_id").order("payer_ref").order("account_id").order("portion").order("business_date").range(0, 0),
      supabase.from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id").range(0, 0),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  }, 30_000); // tenant_payment_portions takes ~6s on the local stack; the default 5s is too tight

  it("a cancelled adjustment is not read", async () => {
    const db = new Client({ connectionString: POSTGRES_URL });
    await db.connect();
    let account: string;
    try {
      account = await createAccount(db);
      const { userId } = await createAppUser({ email: "msr-accounting", role: "accounting" });
      await db.query(
        `insert into ceedo_collections.monthly_adjustments
           (account_id, month, amount, note, entered_by, cancelled_at, cancelled_by, cancel_reason)
         values ($1, '2026-10-01', 9, 'n', $2, now(), $2, 'wrong')`,
        [account, userId],
      );
    } finally {
      await db.end();
    }
    const supabase = await client();
    const { data, error } = await supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
      .eq("account_id", account).is("cancelled_at", null);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
