// apps/web/lib/accounts/schemas.test.ts
import { describe, expect, it } from "vitest";
import { ruleSchema, sharesToBps } from "./schemas";

describe("sharesToBps", () => {
  it("turns percents into basis points that sum to 10000", () => {
    expect(sharesToBps([{ accountId: "a", percent: "75" }, { accountId: "b", percent: "25" }]))
      .toEqual([{ account_id: "a", share_bps: 7500 }, { account_id: "b", share_bps: 2500 }]);
  });
  it("accepts two decimals", () => {
    expect(sharesToBps([{ accountId: "a", percent: "33.34" }, { accountId: "b", percent: "66.66" }])
      .map((s) => s.share_bps)).toEqual([3334, 6666]);
  });
  it.each([
    [[{ accountId: "a", percent: "90" }]],
    [[{ accountId: "a", percent: "100" }, { accountId: "a", percent: "0" }]],
    [[]],
  ])("refuses %j", (rows) => {
    expect(() => sharesToBps(rows)).toThrow();
  });
});

describe("ruleSchema", () => {
  it("needs a fee type, a portion and a start date, and blanks become null", () => {
    const r = ruleSchema.parse({
      feeTypeId: "00000000-0000-0000-0000-000000000001", facilityId: "", sectionId: "", rateClass: " ",
      portion: "base", effectiveFrom: "2026-10-01",
    });
    expect(r).toMatchObject({ facilityId: null, sectionId: null, rateClass: null });
    expect(ruleSchema.safeParse({ portion: "base", effectiveFrom: "2026-10-01" }).success).toBe(false);
  });
});
