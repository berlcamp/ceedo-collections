import { fromCentavos, sum, type Centavos } from "./money";
import type { PeriodGroup } from "./fifo";

/** One calendar month of a lease's unpaid periods, oldest first. Parent spec §9.3. */
export interface MonthBlock {
  /** `YYYY-MM`, from the periods' start dates. */
  month: string;
  groups: PeriodGroup[];
  outstanding: Centavos;
}

/**
 * Buckets oldest-first period groups by the month each period STARTS in, keeping order.
 *
 * By period start, not due date: a daily stall's 31 July days are "July" to the tenant
 * and the collector alike, even though the last one falls due on 1 August.
 *
 * Only adjacent groups are merged, so the output is oldest first and each block is a
 * contiguous run of ranks. FIFO selection (a prefix of ranks) therefore always covers
 * whole earlier blocks plus a leading part of at most one more.
 */
export function groupByMonth(groups: readonly PeriodGroup[]): MonthBlock[] {
  const blocks: MonthBlock[] = [];
  for (const group of groups) {
    const month = group.periodStart.slice(0, 7);
    const last = blocks[blocks.length - 1];
    if (last && last.month === month) last.groups.push(group);
    else blocks.push({ month, groups: [group], outstanding: fromCentavos(0) });
  }
  for (const block of blocks) block.outstanding = sum(block.groups.map((g) => g.outstanding));
  return blocks;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2026-07` → `July 2026`. Fixed English, not the device locale: it matches the paper OR. */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? month} ${year}`;
}
