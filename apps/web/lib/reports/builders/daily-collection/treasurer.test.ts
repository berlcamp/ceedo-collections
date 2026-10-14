// apps/web/lib/reports/builders/daily-collection/treasurer.test.ts
import { describe, expect, it } from "vitest";
import { sept30 } from "./fixture";
import { depositLabel, shortDate, treasurerSection } from "./treasurer";

const rowsOf = () => treasurerSection(sept30()).rows;
const line = (name: string) => rowsOf().find((r) => r.particulars === name)!;

describe("treasurerSection", () => {
  it("lists lines in order with Sub-total 1, Sub-total 2 and the Grand total", () => {
    expect(rowsOf().map((r) => [r.particulars, r.amount, r.$style ?? null])).toEqual([
      ["Slaughterhouse fees", 82_500, null],
      ["Public Mall stall rentals/misc", 160_000, null],
      ["Public Mall CR", 300_000, null],
      ["IBJT stall rentals/parking/misc", 3_000, null],
      ["Public cemetery", null, null],
      ["Other collections", 6_800, null],
      ["Sub-total 1", 552_300, "subtotal"],
      ["Ante/post-mortem fees", 27_500, null],
      ["Electricity bill payments", 172_200, null],
      ["Surcharges on electricity bill payments", 3_444, null],
      ["Sub-total 2", 203_144, "subtotal"],
      ["Grand total", 755_444, "total"],
    ]);
  });

  it("leaves cancelled receipts out", () => {
    // OR 1002 (200.00, cancelled) is on the Public Mall line; the line holds only 600 + 1,000.
    expect(line("Public Mall stall rentals/misc").amount).toBe(160_000);
  });

  it("dates each line's collection and its deposit", () => {
    expect(line("Slaughterhouse fees")).toMatchObject({ collected: "9/30/2026", deposited: "10/1/2026 (unverified)" });
    expect(line("Public Mall stall rentals/misc").deposited).toBe("10/2/2026");
    expect(line("Public cemetery")).toMatchObject({ collected: null, deposited: null });
  });

  it("reads Undeposited when any shift behind the line is not deposited", () => {
    expect(line("Public Mall CR").deposited).toBe("Undeposited");
  });

  it("hides an empty Other collections line, and shows any line holding money", () => {
    const input = sept30();
    input.portions = input.portions.filter((p) => p.accountId !== "acc-unc" && p.accountId !== "acc-pm-sur");
    expect(treasurerSection(input).rows.map((r) => r.particulars)).not.toContain("Other collections");

    const inactive = sept30();
    inactive.treasurerLines = inactive.treasurerLines.map((l) => (l.code === "TL_PM_CR" ? { ...l, active: false } : l));
    expect(treasurerSection(inactive).rows.map((r) => r.particulars)).toContain("Public Mall CR");
  });

  it("is portrait, on the Treasurer sheet, with no automatic totals row", () => {
    const s = treasurerSection(sept30());
    expect(s.orientation).toBe("portrait");
    expect(s.sheet).toBe("Treasurer");
    expect(s.columns.some((c) => c.total)).toBe(false);
  });
});

describe("depositLabel", () => {
  const shifts = new Map([
    ["s1", { id: "s1", deposit: { on: "2026-10-01", verified: true } }],
    ["s2", { id: "s2", deposit: { on: "2026-10-03", verified: true } }],
    ["s3", { id: "s3", deposit: null }],
  ]);
  it("takes the latest deposit date", () => expect(depositLabel(["s1", "s2"], shifts)).toBe("10/3/2026"));
  it("is Undeposited for a receipt on no shift", () => expect(depositLabel(["s1", null], shifts)).toBe("Undeposited"));
  it("is Undeposited for an unknown shift", () => expect(depositLabel(["zz"], shifts)).toBe("Undeposited"));
  it("is null with no shifts", () => expect(depositLabel([], shifts)).toBeNull());
  it("is Undeposited when one is not deposited", () => expect(depositLabel(["s1", "s3"], shifts)).toBe("Undeposited"));
});

describe("shortDate", () => {
  it("writes an ISO date as M/D/YYYY", () => {
    expect(shortDate("2026-09-30")).toBe("9/30/2026");
    expect(shortDate("2026-10-01")).toBe("10/1/2026");
  });
});
