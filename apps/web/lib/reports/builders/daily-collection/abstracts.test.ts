// apps/web/lib/reports/builders/daily-collection/abstracts.test.ts
import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { abstractSections, formatPeriods } from "./abstracts";
import { fromPesos } from "@ceedo/shared";
import { ID, sept30 } from "./fixture";

const titled = (title: string, input = sept30()) => abstractSections(input).find((s) => s.title === title)!;

describe("abstractSections", () => {
  it("gives each collector who collected their booklets, tickets and summary, by name", () => {
    expect(abstractSections(sept30()).map((s) => s.title)).toEqual([
      "Collector A · Booklet A1 (1/2)",
      "Collector A · Booklet A2 (2/2)",
      "Collector A · Summary by section",
      "Collector B · Booklet B1 (1/1)",
      "Collector B · Summary by section",
      "Collector D · Cash tickets",
      "Collector D · Summary by section",
    ]);
  });

  it("lists a lease receipt once, base and surcharge together, with the rent it settled", () => {
    const [first] = titled("Collector A · Booklet A1 (1/2)").rows;
    expect(first).toMatchObject({
      no: 1, or: "1001", name: "Tenant One", section: "Public Mall · Fresh Fish", stall: "F-1",
      amount: 61_800, total: 61_800, remarks: "Sept 27–30",
    });
  });

  it("lists a cancelled receipt at zero", () => {
    const rows = titled("Collector A · Booklet A1 (1/2)").rows;
    expect(rows[1]).toMatchObject({ no: 2, or: "1002", amount: 0, total: 0, remarks: "(cancelled)" });
    expect(sectionTotals(titled("Collector A · Booklet A1 (1/2)"))).toEqual({ amount: 61_800, total: 61_800 });
  });

  it("shows each line of a several-line OR, with the OR total on its first row", () => {
    const rows = titled("Collector A · Booklet A2 (2/2)").rows;
    expect(rows.slice(0, 2).map((r) => [r.no, r.or, r.amount, r.total, r.remarks])).toEqual([
      [1, "2001", 172_200, 175_644, "Electricity bill payment (Public Mall)"],
      [null, null, 3_444, null, "Electricity surcharge (Public Mall)"],
    ]);
    expect(rows[2]).toMatchObject({ or: "2002", amount: 100_000, remarks: "Oct 1–5; advance" });
  });

  it("does not call a mixed receipt's rent an advance because of its fee line", () => {
    const input = sept30();
    const base = input.portions[0]!;
    const mixed = { ...base, collectionId: "c8", orNo: 1003, leaseId: ID.lease1 };
    input.portions.push(
      { ...mixed, lineId: "l8", feeTypeId: ID.ftMisc, accountId: ID.accUnc, amount: fromPesos(170) },
      { ...mixed, lineId: null, accountId: ID.accPmRent, amount: fromPesos(50) },
    );
    input.rentCover.push({ collectionId: "c8", allocated: fromPesos(50), periods: [{ start: "2026-09-30", end: "2026-09-30" }] });
    const rows = titled("Collector A · Booklet A1 (1/2)", input).rows.filter((r) => r.or === "1003" || r.or === null);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.total)).toEqual([fromPesos(220), null]);
    const lease = rows.find((r) => r.remarks !== "Miscellaneous fee")!;
    expect(String(lease.remarks)).not.toContain("advance");
  });

  it("is one row for a line split across accounts, with slaughterhouse and terminal columns", () => {
    const s = titled("Collector B · Booklet B1 (1/1)");
    expect(s.columns.map((c) => c.key)).toEqual([
      "no", "or", "name", "section", "stall", "plate", "variety", "heads", "amount", "total", "remarks",
    ]);
    expect(s.rows.map((r) => [r.or, r.name, r.plate, r.variety, r.heads, r.amount])).toEqual([
      ["3001", "Owner One", null, "Hog", 2, 110_000],
      ["3002", "RTMI", "KVX 123", null, null, 3_000],
      ["3003", "Miscellaneous fee", null, null, null, 5_000],
    ]);
  });

  it("leaves the extra columns off a booklet with neither", () => {
    expect(titled("Collector A · Booklet A1 (1/2)").columns.map((c) => c.key)).toEqual([
      "no", "or", "name", "section", "stall", "amount", "total", "remarks",
    ]);
  });

  it("labels each booklet's totals k/n and breaks the page per collector", () => {
    const a2 = titled("Collector A · Booklet A2 (2/2)");
    expect(a2.totalLabel).toBe("Total 2/2");
    expect(titled("Collector A · Booklet A1 (1/2)").breakBefore).toBe(true);
    expect(a2.breakBefore).toBeFalsy();
  });

  it("lists cash tickets after the ORs", () => {
    expect(titled("Collector D · Cash tickets").rows).toEqual([
      { fee: "PM CR cash ticket", tickets: "1–600", note: null, amount: 300_000 },
    ]);
    // D has no receipts, so the cash tickets open D's pages; the summary follows on.
    expect(titled("Collector D · Cash tickets").breakBefore).toBe(true);
    expect(titled("Collector D · Summary by section").breakBefore).toBeFalsy();
  });

  it("summarises each collector by section and account, live money only", () => {
    const s = titled("Collector A · Summary by section");
    expect(s.rows.map((r) => [r.place, r.account, r.amount])).toEqual([
      ["Public Mall", "Public Mall Electricity Surcharge", 3_444],
      ["Public Mall", "Public Mall Electricity", 172_200],
      ["Public Mall · Fresh Fish", "Fresh Fish Section - Daily Rent", 160_000],
      ["Public Mall · Fresh Fish", "Public Mall Rental Surcharge", 1_800],
    ]);
  });

  it("gives a collector with only cancelled receipts an abstract at zero", () => {
    const input = sept30();
    input.portions.push({ ...input.portions[2]!, collectorId: "col-e", collectionId: "c9", orNo: 1003 });
    const titles = abstractSections(input).map((s) => s.title);
    expect(titles).toContain("Collector E · Booklet A1 (1/1)");
    const summary = abstractSections(input).find((s) => s.title === "Collector E · Summary by section")!;
    expect(summary.rows).toEqual([]);
  });

  it("says so when nobody collected", () => {
    const input = sept30();
    input.portions = [];
    const sections = abstractSections(input);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.empty).toBe("No receipts or cash tickets were recorded this day.");
  });
});

describe("formatPeriods", () => {
  it("merges consecutive days within a month", () =>
    expect(formatPeriods([
      { start: "2026-09-29", end: "2026-09-29" }, { start: "2026-09-27", end: "2026-09-28" },
      { start: "2026-09-30", end: "2026-09-30" },
    ])).toBe("Sept 27–30"));
  it("prints one day alone", () => expect(formatPeriods([{ start: "2026-09-30", end: "2026-09-30" }])).toBe("Sept 30"));
  it("spans months", () => expect(formatPeriods([{ start: "2026-09-29", end: "2026-10-02" }])).toBe("Sept 29–Oct 2"));
  it("spans years", () =>
    expect(formatPeriods([{ start: "2026-12-30", end: "2027-01-02" }])).toBe("Dec 30, 2026–Jan 2, 2027"));
  it("keeps gaps apart", () =>
    expect(formatPeriods([{ start: "2026-09-01", end: "2026-09-02" }, { start: "2026-09-05", end: "2026-09-05" }]))
      .toBe("Sept 1–2, Sept 5"));
  it("is null for none", () => expect(formatPeriods([])).toBeNull());
});
