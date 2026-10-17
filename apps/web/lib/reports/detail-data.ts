// apps/web/lib/reports/detail-data.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import type { DetailInput, DetailLine } from "./builders/collections-detail";
import { allPages, byIds, mapPool } from "./data";
import { monthBounds } from "./params";

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/** Days read at once: enough to overlap round trips, few enough not to crowd PostgREST. */
const DAYS_AT_ONCE = 4;

/** Every date of a YYYY-MM month. */
function monthDays(month: string): string[] {
  const { to } = monthBounds(month);
  const last = Number(to.slice(8));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Everything the Collections detail reads for one month: the live portions from
 * receipt_account_lines, the chart, and the names its lines show.
 *
 * The portions are read one DAY per call. A month in one call costs about 2 s at
 * production volume, and paging it 1000 rows at a time re-runs the classifier for every
 * page, past PostgREST's 8 s statement limit; a day is a few hundred lines, one page.
 */
export async function collectionsDetailData(month: string, tenantId: string | null): Promise<DetailInput> {
  const supabase = await getServerClient();

  const dayLines = (day: string) =>
    allPages((a, b) =>
      supabase
        .rpc("receipt_account_lines", { p_from: day, p_to: day })
        .eq("cancelled", false)
        .order("or_no").order("collection_id").order("cash_ticket_id").order("line_id")
        .order("portion").order("account_id")
        .range(a, b),
    );

  const [days, accounts, facilities, users, occupancy, tenant] = await Promise.all([
    mapPool(monthDays(month), DAYS_AT_ONCE, dayLines),
    allPages((a, b) =>
      supabase.from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id").range(a, b),
    ),
    allPages((a, b) => supabase.from("facilities").select("id, name").order("name").order("id").range(a, b)),
    // Every user, not just collectors: an office receipt is posted by back-office staff.
    allPages((a, b) => supabase.from("app_users").select("id, full_name").order("full_name").order("id").range(a, b)),
    supabase.from("fee_types").select("id").eq("code", "OCCUPANCY"),
    tenantId
      ? supabase.from("tenants").select("full_name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (occupancy.error) throw new Error(occupancy.error.message);
  if (tenant.error) throw new Error(tenant.error.message);

  const lines: DetailLine[] = days.flat().map((r) => ({
    source: r.source === "cash_ticket" ? "cash_ticket" : "receipt",
    collectionId: r.collection_id,
    cashTicketId: r.cash_ticket_id,
    lineId: r.line_id,
    orNo: r.or_no,
    businessDate: r.business_date,
    collectorId: r.collector_id,
    leaseId: r.lease_id,
    payerRef: r.payer_ref,
    feeTypeId: r.fee_type_id,
    facilityId: r.facility_id,
    portion: r.portion === "surcharge" ? "surcharge" : "base",
    accountId: r.account_id,
    paymentMode: r.payment_mode === "check" ? "check" : "cash",
    amount: centavos(r.amount),
  }));

  const leaseIds = [...new Set(lines.flatMap((l) => (l.leaseId ? [l.leaseId] : [])))];
  const leases = await byIds(leaseIds, (chunk) =>
    supabase.from("leases").select("id, tenant_id, stalls(stall_no), tenants(full_name)").in("id", chunk),
  );

  return {
    month,
    lines,
    accounts: accounts.map((a) => ({
      id: a.id, code: a.code, name: a.name, facilityId: a.facility_id, sortOrder: a.sort_order,
    })),
    facilities,
    collectors: users.map((u) => ({ id: u.id, name: u.full_name })),
    leases: leases.map((l) => ({
      id: l.id, tenantId: l.tenant_id, tenantName: l.tenants.full_name, stallNo: l.stalls.stall_no,
    })),
    occupancyFeeTypeIds: (occupancy.data ?? []).map((f) => f.id),
    tenantName: tenant.data?.full_name ?? null,
  };
}
