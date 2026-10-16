// apps/web/lib/reports/summary-data.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import { shownMonths, type SummaryInput } from "./builders/monthly-summary";
import { allPages } from "./data";
import { manilaToday, monthBounds, yearBounds } from "./params";

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/**
 * Everything the Monthly summary reads for one year: the account × month sums of live
 * receipt portions (monthly_account_totals over receipt_account_lines), the chart, the live
 * adjustments, every control-total entry, and the signatories.
 *
 * The totals are read one month per call, and only for the months the summary shows: a
 * month of receipt portions costs about 2 s at production volume, and PostgREST stops a
 * statement at 8 s, so a whole year in one call would time out.
 */
export async function monthlySummaryData(year: string): Promise<SummaryInput> {
  const { from } = yearBounds(year);
  const lastMonth = `${year}-12-01`;
  const today = manilaToday();
  const supabase = await getServerClient();

  const monthTotals = (month: string) => {
    const b = monthBounds(month);
    return allPages((a, z) =>
      supabase.rpc("monthly_account_totals", { p_from: b.from, p_to: b.to }).order("month").order("account_id").range(a, z),
    );
  };

  const [monthly, accounts, facilities, adjustments, controls, signatories] = await Promise.all([
    Promise.all(shownMonths(year, today).map(monthTotals)),
    allPages((a, b) =>
      supabase.from("collection_accounts")
        .select("id, code, name, facility_id, group_name, sort_order, kind, active").order("sort_order").order("id").range(a, b),
    ),
    allPages((a, b) => supabase.from("facilities").select("id, name").order("name").order("id").range(a, b)),
    allPages((a, b) =>
      supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
        .gte("month", from).lte("month", lastMonth).is("cancelled_at", null)
        .order("month").order("id").range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("monthly_control_totals").select("id, month, amount, note, entered_at")
        .gte("month", from).lte("month", lastMonth).order("month").order("id").range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("report_signatories").select("label, name, title")
        .eq("report_key", "monthly-summary").eq("active", true).order("sort_order").range(a, b),
    ),
  ]);
  const totals = monthly.flat();

  return {
    year,
    today,
    accounts: accounts.map((a) => ({
      id: a.id, code: a.code, name: a.name, facilityId: a.facility_id, groupName: a.group_name,
      sortOrder: a.sort_order, kind: a.kind === "non_income" ? "non_income" : "income", active: a.active,
    })),
    facilities,
    totals: totals.map((t) => ({ month: t.month.slice(0, 7), accountId: t.account_id, amount: centavos(t.amount) })),
    adjustments: adjustments.map((a) => ({
      month: a.month.slice(0, 7), accountId: a.account_id, amount: centavos(a.amount), note: a.note,
    })),
    controls: controls.map((c) => ({
      month: c.month.slice(0, 7), amount: centavos(c.amount), note: c.note, enteredAt: c.entered_at,
    })),
    signatories: signatories.map((s) => ({ label: s.label, name: s.name, title: s.title })),
  };
}
