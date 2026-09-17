import { applyBasisPoints, type Centavos } from "./money";

export type AccrualPeriod = "daily" | "weekly" | "monthly";

export interface ChargePeriod {
  /** ISO date, inclusive. */
  periodStart: string;
  /** ISO date, inclusive. */
  periodEnd: string;
  /** ISO date. The surcharge clock starts here. */
  dueDate: string;
}

export interface GeneratePeriodsInput {
  accrualPeriod: AccrualPeriod;
  leaseStart: string;
  leaseEnd: string | null;
  /** No period may begin before this date. */
  cutover: string;
  /** Generate periods that have fully elapsed on or before this date. */
  through: string;
  /** Day of month a monthly charge falls due. Constrained to 1..28 in the database. */
  dueDay: number | null;
}

/**
 * Dates are handled as ISO strings and UTC-noon Date objects throughout.
 *
 * Noon rather than midnight is not superstition: a Date at midnight UTC shifts to the
 * previous calendar day in any negative-offset timezone, so `toISOString().slice(0, 10)`
 * silently returns yesterday. Anchoring at noon keeps every offset on Earth inside the
 * same calendar day, so the same period boundaries come out whoever runs this.
 */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** The last day of the month `date` falls in. */
function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
}

function startOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12));
}

export function generatePeriods(input: GeneratePeriodsInput): ChargePeriod[] {
  const { accrualPeriod, leaseEnd, dueDay } = input;

  if (accrualPeriod === "monthly" && (dueDay === null || dueDay === undefined)) {
    throw new Error("A monthly lease needs a due day");
  }

  const leaseStartDate = parse(input.leaseStart);

  // The cutover floor is applied here, once, rather than by each caller. Invariant #18.
  const start = leaseStartDate > parse(input.cutover) ? leaseStartDate : parse(input.cutover);
  const through = parse(input.through);
  const hardEnd = leaseEnd === null ? null : parse(leaseEnd);

  const periods: ChargePeriod[] = [];
  let cursor = accrualPeriod === "monthly"
    ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12))
    : start;

  while (cursor <= through) {
    let periodEnd: Date;
    let dueDate: Date;

    if (accrualPeriod === "daily") {
      periodEnd = cursor;
      dueDate = cursor;
    } else if (accrualPeriod === "weekly") {
      periodEnd = addDays(cursor, 6);
      dueDate = periodEnd;
    } else {
      periodEnd = endOfMonth(cursor);
      dueDate = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay!, 12),
      );
    }

    const next = accrualPeriod === "monthly" ? startOfNextMonth(cursor) : addDays(periodEnd, 1);

    // A period is billed only when the lease covers it end to end -- symmetric with the
    // trailing guard just below (`periodEnd > hardEnd`). A monthly lease starting mid-month
    // is therefore not billed a partial first month; billing starts the following calendar
    // month. This guard only bites monthly periods: the cursor there is floored to the 1st
    // of the month regardless of where in the month the lease (or the cutover) actually
    // falls, so `cursor` (== periodStart) can land before leaseStart. Daily and weekly
    // periods start exactly on `start` (= max(leaseStart, cutover)), so periodStart is never
    // earlier than leaseStart for them and this branch never fires.
    //
    // The cutover interacts with this cleanly, not additionally: `start` already floors to
    // the cutover when the lease predates it, so a lease already running when the cutover
    // landed still gets billed for the calendar period the cutover falls inside -- that
    // period is wholly covered by the already-running lease, just not by the accrual window
    // before cutover. Those pre-cutover arrears belong to the opening balance, not to this
    // function.
    if (cursor < leaseStartDate) {
      cursor = next;
      continue;
    }

    // Only fully elapsed periods are raised. A week that has not finished is not yet owed.
    if (periodEnd > through) break;
    if (hardEnd !== null && periodEnd > hardEnd) break;

    periods.push({
      periodStart: fmt(cursor),
      periodEnd: fmt(periodEnd),
      dueDate: fmt(dueDate),
    });

    cursor = next;
  }

  return periods;
}

/**
 * 3% of the base rental, as integer basis points. Delegates to applyBasisPoints so there
 * is one rounding rule in the codebase rather than two that agree until they do not.
 */
export function computeSurcharge(base: Centavos, bps: number): Centavos {
  return applyBasisPoints(base, bps);
}

/**
 * The date a charge becomes delinquent: one calendar month after it fell due.
 *
 * Calendar arithmetic, not 30 days. A 31 January charge becomes delinquent on 28
 * February, matching Postgres's `+ interval '1 month'` and the office's own reckoning.
 */
export function surchargeDueFrom(dueDate: string): string {
  const d = parse(dueDate);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
  const lastDay = endOfMonth(target).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return fmt(target);
}
