import { describe, expect, it } from "vitest";
import { fromCentavos } from "@ceedo/shared";
import { canVerify, reconcile, remittanceState } from "./reconcile";

const c = fromCentavos;

describe("reconcile", () => {
  it("measures the deposit against declared cash, across every shift it covers", () => {
    const r = reconcile(c(560_000), [
      { businessDate: "2026-09-02", declared: c(300_000), system: c(300_000) },
      { businessDate: "2026-09-01", declared: c(261_000), system: c(261_000) },
    ]);
    expect(r).toEqual({
      declared: 561_000,
      system: 561_000,
      difference: -1_000,
      dates: ["2026-09-01", "2026-09-02"],
    });
  });

  it("does not blame the deposit for a shortage already on the closeout", () => {
    // The drawer was ₱20 short of the receipts at closeout; the deposit carried every
    // peso that was declared, so the deposit itself is exact.
    const r = reconcile(c(98_000), [
      { businessDate: "2026-09-01", declared: c(98_000), system: c(100_000) },
    ]);
    expect(r.difference).toBe(0);
    expect(r.system - r.declared).toBe(2_000);
  });
});

describe("remittanceState", () => {
  it("is cancelled, verified or merely recorded", () => {
    expect(remittanceState({ verifiedAt: null, cancelledAt: null })).toBe("recorded");
    expect(remittanceState({ verifiedAt: "t", cancelledAt: null })).toBe("verified");
    expect(remittanceState({ verifiedAt: null, cancelledAt: "t" })).toBe("cancelled");
  });
});

describe("canVerify", () => {
  it("is accounting or admin, never the recorder", () => {
    expect(canVerify("accounting", "a", "s")).toBe(true);
    expect(canVerify("admin", "a", "s")).toBe(true);
    expect(canVerify("admin", "s", "s")).toBe(false);
    expect(canVerify("supervisor", "a", "s")).toBe(false);
  });
});
