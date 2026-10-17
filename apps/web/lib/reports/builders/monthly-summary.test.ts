// apps/web/lib/reports/builders/monthly-summary.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { toXlsx } from "../xlsx";
import {
  latestControls, monthlySummaryReport, type MonthAmount, type SummaryAccount, type SummaryInput,
} from "./monthly-summary";

const acct = (id: string, over: Partial<SummaryAccount>): SummaryAccount => ({
  id, code: id.toUpperCase(), name: id, facilityId: "f-cpm", groupName: "Other Collections",
  sortOrder: 10, kind: "income", active: true, ...over,
});
const amt = (month: string, accountId: string, pesos: number): MonthAmount => ({
  month, accountId, amount: fromPesos(pesos),
});

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    year: "2026",
    today: "2026-12-15",
    facilities: [{ id: "f-cpm", name: "Public Mall" }, { id: "f-ibjt", name: "IBJT" }],
    accounts: [
      acct("bak", { name: "Bakery - Daily Rent", groupName: "Stall Sections Daily Rent", sortOrder: 20 }),
      acct("rent", { name: "Rentable Space - Monthly Rent", groupName: "Rentable Space", sortOrder: 190 }),
      acct("old", { name: "Old fee", sortOrder: 440, active: false }),
      acct("kiosk", { name: "Kiosk Rentals", facilityId: "f-ibjt", groupName: "IBJT Daily Rent", sortOrder: 480 }),
      acct("gone", { name: "Gone fee", facilityId: "f-ibjt", sortOrder: 550, active: false }),
      acct("sur", { name: "PM Rental Surcharge", facilityId: null, groupName: "Rental Surcharge", sortOrder: 760 }),
      acct("nmis", { name: "NMIS", facilityId: null, groupName: "Regulatory Collection (Non-Income)", sortOrder: 930, kind: "non_income" }),
      acct("unc", { code: "UNCLASSIFIED", name: "Unclassified", facilityId: null, groupName: "Unclassified", sortOrder: 99999 }),
    ],
    totals: [
      amt("2026-09", "bak", 777), // before cutover: never shown
      amt("2026-10", "bak", 1000), amt("2026-10", "rent", 500), amt("2026-10", "kiosk", 300),
      amt("2026-10", "sur", 30), amt("2026-10", "gone", 50), amt("2026-10", "nmis", 100),
      amt("2026-11", "bak", 1100), amt("2026-11", "kiosk", 200), amt("2026-11", "nmis", 120),
      amt("2026-12", "bak", 999), // December has not ended on the 15th
    ],
    adjustments: [
      { ...amt("2026-11", "rent", -20), note: "Over-deposit returned" },
      { ...amt("2026-12", "bak", 5), note: "Not yet" },
    ],
    controls: [
      { month: "2026-10", amount: fromPesos(2080), note: null, enteredAt: "2026-11-01T01:00:00.000000+00:00" },
      { month: "2026-10", amount: fromPesos(2100), note: "Recounted", enteredAt: "2026-11-02T01:00:00.000000+00:00" },
      { month: "2026-11", amount: fromPesos(1400), note: null, enteredAt: "2026-12-01T01:00:00.000000+00:00" },
    ],
    signatories: [{ label: "Prepared by", name: "Signer One", title: "Accountant" }, { label: "Noted by", name: null, title: null }],
    ...over,
  };
}

const rowOf = (r: ReturnType<typeof monthlySummaryReport>, section: number, label: string) =>
  r.sections[section]!.rows.find((x) => x.account === label)!;

