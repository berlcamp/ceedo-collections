import type { Centavos } from "@ceedo/shared";
import { longMonth, monthBounds } from "../params";
import type { Cell, Report, ReportColumn, ReportSection } from "../report";
import { compareStall, groupBySection, rateLabel, type AccrualPeriod } from "./grouping";

export interface PaymentLease {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
}

export interface PaymentDay {
  leaseId: string;
  businessDate: string;
  base: Centavos;
  surcharge: Centavos;
}

/**
 * Spec report 2, the April "Rentable Income Collections" grid: one row per lease, one
 * column per day holding the rent received that day, surcharges totalled apart.
 */
export function tenantPaymentsReport(
  leases: PaymentLease[],
  days: PaymentDay[],
  opts: { month: string; facilityName: string | null },
): Report {
  const { from, to } = monthBounds(opts.month);
  const dayCount = Number(to.slice(8));
  const dayKeys = Array.from({ length: dayCount }, (_, i) => `d${i + 1}`);

  const byLease = new Map<string, PaymentDay[]>();
  for (const d of days) {
    if (d.businessDate < from || d.businessDate > to) continue;
    byLease.set(d.leaseId, [...(byLease.get(d.leaseId) ?? []), d]);
  }

  const columns: ReportColumn[] = [
    { key: "tenant", label: "Tenant", kind: "text" },
    { key: "stall", label: "Stall", kind: "text" },
    { key: "rate", label: "Rate", kind: "text" },
    ...dayKeys.map((key, i) => ({ key, label: String(i + 1), kind: "money" as const, total: true })),
    { key: "surcharge", label: "Surcharge", kind: "money", total: true },
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const totals = new Map<string, { rent: number; surcharge: number }>();
  const toRow = (l: PaymentLease): Record<string, Cell> => {
    const row: Record<string, Cell> = { tenant: l.tenantName, stall: l.stallNo, rate: rateLabel(l.rate, l.accrualPeriod) };
    for (const key of dayKeys) row[key] = null;
    let rent = 0;
    let surcharge = 0;
    for (const d of byLease.get(l.leaseId) ?? []) {
      const key = `d${Number(d.businessDate.slice(8))}`;
      if (d.base > 0) row[key] = ((row[key] as number | null) ?? 0) + d.base;
      rent += d.base;
      surcharge += d.surcharge;
    }
    totals.set(l.leaseId, { rent, surcharge });
    row.surcharge = surcharge > 0 ? surcharge : null;
    row.total = rent + surcharge;
    return row;
  };

  const groups = groupBySection(leases);
  const sections: ReportSection[] = groups.map((g) => ({
    title: `${g.facilityName} · ${g.sectionName}`,
    columns,
    dense: true,
    rows: [...g.rows].sort((a, b) => compareStall(a.stallNo, b.stallNo)).map(toRow),
  }));

  sections.push({
    title: "Summary by section",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "section", label: "Section", kind: "text" },
      { key: "leases", label: "Tenants", kind: "int", total: true },
      { key: "rent", label: "Rent", kind: "money", total: true },
      { key: "surcharge", label: "Surcharge", kind: "money", total: true },
      { key: "total", label: "Total", kind: "money", total: true },
    ],
    rows: groups.map((g) => {
      const rent = g.rows.reduce((acc, l) => acc + (totals.get(l.leaseId)?.rent ?? 0), 0);
      const surcharge = g.rows.reduce((acc, l) => acc + (totals.get(l.leaseId)?.surcharge ?? 0), 0);
      return { facility: g.facilityName, section: g.sectionName, leases: g.rows.length, rent, surcharge, total: rent + surcharge };
    }),
    empty: "No lease was active or paid in this month.",
  });

  return {
    title: "Monthly tenant payments",
    scope: `${opts.facilityName ?? "All facilities"} · ${longMonth(opts.month)}`,
    sections,
    notes: [
      "Each day shows the rent received on that business date; surcharges are totalled in their own column.",
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
    ],
  };
}
