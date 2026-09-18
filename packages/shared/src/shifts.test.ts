import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import { reconciles, shiftVariance } from "./shifts";

describe("shiftVariance", () => {
  it("is zero when the declaration matches the system", () => {
    expect(
      shiftVariance({ declared: fromCentavos(125_00), system: fromCentavos(125_00) }),
    ).toBe(0);
  });

  it("is negative when the collector is short", () => {
    expect(
      shiftVariance({ declared: fromCentavos(120_00), system: fromCentavos(125_00) }),
    ).toBe(-5_00);
  });

  it("is positive when the collector is over", () => {
    // Signed, deliberately: over and short are different problems and an absolute value
    // would not tell a supervisor which one they have.
    expect(
      shiftVariance({ declared: fromCentavos(130_00), system: fromCentavos(125_00) }),
    ).toBe(5_00);
  });

  it("works in integer centavos, never floats", () => {
    expect(shiftVariance({ declared: fromCentavos(1_00), system: fromCentavos(3_33) })).toBe(
      -2_33,
    );
  });
});

describe("reconciles", () => {
  it("is true when both count and total agree", () => {
    expect(
      reconciles({
        deviceCount: 3,
        deviceTotal: fromCentavos(300_00),
        systemCount: 3,
        systemTotal: fromCentavos(300_00),
      }),
    ).toBe(true);
  });

  it("is false when the counts differ", () => {
    // A device holding an unpushed receipt has a count the server cannot match. This is
    // what makes silent data loss impossible to overlook.
    expect(
      reconciles({
        deviceCount: 4,
        deviceTotal: fromCentavos(300_00),
        systemCount: 3,
        systemTotal: fromCentavos(300_00),
      }),
    ).toBe(false);
  });

  it("is false when the totals differ though the counts match", () => {
    // Both halves are load-bearing. Checking only the total would let a shift with one
    // missing receipt and one duplicated amount reconcile cleanly.
    expect(
      reconciles({
        deviceCount: 3,
        deviceTotal: fromCentavos(299_00),
        systemCount: 3,
        systemTotal: fromCentavos(300_00),
      }),
    ).toBe(false);
  });

  it("does not consider the cash declaration at all", () => {
    // §6.5 step 5: variance is recorded, not blocking. A short drawer still reconciles.
    expect(
      reconciles({
        deviceCount: 3,
        deviceTotal: fromCentavos(300_00),
        systemCount: 3,
        systemTotal: fromCentavos(300_00),
      }),
    ).toBe(true);
  });
});
