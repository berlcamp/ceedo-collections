import type { ParamKind } from "./catalog";
import { monthBounds, type ReportParams } from "./params";

/**
 * Which unresolved sync exceptions bear on a report's figures.
 *
 * An open exception is a receipt a vendor holds and the ledger does not: until it is
 * corrected or spoiled, collection totals are short by it, the tenant's periods read as
 * unpaid, and its OR reads as a gap in the booklet. A correction posts it under its
 * ORIGINAL collection date, so a report printed now for that date will not match one
 * printed afterwards. The report screen warns rather than refusing: the office may still
 * need the report, but it must know the figures can move.
 *
 * Scoped by the receipt's own collected_at -- the date it will be posted under -- not by
 * when the exception was raised. Pure, so the scoping is testable without a database.
 */
export interface OpenException {
  collectorId: string;
  /** From the device's payload; null when the payload does not carry one. */
  collectedAt: string | null;
  leaseId: string | null;
}

/** A Manila calendar date from a timestamp. */
function manilaDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(timestamp));
}

export function exceptionsInScope(
  rows: OpenException[],
  kinds: ParamKind[],
  p: ReportParams,
): OpenException[] {
  return rows.filter((row) => {
    if (kinds.includes("collector") && p.collectorId && row.collectorId !== p.collectorId) return false;
    if (kinds.includes("lease") && p.leaseId && row.leaseId !== p.leaseId) return false;

    // A receipt with no readable date cannot be placed in or out of a period, so it is
    // counted: an unwarranted warning costs a glance, a missing one a wrong report.
    const on = row.collectedAt ? manilaDate(row.collectedAt) : null;
    if (on === null) return true;

    if (kinds.includes("date")) return on === p.date;
    if (kinds.includes("month")) {
      const { from, to } = monthBounds(p.month);
      return on >= from && on <= to;
    }
    // Balances as of now (aging, delinquency, a lease's ledger): every open one counts.
    return true;
  });
}
