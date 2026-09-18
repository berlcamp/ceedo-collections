import { describe, expect, it } from "vitest";
import { REJECT_REASONS, RETRYABLE_REASONS, isRetryable } from "./reason-codes";

describe("reject reasons", () => {
  it("includes stale_allocations", () => {
    expect(REJECT_REASONS).toContain("stale_allocations");
  });

  it("marks exactly one reason retryable", () => {
    // Invariant 24. The count matters: a second retryable reason means a receipt the
    // device retries forever without a human ever seeing it.
    expect([...RETRYABLE_REASONS]).toEqual(["stale_allocations"]);
  });

  it("treats every other reason as needing a human", () => {
    for (const reason of REJECT_REASONS) {
      if (reason === "stale_allocations") continue;
      expect(isRetryable(reason)).toBe(false);
    }
  });

  it("does not treat or_already_used as retryable", () => {
    // The case §6.3 says no device can detect on its own. Retrying it would spin forever
    // while a supervisor never learns that two devices claimed one OR number.
    expect(isRetryable("or_already_used")).toBe(false);
  });
});
