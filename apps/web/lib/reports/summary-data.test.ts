import { describe, expect, it } from "vitest";
import { shownMonths } from "./builders/monthly-summary";

describe("shownMonths", () => {
  it("is empty before the first month after cutover has ended", () => {
    expect(shownMonths("2026", "2026-10-20")).toEqual([]);
  });

  it("starts at cutover and stops before the current month", () => {
    expect(shownMonths("2026", "2026-12-15")).toEqual(["2026-10", "2026-11"]);
  });

  it("is capped at December once the year has ended", () => {
    expect(shownMonths("2026", "2027-02-01")).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("starts in January for a year after cutover", () => {
    expect(shownMonths("2027", "2027-03-10")).toEqual(["2027-01", "2027-02"]);
  });

  it("is empty for a year before cutover", () => {
    expect(shownMonths("2025", "2026-12-01")).toEqual([]);
  });
});
