import type { Centavos } from "@ceedo/shared";

/**
 * A shortage against what has been paid back toward it. Migration 20260929000058.
 *
 * The shift's variance is never edited, so "is this collector still short?" is always
 * answered here, from the variance and the settlements beside it. Client-safe: no database
 * import, so the tables can use it too.
 */
export type SettlementState = "recorded" | "verified" | "cancelled";

export type ShortageState = "outstanding" | "partly_settled" | "settled";

export interface Tally {
  /** The shortage, as a positive figure: -variance. */
  short: Centavos;
  /** Verified repayments. Only these reduce what is owed. */
  settled: Centavos;
  /** Recorded, awaiting accounting. Shown, but not yet counted as paid. */
  pending: Centavos;
  /** short - settled. */
  outstanding: Centavos;
  /** What may still be recorded: short - settled - pending. The database enforces it too. */
  room: Centavos;
  state: ShortageState;
}

export function settlementState(s: {
  verifiedAt: string | null;
  cancelledAt: string | null;
}): SettlementState {
  if (s.cancelledAt) return "cancelled";
  return s.verifiedAt ? "verified" : "recorded";
}

/** `variance` is the shift's signed variance; only a negative one is a shortage. */
export function tally(
  variance: Centavos,
  settlements: { amount: Centavos; state: SettlementState }[],
): Tally {
  const short = (variance < 0 ? -variance : 0) as Centavos;
  const add = (state: SettlementState) =>
    settlements.filter((s) => s.state === state).reduce((a, s) => a + s.amount, 0) as Centavos;
  const settled = add("verified");
  const pending = add("recorded");
  const outstanding = Math.max(0, short - settled) as Centavos;
  return {
    short,
    settled,
    pending,
    outstanding,
    room: Math.max(0, short - settled - pending) as Centavos,
    state: outstanding === 0 ? "settled" : settled > 0 ? "partly_settled" : "outstanding",
  };
}

export const SHORTAGE_LABEL: Record<ShortageState, string> = {
  outstanding: "Outstanding",
  partly_settled: "Partly settled",
  settled: "Settled",
};
