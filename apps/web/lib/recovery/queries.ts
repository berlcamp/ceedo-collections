import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient, selectByIds } from "@/lib/ledger/queries";
import type { UnpaidGroup } from "./months";

/**
 * Same reasoning as `lib/ledger/queries.ts`'s own `centavos()`: Postgres numeric arrives as
 * a string through PostgREST, and converting here once is what keeps a 2-decimal float out
 * of this screen. `@ceedo/shared` exports `fromPesos`/`fromCentavos`, not a `centavos()` of
 * its own -- this is the same one-line wrapper the ledger reads already define locally.
 */
function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

export interface RecoveryChoices {
  collectors: { id: string; name: string }[];
  devices: { id: string; label: string; lastSeenAt: string | null }[];
}

/** Step 1's pickers: every active collector and every active tablet. */
export async function getRecoveryChoices(): Promise<RecoveryChoices> {
  const supabase = await ledgerClient();
  const [collectors, devices] = await Promise.all([
    supabase
      .from("app_users")
      .select("id, full_name")
      .eq("role", "collector")
      .eq("status", "active")
      .order("full_name"),
    supabase.from("devices").select("id, label, last_seen_at").eq("active", true).order("label"),
  ]);
  if (collectors.error) throw collectors.error;
  if (devices.error) throw devices.error;
  return {
    collectors: (collectors.data ?? []).map((c) => ({ id: c.id, name: c.full_name })),
    devices: (devices.data ?? []).map((d) => ({ id: d.id, label: d.label, lastSeenAt: d.last_seen_at })),
  };
}

export interface RecoveryReceipt {
  id: string;
  orNo: number;
  stallOrPayer: string;
  grossAmount: number;
  /** Has a `collection_recoveries` row -- came from the office, not the tablet. */
  officeEncoded: boolean;
  /** Has a `standing_cancellations` row -- voided, the same fact `getCollections` (lib/
   * ledger/queries.ts) reads for the collection browser. `office_close_shift`'s own query
   * excludes these from the system count and total (migration 20260930000060), so this
   * screen must too -- see `receiptTotals()`. */
  cancelled: boolean;
}

export interface RecoveryShift {
  id: string;
  collectorId: string;
  collectorName: string;
  deviceId: string;
  deviceLabel: string;
  lastSeenAt: string | null;
  businessDate: string;
  status: string;
  receipts: RecoveryReceipt[];
  /** Centavos, like every other money field here. Null until `office_close_shift` runs. */
  declaredTotal: number | null;
  /** Centavos, signed: negative is short, positive is over. Null until closed. */
  variance: number | null;
}

/** The shift a recovery is being entered into, and every receipt already on it (from the
 * tablet, or office-encoded in an earlier session on this same shift). Null only when the
 * shift itself no longer exists. */
