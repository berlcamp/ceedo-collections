/**
 * Money is integer centavos everywhere in this codebase. Floats never touch a peso.
 * Rounding is half-up to the centavo, never banker's rounding, so figures match
 * manual computation.
 */
export type Centavos = number & { readonly __brand: "Centavos" };

/**
 * Rounds half away from zero. All amounts here are non-negative in practice.
 *
 * The `toFixed(9)` is not cosmetic. A value that is mathematically x.5 may be
 * stored as x.49999999999999 — `1.005 * 100` is `100.49999999999999` — and
 * `floor(x + 0.5)` would then round it DOWN, silently breaking half-up on
 * exactly the inputs the rule exists for. Normalising to 9 decimal places first
 * restores the intended decimal value; 9 is far below the precision at which a
 * genuine sub-half value could be promoted, and far above any peso amount's
 * significant digits.
 */
function roundHalfUp(value: number): number {
  const normalised = Number(value.toFixed(9));
  return Math.sign(normalised) * Math.floor(Math.abs(normalised) + 0.5);
}

export function fromCentavos(n: number): Centavos {
  if (!Number.isFinite(n)) throw new Error("Centavo amount must be finite");
  if (!Number.isInteger(n)) throw new Error("Centavo amount must be an integer");
  return n as Centavos;
}

export function fromPesos(pesos: number): Centavos {
  if (!Number.isFinite(pesos)) throw new Error("Peso amount must be finite");
  return roundHalfUp(pesos * 100) as Centavos;
}

export function multiply(amount: Centavos, quantity: number): Centavos {
  if (!Number.isInteger(quantity)) throw new Error("Quantity must be an integer");
  if (quantity < 0) throw new Error("Quantity must not be negative");
  return (amount * quantity) as Centavos;
}

/**
 * Applies a rate expressed in integer basis points (3% is 300).
 *
 * Integer arithmetic throughout: `(amount * bps + 5000) / 10000` floored. Using a
 * float rate would misround exact half-centavo results, because 0.03 * 8350 is
 * 250.49999999999997 in IEEE 754 and floors to 250 rather than the correct 251.
 */
export function applyBasisPoints(amount: Centavos, bps: number): Centavos {
  if (!Number.isInteger(bps)) throw new Error("Basis points must be an integer");
  if (bps < 0) throw new Error("Basis points must not be negative");
  return Math.floor((amount * bps + 5000) / 10000) as Centavos;
}

export function sum(amounts: readonly Centavos[]): Centavos {
  return amounts.reduce<number>((total, amount) => total + amount, 0) as Centavos;
}

const PESO_FORMAT = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function format(amount: Centavos): string {
  return `₱${PESO_FORMAT.format(amount / 100)}`;
}

export function parsePesoInput(input: string): Centavos {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) {
    throw new Error(`Not a valid peso amount: ${input}`);
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Not a valid peso amount: ${input}`);
  return fromPesos(parsed);
}
