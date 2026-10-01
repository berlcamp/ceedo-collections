import type { Database } from "@ceedo/shared";
import { fromPesos, type Centavos } from "@ceedo/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerClient } from "../supabase/server";

/**
 * Postgres numeric arrives as a string through PostgREST. Converting here, once, is what
 * keeps 2-decimal floats out of the ledger UI -- the shortcut the Phase 1 handover flagged
 * and this phase deliberately does not extend.
 */
function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

/**
 * Task 19 regenerated `packages/shared/src/db.types.ts` from every Phase 2 migration, so
 * `charges`, `collections`, `collection_cancellations`, `settings`, `accrual_runs` and the
 * four reporting views (plus `charge_balances` and the ledger RPCs) are now all part of the
 * generated `Database` type. The `LedgerViews`/`LedgerTables`/`LedgerFunctions` bridge and
 * its `as unknown as` cast that Task 17/18 needed are gone -- `getServerClient()` is used
 * directly. One thing the generator does NOT know: a view's own SQL can guarantee a column
 * is never null (e.g. `lease_id` is always present because every row comes from a `charges`
 * join keyed on it), but the generator has no way to see that guarantee and marks every
 * view column nullable. The functions below assert non-null on exactly the columns each
 * view's definition (`supabase/migrations/20260918000024_reporting_views.sql`) guarantees,
 * with a comment at each one.
 */
export async function ledgerClient(): Promise<SupabaseClient<Database, "ceedo_collections">> {
  return getServerClient();
}

/**
 * The most ids that may ride in a single PostgREST `in.(…)` filter.
 *
 * PostgREST takes its filters in the query string, so an `.in()` over N uuids puts roughly
 * 37N characters into the URL, and the server refuses the request outright past its limit
 * ("URI too long", HTTP 414). At 200 that is about 7.4 kB, comfortably inside the usual
 * 8 kB header budget with the rest of the URL and the auth header alongside it.
 *
 * This is not a theoretical bound: the collections browser fetches its window of receipts
 * and then looks their cancellations up by id, so the screen started returning a server
 * error at a few hundred receipts — which, per PRODUCT.md, is the scale this deployment
 * actually reaches.
 */
const IN_CHUNK = 200;

/**
 * Runs `query(idsChunk)` over the ids in batches and concatenates the rows.
 *
 * Deliberately sequential: these are secondary lookups behind a page render, and firing
 * an unbounded number of them at once would trade one failure mode for another.
 */
export async function selectByIds<Row>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await query(ids.slice(i, i + IN_CHUNK));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * The subset of `collectionIds` that has a `collection_recoveries` row -- entered at the
 * office after the tablet that wrote it was wiped, not synced from a device (Task 4's
 * `recover_collection`). Every screen or report that marks a receipt "office-encoded" reads
 * this same set, so the one RLS note lives here instead of being repeated at each call site:
 * a role with no SELECT on `collection_recoveries` (e.g. a collector) has its rows filtered
 * to nothing by Postgres, not refused with an error, so `selectByIds` never throws for that
 * role -- it just returns an empty set, and every caller renders no badge rather than
 * breaking the page.
 */
export async function recoveredCollectionIds(
  supabase: SupabaseClient<Database, "ceedo_collections">,
  collectionIds: string[],
): Promise<Set<string>> {
  const rows = await selectByIds(collectionIds, (chunk) =>
    supabase.from("collection_recoveries").select("collection_id").in("collection_id", chunk),
  );
  return new Set(rows.map((r) => r.collection_id));
}

/**
 * "Stall 12 · Fish": the number and its section. Numbers repeat across sections, so the
 * number alone is ambiguous. Reads a stalls embed selected with `sections(name)`.
 */
function stallLabel(stall: { stall_no: string; sections: { name: string } | null } | null): string {
  return stall ? [`Stall ${stall.stall_no}`, stall.sections?.name].filter(Boolean).join(" · ") : "—";
}

