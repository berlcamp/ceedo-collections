// apps/web/lib/reports/daily-data.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import type { DailyInput, DailyPortion, RentCover } from "./builders/daily-collection/types";
import { allPages, byIds } from "./data";

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/**
 * Everything the Daily Collection Report reads for one business date. The portions come
 * from receipt_account_lines(D, D), the one source every collections report shares; the
 * rest is the chart, names, and what each lease receipt settled (for Remarks).
 */
export async function dailyCollectionData(date: string): Promise<DailyInput> {
  const supabase = await getServerClient();

  const [raw, accounts, lines, columns, facilities, sections, feeTypes, collectorRows, signatories] =
    await Promise.all([
      allPages((a, b) =>
        supabase
          .rpc("receipt_account_lines", { p_from: date, p_to: date })
          .order("collector_id").order("or_no").order("collection_id").order("cash_ticket_id")
          .order("line_id").order("portion").order("account_id")
          .range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("collection_accounts")
          .select("id, code, name, sort_order, treasurer_line_id, rcd_column_id").order("sort_order").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("treasurer_lines").select("id, code, name, sort_order, subtotal_group, active").order("sort_order").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("rcd_columns").select("id, code, name, sort_order, active").order("sort_order").range(a, b),
      ),
      allPages((a, b) => supabase.from("facilities").select("id, name, type").order("name").range(a, b)),
      allPages((a, b) => supabase.from("sections").select("id, name").order("name").range(a, b)),
      allPages((a, b) => supabase.from("fee_types").select("id, name").order("name").range(a, b)),
      allPages((a, b) =>
        supabase.from("app_users").select("id, full_name, status").eq("role", "collector").order("full_name").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("report_signatories").select("label, name, title")
          .eq("report_key", "daily-collection").eq("active", true).order("sort_order").range(a, b),
      ),
    ]);

  const portions: DailyPortion[] = raw.map((r) => ({
    source: r.source as DailyPortion["source"],
    collectionId: r.collection_id,
    cashTicketId: r.cash_ticket_id,
    lineId: r.line_id,
    orNo: r.or_no,
    bookletId: r.booklet_id,
    shiftId: r.shift_id,
    collectorId: r.collector_id,
    leaseId: r.lease_id,
    payerRef: r.payer_ref,
    feeTypeId: r.fee_type_id,
    facilityId: r.facility_id,
    sectionId: r.section_id,
    rateClass: r.rate_class,
    quantity: r.quantity,
    accountId: r.account_id,
    paymentMode: r.payment_mode as DailyPortion["paymentMode"],
    amount: centavos(r.amount),
    cancelled: r.cancelled,
  }));

  const ids = (pick: (p: DailyPortion) => string | null) =>
    [...new Set(portions.map(pick).filter((x): x is string => x !== null))];
  const leaseReceiptIds = [
    ...new Set(portions.filter((p) => p.leaseId && !p.lineId && p.collectionId).map((p) => p.collectionId!)),
  ];
  const knownCollectors = new Set(collectorRows.map((c) => c.id));
  const otherCollectorIds = ids((p) => p.collectorId).filter((id) => !knownCollectors.has(id));

  const [shiftRows, bookletRows, leaseRows, allocationRows, ticketRows, otherCollectors] = await Promise.all([
    byIds(ids((p) => p.shiftId), (chunk) =>
      supabase.from("shifts").select("id, remittances(deposited_at, verified_at, cancelled_at)").in("id", chunk),
    ),
    byIds(ids((p) => p.bookletId), (chunk) => supabase.from("booklets").select("id, serial_prefix").in("id", chunk)),
    byIds(ids((p) => p.leaseId), (chunk) =>
      supabase.from("leases").select("id, stalls(stall_no), tenants(full_name)").in("id", chunk),
    ),
    byIds(leaseReceiptIds, (chunk) =>
      supabase.from("collection_allocations")
        .select("collection_id, amount, charges(charge_type, period_start, period_end)").in("collection_id", chunk),
    ),
    byIds(ids((p) => p.cashTicketId), (chunk) =>
      supabase.from("cash_ticket_sales").select("id, ticket_from, ticket_to, note").in("id", chunk),
    ),
    byIds(otherCollectorIds, (chunk) => supabase.from("app_users").select("id, full_name, status").in("id", chunk)),
  ]);

  const cover = new Map<string, RentCover>();
  for (const a of allocationRows) {
    const c = cover.get(a.collection_id) ?? { collectionId: a.collection_id, allocated: centavos(0), periods: [] };
    c.allocated = (c.allocated + centavos(a.amount)) as Centavos;
    if (a.charges.charge_type === "rental") c.periods.push({ start: a.charges.period_start, end: a.charges.period_end });
    cover.set(a.collection_id, c);
  }

  return {
    date,
    portions,
    accounts: accounts.map((a) => ({
      id: a.id, code: a.code, name: a.name, sortOrder: a.sort_order,
      treasurerLineId: a.treasurer_line_id, rcdColumnId: a.rcd_column_id,
    })),
    treasurerLines: lines.map((l) => ({
      id: l.id, code: l.code, name: l.name, sortOrder: l.sort_order,
      subtotalGroup: l.subtotal_group === 2 ? 2 : 1, active: l.active,
    })),
    rcdColumns: columns.map((c) => ({ id: c.id, code: c.code, name: c.name, sortOrder: c.sort_order, active: c.active })),
    shifts: shiftRows.map((s) => {
      const r = s.remittances;
      return {
        id: s.id,
        deposit: r && r.cancelled_at === null ? { on: r.deposited_at, verified: r.verified_at !== null } : null,
      };
    }),
    collectors: [...collectorRows, ...otherCollectors].map((c) => ({
      id: c.id, name: c.full_name, active: collectorRows.includes(c) && c.status === "active",
    })),
    facilities: facilities.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    sections,
    feeTypes,
    booklets: bookletRows.map((b) => ({ id: b.id, label: b.serial_prefix })),
    leases: leaseRows.map((l) => ({ id: l.id, tenantName: l.tenants.full_name, stallNo: l.stalls.stall_no })),
    rentCover: [...cover.values()],
    cashTickets: ticketRows.map((t) => ({ id: t.id, ticketFrom: t.ticket_from, ticketTo: t.ticket_to, note: t.note })),
    signatories: signatories.map((s) => ({ label: s.label, name: s.name, title: s.title })),
    unclassifiedAccountId: accounts.find((a) => a.code === "UNCLASSIFIED")?.id ?? null,
  };
}