export async function getRecoveryShift(shiftId: string): Promise<RecoveryShift | null> {
  const supabase = await ledgerClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    // A single string literal, not built by concatenation: supabase-js infers a select's
    // shape from the literal type of this argument, and a `string`-widened expression (as
    // `+`-concatenation produces) falls back to an untyped GenericStringError row.
    .select(
      "id, collector_id, device_id, business_date, status, declared_total, variance, collector:app_users!shifts_collector_id_fkey(full_name), device:devices!shifts_device_id_fkey(label, last_seen_at)",
    )
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw error;
  if (!shift) return null;
  // Recovery is for a tablet's shift. An office shift (migration 0065) has no tablet and is
  // closed from the Office receipt screen instead.
  if (shift.device_id === null) return null;

  const { data: rows, error: rowsError } = await supabase
    .from("collections")
    .select("id, or_no, lease_id, payer_ref, gross_amount")
    .eq("shift_id", shiftId)
    .order("or_no");
  if (rowsError) throw rowsError;

  const ids = (rows ?? []).map((r) => r.id);
  const leaseIds = [...new Set((rows ?? []).map((r) => r.lease_id).filter((id): id is string => id !== null))];
  // Same reasoning and shape as getCollections() in lib/ledger/queries.ts: a receipt
  // cancelled after being recovered is still fetched and listed here, just marked and
  // excluded from the totals (receiptTotals()), not hidden.
  const [recovered, leases, cancellations] = await Promise.all([
    selectByIds(ids, (chunk) =>
      supabase.from("collection_recoveries").select("collection_id").in("collection_id", chunk),
    ),
    selectByIds(leaseIds, (chunk) => supabase.from("leases").select("id, stalls(stall_no)").in("id", chunk)),
    selectByIds(ids, (chunk) =>
      supabase.from("standing_cancellations").select("collection_id").in("collection_id", chunk),
    ),
  ]);
  const officeEncoded = new Set(recovered.map((r) => r.collection_id));
  const cancelled = new Set(cancellations.map((c) => c.collection_id));
  const stallByLease = new Map(leases.map((l) => [l.id, l.stalls?.stall_no ?? "—"]));

  return {
    id: shift.id,
    collectorId: shift.collector_id,
    collectorName: shift.collector?.full_name ?? "—",
    deviceId: shift.device_id,
    deviceLabel: shift.device?.label ?? "—",
    lastSeenAt: shift.device?.last_seen_at ?? null,
    businessDate: shift.business_date,
    status: shift.status,
    declaredTotal: shift.declared_total === null ? null : centavos(shift.declared_total),
    variance: shift.variance === null ? null : centavos(shift.variance),
    receipts: (rows ?? []).map((r) => ({
      id: r.id,
      orNo: r.or_no,
      stallOrPayer: r.lease_id ? (stallByLease.get(r.lease_id) ?? "—") : (r.payer_ref ?? "—"),
      grossAmount: centavos(r.gross_amount),
      officeEncoded: officeEncoded.has(r.id),
      cancelled: cancelled.has(r.id),
    })),
  };
}

export interface HeldBooklet {
  id: string;
  label: string;
}

/**
 * Booklets the collector held on that date -- the same test post_collection itself applies
 * (`assigned_at <= business date and (returned_at is null or returned_at >= business
 * date)`, migration 20260918000022), so a booklet this lists is one recover_collection will
 * actually accept.
 */
export async function getHeldBooklets(collectorId: string, date: string): Promise<HeldBooklet[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("booklet_assignments")
    .select("booklet_id, booklets(serial_prefix, start_no, end_no)")
    .eq("collector_id", collectorId)
    .lte("assigned_at", date)
    .or(`returned_at.is.null,returned_at.gte.${date}`);
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.booklet_id,
    label: `${a.booklets?.serial_prefix ?? ""} ${a.booklets?.start_no}–${a.booklets?.end_no}`.trim(),
  }));
}

export interface RecoveryLeaseOption {
  id: string;
  label: string;
}

/**
 * Active leases in the facilities of the collector's active `collector_assignments` --
 * where this collector actually walks, not every lease in the system.
 *
 * Filtered by the database, not fetched-then-filtered in memory: a plain `.eq()` reaches
 * only into a *listed* embed's own columns, but PostgREST does resolve a dot-path filter
 * through a chain of embeds (`stalls.sections.facility_id`) when every embed on that path
 * is `!inner`, which is also what makes the filter apply as a join condition rather than
 * nulling out the embed on a non-match. Pulling every active lease first (1284 in this
 * seed already, and PostgREST's own row cap would silently truncate a bigger one) would be
 * the wrong shape for what is a small, facility-scoped list.
 */
