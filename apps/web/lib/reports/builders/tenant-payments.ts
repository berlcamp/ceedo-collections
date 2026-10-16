// apps/web/lib/reports/builders/tenant-payments.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth, monthBounds } from "../params";
import type { Report, ReportColumn, ReportRow, ReportSection } from "../report";
import { compareStall, rateLabel, type AccrualPeriod } from "./grouping";

export interface PaymentLease {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
  /** The rent account the lease belongs to (lease_home_accounts): its row when it paid nothing. */
  homeAccountId: string;
}

/** Live receipt portions summed per lease (or payer), account, portion and day. */
export interface PaymentPortion {
  leaseId: string | null;
  payerRef: string | null;
  accountId: string;
  portion: "base" | "surcharge";
  businessDate: string;
  amount: Centavos;
}

export interface PaymentAccount {
  id: string;
  name: string;
  facilityName: string | null;
  sortOrder: number;
}

export interface TenantPaymentsInput {
  leases: PaymentLease[];
  portions: PaymentPortion[];
  accounts: PaymentAccount[];
  /** Accounts whose lease-less payers get a row each (Night Market, Tabo). */
  payerAccountIds: string[];
}

interface GridRow {
  accountId: string;
  tenant: string;
  stall: string | null;
  rate: string | null;
  isLease: boolean;
  days: number[];
  surcharge: number;
}

/**
 * Spec report 2, the April "Rentable Income Collections" grid, in blocks by account line
 * (facility → account). Each block's day columns (its "Received") equal that account's line
 * in the Monthly summary. One row per lease per block it paid into, plus its home block
 * always (a lease that paid nothing keeps its row). The Surcharge column shows a lease's
 * surcharges, on its home row only so they count once; the summary carries them on the
 * Rental Surcharge lines. Night Market and Tabo vendors without a lease get one row per
 * payer name. Money on an account that is neither a lease's nor a payer account (walk-in
 * fees) is not in this grid.
 */
