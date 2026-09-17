import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import { isContiguousPrefix, selectByAmount, type PeriodGroup } from "./fifo";

const groups: PeriodGroup[] = [
  { groupRank: 1, dueDate: "2026-10-01", periodStart: "2026-10-01", chargeIds: ["a"], outstanding: fromCentavos(5000) },
  { groupRank: 2, dueDate: "2026-10-02", periodStart: "2026-10-02", chargeIds: ["b"], outstanding: fromCentavos(5000) },
  { groupRank: 3, dueDate: "2026-10-03", periodStart: "2026-10-03", chargeIds: ["c"], outstanding: fromCentavos(5000) },
];

describe("isContiguousPrefix", () => {
  it("accepts the oldest group alone", () => {
    expect(isContiguousPrefix(groups, [1])).toBe(true);
  });

  it("accepts an oldest-first run", () => {
    expect(isContiguousPrefix(groups, [1, 2])).toBe(true);
  });

  it("accepts every group", () => {
    expect(isContiguousPrefix(groups, [1, 2, 3])).toBe(true);
  });

  it("rejects skipping the oldest", () => {
    expect(isContiguousPrefix(groups, [2, 3])).toBe(false);
  });

  it("rejects a gap in the middle", () => {
    expect(isContiguousPrefix(groups, [1, 3])).toBe(false);
  });

  it("rejects an empty selection", () => {
    expect(isContiguousPrefix(groups, [])).toBe(false);
  });

  it("rejects a rank that is not on offer", () => {
    expect(isContiguousPrefix(groups, [1, 2, 9])).toBe(false);
  });

  it("ignores the order the ranks arrive in", () => {
    expect(isContiguousPrefix(groups, [2, 1])).toBe(true);
  });

  it("rejects a duplicated rank", () => {
    expect(isContiguousPrefix(groups, [1, 1, 2])).toBe(false);
  });
});

describe("selectByAmount", () => {
  it("takes whole periods only and returns the remainder as change", () => {
    const result = selectByAmount(groups, fromCentavos(12000));
    expect(result.selected.map((g) => g.groupRank)).toEqual([1, 2]);
    expect(result.applied).toBe(10000);
    expect(result.change).toBe(2000);
  });

  it("takes nothing when the amount does not cover the oldest period", () => {
    const result = selectByAmount(groups, fromCentavos(3000));
    expect(result.selected).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.change).toBe(3000);
  });

  it("takes everything when the amount covers the lot", () => {
    const result = selectByAmount(groups, fromCentavos(20000));
    expect(result.selected).toHaveLength(3);
    expect(result.change).toBe(5000);
  });

  it("leaves no change on an exact payment", () => {
    const result = selectByAmount(groups, fromCentavos(10000));
    expect(result.selected).toHaveLength(2);
    expect(result.change).toBe(0);
  });

  it("returns the whole amount as change when nothing is owed", () => {
    const result = selectByAmount([], fromCentavos(5000));
    expect(result.selected).toEqual([]);
    expect(result.change).toBe(5000);
  });
});
