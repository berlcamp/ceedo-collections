import type { Centavos } from "./money.js";

export type RateBasis =
  | "per_day"
  | "per_week"
  | "per_month"
  | "per_entry"
  | "per_head"
  | "per_sqm";

export interface RateRow {
  id: string;
  feeTypeId: string;
  /** Vehicle class at the terminal, animal class at the slaughterhouse. "" when unclassified. */
  rateClass: string;
  /** ISO date, inclusive. */
  effectiveFrom: string;
  /** ISO date, inclusive. null means open-ended. */
  effectiveTo: string | null;
  amount: Centavos;
  basis: RateBasis;
}

export class RateNotFoundError extends Error {
  constructor(feeTypeId: string, on: string, rateClass: string) {
    super(
      `No rate for fee type "${feeTypeId}"${rateClass ? ` class "${rateClass}"` : ""} on ${on}`,
    );
    this.name = "RateNotFoundError";
  }
}

function covers(row: RateRow, on: string): boolean {
  if (on < row.effectiveFrom) return false;
  return row.effectiveTo === null || on <= row.effectiveTo;
}

/**
 * The rate in force for a fee type and class on a given date.
 *
 * Throws rather than picking one when two rates overlap. A database exclusion
 * constraint prevents that, so reaching this branch means the constraint was
 * dropped or the caller assembled rows by hand — either way, silently choosing
 * would produce a wrong amount on a receipt.
 */
export function resolveRate(
  rates: readonly RateRow[],
  feeTypeId: string,
  on: string,
  rateClass = "",
): RateRow {
  const matches = rates.filter(
    (row) => row.feeTypeId === feeTypeId && row.rateClass === rateClass && covers(row, on),
  );
  if (matches.length === 0) throw new RateNotFoundError(feeTypeId, on, rateClass);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous rates for "${feeTypeId}" on ${on}: ${matches.map((m) => m.id).join(", ")}`,
    );
  }
  return matches[0]!;
}
