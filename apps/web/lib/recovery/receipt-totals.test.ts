import { describe, expect, it } from "vitest";
import { receiptTotals } from "./receipt-totals";

describe("receiptTotals", () => {
  it("counts and totals every receipt when none is cancelled", () => {
    const result = receiptTotals([
      { grossAmount: 500_00, cancelled: false },
      { grossAmount: 300_00, cancelled: false },
    ]);
    expect(result.count).toBe(2);
    expect(result.total).toBe(800_00);
  });

  it("excludes a cancelled receipt from both the count and the total", () => {
    // Task 1: the Recovery screen's "System total" must match what office_close_shift
    // actually books -- its own query excludes standing_cancellations the same way.
    const result = receiptTotals([
      { grossAmount: 500_00, cancelled: false },
      { grossAmount: 300_00, cancelled: true },
    ]);
    expect(result.count).toBe(1);
    expect(result.total).toBe(500_00);
  });

  it("returns a zero count and total when every receipt is cancelled", () => {
    const result = receiptTotals([{ grossAmount: 300_00, cancelled: true }]);
    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
  });

  it("returns a zero count and total for no receipts at all", () => {
    const result = receiptTotals([]);
    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
  });
});
