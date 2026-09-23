import type { Centavos } from "@ceedo/shared";

export interface CoveredShift {
  businessDate: string;
  /** What the collector counted and declared at closeout. */
  declared: Centavos;
  /** What the receipts add up to. */
  system: Centavos;
}

export type RemittanceState = "recorded" | "verified" | "cancelled";

export interface Reconciliation {
  declared: Centavos;
  system: Centavos;
  /** Deposit minus declared cash. Negative: less went to the bank than was counted. */
  difference: Centavos;
  /** The dates covered, oldest first, e.g. "1–2 Sep" is left to the caller. */
  dates: string[];
}

/**
 * A deposit against the cash it is meant to carry. Parent §10's Remittance reconciliation.
 *
 * Measured against DECLARED cash, not the receipts' total: the declaration is what the
 * collector said was in the drawer and so what should have reached the bank. The gap
 * between declared and receipts is the shift's own variance, already on the closeout,
 * and counting it twice here would blame the deposit for a shortage at the stall.
 */
export function reconcile(amount: Centavos, shifts: CoveredShift[]): Reconciliation {
  const declared = shifts.reduce((acc, s) => acc + s.declared, 0) as Centavos;
  const system = shifts.reduce((acc, s) => acc + s.system, 0) as Centavos;
  return {
    declared,
    system,
    difference: (amount - declared) as Centavos,
    dates: [...new Set(shifts.map((s) => s.businessDate))].sort(),
  };
}

export function remittanceState(r: {
  verifiedAt: string | null;
  cancelledAt: string | null;
}): RemittanceState {
  if (r.cancelledAt) return "cancelled";
  return r.verifiedAt ? "verified" : "recorded";
}

/**
 * Who may verify: accounting or an admin, and never the person who recorded the slip.
 * Mirrors verify_remittance(); the database refuses anyway, this only hides a button
 * that could not work.
 */
export function canVerify(role: string, userId: string, recordedBy: string): boolean {
  return (role === "accounting" || role === "admin") && userId !== recordedBy;
}
