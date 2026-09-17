import { describe, expect, it } from "vitest";
import { fromPesos } from "./money.js";
import { RateNotFoundError, resolveRate, type RateRow } from "./rates.js";

const rate = (over: Partial<RateRow> & Pick<RateRow, "id" | "effectiveFrom">): RateRow => ({
  feeTypeId: "market-daily",
  rateClass: "",
  effectiveTo: null,
  amount: fromPesos(120),
  basis: "per_day",
  ...over,
});

describe("resolveRate", () => {
  it("returns the rate in force on the given date", () => {
    const rates = [
      rate({ id: "old", effectiveFrom: "2024-01-01", effectiveTo: "2025-12-31", amount: fromPesos(100) }),
      rate({ id: "new", effectiveFrom: "2026-01-01", amount: fromPesos(120) }),
    ];
    expect(resolveRate(rates, "market-daily", "2026-05-01").id).toBe("new");
  });

  it("returns the historical rate for a past date", () => {
    const rates = [
      rate({ id: "old", effectiveFrom: "2024-01-01", effectiveTo: "2025-12-31", amount: fromPesos(100) }),
      rate({ id: "new", effectiveFrom: "2026-01-01", amount: fromPesos(120) }),
    ];
    expect(resolveRate(rates, "market-daily", "2025-06-01").amount).toBe(10000);
  });

  it("treats effective_from as inclusive", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(resolveRate(rates, "market-daily", "2026-01-01").id).toBe("r");
  });

  it("treats effective_to as inclusive", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" })];
    expect(resolveRate(rates, "market-daily", "2026-01-31").id).toBe("r");
  });

  it("distinguishes rate classes", () => {
    const rates = [
      rate({ id: "hog", feeTypeId: "slaughter", rateClass: "hog", effectiveFrom: "2026-01-01", amount: fromPesos(85), basis: "per_head" }),
      rate({ id: "goat", feeTypeId: "slaughter", rateClass: "goat", effectiveFrom: "2026-01-01", amount: fromPesos(45), basis: "per_head" }),
    ];
    expect(resolveRate(rates, "slaughter", "2026-05-01", "goat").amount).toBe(4500);
  });

  it("throws when no rate covers the date", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(() => resolveRate(rates, "market-daily", "2025-01-01")).toThrow(RateNotFoundError);
  });

  it("throws when the fee type is unknown", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(() => resolveRate(rates, "parking", "2026-05-01")).toThrow(RateNotFoundError);
  });

  it("throws rather than guessing when two rates overlap", () => {
    const rates = [
      rate({ id: "a", effectiveFrom: "2026-01-01" }),
      rate({ id: "b", effectiveFrom: "2026-02-01" }),
    ];
    expect(() => resolveRate(rates, "market-daily", "2026-05-01")).toThrow(/ambiguous/i);
  });
});