/** stallLabel() for each lease, for the reporting views that carry only stall_no. */
async function stallLabelsByLeaseId(leaseIds: string[]): Promise<Map<string, string>> {
  const supabase = await ledgerClient();
  const leases = await selectByIds(leaseIds, (chunk) =>
    supabase.from("leases").select("id, stalls(stall_no, sections(name))").in("id", chunk),
  );
  return new Map(leases.map((l) => [l.id, stallLabel(l.stalls)]));
}

export interface AgingRow {
  leaseId: string;
  stallNo: string;
  stallLabel: string;
  tenantName: string;
  bucket1to30: Centavos;
  bucket31to60: Centavos;
  bucket61to90: Centavos;
  bucketOver90: Centavos;
  notYetDue: Centavos;
  total: Centavos;
}

export async function getAging(): Promise<AgingRow[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("aging_of_receivables")
    .select("*")
    .order("bucket_over_90", { ascending: false });
  if (error) throw error;

  // lease_id/stall_id/stall_no/tenant_name come from inner joins and a GROUP BY on
  // lease_id (see the view's own definition) -- never null in practice, though the
  // generator marks every view column nullable because it cannot see that guarantee.
  const labels = await stallLabelsByLeaseId((data ?? []).map((r) => r.lease_id!));
  return (data ?? []).map((r) => ({
    leaseId: r.lease_id!,
    stallNo: r.stall_no!,
    stallLabel: labels.get(r.lease_id!) ?? `Stall ${r.stall_no}`,
    tenantName: r.tenant_name!,
    bucket1to30: centavos(r.bucket_1_30),
    bucket31to60: centavos(r.bucket_31_60),
    bucket61to90: centavos(r.bucket_61_90),
    bucketOver90: centavos(r.bucket_over_90),
    notYetDue: centavos(r.not_yet_due),
    total: centavos(r.total),
  }));
}

export interface DelinquencyRow {
  leaseId: string;
  stallNo: string;
  stallLabel: string;
  tenantName: string;
  address: string | null;
  contactNo: string | null;
  outstanding: Centavos;
  oldestDueDate: string | null;
  daysOverdue: number;
  unpaidCharges: number;
}

export async function getDelinquency(): Promise<DelinquencyRow[]> {
  const supabase = await ledgerClient();
  // The view itself is defined with `order by days_overdue desc, outstanding desc`, but
  // that ordering is not guaranteed to survive being selected from again -- Postgres makes
  // no promise that a view's own ORDER BY is preserved for a query over it. Asking for it
  // again here is what actually guarantees the worst-delinquent lease sorts first.
  const { data, error } = await supabase
    .from("delinquency_list")
    .select("*")
    .order("days_overdue", { ascending: false })
    .order("outstanding", { ascending: false });
  if (error) throw error;

  // Same reasoning as getAging() above: lease_id/stall_no/tenant_name/outstanding/
  // days_overdue/unpaid_charges are all guaranteed non-null by the view's joins and
  // aggregates (a row only exists here for a lease with unsettled charges); address and
  // contact_no are genuinely nullable tenant fields.
  const labels = await stallLabelsByLeaseId((data ?? []).map((r) => r.lease_id!));
  return (data ?? []).map((r) => ({
    leaseId: r.lease_id!,
    stallNo: r.stall_no!,
    stallLabel: labels.get(r.lease_id!) ?? `Stall ${r.stall_no}`,
    tenantName: r.tenant_name!,
    address: r.address,
    contactNo: r.contact_no,
    outstanding: centavos(r.outstanding),
    oldestDueDate: r.oldest_due_date,
    daysOverdue: r.days_overdue!,
    unpaidCharges: r.unpaid_charges!,
  }));
}

export interface LeaseBalance {
  leaseId: string;
  stallNo: string;
  stallLabel: string;
  tenantName: string;
  outstanding: Centavos;
  oldestDueDate: string | null;
  daysOverdue: number;
  unpaidCharges: number;
}

/**
 * Returns `null` only when the lease itself does not exist. A lease with nothing owing has
 * no row in `lease_balances` (it is built from unsettled charges only) -- that lease still
 * exists and is reported here with a zero balance, not treated as "not found".
 */