export function tenantPaymentsReport(
  input: TenantPaymentsInput,
  opts: { month: string; facilityName: string | null },
): Report {
  const { from, to } = monthBounds(opts.month);
  const dayCount = Number(to.slice(8));
  const dayKeys = Array.from({ length: dayCount }, (_, i) => `d${i + 1}`);
  const leaseById = new Map(input.leases.map((l) => [l.leaseId, l]));
  const payerAccounts = new Set(input.payerAccountIds);

  const grid = new Map<string, GridRow>();
  const rowFor = (accountId: string, key: string, init: Pick<GridRow, "tenant" | "stall" | "rate" | "isLease">) => {
    const k = `${accountId}\u0000${key}`;
    let row = grid.get(k);
    if (!row) {
      row = { accountId, ...init, days: Array.from({ length: dayCount }, () => 0), surcharge: 0 };
      grid.set(k, row);
    }
    return row;
  };
  const leaseRow = (accountId: string, l: PaymentLease) =>
    rowFor(accountId, `lease:${l.leaseId}`, {
      tenant: l.tenantName, stall: l.stallNo, rate: rateLabel(l.rate, l.accrualPeriod), isLease: true,
    });

  for (const l of input.leases) leaseRow(l.homeAccountId, l);
  for (const p of input.portions) {
    if (p.businessDate < from || p.businessDate > to) continue;
    const day = Number(p.businessDate.slice(8)) - 1;
    if (p.leaseId) {
      const l = leaseById.get(p.leaseId);
      if (!l) continue; // a lease outside the chosen facility
      if (p.portion === "surcharge") {
        leaseRow(l.homeAccountId, l).surcharge += p.amount;
      } else {
        const row = leaseRow(p.accountId, l);
        row.days[day] = (row.days[day] ?? 0) + p.amount;
      }
    } else if (p.portion === "base" && payerAccounts.has(p.accountId)) {
      const name = p.payerRef ?? "(no name)";
      const row = rowFor(p.accountId, `payer:${name}`, { tenant: name, stall: null, rate: null, isLease: false });
      row.days[day] = (row.days[day] ?? 0) + p.amount;
    }
  }

  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const byAccount = new Map<string, GridRow[]>();
  for (const row of grid.values()) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  const blocks = [...byAccount]
    .map(([id, rows]) => ({ account: accountById.get(id), rows }))
    .sort(
      (a, b) =>
        (a.account?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.account?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (a.account?.name ?? "").localeCompare(b.account?.name ?? ""),
    );

  const columns: ReportColumn[] = [
    { key: "tenant", label: "Tenant", kind: "text" },
    { key: "stall", label: "Stall", kind: "text" },
    { key: "rate", label: "Rate", kind: "text" },
    ...dayKeys.map((key, i) => ({ key, label: String(i + 1), kind: "money" as const, total: true })),
    { key: "surcharge", label: "Surcharge", kind: "money", total: true },
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const rentOf = (r: GridRow) => r.days.reduce((acc, v) => acc + v, 0);
  const toRow = (r: GridRow): ReportRow => {
    const row: ReportRow = { tenant: r.tenant, stall: r.stall, rate: r.rate };
    r.days.forEach((v, i) => {
      row[dayKeys[i]!] = v !== 0 ? v : null;
    });
    row.surcharge = r.surcharge !== 0 ? r.surcharge : null;
    row.total = rentOf(r) + r.surcharge;
    return row;
  };
  const byStallThenName = (a: GridRow, b: GridRow) =>
    a.isLease !== b.isLease
      ? a.isLease ? -1 : 1
      : compareStall(a.stall ?? "", b.stall ?? "") || a.tenant.localeCompare(b.tenant);

  const sections: ReportSection[] = blocks.map((b) => ({
    title: b.account ? `${b.account.facilityName ?? "All facilities"} · ${b.account.name}` : "Unknown account",
    columns,
    dense: true,
    rows: [...b.rows].sort(byStallThenName).map(toRow),
  }));

  const blockTotals = (b: { rows: GridRow[] }) => {
    const rent = b.rows.reduce((acc, r) => acc + rentOf(r), 0);
    const surcharge = b.rows.reduce((acc, r) => acc + r.surcharge, 0);
    return { rows: b.rows.length, rent, surcharge, total: rent + surcharge };
  };
  const byFacility = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const label = b.account?.facilityName ?? "All facilities";
    byFacility.set(label, [...(byFacility.get(label) ?? []), b]);
  }
  const summaryRows: ReportRow[] = [];
  for (const [label, group] of byFacility) {
    for (const b of group) {
      summaryRows.push({ facility: label, account: b.account?.name ?? "Unknown account", ...blockTotals(b) });
    }
    const sub = group.reduce(
      (acc, b) => {
        const t = blockTotals(b);
        return { rows: acc.rows + t.rows, rent: acc.rent + t.rent, surcharge: acc.surcharge + t.surcharge, total: acc.total + t.total };
      },
      { rows: 0, rent: 0, surcharge: 0, total: 0 },
    );
    summaryRows.push({ facility: label, account: `Total ${label}`, ...sub, $style: "subtotal" });
  }

  sections.push({
    title: "Summary by account",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "account", label: "Account", kind: "text" },
      { key: "rows", label: "Rows", kind: "int", total: true },
      { key: "rent", label: "Received", kind: "money", total: true },
      { key: "surcharge", label: "Surcharge", kind: "money", total: true },
      { key: "total", label: "Total", kind: "money", total: true },
    ],
    rows: summaryRows,
    empty: "No lease was active or paid in this month.",
  });

  return {
    title: "Monthly tenant payments",
    scope: `${opts.facilityName ?? "All facilities"} · ${longMonth(opts.month)}`,
    sections,
    notes: [
      "Blocks follow the account chart. Each day shows what the row paid to that line on that business date.",
      "“Received” in the summary by account equals that line in the Monthly summary; surcharges belong to the Rental Surcharge lines there.",
      "A lease that paid to more than one line appears in each; its surcharges are on its row in its home line.",
      "Night Market and Tabo vendors without a lease appear as one row per payer name.",
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
    ],
  };
}
