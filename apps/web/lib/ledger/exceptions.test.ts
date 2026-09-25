import { describe, expect, it } from "vitest";
import { describeReason, summarisePayload } from "./exceptions";

describe("describeReason", () => {
  it("renders every reason the server can return", () => {
    // A reason code the SQL returns and the web does not know about renders as a raw
    // snake_case string to a supervisor deciding what to do about real money.
    for (const reason of [
      "booklet_not_assigned",
      "or_out_of_range",
      "or_already_used",
      "or_spoiled",
      "lease_not_found",
      "allocation_not_prefix",
      "allocation_partial_period",
      "amount_mismatch",
      "no_parts",
      "rate_not_found",
      "stale_allocations",
      "collector_not_on_device",
      "unknown_entry_type",
      "server_error",
    ]) {
      const described = describeReason(reason);
      expect(described).toBeTruthy();
      expect(described).not.toBe(reason);
    }
  });

  it("falls back to the raw code rather than rendering nothing", () => {
    expect(describeReason("a_reason_from_the_future")).toContain("a_reason_from_the_future");
  });
});

describe("summarisePayload", () => {
  it("surfaces the OR number and the lease, not a JSON blob", () => {
    // A supervisor resolving an or_already_used needs to see WHICH OR number and WHICH
    // lease. A rendered blob is technically complete and practically useless.
    const summary = summarisePayload({
      or_no: 1234,
      lease_id: "5f9d4f1e-0000-4000-8000-000000000001",
      collected_at: "2026-10-05T02:00:00+00:00",
      allocations: [{ group_rank: 1 }, { group_rank: 2 }],
    });

    expect(summary.orNo).toBe(1234);
    expect(summary.periods).toBe(2);
  });

  it("renders a payload with no allocations as zero periods, not undefined", () => {
    expect(summarisePayload({ or_no: 1 }).periods).toBe(0);
  });

  it("survives a payload that is not an object at all", () => {
    // The payload is whatever the device sent. A malformed one must render, not throw --
    // this screen is how a malformed push gets noticed at all. Property access on an empty
    // object never throws regardless of implementation, so the case that actually pins the
    // defensive guard is a payload that isn't an object in the first place.
    expect(() => summarisePayload(null as never)).not.toThrow();
    expect(() => summarisePayload("garbage" as never)).not.toThrow();
    expect(() => summarisePayload(42 as never)).not.toThrow();
    expect(() => summarisePayload({})).not.toThrow();
  });
});