export async function getLeaseBalance(leaseId: string): Promise<LeaseBalance | null> {
  const supabase = await ledgerClient();

  const [{ data: lease, error: leaseError }, { data: balance, error: balanceError }] =
    await Promise.all([
      supabase
        .from("leases")
        .select("id, stalls(stall_no, sections(name)), tenants(full_name)")
        .eq("id", leaseId)
        .maybeSingle(),
      supabase.from("lease_balances").select("*").eq("lease_id", leaseId).maybeSingle(),
    ]);
  if (leaseError) throw leaseError;
  if (balanceError) throw balanceError;
  if (!lease) return null;

  return {
    leaseId,
    stallNo: lease.stalls?.stall_no ?? "—",
    stallLabel: stallLabel(lease.stalls),
    tenantName: lease.tenants?.full_name ?? "—",
    outstanding: centavos(balance?.outstanding ?? null),
    oldestDueDate: balance?.oldest_due_date ?? null,
    daysOverdue: balance?.days_overdue ?? 0,
    unpaidCharges: balance?.unpaid_charges ?? 0,
  };
}

export interface SubsidiaryLedgerEntry {
  leaseId: string;
  entryDate: string;
  entryType: string;
  detail: string;
  periodStart: string | null;
  periodEnd: string | null;
  debit: Centavos;
  credit: Centavos;
  orNo: number | null;
  sourceId: string;
  cancelled: boolean;
  /** Only ever set when `cancelled` is true; the reason a supervisor voided the receipt. */
  cancellationReason: string | null;
  /** Has a `collection_recoveries` row -- entered at the office after the tablet that wrote
   * it was wiped, not synced from a device. Always false for a `charge` row, where the
   * concept does not apply. */
  officeEncoded: boolean;
  runningBalance: Centavos;
  /**
   * Set only when `entryType === "charge"` (`sourceId` is then a `charges.id`). Backs the
   * condone dialog's default amount and its "already fully settled" gate. Null for a
   * `collection` row, where condoning makes no sense.
   */
  outstanding: Centavos | null;
  isSettled: boolean | null;
}

export async function getSubsidiaryLedger(leaseId: string): Promise<SubsidiaryLedgerEntry[]> {
  const supabase = await ledgerClient();

  // Matches the ORDER BY the view's own window function partitions on (migration
  // 20260918000024), so the rows print in the same order the running balance assumes.
  // The view's outer SELECT carries no ORDER BY of its own, and Postgres does not promise
  // to preserve a subquery's ordering once it is selected from again.
  const { data, error } = await supabase
    .from("subsidiary_ledger")
    .select("*")
    .eq("lease_id", leaseId)
    .order("entry_date", { ascending: true })
    .order("entry_type", { ascending: true })
    .order("source_id", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];

  // The view marks a cancelled collection but does not carry the reason -- that lives on
  // collection_cancellations, gated by the same supervisor/accounting/admin read policy
  // (migration 20260918000011's apply_ledger_policies) as everything else on this screen.
  // A second, targeted query for just the cancelled entries' reasons is what lets the page
  // honour "struck through with the reason" without extending the view itself, which is
  // out of scope for a read-only task.
  // source_id is `b.id`/`c.id` in the view's own SELECT (never a NULL-producing
  // expression) -- guaranteed non-null the same way lease_id etc. are above.
  const cancelledIds = rows
    .filter((r) => r.entry_type === "collection" && r.cancelled)
    .map((r) => r.source_id!);

  const reasonById = new Map<string, string>();
  for (const c of await selectByIds(cancelledIds, (chunk) =>
    supabase.from("standing_cancellations").select("collection_id, reason").in("collection_id", chunk),
  )) {
    // A view's columns are all nullable to the type generator; these never are.
    reasonById.set(c.collection_id!, c.reason!);
  }

  // Same reasoning as the cancellation lookup above: subsidiary_ledger's `entry_type =
  // 'charge'` rows carry `source_id = charge_balances.id` (migration 20260918000024), but
  // not that view's own `outstanding`/`is_settled` -- a second, lease-scoped query for
  // just those two columns is what lets the condone dialog default to the right figure
  // without extending the read-only view for a write screen's convenience.
  const { data: balances, error: balancesError } = await supabase
    .from("charge_balances")
    .select("id, outstanding, is_settled")
    .eq("lease_id", leaseId);
  if (balancesError) throw balancesError;
  const balanceById = new Map((balances ?? []).map((b) => [b.id, b]));

  // Same shape as the cancellation/balance lookups above: the view doesn't carry
  // office-encoded status, so a third, targeted query over just this lease's collection
  // rows fills it in. See `recoveredCollectionIds`'s own comment for the RLS note.
  const collectionIds = rows.filter((r) => r.entry_type === "collection").map((r) => r.source_id!);
  const officeEncodedIds = await recoveredCollectionIds(supabase, collectionIds);

  // lease_id/entry_date/entry_type/detail/source_id/cancelled are all direct columns or
  // non-NULL-producing expressions in the view's own CTE (see the migration) -- never null
  // in practice, unlike period_start/period_end/or_no, which the interface already types
  // as nullable because a 'collection' row genuinely has none.
  return rows.map((r) => {
    const sourceId = r.source_id!;
    const balance = r.entry_type === "charge" ? balanceById.get(sourceId) : undefined;
    return {
      leaseId: r.lease_id!,
      entryDate: r.entry_date!,
      entryType: r.entry_type!,
      detail: r.detail!,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      debit: centavos(r.debit),
      credit: centavos(r.credit),
      orNo: r.or_no,
      sourceId,
      cancelled: r.cancelled!,
      cancellationReason: r.cancelled ? (reasonById.get(sourceId) ?? null) : null,
      officeEncoded: r.entry_type === "collection" && officeEncodedIds.has(sourceId),
      runningBalance: centavos(r.running_balance),
      outstanding: balance ? centavos(balance.outstanding) : null,
      isSettled: balance ? balance.is_settled : null,
    };
  });
}

