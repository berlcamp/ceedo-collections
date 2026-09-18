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
 * Task 14 created `aging_of_receivables`, `delinquency_list`, `lease_balances` and
 * `subsidiary_ledger` as `security_invoker` views. `packages/shared/src/db.types.ts` is
 * regenerated from the database in Task 19 -- until then its `Views` map is empty, so
 * `supabase.from("aging_of_receivables")` does not typecheck against the real `Database`
 * type. These row shapes are declared locally, mirror
 * `supabase/migrations/20260918000024_reporting_views.sql` column-for-column, and should
 * be deleted in favour of the generated ones once Task 19 lands.
 */
type LedgerViews = {
  aging_of_receivables: {
    Row: {
      lease_id: string;
      stall_id: string;
      stall_no: string;
      tenant_name: string;
      bucket_1_30: string | null;
      bucket_31_60: string | null;
      bucket_61_90: string | null;
      bucket_over_90: string | null;
      not_yet_due: string | null;
      total: string | null;
    };
    Relationships: [];
  };
  delinquency_list: {
    Row: {
      lease_id: string;
      stall_no: string;
      tenant_name: string;
      address: string | null;
      contact_no: string | null;
      outstanding: string;
      oldest_due_date: string | null;
      days_overdue: number;
      unpaid_charges: number;
    };
    Relationships: [];
  };
  lease_balances: {
    Row: {
      lease_id: string;
      outstanding: string;
      oldest_due_date: string | null;
      days_overdue: number | null;
      unpaid_charges: number;
    };
    Relationships: [];
  };
  subsidiary_ledger: {
    Row: {
      lease_id: string;
      entry_date: string;
      entry_type: string;
      detail: string;
      period_start: string | null;
      period_end: string | null;
      debit: string;
      credit: string;
      or_no: number | null;
      source_id: string;
      cancelled: boolean;
      running_balance: string;
    };
    Relationships: [];
  };
  /**
   * Mirrors migration 20260918000019's select list column-for-column, same rationale as
   * the views above. Task 18 needs it for two things `subsidiary_ledger` does not carry:
   * a charge's own `outstanding` figure (to default the condone amount) and `charge_type`
   * (to find leases that already have an `opening_balance` charge).
   */
  charge_balances: {
    Row: {
      id: string;
      lease_id: string;
      fee_type_id: string;
      charge_type: string;
      parent_charge_id: string | null;
      period_start: string;
      period_end: string;
      due_date: string;
      amount: string;
      surcharge_bps: number;
      created_at: string;
      allocated: string;
      condoned: string;
      outstanding: string;
      is_settled: boolean;
      days_overdue: number;
    };
    Relationships: [];
  };
};

/**
 * `db.types.ts` has not been regenerated since before ANY of the Phase 2 ledger migrations
 * (0011 onward) -- it is not only the four reporting views that are missing, as the brief
 * anticipated, but the whole ledger schema: `charges`, `collections`,
 * `collection_cancellations`, `charge_balances`, and the rest. This screen needs exactly
 * one of those tables directly (the views cover the rest), so only it is added here.
 * Task 19 should regenerate from every Phase 2 migration, not just add the four views.
 */
type CollectionCancellationInsert = {
  id?: string;
  collection_id: string;
  reason: string;
  cancelled_by: string;
  cancelled_at?: string;
  row_version?: number;
};

/**
 * `collections` itself, needed by Task 18's collection browser. Web never inserts or
 * updates it (no role holds either privilege -- `apply_ledger_policies` grants SELECT
 * only), so `Insert`/`Update` are declared but not exercised from this app; they exist
 * only because the `Tables` map's shape requires them.
 */
type CollectionRowShape = {
  id: string;
  or_no: number;
  booklet_id: string;
  collector_id: string;
  device_id: string;
  collected_at: string;
  business_date: string;
  fee_type_id: string;
  lease_id: string | null;
  payer_ref: string | null;
  gross_amount: string;
  notes: string | null;
  synced_at: string | null;
  posted_at: string;
  posted_by: string | null;
  row_version: number;
};

type LedgerTables = {
  collection_cancellations: {
    Row: {
      id: string;
      collection_id: string;
      reason: string;
      cancelled_by: string;
      cancelled_at: string;
      row_version: number;
    };
    Insert: CollectionCancellationInsert;
    Update: Partial<CollectionCancellationInsert>;
    Relationships: [];
  };
  collections: {
    Row: CollectionRowShape;
    Insert: CollectionRowShape;
    Update: Partial<CollectionRowShape>;
    Relationships: [];
  };
};

/**
 * The three RPCs Task 18 calls, plus `cutover_date()` (read by both the opening-balances
 * screen and its server action). None of these existed when `db.types.ts` was generated
 * either -- same gap as `LedgerViews`/`LedgerTables` above, same fix: a narrow, documented
 * bridge rather than an untyped `.rpc()` call. Argument names and `Returns` mirror the
 * `create function` signatures in migrations 20260918000013, 20260918000020,
 * 20260918000023 and 20260918000012 exactly.
 */
