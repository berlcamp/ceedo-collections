import { type Centavos } from "./money";

export interface PeriodGroup {
  /** 1-based position in oldest-first order. */
  groupRank: number;
  dueDate: string;
  periodStart: string;
  /** The rental charge and its surcharge, or a standalone opening balance. */
  chargeIds: string[];
  outstanding: Centavos;
}

/**
 * Whether a selection is a contiguous oldest-first prefix (invariant #5).
 *
 * Groups are assumed already ordered oldest-first by the caller -- the database orders
 * them by (due_date, period_start) in unpaid_period_groups(). This function checks the
 * SHAPE of the selection, not the ordering of the input.
 *
 * FIFO is what stops arrears being kept alive indefinitely: without it a tenant pays this
 * month, stays technically current, and the oldest debt never moves.
 */
export function isContiguousPrefix(
  groups: readonly PeriodGroup[],
  selectedRanks: readonly number[],
): boolean {
  if (selectedRanks.length === 0) return false;

  const unique = new Set(selectedRanks);
  // A duplicated rank would let a caller allocate twice against one period while still
  // looking like a prefix by length.
  if (unique.size !== selectedRanks.length) return false;

  const available = new Set(groups.map((g) => g.groupRank));
  for (const rank of unique) {
    if (!available.has(rank)) return false;
  }

  // A prefix of length n is exactly the ranks 1..n. Nothing else qualifies.
  for (let rank = 1; rank <= unique.size; rank += 1) {
    if (!unique.has(rank)) return false;
  }
  return true;
}

/**
 * Amount-driven selection: given what the tenant is handing over, take the longest
 * oldest-first run of WHOLE periods it covers and return the rest as change.
 *
 * Whole periods only (parent spec §8.3, §14). A partial period would leave a charge
 * neither settled nor untouched, and the next collector would have to work out what the
 * remainder means at a stall with a queue behind them.
 */
export function selectByAmount(
  groups: readonly PeriodGroup[],
  tendered: Centavos,
): { selected: PeriodGroup[]; applied: Centavos; change: Centavos } {
  const selected: PeriodGroup[] = [];
  let remaining: number = tendered;

  for (const group of groups) {
    if (group.outstanding > remaining) break;
    selected.push(group);
    remaining -= group.outstanding;
  }

  return {
    selected,
    applied: (tendered - remaining) as Centavos,
    change: remaining as Centavos,
  };
}
