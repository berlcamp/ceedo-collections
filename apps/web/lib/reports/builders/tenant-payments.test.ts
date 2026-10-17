// apps/web/lib/reports/builders/tenant-payments.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import {
  tenantPaymentsReport, type PaymentAccount, type PaymentLease, type PaymentPortion, type TenantPaymentsInput,
} from "./tenant-payments";

const ACCOUNTS: PaymentAccount[] = [
  { id: "a-bak", name: "Bakery Section - Daily Rent", facilityName: "Public Mall", sortOrder: 20 },
  { id: "a-occ", name: "Bakery Section - Occupancy Fee", facilityName: "Public Mall", sortOrder: 210 },
  { id: "a-kiosk", name: "Kiosk Rentals - IBJT", facilityName: "IBJT", sortOrder: 480 },
  { id: "a-sur", name: "Public Mall Rental Surcharge", facilityName: null, sortOrder: 760 },
  { id: "a-nm", name: "Night Market", facilityName: "Night Market", sortOrder: 910 },
  { id: "a-walk", name: "Public Mall Delivery Fee", facilityName: "Public Mall", sortOrder: 400 },
];

function lease(id: string, over: Partial<PaymentLease> = {}): PaymentLease {
  return {
    leaseId: id, facilityName: "Public Mall", sectionName: "Bakery", stallNo: "1", tenantName: `Tenant ${id}`,
    rate: fromPesos(200), accrualPeriod: "daily", homeAccountId: "a-bak", ...over,
  };
}
const base = (leaseId: string | null, accountId: string, date: string, pesos: number, payerRef: string | null = null): PaymentPortion => ({
  leaseId, payerRef, accountId, portion: "base", businessDate: date, amount: fromPesos(pesos),
});
const sur = (leaseId: string, date: string, pesos: number): PaymentPortion => ({
  leaseId, payerRef: null, accountId: "a-sur", portion: "surcharge", businessDate: date, amount: fromPesos(pesos),
});
const build = (over: Partial<TenantPaymentsInput>, month = "2026-10") =>
  tenantPaymentsReport({ leases: [], portions: [], accounts: ACCOUNTS, payerAccountIds: ["a-nm"], ...over }, { month, facilityName: null });

