import type { Centavos } from "@ceedo/shared";
import { pesos } from "../report";

export type AccrualPeriod = "daily" | "weekly" | "monthly";

const PER: Record<AccrualPeriod, string> = { daily: "day", weekly: "week", monthly: "month" };

/** "200.00/day" -- the rate as the office writes it on the April grid. */
export function rateLabel(rate: Centavos, period: AccrualPeriod): string {
  return `${pesos(rate)}/${PER[period]}`;
}

/** Stall numbers in counting order: 2 before 10, letters after digits. */
export function compareStall(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface SectionGroup<T> {
  facilityName: string;
  sectionName: string;
  rows: T[];
}

/** Rows by facility, then section -- the office's area → section blocks. */
export function groupBySection<T extends { facilityName: string; sectionName: string }>(
  rows: T[],
): SectionGroup<T>[] {
  const groups = new Map<string, SectionGroup<T>>();
  for (const row of rows) {
    const key = `${row.facilityName}\u0000${row.sectionName}`;
    let group = groups.get(key);
    if (!group) {
      group = { facilityName: row.facilityName, sectionName: row.sectionName, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()].sort(
    (a, b) => a.facilityName.localeCompare(b.facilityName) || a.sectionName.localeCompare(b.sectionName),
  );
}
