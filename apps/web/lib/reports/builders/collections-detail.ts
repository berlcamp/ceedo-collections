// apps/web/lib/reports/builders/collections-detail.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth } from "../params";
import { pesos, type Report, type ReportRow } from "../report";
import { compareStall } from "./grouping";

/**
 * Collections detail (spec report 5): every live collection in a month, one line per
 * receipt portion and account, then each lease's payments and the totals by account. It
 * replaces the office's QuickBooks entry log and its pivots.
 *
 * All three sections are built from ONE filtered list of lines, so Section 1's total
 * equals Section 3's whatever the filters; with none, both equal the month's column in
 * the Monthly summary (before adjustments), which sums the same receipt_account_lines.
 */

/** QuickBooks' transaction types, plus cash tickets, which never had an OR. */
export type DetailType = "Rental" | "Occupancy" | "Walk-in" | "Cash ticket";

/** One receipt portion on one account: a live row of receipt_account_lines. */
export interface DetailLine {
  source: "receipt" | "cash_ticket";
  collectionId: string | null;
  cashTicketId: string | null;
  lineId: string | null;
  orNo: number | null;
  businessDate: string;
  collectorId: string;
  leaseId: string | null;
  payerRef: string | null;
  feeTypeId: string;
  facilityId: string | null;
  portion: "base" | "surcharge";
  accountId: string;
  paymentMode: "cash" | "check";
  amount: Centavos;
}

export interface DetailInput {
  /** YYYY-MM. */
  month: string;
  /** Live (not cancelled) lines only. */
  lines: DetailLine[];
  accounts: { id: string; code: string; name: string; facilityId: string | null; sortOrder: number }[];
  facilities: { id: string; name: string }[];
  collectors: { id: string; name: string }[];
  leases: { id: string; tenantId: string; tenantName: string; stallNo: string }[];
  occupancyFeeTypeIds: string[];
  /** The filtered tenant's name for the scope line, when a tenant filter is set. */
  tenantName: string | null;
}

export interface DetailFilters {
  facilityId: string | null;
  collectorId: string | null;
  accountId: string | null;
  tenantId: string | null;
  /** A case-insensitive substring of Customer; "" = no search. */
  customer: string;
}

export function detailType(line: DetailLine, occupancyFeeTypeIds: string[]): DetailType {
  if (line.source === "cash_ticket") return "Cash ticket";
  if (line.lineId !== null && occupancyFeeTypeIds.includes(line.feeTypeId)) return "Occupancy";
  if (line.leaseId !== null && line.lineId === null) return "Rental";
  return "Walk-in";
}

const UNCLASSIFIED = "UNCLASSIFIED";