describe("tenantPaymentsReport", () => {
  it("says, second among its notes, what reconciles with the Monthly summary", () => {
    expect(build({}).notes?.[1]).toBe(
      "“Received” in the summary by account equals that line in the Monthly summary; surcharges belong to the Rental Surcharge lines there.",
    );
  });

  it("has one money column per day of the month, February included", () => {
    const feb = build({ leases: [lease("a")] }, "2028-02");
    const dayCols = feb.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key));
    expect(dayCols).toHaveLength(29);
    expect(dayCols.at(-1)!.label).toBe("29");
    expect(feb.sections[0]!.dense).toBe(true);
  });

  it("puts each day's rent in its column, the surcharge on the home row, and totals the row", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-10-05", 600), sur("a", "2026-10-05", 18), base("a", "a-bak", "2026-10-06", 200)],
    });
    expect(r.sections[0]!.title).toBe("Public Mall · Bakery Section - Daily Rent");
    const row = r.sections[0]!.rows[0]!;
    expect(row).toMatchObject({ tenant: "Tenant a", stall: "1", rate: "200.00/day", d5: 60000, d6: 20000, d7: null, surcharge: 1800, total: 81800 });
  });

  it("keeps a lease that paid nothing, in its home block, at zero", () => {
    const r = build({ leases: [lease("a"), lease("b", { stallNo: "2" })], portions: [base("a", "a-bak", "2026-10-01", 200)] });
    const unpaid = r.sections[0]!.rows[1]!;
    expect(unpaid).toMatchObject({ tenant: "Tenant b", d1: null, surcharge: null, total: 0 });
  });

  it("puts a lease in every block it paid into, its surcharge once, on the home row", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-10-02", 200), sur("a", "2026-10-02", 6), base("a", "a-occ", "2026-10-03", 500)],
    });
    expect(r.sections.map((s) => s.title)).toEqual([
      "Public Mall · Bakery Section - Daily Rent", "Public Mall · Bakery Section - Occupancy Fee", "Summary by account",
    ]);
    expect(r.sections[0]!.rows[0]).toMatchObject({ d2: 20000, surcharge: 600, total: 20600 });
    expect(r.sections[1]!.rows[0]).toMatchObject({ tenant: "Tenant a", d3: 50000, surcharge: null, total: 50000 });
  });

  it("gives Night Market vendors one row per payer, and ignores other walk-in fees", () => {
    const r = build({
      portions: [
        base(null, "a-nm", "2026-10-01", 30, "Vendor X"), base(null, "a-nm", "2026-10-02", 30, "Vendor X"),
        base(null, "a-nm", "2026-10-01", 10, null), base(null, "a-walk", "2026-10-01", 99, "Truck"),
      ],
    });
    expect(r.sections.map((s) => s.title)).toEqual(["Night Market · Night Market", "Summary by account"]);
    expect(r.sections[0]!.rows.map((x) => [x.tenant, x.stall, x.total])).toEqual([["(no name)", null, 1000], ["Vendor X", null, 6000]]);
  });

  it("ignores days outside the month and leases not in the list (another facility's)", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-09-30", 200), base("z", "a-kiosk", "2026-10-01", 300)],
    });
    expect(r.sections.map((s) => s.title)).toEqual(["Public Mall · Bakery Section - Daily Rent", "Summary by account"]);
    expect(r.sections[0]!.rows[0]!.total).toBe(0);
  });

  it("orders blocks by the chart and summarises them, each block's days equal to its account's portions", () => {
    const portions = [
      base("a", "a-bak", "2026-10-01", 200), sur("a", "2026-10-01", 6),
      base("b", "a-kiosk", "2026-10-02", 100), base(null, "a-nm", "2026-10-03", 40, "Vendor Y"),
    ];
    const r = build({
      leases: [lease("a"), lease("b", { facilityName: "IBJT", sectionName: "Kiosk", homeAccountId: "a-kiosk" })],
      portions,
    });
    expect(r.sections.map((s) => s.title)).toEqual([
      "Public Mall · Bakery Section - Daily Rent", "IBJT · Kiosk Rentals - IBJT", "Night Market · Night Market", "Summary by account",
    ]);
    const summary = r.sections.at(-1)!;
    expect(summary.rows.filter((x) => !x.$style).map((x) => [x.account, x.rent])).toEqual([
      ["Bakery Section - Daily Rent", 20000], ["Kiosk Rentals - IBJT", 10000], ["Night Market", 4000],
    ]);
    for (const row of summary.rows.filter((x) => !x.$style)) {
      const account = ACCOUNTS.find((a) => a.name === row.account)!;
      const expected = portions.filter((p) => p.portion === "base" && p.accountId === account.id).reduce((s, p) => s + p.amount, 0);
      expect(row.rent).toBe(expected);
    }
    expect(sectionTotals(summary)).toEqual({ rows: 3, rent: 34000, surcharge: 600, total: 34600 });
    expect(summary.rows.find((x) => x.account === "Total Public Mall")).toMatchObject({
      rent: 20000, surcharge: 600, total: 20600, $style: "subtotal",
    });
    expect(summary.rows.filter((x) => x.$style).map((x) => x.account)).toEqual([
      "Total Public Mall", "Total IBJT", "Total Night Market",
    ]);
    expect(r.scope).toBe("All facilities · October 2026");
  });

  it("says so when there is nothing", () => {
    const r = tenantPaymentsReport({ leases: [], portions: [], accounts: ACCOUNTS, payerAccountIds: [] }, { month: "2026-10", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.empty).toBe("No lease was active or paid in this month.");
    expect(r.scope).toBe("IBJT · October 2026");
  });
});
