// apps/web/lib/reports/builders/daily-collection/treasurer.ts
import type { ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyInput, type DailyShift } from "./types";

/** The built-in holding line for accounts the office has not placed (migration 066). */
export const OTHER_LINE = "TL_OTHER";

/**
 * Date of deposit for money collected on these shifts: the latest live deposit covering
 * them, "(unverified)" if any covering deposit is not yet verified, and "Undeposited" while
 * any of them -- or a receipt on no shift -- is not deposited at all. Null with no shifts.
 */
export function depositLabel(shiftIds: Iterable<string | null>, shifts: Map<string, DailyShift>): string | null {
  let latest: string | null = null;
  let unverified = false;
  let any = false;
  for (const id of shiftIds) {
    any = true;
    const deposit = id ? (shifts.get(id)?.deposit ?? null) : null;
    if (!deposit) return "Undeposited";
    if (latest === null || deposit.on > latest) latest = deposit.on;
    if (!deposit.verified) unverified = true;
  }
  if (!any) return null;
  return unverified ? `${latest} (unverified)` : latest;
}

/**
 * Part (a), the page sent to the City Treasurer: one row per Treasurer line, Sub-total 1
 * and Sub-total 2 after their groups, then the Grand total. Lines with nothing that day
 * stay on the page blank, as the office's form lists them all -- except the built-in
 * "Other collections", which is shown only when it holds money (and then always).
 */
export function treasurerSection(input: DailyInput): ReportSection {
  const accounts = byId(input.accounts);
  const shifts = byId(input.shifts);
  const amount = new Map<string, number>();
  const shiftsOf = new Map<string, Set<string | null>>();
  for (const p of input.portions) {
    if (p.cancelled) continue;
    const lineId = accountOf(accounts, p).treasurerLineId;
    amount.set(lineId, (amount.get(lineId) ?? 0) + p.amount);
    shiftsOf.set(lineId, (shiftsOf.get(lineId) ?? new Set<string | null>()).add(p.shiftId));
  }

  const shown = input.treasurerLines
    .filter((l) => (l.active && l.code !== OTHER_LINE) || (amount.get(l.id) ?? 0) !== 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows: ReportRow[] = [];
  let grand = 0;
  for (const group of [1, 2] as const) {
    let sum = 0;
    for (const l of shown.filter((x) => x.subtotalGroup === group)) {
      const a = amount.get(l.id) ?? 0;
      sum += a;
      rows.push({
        particulars: l.name,
        collected: a ? input.date : null,
        amount: a || null,
        deposited: a ? depositLabel(shiftsOf.get(l.id) ?? [], shifts) : null,
      });
    }
    grand += sum;
    rows.push({ particulars: `Sub-total ${group}`, collected: null, amount: sum, deposited: null, $style: "subtotal" });
  }
  rows.push({ particulars: "Grand total", collected: null, amount: grand, deposited: null, $style: "total" });

  return {
    title: "Daily Collection Report",
    orientation: "portrait",
    sheet: "Treasurer",
    columns: [
      { key: "particulars", label: "Particulars", kind: "text" },
      { key: "collected", label: "Date of collection", kind: "date" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "deposited", label: "Date of deposit", kind: "text" },
    ],
    rows,
  };
}
