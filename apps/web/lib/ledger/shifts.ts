import { fromPesos } from "@ceedo/shared";
import { classifyShift, officeEncodedCounts, type ShiftClass, type ShiftRow } from "./shift-class";
import { ledgerClient, selectByIds } from "./queries";
import { settlementsByShift } from "../shortages/by-shift";
import { tally } from "../shortages/tally";

// Re-exported so every existing importer (and lib/ledger/shifts.test.ts) keeps working
// against this module unchanged; the definitions now live in the client-safe file.
export { classifyShift, formatVariance, officeEncodedCounts } from "./shift-class";
export type { ShiftClass, ShiftRow } from "./shift-class";

/**
 * Sorted so `stale_open` and `unsynced` rows -- the two states nothing else in the system
 * reports -- appear first regardless of date. A supervisor opening this screen should not
 * have to scroll to find the problem.
 */
const KLASS_PRIORITY: Record<ShiftClass, number> = {
  stale_open: 0,
  unsynced: 1,
  open: 2,
  closed: 3,
  remitted: 4,
};

export async function getShifts(): Promise<ShiftRow[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "id, business_date, status, system_count, system_total, declared_total, variance, collector:app_users!shifts_collector_id_fkey(full_name), device:devices!shifts_device_id_fkey(label)",
    )
    .order("business_date", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const today = new Date().toISOString().slice(0, 10);
  const shiftIds = (data ?? []).map((row) => row.id);
  const [settlements, collections] = await Promise.all([
    settlementsByShift((data ?? []).filter((row) => Number(row.variance ?? 0) < 0).map((row) => row.id)),
    selectByIds(shiftIds, (chunk) =>
      supabase.from("collections").select("id, shift_id").in("shift_id", chunk),
    ),
  ]);
  // Same RLS shape as `getCollections`' own recoveries lookup: a role with no SELECT on
  // collection_recoveries gets an empty array here, not an error, so this screen never
  // breaks for it -- it just shows no "office-encoded" badges.
  const recoveredIds = new Set(
    (
      await selectByIds(
        collections.map((c) => c.id),
        (chunk) => supabase.from("collection_recoveries").select("collection_id").in("collection_id", chunk),
      )
    ).map((r) => r.collection_id),
  );
  const officeEncoded = officeEncodedCounts(
    // shift_id is nullable in the generated type (a collection posted before migration
    // 20260919000043 genuinely has none), but every row here came back from an `.in
    // ("shift_id", chunk)` filter over this list's own shift ids -- never null in practice.
    collections.map((c) => ({ id: c.id, shiftId: c.shift_id! })),
    recoveredIds,
  );

  const rows: ShiftRow[] = (data ?? []).map((row) => ({
    id: row.id,
    collectorName: row.collector?.full_name ?? "Unknown collector",
    deviceLabel: row.device?.label ?? "Unknown device",
    businessDate: row.business_date,
    status: row.status,
    klass: classifyShift({ status: row.status, businessDate: row.business_date, today }),
    systemCount: row.system_count,
    systemTotal: row.system_total === null ? null : fromPesos(Number(row.system_total)),
    declaredTotal: row.declared_total === null ? null : fromPesos(Number(row.declared_total)),
    variance: row.variance === null ? null : fromPesos(Number(row.variance)),
    stillOwed:
      row.variance === null || Number(row.variance) >= 0
        ? null
        : tally(fromPesos(Number(row.variance)), settlements.get(row.id) ?? []).outstanding,
    officeEncodedCount: officeEncoded.get(row.id) ?? 0,
  }));

  return rows.sort((a, b) => {
    const priorityDiff = KLASS_PRIORITY[a.klass] - KLASS_PRIORITY[b.klass];
    if (priorityDiff !== 0) return priorityDiff;
    return a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0;
  });
}
