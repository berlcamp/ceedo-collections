import { sum, type Centavos } from "@ceedo/shared";
import { longDate } from "../params";
import type { Report, ReportColumn, ReportSection } from "../report";
import { compareStall, groupBySection, rateLabel, type AccrualPeriod } from "./grouping";

export interface BalanceRow {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
  notYetDue: Centavos;
  days1to30: Centavos;
  days31to60: Centavos;
  days61to90: Centavos;
  over90: Centavos;
  outstanding: Centavos;
}

const COLUMNS: ReportColumn[] = [
  { key: "stall", label: "Stall", kind: "text" },
  { key: "tenant", label: "Tenant", kind: "text" },
  { key: "rate", label: "Rate", kind: "text" },
  { key: "nyd", label: "Not yet due", kind: "money", total: true },
  { key: "b1", label: "1–30 days", kind: "money", total: true },
  { key: "b2", label: "31–60 days", kind: "money", total: true },
  { key: "b3", label: "61–90 days", kind: "money", total: true },
  { key: "b4", label: "Over 90 days", kind: "money", total: true },
  { key: "owed", label: "Outstanding", kind: "money", total: true },
];

/** Spec report 3: what each tenant owed at the end of a date, by facility and section. */
export function balancesReport(
  rows: BalanceRow[],
  opts: { date: string; facilityName: string | null },
): Report {
  const groups = groupBySection(rows);
  const sections: ReportSection[] = groups.map((g) => ({
    title: `${g.facilityName} · ${g.sectionName}`,
    columns: COLUMNS,
    rows: [...g.rows]
      .sort((a, b) => compareStall(a.stallNo, b.stallNo))
      .map((r) => ({
        stall: r.stallNo,
        tenant: r.tenantName,
        rate: rateLabel(r.rate, r.accrualPeriod),
        nyd: r.notYetDue,
        b1: r.days1to30,
        b2: r.days31to60,
        b3: r.days61to90,
        b4: r.over90,
        owed: r.outstanding,
      })),
  }));
  sections.push({
    title: "Summary by section",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "section", label: "Section", kind: "text" },
      { key: "leases", label: "Tenants owing", kind: "int", total: true },
      { key: "owed", label: "Outstanding", kind: "money", total: true },
    ],
    rows: groups.map((g) => ({
      facility: g.facilityName,
      section: g.sectionName,
      leases: g.rows.length,
      owed: sum(g.rows.map((r) => r.outstanding)),
    })),
    empty: "No tenant had an outstanding balance on this date.",
  });
  return {
    title: "Tenant balances",
    scope: `${opts.facilityName ?? "All facilities"} · as of ${longDate(opts.date)}`,
    sections,
    notes: [
      "Outstanding is every charge due on or before the date, less receipts dated by then and write-offs recorded by then.",
      "A receipt cancelled after the date still counts as paid on it.",
    ],
  };
}
