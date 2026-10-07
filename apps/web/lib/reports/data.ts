import { fromPesos, type Centavos } from "@ceedo/shared";
import { recoveredCollectionIds } from "@/lib/ledger/queries";
import { getServerClient } from "@/lib/supabase/server";
import type { BookletInput, Consumption } from "./accountability";
import type { BalanceRow } from "./builders/balances";
import type { OpenException } from "./open-exceptions";

/**
 * Reads for the report builders. Every list is read in pages: PostgREST returns at most
 * 1000 rows per request, and a month of a market's receipts passes that. Truncating
 * silently would print a report whose totals are simply wrong.
 */
const PAGE = 1000;
const IN_CHUNK = 200;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function allPages<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function byIds<T>(ids: string[], read: (chunk: string[]) => Page<T>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await read(unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/** A Manila calendar date from a timestamp. */
export function manilaDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(timestamp));
}

export interface ReceiptRow {
  id: string;
  orNo: number;
  bookletId: string;
  collectorId: string;
  businessDate: string;
  feeTypeId: string;
  leaseId: string | null;
  payer: string;
  amount: Centavos;
  cancelled: boolean;
  /** Has a `collection_recoveries` row -- entered at the office after the tablet that
   * wrote it was wiped, not synced from a device (spec §4.2: every report listing
   * individual receipts carries the same flag the screens do). */
  officeEncoded: boolean;
}

/** Receipts between two business dates, optionally one collector's, cancelled and
 * office-encoded ones flagged.
 *
 * `officeEncoded: false` skips the `collection_recoveries` lookup entirely (`officeEncoded`
 * comes back `false` on every row, not a correct-but-unread value). Final-review Task 7:
 * the RCD's "earlier" range (builders/rcd.ts, everything before the report's own day) is
 * only ever summed through `live()` for the undeposited-before figure -- its rows'
 * `officeEncoded` is never read -- so that lookup was pure cost with no caller. */
export async function receipts(
  from: string,
  to: string,
  collectorId?: string | null,
  options: { officeEncoded?: boolean } = {},
): Promise<ReceiptRow[]> {
  const supabase = await getServerClient();
  const rows = await allPages((a, b) => {
    let q = supabase
      .from("collections")
      .select("id, or_no, booklet_id, collector_id, business_date, fee_type_id, lease_id, payer_ref, gross_amount")
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date")
      .order("or_no")
      .range(a, b);
    if (collectorId) q = q.eq("collector_id", collectorId);
    return q;
  });

  const ids = rows.map((r) => r.id);
  const cancelled = new Set(
    (
      await byIds(ids, (chunk) =>
        supabase.from("standing_cancellations").select("collection_id").in("collection_id", chunk),
      )
    ).map((c) => c.collection_id),
  );
  const officeEncoded =
    options.officeEncoded === false ? new Set<string>() : await recoveredCollectionIds(supabase, ids);
  const leases = await byIds(
    rows.flatMap((r) => (r.lease_id ? [r.lease_id] : [])),
    (chunk) => supabase.from("leases").select("id, stalls(stall_no), tenants(full_name)").in("id", chunk),
  );
  const payerByLease = new Map(
    leases.map((l) => [l.id, `${l.stalls.stall_no} · ${l.tenants.full_name}`]),
  );

  return rows.map((r) => ({
    id: r.id,
    orNo: r.or_no,
    bookletId: r.booklet_id,
    collectorId: r.collector_id,
    businessDate: r.business_date,
    feeTypeId: r.fee_type_id,
    leaseId: r.lease_id,
    payer: r.lease_id ? (payerByLease.get(r.lease_id) ?? "—") : (r.payer_ref ?? ""),
    amount: centavos(r.gross_amount),
    cancelled: cancelled.has(r.id),
    officeEncoded: officeEncoded.has(r.id),
  }));
}

export interface SpoiledRow {
  bookletId: string;
  orNo: number;
  on: string;
  reason: string;
}

export async function spoiledForms(bookletIds: string[]): Promise<SpoiledRow[]> {
  const supabase = await getServerClient();
  const rows = await byIds(bookletIds, (chunk) =>
    supabase.from("spoiled_forms").select("booklet_id, or_no, reason, recorded_at").in("booklet_id", chunk),
  );
  return rows.map((r) => ({
    bookletId: r.booklet_id,
    orNo: r.or_no,
    on: manilaDate(r.recorded_at),
    reason: r.reason,
  }));
}

export interface BookletRow extends BookletInput {
  collectorId: string;
  formName: string;
}

