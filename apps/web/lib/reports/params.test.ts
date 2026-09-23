import { describe, expect, it } from "vitest";
import { longDate, longMonth, manilaToday, monthBounds, readParams } from "./params";

describe("report params", () => {
  // 23 Sep 2026, 17:30 UTC is already 24 Sep in Manila (UTC+8).
  const lateUtc = new Date("2026-09-23T17:30:00Z");

  it("defaults to Manila's business date, not the server's", () => {
    expect(manilaToday(lateUtc)).toBe("2026-09-24");
    expect(readParams({}, lateUtc)).toEqual({
      date: "2026-09-24",
      month: "2026-09",
      collectorId: null,
      leaseId: null,
    });
  });

  it("keeps well-formed values and ignores mangled ones", () => {
    const p = readParams(
      { date: "2026-08-31", month: "2026-07", collector: "11111111-1111-4111-8111-111111111111", lease: "x" },
      lateUtc,
    );
    expect(p).toEqual({
      date: "2026-08-31",
      month: "2026-07",
      collectorId: "11111111-1111-4111-8111-111111111111",
      leaseId: null,
    });
    expect(readParams({ date: "31/08/2026", month: "2026-7" }, lateUtc).date).toBe("2026-09-24");
  });

  it("bounds a month, leap February included", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("writes dates the way the office does", () => {
    expect(longDate("2026-09-03")).toBe("3 September 2026");
    expect(longMonth("2026-12")).toBe("December 2026");
  });
});
