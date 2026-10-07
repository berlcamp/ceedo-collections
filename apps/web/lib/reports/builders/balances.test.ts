import { describe, expect, it } from "vitest";
import { fromPesos, type Centavos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import { balancesReport, type BalanceRow } from "./balances";

const zero = fromPesos(0);
function row(over: Partial<BalanceRow>): BalanceRow {
  return {
    leaseId: crypto.randomUUID(), facilityName: "Public Mall", sectionName: "Bakery",
    stallNo: "1", tenantName: "Tenant", rate: fromPesos(200), accrualPeriod: "daily",
    notYetDue: zero, days1to30: zero, days31to60: zero, days61to90: zero, over90: zero,
    outstanding: zero, ...over,
  };
}

describe("balancesReport", () => {
  const rows = [
    row({ stallNo: "10", tenantName: "Ten", days1to30: fromPesos(400), outstanding: fromPesos(400) }),
    row({ stallNo: "2", tenantName: "Two", over90: fromPesos(1000), outstanding: fromPesos(1000) }),
    row({ facilityName: "IBJT", sectionName: "Building 2", stallNo: "MG 1", outstanding: fromPesos(100), notYetDue: fromPesos(100) }),
  ];

  it("has one section per facility and section, stalls in counting order, then a summary", () => {
    const r = balancesReport(rows, { date: "2026-10-31", facilityName: null });
    expect(r.sections.map((s) => s.title)).toEqual([
      "IBJT · Building 2", "Public Mall · Bakery", "Summary by section",
    ]);
    expect(r.sections[1]!.rows.map((x) => x.stall)).toEqual(["2", "10"]);
    expect(r.sections[1]!.rows[0]!.rate).toBe("200.00/day");
    expect(sectionTotals(r.sections[1]!)!.owed).toBe(140000);
  });

  it("summarises each section and totals every lease", () => {
    const summary = balancesReport(rows, { date: "2026-10-31", facilityName: null }).sections.at(-1)!;
    expect(summary.rows).toEqual([
      { facility: "IBJT", section: "Building 2", leases: 1, owed: 10000 as Centavos },
      { facility: "Public Mall", section: "Bakery", leases: 2, owed: 140000 as Centavos },
    ]);
    expect(sectionTotals(summary)).toEqual({ leases: 3, owed: 150000 });
  });

  it("names the date and facility in its scope", () => {
    expect(balancesReport(rows, { date: "2026-10-31", facilityName: null }).scope)
      .toBe("All facilities · as of 31 October 2026");
    expect(balancesReport([], { date: "2026-10-31", facilityName: "IBJT" }).scope)
      .toBe("IBJT · as of 31 October 2026");
  });

  it("shows only an empty summary when nobody owes anything", () => {
    const r = balancesReport([], { date: "2026-10-31", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.rows).toEqual([]);
    expect(r.sections[0]!.empty).toBe("No tenant had an outstanding balance on this date.");
  });
});