/** Booklets with who holds them. `collectorId` narrows to one collector's. */
export async function booklets(collectorId?: string | null): Promise<BookletRow[]> {
  const supabase = await getServerClient();
  const assignments = await allPages((a, b) => {
    let q = supabase
      .from("booklet_assignments")
      .select("booklet_id, collector_id, assigned_at, booklets(serial_prefix, start_no, end_no, form_types(code, name))")
      .order("assigned_at")
      .range(a, b);
    if (collectorId) q = q.eq("collector_id", collectorId);
    return q;
  });
  return assignments.map((a) => ({
    id: a.booklet_id,
    label: a.booklets.serial_prefix,
    startNo: a.booklets.start_no,
    endNo: a.booklets.end_no,
    receivedOn: a.assigned_at.slice(0, 10),
    collectorId: a.collector_id,
    formName: `${a.booklets.form_types.code} ${a.booklets.form_types.name}`.trim(),
  }));
}

/** Every serial consumed in these booklets, up to a date: receipts and spoiled forms. */
export async function consumption(bookletIds: string[], upTo: string): Promise<Map<string, Consumption[]>> {
  const supabase = await getServerClient();
  const used = await byIds(bookletIds, (chunk) =>
    supabase
      .from("collections")
      .select("booklet_id, or_no, business_date")
      .in("booklet_id", chunk)
      .lte("business_date", upTo),
  );
  const spoiled = (await spoiledForms(bookletIds)).filter((s) => s.on <= upTo);
  const out = new Map<string, Consumption[]>();
  const add = (id: string, c: Consumption) => out.set(id, [...(out.get(id) ?? []), c]);
  for (const u of used) add(u.booklet_id, { orNo: u.or_no, on: u.business_date, spoiled: false });
  for (const s of spoiled) add(s.bookletId, { orNo: s.orNo, on: s.on, spoiled: true });
  return out;
}

export async function feeTypeNames(): Promise<Map<string, string>> {
  const supabase = await getServerClient();
  const { data, error } = await supabase.from("fee_types").select("id, name");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((f) => [f.id, f.name]));
}

export async function staffName(id: string): Promise<string | null> {
  const supabase = await getServerClient();
  const { data } = await supabase.from("app_users").select("full_name").eq("id", id).maybeSingle();
  return data?.full_name ?? null;
}

export async function staffNameMap(ids: string[]): Promise<Map<string, string>> {
  const supabase = await getServerClient();
  const rows = await byIds(ids, (chunk) => supabase.from("app_users").select("id, full_name").in("id", chunk));
  return new Map(rows.map((u) => [u.id, u.full_name]));
}

export interface DepositRow {
  id: string;
  collectorId: string;
  slip: string;
  bank: string;
  amount: Centavos;
  on: string;
  verified: boolean;
}

/** Live (not cancelled) deposits between two dates. */
export async function deposits(from: string, to: string, collectorId?: string | null): Promise<DepositRow[]> {
  const supabase = await getServerClient();
  const rows = await allPages((a, b) => {
    let q = supabase
      .from("remittances")
      .select("id, collector_id, deposit_slip_no, bank, amount, deposited_at, verified_at")
      .is("cancelled_at", null)
      .gte("deposited_at", from)
      .lte("deposited_at", to)
      .order("deposited_at")
      .range(a, b);
    if (collectorId) q = q.eq("collector_id", collectorId);
    return q;
  });
  return rows.map((r) => ({
    id: r.id,
    collectorId: r.collector_id,
    slip: r.deposit_slip_no,
    bank: r.bank,
    amount: centavos(r.amount),
    on: r.deposited_at,
    verified: r.verified_at !== null,
  }));
}

/** Every unresolved sync exception, as the report screen's warning scopes them. */
export async function openExceptions(): Promise<OpenException[]> {
  const supabase = await getServerClient();
  const rows = await allPages((from, to) =>
    supabase
      .from("sync_exceptions")
      .select("id, collector_id, payload")
      .neq("status", "resolved")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      collectorId: row.collector_id,
      collectedAt: typeof payload["collected_at"] === "string" ? payload["collected_at"] : null,
      leaseId: typeof payload["lease_id"] === "string" ? payload["lease_id"] : null,
    };
  });
}

/** lease_balances_as_of, paged; optionally one facility. */
export async function balancesAsOf(date: string, facilityId: string | null): Promise<BalanceRow[]> {
  const supabase = await getServerClient();
  const rows = await allPages((from, to) => {
    let q = supabase.rpc("lease_balances_as_of", { p_date: date });
    if (facilityId) q = q.eq("facility_id", facilityId);
    return q.order("lease_id").range(from, to);
  });
  return rows.map((r) => ({
    leaseId: r.lease_id,
    facilityName: r.facility_name,
    sectionName: r.section_name,
    stallNo: r.stall_no,
    tenantName: r.tenant_name,
    rate: centavos(r.rate_amount),
    accrualPeriod: r.accrual_period,
    notYetDue: centavos(r.not_yet_due),
    days1to30: centavos(r.bucket_1_30),
    days31to60: centavos(r.bucket_31_60),
    days61to90: centavos(r.bucket_61_90),
    over90: centavos(r.bucket_over_90),
    outstanding: centavos(r.outstanding),
  }));
}
