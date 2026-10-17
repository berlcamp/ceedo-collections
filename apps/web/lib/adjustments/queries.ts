// apps/web/lib/adjustments/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { formatDate } from "@/lib/format/date";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages, manilaDate } from "@/lib/reports/data";

export interface AdjustmentRow {
  id: string; account: string; amount: Centavos; note: string; enteredBy: string; enteredOn: string;
  cancelled: boolean; cancelReason: string | null;
}
export interface ControlRow { id: string; amount: Centavos; note: string | null; enteredBy: string; enteredOn: string; inForce: boolean }
export interface AccountOption { id: string; label: string }

/** A month's adjustments, cancelled ones included (shown struck through, with the reason). */
export async function adjustmentsFor(monthStart: string): Promise<AdjustmentRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("monthly_adjustments")
      .select("id, amount, note, entered_at, cancelled_at, cancel_reason, collection_accounts(code, name), entered:app_users!monthly_adjustments_entered_by_fkey(full_name)")
      .eq("month", monthStart).order("entered_at").order("id").range(a, b),
  );
  return rows.map((r) => ({
    id: r.id,
    account: r.collection_accounts ? `${r.collection_accounts.code} · ${r.collection_accounts.name}` : "—",
    amount: fromPesos(Number(r.amount)),
    note: r.note,
    enteredBy: r.entered?.full_name ?? "—",
    enteredOn: formatDate(manilaDate(r.entered_at)),
    cancelled: r.cancelled_at !== null,
    cancelReason: r.cancel_reason,
  }));
}

/** Every control-total entry for a month, latest first; the first is the one in force. */
export async function controlTotalsFor(monthStart: string): Promise<ControlRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("monthly_control_totals")
      .select("id, amount, note, entered_at, entered:app_users!monthly_control_totals_entered_by_fkey(full_name)")
      .eq("month", monthStart).order("entered_at", { ascending: false }).order("id").range(a, b),
  );
  return rows.map((r, i) => ({
    id: r.id,
    amount: fromPesos(Number(r.amount)),
    note: r.note,
    enteredBy: r.entered?.full_name ?? "—",
    enteredOn: formatDate(manilaDate(r.entered_at)),
    inForce: i === 0,
  }));
}

/** Active accounts an adjustment may go to: every one but UNCLASSIFIED. */
export async function adjustableAccounts(): Promise<AccountOption[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("collection_accounts").select("id, code, name")
      .eq("active", true).neq("code", "UNCLASSIFIED").order("sort_order").order("id").range(a, b),
  );
  return rows.map((r) => ({ id: r.id, label: `${r.code} · ${r.name}` }));
}
