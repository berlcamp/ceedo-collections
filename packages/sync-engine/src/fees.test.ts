import { describe, expect, it } from "vitest";
import type { Centavos } from "@ceedo/shared";
import type { DraftLine } from "./collect";
import { addFeeRefusal, keyedAmount } from "./fees";
import type { FeeChoice } from "./site";

describe("keyedAmount", () => {
  it("accepts commas, a peso sign and one decimal", () => {
    expect(keyedAmount("1,234.50")).toEqual({ amount: 123450 });
    expect(keyedAmount("₱1234.5")).toEqual({ amount: 123450 });
  });

  it("rounds to the centavo", () => {
    expect(keyedAmount("12.345")).toEqual({ amount: 1235 });
  });

  it("refuses a comma that is not a thousands separator, rather than reading 100x too much", () => {
    // A decimal comma ("1234,50") must not become 123,450.00 on an official receipt.
    for (const s of ["1234,50", "12,,3", "1,23", ",5", "1,2345.00"]) {
      expect(keyedAmount(s)).toEqual({ refusal: expect.stringMatching(/^Enter an amount/) });
    }
    expect(keyedAmount("12,345,678.90")).toEqual({ amount: 1234567890 });
    expect(keyedAmount("₱ 1,234")).toEqual({ amount: 123400 });
  });

  it("refuses zero, negatives, garbage and too much", () => {
    for (const s of ["", "0", "0.00", "-5", "abc", "1000000000000"]) {
      expect(keyedAmount(s)).toEqual({ refusal: expect.stringMatching(/^Enter an amount/) });
    }
  });
});

describe("addFeeRefusal", () => {
  const keyed = (id: string): FeeChoice => ({ fee_type_id: id, fee_name: id, rate_class: null, amount_mode: "keyed" });
  const rate = (id: string): FeeChoice => ({ fee_type_id: id, fee_name: id, rate_class: "", amount_mode: "rate" });
  const line = (feeTypeId: string, isKeyed?: boolean): DraftLine => ({
    feeTypeId,
    rateClass: null,
    quantity: 1,
    unitRate: 100 as Centavos,
    amount: 100 as Centavos,
    ...(isKeyed ? { keyed: true } : {}),
  });
  const name = (id: string) => `«${id}»`;

  it("allows anything on an empty receipt", () => {
    expect(addFeeRefusal([], rate("a"), name)).toBeNull();
    expect(addFeeRefusal([], keyed("k"), name)).toBeNull();
  });

  it("keeps a rate receipt to one fee type", () => {
    expect(addFeeRefusal([line("a")], rate("a"), name)).toBeNull();
    expect(addFeeRefusal([line("a")], rate("b"), name)).toBe(
      "This receipt is already for «a». «b» needs its own receipt -- add it after this one is recorded.",
    );
  });

  it("lets keyed fees share a receipt (electricity and its surcharge)", () => {
    expect(addFeeRefusal([line("ebp", true)], keyed("sur"), name)).toBeNull();
  });

  it("never mixes a keyed fee with a rate fee", () => {
    expect(addFeeRefusal([line("a")], keyed("k"), name)).toBe(
      "This receipt is for «a», a fee with a set rate. «k» is typed in and needs its own receipt.",
    );
    expect(addFeeRefusal([line("k", true)], rate("a"), name)).toBe(
      "This receipt is for typed-in amounts. «a» has a set rate and needs its own receipt.",
    );
  });
});
