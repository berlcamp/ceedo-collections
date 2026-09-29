import { describe, expect, it } from "vitest";
import { formatDate, isIsoDate } from "./date.js";

describe("formatDate", () => {
  it("writes a calendar date as day, short month, year", () => {
    expect(formatDate("2026-09-05")).toBe("05 Sept 2026");
    expect(formatDate("2026-01-31")).toBe("31 Jan 2026");
  });

  it("reads a timestamp in Manila time and keeps the hour", () => {
    expect(formatDate("2026-09-04T18:30:00+00:00")).toBe("05 Sept 2026 02:30");
  });

  it("leaves anything else alone", () => {
    expect(formatDate("Stall 12")).toBe("Stall 12");
  });
});

describe("isIsoDate", () => {
  it("accepts dates and timestamps only", () => {
    expect(isIsoDate("2026-09-05")).toBe(true);
    expect(isIsoDate("2026-09-05T01:02:03Z")).toBe(true);
    expect(isIsoDate("2026")).toBe(false);
    expect(isIsoDate(12)).toBe(false);
  });
});