export interface CollectorOption {
  id: string;
  fullName: string;
}

/** For the collection browser's collector filter. Every collector, active or not: a
 * cancelled receipt recorded by someone who has since left is still a valid filter. */
export async function getCollectors(): Promise<CollectorOption[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, full_name")
    .eq("role", "collector")
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }));
}

export interface CollectionRow {
  id: string;
  orNo: number;
  businessDate: string;
  collectorName: string;
  /** The stall a lease-bound receipt settles, or the free-text payer of a cash-only one
   * (parking, terminal, slaughterhouse -- collections with no `lease_id`, see migration
   * 20260918000017). Exactly one of the two is ever meaningful for a given row. */
  stallOrPayer: string;
  grossAmount: Centavos;
  cancelled: boolean;
  cancellationReason: string | null;
  /** Has a `collection_recoveries` row -- entered at the office after the tablet that
   * wrote it was wiped, not synced from a device (Task 4's `recover_collection`). */
  officeEncoded: boolean;
}

/**
 * The collection browser's rows. Reads nothing that Phase 3's tablet sync has not yet
 * written -- an empty array here is correct, not a bug (see the page's own comment).
 */
export async function getCollections(filters: {
  businessDate?: string;
  collectorId?: string;
}): Promise<CollectionRow[]> {
  const supabase = await ledgerClient();

  let query = supabase
    .from("collections")
    .select("id, or_no, business_date, collector_id, lease_id, payer_ref, gross_amount")
    .order("business_date", { ascending: false })
    .order("or_no", { ascending: false });
  if (filters.businessDate) query = query.eq("business_date", filters.businessDate);
  if (filters.collectorId) query = query.eq("collector_id", filters.collectorId);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const collectorIds = [...new Set(rows.map((r) => r.collector_id))];
  const leaseIds = [...new Set(rows.map((r) => r.lease_id).filter((id): id is string => id !== null))];
  const collectionIds = rows.map((r) => r.id);

  const [collectors, leases, cancellations, recoveredIds] = await Promise.all([
    selectByIds(collectorIds, (chunk) =>
      supabase.from("app_users").select("id, full_name").in("id", chunk),
    ),
    selectByIds(leaseIds, (chunk) =>
      supabase.from("leases").select("id, stalls(stall_no)").in("id", chunk),
    ),
    selectByIds(collectionIds, (chunk) =>
      supabase.from("standing_cancellations").select("collection_id, reason").in("collection_id", chunk),
    ),
    recoveredCollectionIds(supabase, collectionIds),
  ]);

  const collectorNameById = new Map(collectors.map((c) => [c.id, c.full_name]));
  const stallNoByLeaseId = new Map(leases.map((l) => [l.id, l.stalls?.stall_no ?? "—"]));
  const reasonById = new Map(cancellations.map((c) => [c.collection_id, c.reason]));

  return rows.map((r) => ({
    id: r.id,
    orNo: r.or_no,
    businessDate: r.business_date,
    collectorName: collectorNameById.get(r.collector_id) ?? "—",
    stallOrPayer: r.lease_id ? (stallNoByLeaseId.get(r.lease_id) ?? "—") : (r.payer_ref ?? "—"),
    grossAmount: centavos(r.gross_amount),
    cancelled: reasonById.has(r.id),
    cancellationReason: reasonById.get(r.id) ?? null,
    officeEncoded: recoveredIds.has(r.id),
  }));
}

