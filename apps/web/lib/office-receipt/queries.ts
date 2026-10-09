import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient, selectByIds } from "@/lib/ledger/queries";
import { allPages } from "@/lib/reports/data";

export interface OfficeFee {
  id: string;
  name: string;
  keyed: boolean;
  rateClasses: { rateClass: string; amount: Centavos }[];
}

/** Non-accruing active fees: keyed ones with no rate, and rate ones with the classes priced on `date`. */
export async function getOfficeFees(date: string): Promise<OfficeFee[]> {
  const supabase = await ledgerClient();
  const [fees, rates] = await Promise.all([
    supabase.from("fee_types").select("id, name, amount_mode").eq("accrues", false).eq("active", true).order("name"),
    supabase.from("rates").select("fee_type_id, rate_class, amount").lte("effective_from", date)
      .or(`effective_to.is.null,effective_to.gte.${date}`),
  ]);
  if (fees.error) throw fees.error;
  if (rates.error) throw rates.error;
  return (fees.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    keyed: f.amount_mode === "keyed",
    rateClasses: (rates.data ?? [])
      .filter((r) => r.fee_type_id === f.id)
      .map((r) => ({ rateClass: r.rate_class, amount: fromPesos(Number(r.amount)) })),
  }));
}

/** Every active lease, "stall · section · tenant": the office takes payments for any of them. */
export async function getAllActiveLeases(): Promise<{ id: string; label: string }[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((from, to) =>
    supabase.from("leases")
      .select("id, stalls(stall_no, sections(name, facilities(name))), tenants(full_name)")
      .eq("status", "active")
      .order("id")
      .range(from, to),
  );
  return rows
    .map((l) => ({
      id: l.id,
      label: [l.stalls?.sections?.facilities?.name, l.stalls?.sections?.name, l.stalls?.stall_no, l.tenants?.full_name]
        .map((p) => p ?? "—").join(" · "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getOfficers(): Promise<{ id: string; name: string }[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("app_users").select("id, full_name")
    .eq("role", "collector").eq("status", "active").order("full_name");
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, name: u.full_name }));
}

export interface OfficeShift {
  id: string;
  collectorId: string;
  collectorName: string;
  businessDate: string;
  status: string;
  declaredTotal: Centavos | null;
  variance: Centavos | null;
  /** Every receipt on the shift; a standing-cancelled one is listed, flagged, and not counted. */
  receipts: { id: string; orNo: number; payer: string; mode: string; amount: Centavos; cancelled: boolean }[];
  /** Live (uncancelled) cash tickets entered on the shift: part of the cash handed over. */
  cashTickets: { id: string; feeName: string; amount: Centavos }[];
}

export async function getOfficeShift(shiftId: string): Promise<OfficeShift | null> {
  const supabase = await ledgerClient();
  const { data: s, error } = await supabase.from("shifts")
    .select("id, kind, collector_id, business_date, status, declared_total, variance, collector:app_users!shifts_collector_id_fkey(full_name)")
    .eq("id", shiftId).maybeSingle();
  if (error) throw error;
  if (!s || s.kind !== "office") return null;
  // Unique final key (id): a page boundary must not repeat or skip receipts that share an OR number.
  const rows = await allPages((from, to) =>
    supabase.from("collections")
      .select("id, or_no, payer_ref, payment_mode, gross_amount, leases(tenants(full_name))")
      .eq("shift_id", shiftId).order("or_no").order("id").range(from, to),
  );
  const [cancellations, tickets] = await Promise.all([
    selectByIds(rows.map((r) => r.id), (chunk) =>
      supabase.from("standing_cancellations").select("collection_id").in("collection_id", chunk),
    ),
    allPages((from, to) =>
      supabase.from("cash_ticket_sales").select("id, amount, fee_types(name)")
        .eq("shift_id", shiftId).is("cancelled_at", null).order("entered_at").order("id").range(from, to),
    ),
  ]);
  const cancelled = new Set(cancellations.map((c) => c.collection_id));
  return {
    id: s.id,
    collectorId: s.collector_id,
    collectorName: s.collector?.full_name ?? "—",
    businessDate: s.business_date,
    status: s.status,
    declaredTotal: s.declared_total === null ? null : fromPesos(Number(s.declared_total)),
    variance: s.variance === null ? null : fromPesos(Number(s.variance)),
    receipts: rows.map((r) => ({
      id: r.id,
      orNo: r.or_no,
      payer: r.leases?.tenants?.full_name ?? r.payer_ref ?? "Walk-in",
      mode: r.payment_mode,
      amount: fromPesos(Number(r.gross_amount)),
      cancelled: cancelled.has(r.id),
    })),
    cashTickets: tickets.map((t) => ({
      id: t.id,
      feeName: t.fee_types?.name ?? "Cash ticket",
      amount: fromPesos(Number(t.amount)),
    })),
  };
}