describe("monthlySummaryReport", () => {
  it("follows the chart: facility heading, group heading, lines, sub-totals, then the totals", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[0]!.rows.map((x) => x.account)).toEqual([
      "Public Mall",
      "Stall Sections Daily Rent", "Bakery - Daily Rent", "Total Stall Sections Daily Rent",
      "Rentable Space", "Rentable Space - Monthly Rent †", "Total Rentable Space",
      "Total Public Mall",
      "IBJT",
      "IBJT Daily Rent", "Kiosk Rentals", "Total IBJT Daily Rent",
      "Other Collections", "Gone fee", "Total Other Collections",
      "Total IBJT",
      "All facilities",
      "Rental Surcharge", "PM Rental Surcharge", "Total Rental Surcharge",
      "Total All facilities",
      "Total Income",
      "Non-Income",
      "Regulatory Collection (Non-Income)", "NMIS", "Total Regulatory Collection (Non-Income)",
      "Total Non-Income",
      "Grand total",
    ]);
    expect(rowOf(r, 0, "Public Mall").$style).toBe("heading");
    expect(rowOf(r, 0, "Bakery - Daily Rent").$indent).toBe(2);
    expect(rowOf(r, 0, "Total Public Mall").$style).toBe("subtotal");
    expect(rowOf(r, 0, "Total Income").$style).toBe("total");
    expect(r.title).toBe("Monthly Summary of Collections");
    expect(r.scope).toBe("Year 2026");
    expect(r.layout).toBe("landscape");
  });

  it("shows only ended months on or after cutover; the rest are blank, not zero", () => {
    const bak = rowOf(monthlySummaryReport(input()), 0, "Bakery - Daily Rent");
    expect(bak.m1).toBeNull();
    expect(bak.m9).toBeNull();
    expect(bak.m10).toBe(100_000);
    expect(bak.m11).toBe(110_000);
    expect(bak.m12).toBeNull();
    expect(bak.total).toBe(210_000);
  });

  it("totals groups, facilities, income, non-income and the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(rowOf(r, 0, "Total Public Mall")).toMatchObject({ m10: 150_000, m11: 108_000 });
    expect(rowOf(r, 0, "Total IBJT")).toMatchObject({ m10: 35_000, m11: 20_000 });
    expect(rowOf(r, 0, "Total Income")).toMatchObject({ m10: 188_000, m11: 128_000 });
    expect(rowOf(r, 0, "Total Non-Income")).toMatchObject({ m10: 10_000, m11: 12_000 });
    expect(rowOf(r, 0, "Grand total")).toMatchObject({ m10: 198_000, m11: 140_000, total: 338_000 });
  });

  it("agrees with its inputs: grand total = shown receipts + shown adjustments", () => {
    const i = input();
    const shown = (m: string) => m >= "2026-10" && m < "2026-12";
    const expected = [...i.totals, ...i.adjustments].filter((x) => shown(x.month)).reduce((a, x) => a + x.amount, 0);
    expect(rowOf(monthlySummaryReport(i), 0, "Grand total").total).toBe(expected);
  });

  it("adds, marks and lists only adjustments in shown months", () => {
    const r = monthlySummaryReport(input());
    expect(rowOf(r, 0, "Rentable Space - Monthly Rent †")).toMatchObject({ m10: 50_000, m11: -2_000 });
    expect(r.sections[0]!.rows.some((x) => x.account === "Bakery - Daily Rent †")).toBe(false);
    expect(r.notes).toContain("† Rentable Space - Monthly Rent, November 2026: -20.00. Over-deposit returned");
    expect(r.notes!.some((n) => n.includes("Not yet"))).toBe(false);
  });

  it("keeps an inactive account that holds money and hides one that holds none", () => {
    const labels = monthlySummaryReport(input()).sections[0]!.rows.map((x) => x.account);
    expect(labels).toContain("Gone fee");
    expect(labels).not.toContain("Old fee");
  });

  it("hides UNCLASSIFIED when empty; shows it and warns when it holds money", () => {
    expect(monthlySummaryReport(input()).warnings).toEqual([]);
    const r = monthlySummaryReport(input({ totals: [...input().totals, amt("2026-11", "unc", 10)] }));
    expect(r.sections[0]!.rows.find((x) => x.account === "Unclassified" && x.$indent === 2)!.m11).toBe(1_000);
    expect(r.warnings).toEqual([
      {
        text: "10.00 of 2026's collections is on no account (Unclassified).",
        href: "/accounts/unclassified?month=2026-11",
        linkText: "Classify it",
      },
    ]);
  });

  it("summarises by facility, adding up to the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[1]!.title).toBe("Summary by facility");
    expect(r.sections[1]!.rows.map((x) => [x.account, x.total])).toEqual([
      ["Public Mall", 258_000], ["IBJT", 55_000], ["All facilities", 3_000], ["Non-Income", 22_000], ["Grand total", 338_000],
    ]);
  });

  it("sets the control total in force (the latest) against the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[2]!.title).toBe("Control total");
    expect(rowOf(r, 2, "Cashier's control total")).toMatchObject({ m10: 210_000, m11: 140_000, m12: null, total: 350_000 });
    expect(rowOf(r, 2, "Difference (control − system)")).toMatchObject({ m10: 12_000, m11: 0, total: 12_000 });
    expect(r.notes).toContain("Control total, October 2026: Recounted");
  });

  it("leaves a month with no control total blank, not a difference against zero", () => {
    const r = monthlySummaryReport(input({ controls: [] }));
    expect(rowOf(r, 2, "Cashier's control total")).toMatchObject({ m10: null, total: null });
    expect(rowOf(r, 2, "Difference (control − system)")).toMatchObject({ m10: null, total: null });
  });

  it("opens the next year from January, and shows nothing before a month has ended", () => {
    const next = monthlySummaryReport(input({ year: "2027", today: "2027-03-10", totals: [amt("2027-01", "bak", 10)], adjustments: [], controls: [] }));
    expect(rowOf(next, 0, "Bakery - Daily Rent")).toMatchObject({ m1: 1_000, m2: 0, m3: null, total: 1_000 });
    const early = monthlySummaryReport(input({ today: "2026-10-20" }));
    expect(rowOf(early, 0, "Grand total")).toMatchObject({ m10: null, total: null });
  });

  it("signs with the configured signatories and exports", async () => {
    const r = monthlySummaryReport(input());
    expect(r.signatures).toEqual([
      { label: "Prepared by", name: "Signer One", title: "Accountant" },
      { label: "Noted by", name: undefined, title: undefined },
    ]);
    expect((await toXlsx(r)).byteLength).toBeGreaterThan(0);
  });
});

describe("latestControls", () => {
  it("keeps the latest entry per month", () => {
    const m = latestControls(input().controls);
    expect(m.get("2026-10")!.amount).toBe(210_000);
    expect(m.get("2026-11")!.amount).toBe(140_000);
  });
});
