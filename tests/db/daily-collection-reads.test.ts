import { describe, expect, it } from "vitest";
import { createAppUser } from "../helpers/supabase.js";

// The select strings, filters and orderings below are copied verbatim from
// apps/web/lib/reports/daily-data.ts and must be kept in step with it. A wrong embedded
// relation or column name passes the typecheck's escape hatches only to fail at runtime, so
// each read is run against the live schema as an accounting user.
describe("Daily Collection Report reads resolve against the live schema", () => {
  const nil = ["00000000-0000-0000-0000-000000000000"];
  const client = async () => (await createAppUser({ email: "dcr-accounting", role: "accounting" })).client;

  it("receipt_account_lines", async () => {
    const supabase = await client();
    const { error } = await supabase
      .rpc("receipt_account_lines", { p_from: "2026-10-01", p_to: "2026-10-01" })
      .order("collector_id").order("or_no").order("collection_id").order("cash_ticket_id")
      .order("line_id").order("portion").order("account_id")
      .range(0, 0);
    expect(error).toBeNull();
  });

  it("chart and name reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.from("collection_accounts")
        .select("id, code, name, sort_order, treasurer_line_id, rcd_column_id").order("sort_order").range(0, 0),
      supabase.from("treasurer_lines").select("id, code, name, sort_order, subtotal_group, active").order("sort_order").range(0, 0),
      supabase.from("rcd_columns").select("id, code, name, sort_order, active").order("sort_order").range(0, 0),
      supabase.from("facilities").select("id, name, type").order("name").range(0, 0),
      supabase.from("sections").select("id, name").order("name").range(0, 0),
      supabase.from("fee_types").select("id, name").order("name").range(0, 0),
      supabase.from("app_users").select("id, full_name, status").eq("role", "collector").order("full_name").range(0, 0),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  });

  it("report_signatories returns the two seeded rows", async () => {
    const supabase = await client();
    const { data, error } = await supabase.from("report_signatories").select("label, name, title")
      .eq("report_key", "daily-collection").eq("active", true).order("sort_order").range(0, 999);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("by-id reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.from("shifts").select("id, remittances(deposited_at, verified_at, cancelled_at)").in("id", nil),
      supabase.from("booklets").select("id, serial_prefix").in("id", nil),
      supabase.from("leases").select("id, stalls(stall_no), tenants(full_name)").in("id", nil),
      supabase.from("collection_allocations")
        .select("id, collection_id, amount, charges(charge_type, period_start, period_end)")
        .in("collection_id", nil).order("id").range(0, 999),
      supabase.from("cash_ticket_sales").select("id, ticket_from, ticket_to, note").in("id", nil),
      supabase.from("app_users").select("id, full_name, status").in("id", nil),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  });
});
