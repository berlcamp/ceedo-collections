import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import { tenantPaymentsReport, type PaymentDay, type PaymentLease } from "./tenant-payments";

function lease(id: string, over: Partial<PaymentLease> = {}): PaymentLease {
  return {
    leaseId: id, facilityName: "Public Mall", sectionName: "Bakery", stallNo: "1",
    tenantName: `Tenant ${id}`, rate: fromPesos(200), accrualPeriod: "daily", ...over,
  };
}
const day = (leaseId: string, businessDate: string, base: number, surcharge = 0): PaymentDay => ({
  leaseId, businessDate, base: fromPesos(base), surcharge: fromPesos(surcharge),
});

describe("tenantPaymentsReport", () => {
  it("has one money column per day of the month, February included", () => {
    const feb = tenantPaymentsReport([lease("a")], [], { month: "2028-02", facilityName: null });
    const dayCols = feb.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key));
    expect(dayCols).toHaveLength(29);
    expect(dayCols.at(-1)!.label).toBe("29");
    const oct = tenantPaymentsReport([lease("a")], [], { month: "2026-10", facilityName: null });
    expect(oct.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key))).toHaveLength(31);
    expect(oct.sections[0]!.dense).toBe(true);
  });

  it("puts each day's rent in its column, surcharge apart, and totals the row", () => {
    const r = tenantPaymentsReport(
      [lease("a")],
      [day("a", "2026-10-05", 600, 18), day("a", "2026-10-06", 200)],
      { month: "2026-10", facilityName: null },
    );
    const row = r.sections[0]!.rows[0]!;
    expect(row.d5).toBe(60000);
    expect(row.d6).toBe(20000);
    expect(row.d7).toBeNull();
    expect(row.surcharge).toBe(1800);
    expect(row.total).toBe(81800);
    expect(row.rate).toBe("200.00/day");
  });

  it("keeps a lease that paid nothing, with a zero total", () => {
    const r = tenantPaymentsReport([lease("a"), lease("b", { stallNo: "2" })], [day("a", "2026-10-01", 200)], {
      month: "2026-10", facilityName: null,
    });
    const unpaid = r.sections[0]!.rows[1]!;
    expect(unpaid.tenant).toBe("Tenant b");
    expect(unpaid.d1).toBeNull();
    expect(unpaid.total).toBe(0);
  });

  it("ignores days outside the month", () => {
    const r = tenantPaymentsReport([lease("a")], [day("a", "2026-09-30", 200)], {
      month: "2026-10", facilityName: null,
    });
    expect(r.sections[0]!.rows[0]!.total).toBe(0);
  });

  it("sections by facility and section, then summarises them", () => {
    const r = tenantPaymentsReport(
      [lease("a"), lease("b", { facilityName: "IBJT", sectionName: "Building 2" })],
      [day("a", "2026-10-01", 200, 6), day("b", "2026-10-02", 100)],
      { month: "2026-10", facilityName: null },
    );
    expect(r.sections.map((s) => s.title)).toEqual([
      "IBJT · Building 2", "Public Mall · Bakery", "Summary by section",
    ]);
    expect(sectionTotals(r.sections[1]!)!.total).toBe(20600);
    expect(sectionTotals(r.sections.at(-1)!)).toEqual({ leases: 2, rent: 30000, surcharge: 600, total: 30600 });
    expect(r.scope).toBe("All facilities · October 2026");
  });

  it("says so when there are no leases", () => {
    const r = tenantPaymentsReport([], [], { month: "2026-10", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.empty).toBe("No lease was active or paid in this month.");
  });
});
