import { format, fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "./queries";

export type ShiftClass = "open" | "stale_open" | "unsynced" | "closed" | "remitted";

/**
 * Two states this screen exists to surface, per spec §6.2:
 *
 *   stale_open -- a tablet that never closed out. Nothing else in the system reports this.
 *   unsynced   -- §6.5's closed_unsynced, which "appears on a supervisor dashboard until it
 *                 reconciles".
 */
export function classifyShift(input: {
  status: string;
  businessDate: string;
  today: string;
}): ShiftClass {
  if (input.status === "closed_unsynced") return "unsynced";
  if (input.status === "open") {
    return input.businessDate < input.today ? "stale_open" : "open";
  }
  if (input.status === "remitted") return "remitted";
  return "closed";
}

/**
 * A variance of zero and no variance at all are different facts. A shift that has not closed
 * has no declaration to compare, and rendering that as "Balanced" would say the drawer was
 * counted and matched when nobody has counted it.
 *
 * Signed: over and short are different problems. An absolute value would not tell a
 * supervisor which one they are looking at.
 */
export function formatVariance(variance: Centavos | null): string {
  if (variance === null) return "Not yet closed";
  if (variance === 0) return "Balanced";
  const pesos = format(Math.abs(variance) as Centavos);
  return variance > 0 ? `+${pesos} over` : `-${pesos} short`;
}

export interface ShiftRow {
  id: string;
  collectorName: string;
  deviceLabel: string;
  businessDate: string;
  status: string;
  klass: ShiftClass;
  systemCount: number | null;
  systemTotal: Centavos | null;
  declaredTotal: Centavos | null;
  variance: Centavos | null;
}

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
  }));

  return rows.sort((a, b) => {
    const priorityDiff = KLASS_PRIORITY[a.klass] - KLASS_PRIORITY[b.klass];
    if (priorityDiff !== 0) return priorityDiff;
    return a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0;
  });
}
