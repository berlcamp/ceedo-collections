import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages } from "@/lib/reports/data";

export interface TicketShift { id: string; label: string }
export interface TicketRow {
  id: string; collector: string; fee: string; amount: Centavos; serials: string | null;
  note: string | null; cancelled: boolean; cancelReason: string | null; shiftStatus: string;
}

/** The day's shifts (any kind) a ticket can still be entered against: not remitted. */
export async function shiftsOn(date: string): Promise<TicketShift[]> {
  const supabase = await ledgerClient();
  const data = await allPages((a, b) =>
    supabase.from("shifts")
      .select("id, kind, status, collector:app_users!shifts_collector_id_fkey(full_name), device:devices!shifts_device_id_fkey(label)")
      .eq("business_date", date).neq("status", "remitted")
      .order("id").range(a, b),
  );
  return data
    .map((s) => ({ id: s.id, label: `${s.collector?.full_name ?? "—"} · ${s.kind === "office" ? "Office" : s.device?.label ?? "—"} · ${s.status}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Bounded master data (a handful of ticket types), so not paged. */
export async function ticketFees(): Promise<{ id: string; name: string }[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("fee_types").select("id, name")
    .eq("active", true).eq("accrues", false).eq("amount_mode", "keyed").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function ticketsOn(date: string): Promise<TicketRow[]> {
  const supabase = await ledgerClient();
  const data = await allPages((a, b) =>
    supabase.from("cash_ticket_sales")
      .select("id, amount, ticket_from, ticket_to, note, cancelled_at, cancel_reason, fee_types(name), collector:app_users!cash_ticket_sales_collector_id_fkey(full_name), shifts(status)")
      .eq("business_date", date).order("entered_at").order("id").range(a, b),
  );
  return data.map((t) => ({
    id: t.id,
    collector: t.collector?.full_name ?? "—",
    fee: t.fee_types?.name ?? "—",
    amount: fromPesos(Number(t.amount)),
    serials: t.ticket_from === null ? null : `${t.ticket_from}–${t.ticket_to}`,
    note: t.note,
    cancelled: t.cancelled_at !== null,
    cancelReason: t.cancel_reason,
    shiftStatus: t.shifts?.status ?? "—",
  }));
}
