import { describe, expect, it } from "vitest";
import { canTick, tickedRanks, tickedTotal, type UnpaidGroup } from "./months";

const groups: UnpaidGroup[] = [
  { groupRank: 1, periodStart: "2026-07-01", periodEnd: "2026-07-31", outstanding: 150000 },
  { groupRank: 2, periodStart: "2026-08-01", periodEnd: "2026-08-31", outstanding: 150000 },
  { groupRank: 3, periodStart: "2026-09-01", periodEnd: "2026-09-30", outstanding: 165000 },
];

describe("unpaid months on a recovered lease receipt", () => {
  it("allows only the next month after a contiguous run from the oldest", () => {
    expect(canTick(groups, [], 1)).toBe(true);
    expect(canTick(groups, [], 2)).toBe(false);
    expect(canTick(groups, [1], 2)).toBe(true);
    expect(canTick(groups, [1], 3)).toBe(false);
  });

  it("allows unticking only the newest ticked month", () => {
    expect(canTick(groups, [1, 2], 2)).toBe(true);
    expect(canTick(groups, [1, 2], 1)).toBe(false);
  });

  it("maps ticked months to sorted group ranks and refuses a gap", () => {
    expect(tickedRanks([2, 1])).toEqual([1, 2]);
    expect(() => tickedRanks([1, 3])).toThrow(/oldest/);
    expect(() => tickedRanks([])).toThrow(/at least one/);
  });

  it("totals the ticked months in centavos", () => {
    expect(tickedTotal(groups, [1, 2])).toBe(300000);
  });
});