type LedgerFunctions = {
  cancel_collection: {
    Args: { p_collection_id: string; p_reason: string };
    Returns: string;
  };
  condone_charge: {
    Args: {
      p_charge_id: string;
      p_amount: number;
      p_authority_ref: string;
      p_reason: string;
    };
    Returns: string;
  };
  record_opening_balance: {
    Args: {
      p_lease_id: string;
      p_amount: number;
      p_oldest_unpaid_date: string;
      p_authority_ref: string;
    };
    Returns: string;
  };
  cutover_date: {
    Args: never;
    Returns: string;
  };
};

type LedgerSchema = Omit<Database["ceedo_collections"], "Views" | "Tables" | "Functions"> & {
  Views: LedgerViews;
  Tables: Database["ceedo_collections"]["Tables"] & LedgerTables;
  Functions: Database["ceedo_collections"]["Functions"] & LedgerFunctions;
};
type LedgerDatabase = Omit<Database, "ceedo_collections"> & { ceedo_collections: LedgerSchema };

/**
 * `getServerClient()` is correctly typed against the generated `Database`; the cast below
 * only widens its `Views`, `Tables` and `Functions` maps to the shapes declared above. It
 * is a type-level bridge over a generator gap (see `LedgerViews`/`LedgerTables`/
 * `LedgerFunctions`), not a guess at runtime shape -- every column and argument it asserts
 * is one the corresponding migration actually defines. Everything else in `Database` is
 * untouched and still fully generated-checked.
 *
 * Exported so `lib/ledger/actions.ts` reuses this one bridge for its RPC calls rather than
 * adding a fourth `as unknown as` cast of its own.
 */
export async function ledgerClient(): Promise<SupabaseClient<LedgerDatabase, "ceedo_collections">> {
  const supabase = await getServerClient();
  return supabase as unknown as SupabaseClient<LedgerDatabase, "ceedo_collections">;
}

export interface AgingRow {
  leaseId: string;
  stallNo: string;
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

  return (data ?? []).map((r) => ({
    leaseId: r.lease_id,
    stallNo: r.stall_no,
    tenantName: r.tenant_name,
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

  return (data ?? []).map((r) => ({
    leaseId: r.lease_id,
    stallNo: r.stall_no,
    tenantName: r.tenant_name,
    address: r.address,
    contactNo: r.contact_no,
    outstanding: centavos(r.outstanding),
    oldestDueDate: r.oldest_due_date,
    daysOverdue: r.days_overdue,
    unpaidCharges: r.unpaid_charges,
  }));
}

export interface LeaseBalance {
  leaseId: string;
  stallNo: string;
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
        .select("id, stalls(stall_no), tenants(full_name)")
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
  const cancelledIds = rows
    .filter((r) => r.entry_type === "collection" && r.cancelled)
    .map((r) => r.source_id);

  const reasonById = new Map<string, string>();
  if (cancelledIds.length > 0) {
    const { data: cancellations, error: cancellationsError } = await supabase
      .from("collection_cancellations")
      .select("collection_id, reason")
      .in("collection_id", cancelledIds);
    if (cancellationsError) throw cancellationsError;
    for (const c of cancellations ?? []) reasonById.set(c.collection_id, c.reason);
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

  return rows.map((r) => {
    const balance = r.entry_type === "charge" ? balanceById.get(r.source_id) : undefined;
    return {
      leaseId: r.lease_id,
      entryDate: r.entry_date,
      entryType: r.entry_type,
      detail: r.detail,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      debit: centavos(r.debit),
      credit: centavos(r.credit),
      orNo: r.or_no,
      sourceId: r.source_id,
      cancelled: r.cancelled,
      cancellationReason: r.cancelled ? (reasonById.get(r.source_id) ?? null) : null,
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

  const [{ data: collectors, error: collectorsError }, { data: leases, error: leasesError }, { data: cancellations, error: cancellationsError }] =
    await Promise.all([
      supabase.from("app_users").select("id, full_name").in("id", collectorIds),
      leaseIds.length > 0
        ? supabase.from("leases").select("id, stalls(stall_no)").in("id", leaseIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("collection_cancellations").select("collection_id, reason").in("collection_id", collectionIds),
    ]);
  if (collectorsError) throw collectorsError;
  if (leasesError) throw leasesError;
  if (cancellationsError) throw cancellationsError;

  const collectorNameById = new Map((collectors ?? []).map((c) => [c.id, c.full_name]));
  const stallNoByLeaseId = new Map((leases ?? []).map((l) => [l.id, l.stalls?.stall_no ?? "—"]));
  const reasonById = new Map((cancellations ?? []).map((c) => [c.collection_id, c.reason]));

  return rows.map((r) => ({
    id: r.id,
    orNo: r.or_no,
    businessDate: r.business_date,
    collectorName: collectorNameById.get(r.collector_id) ?? "—",
    stallOrPayer: r.lease_id ? (stallNoByLeaseId.get(r.lease_id) ?? "—") : (r.payer_ref ?? "—"),
    grossAmount: centavos(r.gross_amount),
    cancelled: reasonById.has(r.id),
    cancellationReason: reasonById.get(r.id) ?? null,
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
        .select("id, stalls(stall_no), tenants(full_name)")
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
      tenantName: lease.tenants?.full_name ?? "—",
    };
    const opening = openingByLeaseId.get(lease.id);
    if (opening) {
      recorded.push({ ...base, amount: centavos(opening.amount), oldestUnpaidDate: opening.due_date });
    } else {
      pending.push(base);
    }
  }

  return { cutoverDate, pending, recorded };
}
