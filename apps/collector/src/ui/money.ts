import { format, parsePesoInput, type Centavos } from "@ceedo/shared";

/**
 * Renders a WIRE-FORM decimal string ("1250.00") the way every other screen renders money.
 *
 * This exists because two screens were breaking the money rule and neither looked like it
 * was. `deviceTotals` and `CloseOutcome` hand back `toDecimalString` output — a plain
 * decimal with no peso sign and no thousands separators, correct for the wire — and
 * `shift.tsx` and `closeout.tsx` were rendering it as `₱{totals.total}`. That is string
 * interpolation, which the money rule forbids outright, and the visible cost was that a
 * shift total printed `₱1250.00` where every figure on every other screen printed
 * `₱1,250.00`. A collector comparing the shift screen against a lease screen was reading
 * two different notations for the same kind of quantity, in the one part of the app whose
 * entire job is for two figures to be compared.
 *
 * RETURNS NULL RATHER THAN A ZERO WHEN IT CANNOT PARSE. `parsePesoInput` throws, and
 * nothing may throw inside a render — but the fix is not to swallow the failure into
 * `₱0.00`, which is a specific and false claim about money. Null means "this screen does
 * not have a figure", and the caller states that instead of inventing one.
 */
export function fromWire(decimal: string | null | undefined): string | null {
  if (decimal === null || decimal === undefined || decimal.trim() === "") return null;
  try {
    return format(parsePesoInput(decimal));
  } catch {
    return null;
  }
}

/**
 * Parses a collector's typed peso input without throwing. Null means "not a figure yet",
 * which includes the half-typed states a decimal pad produces — a lone "." is the one that
 * crashed a screen mid-keystroke before this guard existed.
 */
export function tryParse(input: string): Centavos | null {
  if (input.trim() === "") return null;
  try {
    return parsePesoInput(input);
  } catch {
    return null;
  }
}
