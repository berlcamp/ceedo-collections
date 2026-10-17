import { parsePesoInput, type Centavos } from "@ceedo/shared";
import type { DraftLine } from "./collect";
import type { FeeChoice } from "./site";

/**
 * The largest typed amount: post_collection refuses a keyed amount of 1,000,000,000,000
 * pesos or more (migration 067), so the tablet refuses it first, in a sentence.
 */
export const MAX_KEYED_CENTAVOS = 99_999_999_999_999 as Centavos;

const ENTER_AN_AMOUNT = "Enter an amount above zero, in pesos (for example 1,234.50).";

/**
 * A keyed fee's typed amount (electricity, certification, misc...). Commas and a peso sign
 * are fine, and it rounds to the centavo as the server stores it. Zero, a negative,
 * garbage or too much come back as a refusal the screen shows as it is.
 */
export function keyedAmount(input: string): { amount: Centavos } | { refusal: string } {
  // A comma is accepted only as a thousands separator. parsePesoInput strips every comma,
  // so a decimal comma ("1234,50", which some Android keyboards offer on decimal-pad)
  // would otherwise be read as 123,450.00 on an official receipt.
  const bare = input.replace(/[₱\s]/g, "");
  if (bare.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(bare)) return { refusal: ENTER_AN_AMOUNT };
  let amount: Centavos;
  try {
    amount = parsePesoInput(input);
  } catch {
    return { refusal: ENTER_AN_AMOUNT };
  }
  if (amount <= 0 || amount > MAX_KEYED_CENTAVOS) return { refusal: ENTER_AN_AMOUNT };
  return { amount };
}

/**
 * Why this fee may not go on this receipt, or null when it may.
 *
 * - A rate fee keeps the receipt to ONE fee type (review R12): the legacy Abstract of
 *   Collections totals by the receipt's fee type. Several classes of that fee are fine.
 * - Keyed fees may share a receipt with other keyed fees: an electricity bill payment and
 *   its surcharge go on one OR, as the office's abstracts show ("EBP" + "Surcharge/EBP").
 * - A rate fee and a keyed fee never share one.
 *
 * Removing the last line empties `lines`, which releases every lock.
 */
export function addFeeRefusal(
  lines: readonly DraftLine[],
  choice: FeeChoice,
  feeName: (feeTypeId: string) => string,
): string | null {
  const first = lines[0];
  if (!first) return null;
  const receiptKeyed = first.keyed === true;
  const choiceKeyed = choice.amount_mode === "keyed";
  if (receiptKeyed && choiceKeyed) return null;
  if (receiptKeyed) {
    return `This receipt is for typed-in amounts. ${feeName(choice.fee_type_id)} has a set rate and needs its own receipt.`;
  }
  if (choiceKeyed) {
    return `This receipt is for ${feeName(first.feeTypeId)}, a fee with a set rate. ${feeName(choice.fee_type_id)} is typed in and needs its own receipt.`;
  }
  if (choice.fee_type_id === first.feeTypeId) return null;
  return `This receipt is already for ${feeName(first.feeTypeId)}. ${feeName(choice.fee_type_id)} needs its own receipt -- add it after this one is recorded.`;
}
