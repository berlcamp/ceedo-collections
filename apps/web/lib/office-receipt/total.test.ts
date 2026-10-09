import { describe, expect, it } from "vitest";
import { fromCentavos } from "@ceedo/shared";
import { officeShiftTotal } from "./total";

const c = fromCentavos;

describe("officeShiftTotal", () => {
  it("leaves out cancelled receipts and adds live cash tickets", () => {
    expect(
      officeShiftTotal(
        [{ amount: c(500_00), cancelled: false }, { amount: c(300_00), cancelled: true }],
        [{ amount: c(25_00) }, { amount: c(10_50) }],
      ),
    ).toBe(535_50);
  });

  it("is zero for an empty day", () => {
    expect(officeShiftTotal([], [])).toBe(0);
  });
});
