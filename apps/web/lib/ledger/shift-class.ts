import { format, type Centavos } from "@ceedo/shared";

/**
 * The parts of the shifts screen a Client Component needs: the classification, the
 * variance wording, and the row shape.
 *
 * Split out of `shifts.ts` because that module reaches the database through
 * `ledgerClient()`, which imports `next/headers` — so a client table importing
 * `formatVariance` from it pulled a server-only module into the browser bundle and broke
 * the build. Types erase; a function does not. `shifts.ts` re-exports everything here, so
 * server callers and the existing tests are unaffected.
 */
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
  /**
   * What is still owed on a short shift after verified repayments (migration
   * 20260929000058). Null when the shift was not short.
   */
  stillOwed: Centavos | null;
  /** Receipts on this shift that have a `collection_recoveries` row -- entered at the
   * office, not synced from the tablet (Task 4's `recover_collection`). Zero for a shift
   * with none, which is the common case and renders no badge. */
  officeEncodedCount: number;
}

/**
 * Per-shift count of office-encoded receipts, from one shift id per `collection_recoveries`
 * row already matched to one of this screen's shifts (`officeEncodedShiftIds()` in
 * lib/ledger/queries.ts does that matching -- the join, not a fetch-then-filter in memory,
 * is what final-review Task 2 fixed: up to 200 shifts' worth of plain `collections` rows
 * can exceed PostgREST's max_rows = 1000, supabase/config.toml, and silently truncate,
 * while the office-encoded ones are always far fewer). Pure and DB-free so it can be unit
 * tested without a Postgres mock.
 */
export function officeEncodedCounts(shiftIds: ReadonlyArray<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of shiftIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
