import { describe, expect, it } from "vitest";
import type { PeriodGroup } from "./fifo";
import { fromCentavos } from "./money";
import { groupByMonth, monthLabel } from "./period-months";

function day(rank: number, periodStart: string, centavos = 5_000): PeriodGroup {
  return {
    groupRank: rank,
    periodStart,
    dueDate: periodStart,
    chargeIds: [`c${rank}`],
    outstanding: fromCentavos(centavos),
  };
}

describe("groupByMonth", () => {
  it("buckets a daily stall's periods by the month they start in, oldest first", () => {
    const blocks = groupByMonth([
      day(1, "2026-07-30"),
      day(2, "2026-07-31"),
      day(3, "2026-08-01"),
    ]);
    expect(blocks.map((b) => b.month)).toEqual(["2026-07", "2026-08"]);
    expect(blocks[0]!.groups.map((g) => g.groupRank)).toEqual([1, 2]);
    expect(blocks[0]!.outstanding).toBe(10_000);
    expect(blocks[1]!.outstanding).toBe(5_000);
  });

  it("uses the period's start, not its due date", () => {
    // July's last day falls due in August; it is still July's rent.
    const late: PeriodGroup = { ...day(1, "2026-07-31"), dueDate: "2026-08-05" };
    expect(groupByMonth([late])[0]!.month).toBe("2026-07");
  });

  it("gives a monthly lease one block per month, each holding one period", () => {
    const blocks = groupByMonth([
      day(1, "2026-06-01", 185_000),
      day(2, "2026-07-01", 185_000),
      day(3, "2026-08-01", 185_000),
    ]);
    expect(blocks.map((b) => b.groups.length)).toEqual([1, 1, 1]);
  });

  it("keeps every rank, in order, across the blocks", () => {
    const groups = [day(1, "2026-06-29"), day(2, "2026-06-30"), day(3, "2026-07-01")];
    expect(groupByMonth(groups).flatMap((b) => b.groups.map((g) => g.groupRank))).toEqual([
      1, 2, 3,
    ]);
  });

  it("returns nothing for nothing outstanding", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("monthLabel", () => {
  it("names the month in full", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthLabel("2026-12")).toBe("December 2026");
  });
});
