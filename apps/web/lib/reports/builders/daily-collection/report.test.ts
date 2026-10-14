// apps/web/lib/reports/builders/daily-collection/report.test.ts
import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { toXlsx } from "../../xlsx";
import { sept30 } from "./fixture";
import { dailyCollectionReport } from "./report";

const grandOf = (r: ReturnType<typeof dailyCollectionReport>) =>
  Number(r.sections[0]!.rows.find((x) => x.particulars === "Grand total")!.amount);

describe("dailyCollectionReport", () => {
  it("agrees with itself: Treasurer grand total = per-collector total = sum of abstracts", () => {
    const r = dailyCollectionReport(sept30());
    const matrixTotal = sectionTotals(r.sections[1]!)!.total;
    const abstracts = r.sections
      .filter((s) => s.title?.endsWith("· Summary by section"))
      .reduce((acc, s) => acc + (sectionTotals(s)?.amount ?? 0), 0);
    expect(grandOf(r)).toBe(755_444);
    expect(matrixTotal).toBe(755_444);
    expect(abstracts).toBe(755_444);
  });

  it("orders the parts: Treasurer, matrix, deposits, abstracts", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.sections.slice(0, 3).map((s) => s.title)).toEqual([
      "Daily Collection Report", "Collections per collector", "Remittances / deposits",
    ]);
    expect(r.title).toBe("Daily Collection Report");
    expect(r.scope).toBe("30 September 2026");
    expect(r.layout).toBe("landscape");
  });

  it("warns, on screen, about unclassified money, linking to that month's list", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.warnings).toEqual([
      {
        text: "50.00 of this day's collections is on no account and is shown under “Other collections”.",
        href: "/accounts/unclassified?month=2026-09",
        linkText: "Classify it",
      },
    ]);
    const clean = sept30();
    clean.portions = clean.portions.filter((p) => p.accountId !== "acc-unc");
    expect(dailyCollectionReport(clean).warnings).toEqual([]);
  });

  it("does not warn about a cancelled unclassified receipt", () => {
    const input = sept30();
    input.portions = input.portions.map((p) => (p.accountId === "acc-unc" ? { ...p, cancelled: true } : p));
    expect(dailyCollectionReport(input).warnings).toEqual([]);
  });

  it("signs with the configured signatories, blank where no name is set", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.signatures).toBeUndefined();
    expect(r.sections[0]!.signatures).toEqual([
      { label: "Prepared by", name: "Signer One", title: "LRCO-I" },
      { label: "Noted by", name: undefined, title: undefined },
    ]);
  });

  it("puts the CC line and deposit-date note on the Treasurer page, only the cancelled note on the report", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.sections[0]!.notes!.some((n) => n.startsWith("CC: City Mayor's Office"))).toBe(true);
    expect(r.sections[0]!.notes!.some((n) => n.startsWith("Date of deposit is"))).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect(r.notes![0]).toMatch(/^Cancelled receipts/);
  });

  it("names the Treasurer line the unclassified account maps to in the warning", () => {
    const input = sept30();
    const acc = input.accounts.find((a) => a.id === "acc-unc")!;
    const line = input.treasurerLines.find((l) => l.id === acc.treasurerLineId)!;
    line.name = "Miscellaneous";
    expect(dailyCollectionReport(input).warnings![0]!.text).toContain("shown under “Miscellaneous”.");
  });

  it("renders a day with no receipts: blank lines, zero sub-totals, empty abstracts", async () => {
    const input = sept30();
    input.portions = [];
    const r = dailyCollectionReport(input);
    expect(grandOf(r)).toBe(0);
    expect(r.sections[0]!.rows.find((x) => x.particulars === "Sub-total 1")!.amount).toBe(0);
    expect(r.sections.at(-1)!.empty).toBe("No receipts or cash tickets were recorded this day.");
    const book = await toXlsx(r);
    expect(book.length).toBeGreaterThan(0);
  });

  it("exports three worksheets", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(dailyCollectionReport(sept30()))) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Treasurer", "Per collector", "Abstracts"]);
  });
});
