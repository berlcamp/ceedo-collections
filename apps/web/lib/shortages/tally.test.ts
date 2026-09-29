import { describe, expect, it } from "vitest";
import { fromCentavos } from "@ceedo/shared";
import { settlementState, tally } from "./tally";

const c = fromCentavos;

describe("tally", () => {
  it("counts only verified repayments as paid; recorded ones wait", () => {
    const t = tally(c(-50_000), [
      { amount: c(20_000), state: "verified" },
      { amount: c(10_000), state: "recorded" },
      { amount: c(99_000), state: "cancelled" },
    ]);
    expect(t).toEqual({
      short: 50_000,
      settled: 20_000,
      pending: 10_000,
      outstanding: 30_000,
      room: 20_000,
      state: "partly_settled",
    });
  });

  it("is outstanding with nothing verified, and settled once the whole shortage is", () => {
    expect(tally(c(-50_000), [{ amount: c(50_000), state: "recorded" }]).state).toBe(
      "outstanding",
    );
    const done = tally(c(-50_000), [{ amount: c(50_000), state: "verified" }]);
    expect(done.state).toBe("settled");
    expect(done.outstanding).toBe(0);
    expect(done.room).toBe(0);
  });

  it("treats an over or balanced drawer as owing nothing", () => {
    expect(tally(c(2_000), []).short).toBe(0);
    expect(tally(c(0), []).state).toBe("settled");
  });
});

describe("settlementState", () => {
  it("reads cancelled before verified", () => {
    expect(settlementState({ verifiedAt: null, cancelledAt: "x" })).toBe("cancelled");
    expect(settlementState({ verifiedAt: "x", cancelledAt: null })).toBe("verified");
    expect(settlementState({ verifiedAt: null, cancelledAt: null })).toBe("recorded");
  });
});
