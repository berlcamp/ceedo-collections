import { describe, expect, it } from "vitest";
import { heardFromAfterManilaMidnight } from "./tablet-activity";

describe("a tablet heard from after a shift's Manila business date began", () => {
  it("warns for a tablet heard from early in the Manila day", () => {
    // 06:00 Manila on 2026-09-30 is 22:00 UTC on 2026-09-29 -- a naive string compare
    // against "2026-09-30T00:00:00" would miss this entirely.
    expect(heardFromAfterManilaMidnight("2026-09-29T22:00:00Z", "2026-09-30")).toBe(true);
  });

  it("does not warn for a tablet last heard from the previous Manila day", () => {
    // 23:00 Manila on 2026-09-29 is 15:00 UTC the same day -- still before the shift's date.
    expect(heardFromAfterManilaMidnight("2026-09-29T15:00:00Z", "2026-09-30")).toBe(false);
  });

  it("does not warn for a tablet heard from exactly at the Manila boundary", () => {
    expect(heardFromAfterManilaMidnight("2026-09-29T16:00:00Z", "2026-09-30")).toBe(false);
  });
});
