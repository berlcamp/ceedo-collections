/**
 * Which unpaid months a recovered lease receipt may pay. post_collection settles whole
 * period groups, oldest first, as a contiguous run from rank 1 (`allocation_not_prefix`).
 * The form enforces the same rule so an admin cannot tick a pattern the server will refuse.
 */
export interface UnpaidGroup {
  groupRank: number;
  periodStart: string;
  periodEnd: string;
  /** Centavos. */
  outstanding: number;
}

/** Whether `rank` may be toggled given what is ticked now. */
export function canTick(groups: UnpaidGroup[], ticked: number[], rank: number): boolean {
  if (!groups.some((g) => g.groupRank === rank)) return false;
  const newest = ticked.length === 0 ? 0 : Math.max(...ticked);
  return ticked.includes(rank) ? rank === newest : rank === newest + 1;
}

/** Sorted group ranks for a ticked set, or throws if it is not a contiguous run from 1 --
 * the same shape post_collection's own allocation_not_prefix check requires. */
export function tickedRanks(ticked: number[]): number[] {
  if (ticked.length === 0) throw new Error("Tick at least one month");
  const sorted = [...ticked].sort((a, b) => a - b);
  sorted.forEach((rank, i) => {
    if (rank !== i + 1) throw new Error("Months must run from the oldest unpaid one");
  });
  return sorted;
}

/** Centavos. */
export function tickedTotal(groups: UnpaidGroup[], ticked: number[]): number {
  return groups.filter((g) => ticked.includes(g.groupRank)).reduce((a, g) => a + g.outstanding, 0);
}
