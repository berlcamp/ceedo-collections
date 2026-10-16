// apps/web/lib/reports/builders/monthly-summary.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth } from "../params";
import { pesos, type Report, type ReportColumn, type ReportRow, type RowStyle } from "../report";

/**
 * The system starts fresh on this month (spec "History before cutover"): earlier months
 * stay in QuickBooks and the office's Excel files, so the summary leaves them blank.
 */
export const CUTOVER_MONTH = "2026-10";

export interface SummaryAccount {
  id: string;
  code: string;
  name: string;
  facilityId: string | null;
  groupName: string;
  sortOrder: number;
  kind: "income" | "non_income";
  active: boolean;
}

/** One account's sum for one month (YYYY-MM). */
export interface MonthAmount {
  month: string;
  accountId: string;
  amount: Centavos;
}

export interface SummaryAdjustment extends MonthAmount {
  note: string;
}

export interface ControlTotal {
  month: string;
  amount: Centavos;
  note: string | null;
  enteredAt: string;
}

export interface SummaryInput {
  year: string;
  /** Manila business date the report is built on: months not yet ended are blank. */
  today: string;
  accounts: SummaryAccount[];
  facilities: { id: string; name: string }[];
  /** Live receipt portions, summed (monthly_account_totals). */
  totals: MonthAmount[];
  /** Live (not cancelled) adjustments of the year. */
  adjustments: SummaryAdjustment[];
  /** Every control-total entry of the year; the latest per month is in force. */
  controls: ControlTotal[];
  signatories: { label: string; name: string | null; title: string | null }[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The control total in force per month: the one entered last. */
export function latestControls(rows: ControlTotal[]): Map<string, ControlTotal> {
  const out = new Map<string, ControlTotal>();
  for (const row of rows) {
    const seen = out.get(row.month);
    if (!seen || row.enteredAt > seen.enteredAt) out.set(row.month, row);
  }
  return out;
}

interface Block {
  heading: string;
  accounts: SummaryAccount[];
}

/** Accounts (already in chart order) grouped by a key, blocks in order of their first account. */
function blocksOf(accounts: SummaryAccount[], key: (a: SummaryAccount) => string, heading: (a: SummaryAccount) => string): Block[] {
  const blocks = new Map<string, Block>();
  for (const a of accounts) {
    const k = key(a);
    const block = blocks.get(k) ?? { heading: heading(a), accounts: [] };
    block.accounts.push(a);
    blocks.set(k, block);
  }
  return [...blocks.values()];
}

/**
 * Spec report 4, the "Total Income and Non-Income Collection" sheet: account lines × Jan–Dec,
 * facility → group → line with sub-totals, Total Income, the Non-Income block, the Grand
 * total; then the summary by facility and the cashier's control total against it.
 */
export function monthlySummaryReport(input: SummaryInput): Report {
  const months = MONTH_LABELS.map((_, i) => `${input.year}-${String(i + 1).padStart(2, "0")}`);
  const current = input.today.slice(0, 7);
  const shown = new Set(months.filter((m) => m >= CUTOVER_MONTH && m < current));

  const byAccount = new Map<string, Map<string, number>>();
  const add = (accountId: string, month: string, amount: number) => {
    const perMonth = byAccount.get(accountId) ?? new Map<string, number>();
    perMonth.set(month, (perMonth.get(month) ?? 0) + amount);
    byAccount.set(accountId, perMonth);
  };
  for (const t of input.totals) add(t.accountId, t.month, t.amount);
  const adjustments = input.adjustments.filter((a) => shown.has(a.month));
  for (const a of adjustments) add(a.accountId, a.month, a.amount);
  const adjusted = new Set(adjustments.map((a) => a.accountId));

  const amountOf = (id: string, month: string) => byAccount.get(id)?.get(month) ?? 0;
  const hasMoney = (id: string) => [...(byAccount.get(id)?.values() ?? [])].some((v) => v !== 0);
  const sumOf = (accounts: SummaryAccount[]) => (month: string) =>
    accounts.reduce((acc, a) => acc + amountOf(a.id, month), 0);

  /** Month cells: blank where not shown; Total over the shown months, blank if none. */
  const cells = (get: (month: string) => number | null): ReportRow => {
    const row: ReportRow = {};
    let total: number | null = null;
    for (let i = 0; i < months.length; i++) {
      const month = months[i]!;
      const value = shown.has(month) ? get(month) : null;
      row[`m${i + 1}`] = value;
      if (value !== null) total = (total ?? 0) + value;
    }
    row.total = total;
    return row;
  };

  const visible = input.accounts
    .filter((a) => (a.code === "UNCLASSIFIED" ? hasMoney(a.id) : a.active || hasMoney(a.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const facilityName = new Map(input.facilities.map((f) => [f.id, f.name]));
  const income = visible.filter((a) => a.kind === "income");
  const nonIncome = visible.filter((a) => a.kind === "non_income");
  const facilityBlocks = blocksOf(
    income,
    (a) => a.facilityId ?? "",
    (a) => (a.facilityId ? (facilityName.get(a.facilityId) ?? "—") : "All facilities"),
  );

  const rows: ReportRow[] = [];
  const pushBlock = (block: Block, totalStyle: RowStyle) => {
    rows.push({ account: block.heading, $style: "heading" });
    for (const group of blocksOf(block.accounts, (a) => a.groupName, (a) => a.groupName)) {
      rows.push({ account: group.heading, $style: "heading", $indent: 1 });
      for (const a of group.accounts) {
        rows.push({
          account: adjusted.has(a.id) ? `${a.name} †` : a.name,
          ...cells((m) => amountOf(a.id, m)),
          $indent: 2,
        });
      }
      rows.push({ account: `Total ${group.heading}`, ...cells(sumOf(group.accounts)), $style: "subtotal", $indent: 1 });
    }
    rows.push({ account: `Total ${block.heading}`, ...cells(sumOf(block.accounts)), $style: totalStyle });
  };

  for (const block of facilityBlocks) pushBlock(block, "subtotal");
  rows.push({ account: "Total Income", ...cells(sumOf(income)), $style: "total" });
  if (nonIncome.length > 0) pushBlock({ heading: "Non-Income", accounts: nonIncome }, "total");
  const grand = sumOf(visible);
  rows.push({ account: "Grand total", ...cells(grand), $style: "total" });

  const byFacility: ReportRow[] = [
    ...facilityBlocks.map((b) => ({ account: b.heading, ...cells(sumOf(b.accounts)) })),
    ...(nonIncome.length > 0 ? [{ account: "Non-Income", ...cells(sumOf(nonIncome)) }] : []),
    { account: "Grand total", ...cells(grand), $style: "total" },
  ];

  const controls = latestControls(input.controls);
  const control: ReportRow[] = [
    { account: "Grand total (system)", ...cells(grand) },
    { account: "Cashier's control total", ...cells((m) => controls.get(m)?.amount ?? null) },
    {
      account: "Difference (control − system)",
      ...cells((m) => {
        const c = controls.get(m);
        return c ? c.amount - grand(m) : null;
      }),
    },
  ];

  const columns: ReportColumn[] = [
    { key: "account", label: "Account", kind: "text" },
    ...MONTH_LABELS.map((label, i) => ({ key: `m${i + 1}`, label, kind: "money" as const })),
    { key: "total", label: "Total", kind: "money" },
  ];

  const nameOf = new Map(input.accounts.map((a) => [a.id, a.name]));
  const sortOf = new Map(input.accounts.map((a) => [a.id, a.sortOrder]));
  const adjustmentNotes = [...adjustments]
    .sort((a, b) => a.month.localeCompare(b.month) || (sortOf.get(a.accountId) ?? 0) - (sortOf.get(b.accountId) ?? 0))
    .map((a) => `† ${nameOf.get(a.accountId) ?? "—"}, ${longMonth(a.month)}: ${pesos(a.amount)}. ${a.note}`);
  const controlNotes = [...controls.values()]
    .filter((c) => shown.has(c.month) && c.note)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((c) => `Control total, ${longMonth(c.month)}: ${c.note}`);

  const unclassified = input.accounts.find((a) => a.code === "UNCLASSIFIED");
  const unclassifiedMonths = unclassified
    ? [...(byAccount.get(unclassified.id) ?? new Map<string, number>())]
        .filter(([, v]) => v !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];
  const unclassifiedTotal = unclassifiedMonths.reduce((acc, [, v]) => acc + v, 0);

  return {
    title: "Monthly Summary of Collections",
    scope: `Year ${input.year}`,
    layout: "landscape",
    sections: [
      { title: "Total income and non-income collections", columns, rows, dense: true },
      { title: "Summary by facility", columns, rows: byFacility, dense: true },
      { title: "Control total", columns, rows: control, dense: true },
    ],
    notes: [
      `Months before the system started (${longMonth(CUTOVER_MONTH)}) and months that have not ended are left blank.`,
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
      ...adjustmentNotes,
      ...controlNotes,
    ],
    warnings:
      unclassifiedMonths.length > 0
        ? [
            {
              text: `${pesos(unclassifiedTotal)} of ${input.year}'s collections is on no account (Unclassified).`,
              href: `/accounts/unclassified?month=${unclassifiedMonths[0]![0]}`,
              linkText: "Classify it",
            },
          ]
        : [],
    signatures:
      input.signatories.length > 0
        ? input.signatories.map((s) => ({ label: s.label, name: s.name ?? undefined, title: s.title ?? undefined }))
        : undefined,
  };
}