export function collectionsDetailReport(input: DetailInput, filters: DetailFilters): Report {
  const account = new Map(input.accounts.map((a) => [a.id, a]));
  const facilityName = new Map(input.facilities.map((f) => [f.id, f.name]));
  const collectorName = new Map(input.collectors.map((c) => [c.id, c.name]));
  const lease = new Map(input.leases.map((l) => [l.id, l]));

  // The line's own facility (its lease's, or its fee type's), else its account's.
  const facilityOf = (l: DetailLine) => l.facilityId ?? account.get(l.accountId)?.facilityId ?? null;
  const customerOf = (l: DetailLine) => {
    if (l.leaseId) return lease.get(l.leaseId)?.tenantName ?? "—";
    return l.payerRef?.trim() || "Walk-in";
  };
  const collectorOf = (l: DetailLine) => collectorName.get(l.collectorId) ?? "—";
  const search = filters.customer.trim().toLowerCase();

  const kept = input.lines.filter(
    (l) =>
      (!filters.facilityId || facilityOf(l) === filters.facilityId) &&
      (!filters.collectorId || l.collectorId === filters.collectorId) &&
      (!filters.accountId || l.accountId === filters.accountId) &&
      (!filters.tenantId || (l.leaseId !== null && lease.get(l.leaseId)?.tenantId === filters.tenantId)) &&
      (!search || customerOf(l).toLowerCase().includes(search)),
  );

  // Date, then OR; a day's cash tickets (no OR) after its ORs, by collector; then a stable
  // tie-break within one OR: allocation portions before lines, base before surcharge,
  // accounts in chart order.
  const sorted = [...kept].sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      (a.orNo ?? Number.MAX_SAFE_INTEGER) - (b.orNo ?? Number.MAX_SAFE_INTEGER) ||
      collectorOf(a).localeCompare(collectorOf(b), "en") ||
      (a.collectionId ?? a.cashTicketId ?? "").localeCompare(b.collectionId ?? b.cashTicketId ?? "") ||
      (a.lineId ?? "").localeCompare(b.lineId ?? "") ||
      a.portion.localeCompare(b.portion) ||
      (account.get(a.accountId)?.sortOrder ?? 0) - (account.get(b.accountId)?.sortOrder ?? 0),
  );

  const lineRows: ReportRow[] = sorted.map((l) => {
    const facility = facilityOf(l);
    return {
      date: l.businessDate,
      or: l.orNo === null ? null : String(l.orNo),
      type: detailType(l, input.occupancyFeeTypeIds),
      customer: customerOf(l),
      facility: facility ? (facilityName.get(facility) ?? null) : null,
      collector: collectorOf(l),
      account: account.get(l.accountId)?.name ?? "—",
      mode: l.paymentMode === "check" ? "Check" : "Cash",
      amount: l.amount,
    };
  });

  const tenantRows = perLease(sorted, input, lease, facilityOf, facilityName);

  const accountTotals = new Map<string, number>();
  for (const l of sorted) accountTotals.set(l.accountId, (accountTotals.get(l.accountId) ?? 0) + l.amount);
  const accountRows: ReportRow[] = [...accountTotals.entries()]
    .map(([id, amount]) => ({ a: account.get(id), id, amount }))
    .sort((x, y) => (x.a?.sortOrder ?? 0) - (y.a?.sortOrder ?? 0) || x.id.localeCompare(y.id))
    .map(({ a, amount }) => ({
      account: a?.name ?? "—",
      facility: a?.facilityId ? (facilityName.get(a.facilityId) ?? null) : null,
      amount,
    }));

  // The whole month's, not the filtered list's (spec: "when the period has a non-zero
  // UNCLASSIFIED total"): a rule gap must still show while one account is reconciled.
  const unclassifiedIds = new Set(input.accounts.filter((a) => a.code === UNCLASSIFIED).map((a) => a.id));
  const unclassified = input.lines.filter((l) => unclassifiedIds.has(l.accountId)).reduce((s, l) => s + l.amount, 0);

  return {
    title: "Collections detail",
    scope: scopeLine(input, filters, account, facilityName, collectorName),
    layout: "landscape",
    warnings:
      unclassified !== 0
        ? [
            {
              text: `${pesos(unclassified)} of this month's collections is on no account (Unclassified).`,
              href: `/accounts/unclassified?month=${input.month}`,
              linkText: "Classify it",
            },
          ]
        : [],
    sections: [
      {
        title: "Collection lines",
        sheet: "Lines",
        columns: [
          { key: "date", label: "Date", kind: "date" },
          // Text, not int: a serial takes no thousands separator.
          { key: "or", label: "OR #", kind: "text" },
          { key: "type", label: "Type", kind: "text" },
          { key: "customer", label: "Customer", kind: "text" },
          { key: "facility", label: "Facility", kind: "text" },
          { key: "collector", label: "Collector", kind: "text" },
          { key: "account", label: "Account", kind: "text" },
          { key: "mode", label: "Payment mode", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: lineRows,
        empty: "No collections match.",
      },
      {
        title: "Payments per tenant",
        sheet: "Per tenant",
        breakBefore: true,
        totalLabel: "Grand total",
        columns: [
          { key: "customer", label: "Customer", kind: "text" },
          { key: "facility", label: "Facility", kind: "text" },
          { key: "stall", label: "Stall", kind: "text" },
          { key: "rent", label: "Rent", kind: "money", total: true },
          { key: "surcharge", label: "Surcharge", kind: "money", total: true },
          { key: "occupancy", label: "Occupancy", kind: "money", total: true },
          { key: "other", label: "Other", kind: "money", total: true },
          { key: "total", label: "Total", kind: "money", total: true },
        ],
        rows: tenantRows,
        empty: "No tenant paid.",
      },
      {
        title: "Totals by account",
        sheet: "By account",
        breakBefore: true,
        columns: [
          { key: "account", label: "Account", kind: "text" },
          { key: "facility", label: "Facility", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: accountRows,
        empty: "No collections match.",
      },
    ],
    notes: [
      "Cancelled receipts are left out.",
      "With no filters, the total equals the month's column in the Monthly summary before adjustments.",
    ],
  };
}

/** One row per lease that paid: its month split into rent, surcharge, occupancy and other. */
function perLease(
  lines: DetailLine[],
  input: DetailInput,
  lease: Map<string, DetailInput["leases"][number]>,
  facilityOf: (l: DetailLine) => string | null,
  facilityName: Map<string, string>,
): ReportRow[] {
  const rows = new Map<string, { facilityId: string | null; rent: number; surcharge: number; occupancy: number; other: number }>();
  for (const l of lines) {
    if (l.leaseId === null) continue;
    const row = rows.get(l.leaseId) ?? { facilityId: facilityOf(l), rent: 0, surcharge: 0, occupancy: 0, other: 0 };
    const type = detailType(l, input.occupancyFeeTypeIds);
    if (type === "Rental") row[l.portion === "surcharge" ? "surcharge" : "rent"] += l.amount;
    else if (type === "Occupancy") row.occupancy += l.amount;
    else row.other += l.amount;
    rows.set(l.leaseId, row);
  }
  return [...rows.entries()]
    .map(([id, r]) => ({ l: lease.get(id), r }))
    .sort(
      (a, b) =>
        (a.l?.tenantName ?? "").localeCompare(b.l?.tenantName ?? "", "en") ||
        compareStall(a.l?.stallNo ?? "", b.l?.stallNo ?? ""),
    )
    .map(({ l, r }) => ({
      customer: l?.tenantName ?? "—",
      facility: r.facilityId ? (facilityName.get(r.facilityId) ?? null) : null,
      stall: l?.stallNo ?? null,
      rent: r.rent,
      surcharge: r.surcharge,
      occupancy: r.occupancy,
      other: r.other,
      total: r.rent + r.surcharge + r.occupancy + r.other,
    }));
}

function scopeLine(
  input: DetailInput,
  f: DetailFilters,
  account: Map<string, DetailInput["accounts"][number]>,
  facilityName: Map<string, string>,
  collectorName: Map<string, string>,
): string {
  const parts = [longMonth(input.month)];
  if (f.facilityId) parts.push(facilityName.get(f.facilityId) ?? "one facility");
  if (f.collectorId) parts.push(collectorName.get(f.collectorId) ?? "one collector");
  if (f.accountId) parts.push(account.get(f.accountId)?.name ?? "one account");
  if (f.tenantId) parts.push(input.tenantName ?? "one tenant");
  if (f.customer.trim()) parts.push(`customer “${f.customer.trim()}”`);
  return parts.join(" · ");
}
