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
};

type LedgerSchema = Omit<Database["ceedo_collections"], "Views" | "Tables"> & {
  Views: LedgerViews;
  Tables: Database["ceedo_collections"]["Tables"] & LedgerTables;
};
type LedgerDatabase = Omit<Database, "ceedo_collections"> & { ceedo_collections: LedgerSchema };

/**
 * `getServerClient()` is correctly typed against the generated `Database`; the cast below
 * only widens its `Views` map to the shapes declared above. It is a type-level bridge over
 * a generator gap (see `LedgerViews`), not a guess at runtime shape -- the columns it
 * asserts are the ones the view migration actually selects. `Tables` (used for `leases` and
 * `collection_cancellations` below) are untouched and still fully generated-checked.
 */
async function ledgerClient(): Promise<SupabaseClient<LedgerDatabase, "ceedo_collections">> {
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

  return rows.map((r) => ({
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
  }));
}
