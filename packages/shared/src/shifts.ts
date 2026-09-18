import type { Centavos } from "./money";

/**
 * Closeout arithmetic, shared by the collector app and the server's own tests.
 *
 * Parent spec §6.5 describes TWO comparisons and they must not be conflated:
 *
 *   device count/sum  vs  server count/sum  -> RECORDS are missing. Blocks closeout.
 *   declared cash     vs  server sum        -> the DRAWER is short. Recorded, never blocks.
 *
 * `reconciles` answers the first. `shiftVariance` computes the second. Neither knows about
 * the other, which is the point.
 */

export function shiftVariance(input: {
  declared: Centavos;
  system: Centavos;
}): Centavos {
  // Signed. Over and short are different problems; an absolute value would hide which.
  return (input.declared - input.system) as Centavos;
}

/**
 * Deliberately takes no declared-cash parameter. §6.5 step 5's cash-vs-system variance is
 * recorded and never blocks closeout; only the device-vs-server comparison does. That is
 * enforced here by omission, not by a runtime check: there is nothing this signature lets a
 * caller pass that could make a short drawer fail to reconcile.
 */
export function reconciles(input: {
  deviceCount: number;
  deviceTotal: Centavos;
  systemCount: number;
  systemTotal: Centavos;
}): boolean {
  // Both halves. Checking only the total would let a shift with one missing receipt and one
  // duplicated amount reconcile cleanly; checking only the count would miss a mispriced one.
  return (
    input.deviceCount === input.systemCount && input.deviceTotal === input.systemTotal
  );
}
