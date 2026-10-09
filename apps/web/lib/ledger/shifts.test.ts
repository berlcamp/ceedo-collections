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
  // Final-review Task 2: getShifts() no longer fetches every collection of up to 200
  // shifts (PostgREST's max_rows = 1000, supabase/config.toml, silently truncated that).
  // It now queries collection_recoveries joined to collections!inner(shift_id) -- the rare
  // side -- so the input here is one shift id per office-encoded collection already found,
  // not every collection paired with a separately-fetched recovered-id set.
  it("counts one shift id once per office-encoded collection on it", () => {
    const counts = officeEncodedCounts(["shift-1", "shift-1"]);
    expect(counts.get("shift-1")).toBe(2);
  });

  it("reports no entry for a shift with nothing recovered", () => {
    const counts = officeEncodedCounts([]);
    expect(counts.get("shift-1")).toBeUndefined();
  });

  it("keeps two shifts' counts separate", () => {
    const counts = officeEncodedCounts(["shift-1", "shift-2"]);
    expect(counts.get("shift-1")).toBe(1);
    expect(counts.get("shift-2")).toBe(1);
  });

  it("ignores a null shift id rather than counting it as its own group", () => {
    // collections.shift_id is nullable in the generated type (a collection posted before
    // migration 20260919000043 genuinely has none); defensive, since the inner join this
    // reads from should never actually produce one.
    const counts = officeEncodedCounts(["shift-1", null, undefined]);
    expect(counts.get("shift-1")).toBe(1);
    expect(counts.size).toBe(1);
  });
});

import { needsCashTickets } from "./shift-class";

describe("needsCashTickets", () => {
  it("flags an overage with no cash-ticket entry", () => {
    expect(needsCashTickets({ variance: 300000, cashTicketTotal: 0 })).toBe(true);
  });
  it("does not flag a balanced shift, a short one, or one with tickets entered", () => {
    expect(needsCashTickets({ variance: 0, cashTicketTotal: 0 })).toBe(false);
    expect(needsCashTickets({ variance: -100, cashTicketTotal: 0 })).toBe(false);
    expect(needsCashTickets({ variance: 300000, cashTicketTotal: 150000 })).toBe(false);
    expect(needsCashTickets({ variance: null, cashTicketTotal: 0 })).toBe(false);
  });
});
