import { fromCentavos } from "@ceedo/shared";
import { describe, expect, it } from "vitest";
import { classifyShift, formatVariance, officeEncodedCounts } from "./shifts";

describe("classifyShift", () => {
  it("flags a shift still open after its business date", () => {
    // The condition NOTHING ELSE in the system reports. §6.5 permits an offline closeout as
    // closed_unsynced and says the shift "appears on a supervisor dashboard until it
    // reconciles" -- but a tablet that simply never closed out produces no record at all
    // beyond an open row nobody is looking at.
    expect(
      classifyShift({ status: "open", businessDate: "2026-10-05", today: "2026-10-07" }),
    ).toBe("stale_open");
  });

  it("does not flag a shift open on its own business date", () => {
    expect(
      classifyShift({ status: "open", businessDate: "2026-10-07", today: "2026-10-07" }),
    ).toBe("open");
  });

  it("flags closed_unsynced regardless of date", () => {
    expect(
      classifyShift({
        status: "closed_unsynced",
        businessDate: "2026-10-07",
        today: "2026-10-07",
      }),
    ).toBe("unsynced");
  });

  it("treats a closed shift as settled", () => {
    expect(
      classifyShift({ status: "closed", businessDate: "2026-10-05", today: "2026-10-07" }),
    ).toBe("closed");
  });
});

describe("formatVariance", () => {
  it("shows a short drawer with its sign", () => {
    // Over and short are different problems. An absolute value would not tell a supervisor
    // which one they are looking at.
    expect(formatVariance(fromCentavos(-5_00))).toContain("-");
  });

  it("shows an over with its sign", () => {
    expect(formatVariance(fromCentavos(5_00))).toMatch(/^\+/);
  });

  it("renders an exact zero as balanced, not as +0.00", () => {
    expect(formatVariance(fromCentavos(0))).toMatch(/balanced/i);
  });

  it("renders a null variance as not yet closed, not as zero", () => {
    // Phase 2's handover names zero-value rendering as an untested seam. A shift that has
    // not closed has NO variance, which is a different fact from a variance of zero.
    expect(formatVariance(null)).not.toMatch(/balanced/i);
  });
});

describe("officeEncodedCounts", () => {
  it("counts only the recovered collection on a shift of two", () => {
    // Task 6: a shift with one office-encoded receipt among its two should report
    // officeEncodedCount: 1, not 2 -- the synced one came from the tablet.
    const counts = officeEncodedCounts(
      [
        { id: "c1", shiftId: "shift-1" },
        { id: "c2", shiftId: "shift-1" },
      ],
      new Set(["c1"]),
    );
    expect(counts.get("shift-1")).toBe(1);
  });

  it("reports no entry for a shift with nothing recovered", () => {
    const counts = officeEncodedCounts([{ id: "c1", shiftId: "shift-1" }], new Set());
    expect(counts.get("shift-1")).toBeUndefined();
  });

  it("keeps two shifts' counts separate", () => {
    const counts = officeEncodedCounts(
      [
        { id: "c1", shiftId: "shift-1" },
        { id: "c2", shiftId: "shift-2" },
      ],
      new Set(["c1", "c2"]),
    );
    expect(counts.get("shift-1")).toBe(1);
    expect(counts.get("shift-2")).toBe(1);
  });
});