/**
 * The one date the whole ledger schema hangs off (migration 20260918000012). Read through
 * the RPC bridge rather than selecting `settings` directly so this and the
 * `recordOpeningBalance` action agree on exactly the same value the database itself will
 * check against -- see `cutover_date()`'s own comment on why a missing row raises instead
 * of returning null.
 */
export async function getCutoverDate(): Promise<string> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("cutover_date");
  if (error) throw error;
  return data;
}

export interface OpeningBalanceLease {
  leaseId: string;
  stallNo: string;
  /** See stallLabel(). */
  stallLabel: string;
  tenantName: string;
}

export interface RecordedOpeningBalance extends OpeningBalanceLease {
  amount: Centavos;
  oldestUnpaidDate: string;
}

export interface OpeningBalanceLeases {
  cutoverDate: string;
  /** Active leases with no `opening_balance` charge yet -- the operator's punch list. */
  pending: OpeningBalanceLease[];
  /** Active leases that already have one, so the operator can see what is already done
   * without it cluttering the list of what is left. */
  recorded: RecordedOpeningBalance[];
}

export async function getOpeningBalanceLeases(): Promise<OpeningBalanceLeases> {
  const supabase = await ledgerClient();

  const [cutoverDate, { data: activeLeases, error: leasesError }, { data: openingCharges, error: chargesError }] =
    await Promise.all([
      getCutoverDate(),
      supabase
        .from("leases")
        .select("id, stalls(stall_no, sections(name)), tenants(full_name)")
        .eq("status", "active")
        .order("id"),
      supabase
        .from("charge_balances")
        .select("lease_id, amount, due_date")
        .eq("charge_type", "opening_balance"),
    ]);
  if (leasesError) throw leasesError;
  if (chargesError) throw chargesError;

  // due_date on an opening_balance charge IS the real oldest-unpaid date, not the cutover
  // -- record_opening_balance() stores it that way deliberately (migration
  // 20260918000013's comment on the insert) so aging buckets it honestly.
  const openingByLeaseId = new Map((openingCharges ?? []).map((c) => [c.lease_id, c]));

  const pending: OpeningBalanceLease[] = [];
  const recorded: RecordedOpeningBalance[] = [];
  for (const lease of activeLeases ?? []) {
    const base = {
      leaseId: lease.id,
      stallNo: lease.stalls?.stall_no ?? "—",
      stallLabel: stallLabel(lease.stalls),
      tenantName: lease.tenants?.full_name ?? "—",
    };
    const opening = openingByLeaseId.get(lease.id);
    if (opening) {
      // due_date is a direct, NOT NULL column of the underlying charges table (see
      // db.types.ts's Tables["charges"]) -- charge_balances only carries it as nullable
      // because the generator treats every view column that way.
      recorded.push({ ...base, amount: centavos(opening.amount), oldestUnpaidDate: opening.due_date! });
    } else {
      pending.push(base);
    }
  }

  return { cutoverDate, pending, recorded };
}