export async function getCollectorLeases(collectorId: string): Promise<RecoveryLeaseOption[]> {
  const supabase = await ledgerClient();
  const { data: assignments, error: assignmentsError } = await supabase
    .from("collector_assignments")
    .select("facility_id")
    .eq("collector_id", collectorId)
    .eq("active", true);
  if (assignmentsError) throw assignmentsError;
  const facilityIds = [...new Set((assignments ?? []).map((a) => a.facility_id))];
  if (facilityIds.length === 0) return [];

  const { data: leases, error: leasesError } = await supabase
    .from("leases")
    .select("id, stalls!inner(stall_no, sections!inner(facility_id, name)), tenants(full_name)")
    .eq("status", "active")
    .in("stalls.sections.facility_id", facilityIds);
  if (leasesError) throw leasesError;

  // Stall, section, tenant: a stall number alone repeats across sections, and the stub names
  // the tenant, so the admin needs all three to be sure which lease the receipt was for.
  return (leases ?? [])
    .map((l) => ({
      id: l.id,
      label: [l.stalls?.stall_no, l.stalls?.sections?.name, l.tenants?.full_name]
        .map((part) => part ?? "—")
        .join(" · "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * `leases` carries no `fee_type_id` column (migration 20260917000004 never gave it one --
 * see the same comment in `apps/collector/src/app/lease/[leaseId].tsx`). Every charge
 * raised on a lease shares the one fee type `rental_fee_type()` maps its accrual period to
 * (migration 20260918000013); that is the same mapping the nightly accrual job and the
 * tablet both use, so this is the correct id to send `recover_collection`, not a guess.
 */
export async function getLeaseFeeType(leaseId: string): Promise<string | null> {
  const supabase = await ledgerClient();
  const { data: lease, error: leaseError } = await supabase
    .from("leases")
    .select("accrual_period")
    .eq("id", leaseId)
    .maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return null;

  const { data: feeTypeId, error: feeTypeError } = await supabase.rpc("rental_fee_type", {
    p_accrual_period: lease.accrual_period,
  });
  if (feeTypeError) throw feeTypeError;
  return feeTypeId;
}

/** The lease's unpaid period groups, oldest first -- the same `unpaid_period_groups()`
 * `post_collection` itself allocates against, so a run this offers is a run it will accept. */
export async function getUnpaidGroups(leaseId: string): Promise<UnpaidGroup[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("unpaid_period_groups", { p_lease_id: leaseId });
  if (error) throw error;
  return (data ?? [])
    .map((g) => ({
      groupRank: g.group_rank,
      periodStart: g.period_start,
      periodEnd: g.period_end,
      outstanding: centavos(g.outstanding),
    }))
    .sort((a, b) => a.groupRank - b.groupRank);
}

export interface CashFeeRateClass {
  rateClass: string;
  amount: number;
  basis: string;
}

export interface CashFeeType {
  id: string;
  name: string;
  rateClasses: CashFeeRateClass[];
}

/** Non-accruing fee types (parking, terminal, slaughterhouse -- a cash receipt with no
 * lease), each with the rate classes that have a rate in effect on `date`. A fee type with
 * no rate in effect that day is still listed, with an empty list, so the form can say so
 * rather than silently hiding the fee. */
export async function getCashFeeTypes(date: string): Promise<CashFeeType[]> {
  const supabase = await ledgerClient();
  const [{ data: feeTypes, error: feeTypesError }, { data: rates, error: ratesError }] = await Promise.all([
    supabase.from("fee_types").select("id, name").eq("accrues", false).eq("active", true).order("name"),
    supabase
      .from("rates")
      .select("fee_type_id, rate_class, amount, basis")
      .lte("effective_from", date)
      .or(`effective_to.is.null,effective_to.gte.${date}`),
  ]);
  if (feeTypesError) throw feeTypesError;
  if (ratesError) throw ratesError;

  const rateClassesByFeeType = new Map<string, CashFeeRateClass[]>();
  for (const r of rates ?? []) {
    const list = rateClassesByFeeType.get(r.fee_type_id) ?? [];
    list.push({ rateClass: r.rate_class, amount: centavos(r.amount), basis: r.basis });
    rateClassesByFeeType.set(r.fee_type_id, list);
  }

  return (feeTypes ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    rateClasses: rateClassesByFeeType.get(f.id) ?? [],
  }));
}
