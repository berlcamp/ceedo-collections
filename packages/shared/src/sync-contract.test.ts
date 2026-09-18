import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { REJECT_REASONS } from "./reason-codes";
import { PushEntry, PushResult, CloseoutRequest, PUSH_REASONS } from "./sync-contract";

const collection = {
  type: "collection" as const,
  payload: {
    id: randomUUID(),
    or_no: 1234,
    booklet_id: randomUUID(),
    collector_id: randomUUID(),
    collected_at: "2026-10-05T02:00:00+00:00",
    fee_type_id: randomUUID(),
    lease_id: randomUUID(),
    allocations: [{ group_rank: 1 }],
    lines: [],
  },
};

describe("PushEntry", () => {
  it("accepts a collection entry", () => {
    expect(PushEntry.safeParse(collection).success).toBe(true);
  });

  it("rejects a collection with no id", () => {
    // The client-generated UUID is the idempotency key. An entry without one would mint a
    // second receipt on every retry.
    const { payload, ...rest } = collection;
    const { id, ...rest2 } = payload;
    expect(PushEntry.safeParse({ ...rest, payload: rest2 }).success).toBe(false);
  });

  it("rejects an amount in the payload", () => {
    // Invariant 3. The device proposes WHICH periods and HOW MANY units; the server decides
    // what that costs. A schema that tolerated an amount field would invite a client to
    // send one and a future handler to read it.
    expect(
      PushEntry.safeParse({
        ...collection,
        payload: { ...collection.payload, gross_amount: "50.00" },
      }).success,
    ).toBe(false);
  });

  it("rejects a device_id in the payload", () => {
    // Invariant 21. device_id comes from the authenticated credential; a payload carrying
    // one is either a confused client or a hostile one.
    expect(
      PushEntry.safeParse({
        ...collection,
        payload: { ...collection.payload, device_id: randomUUID() },
      }).success,
    ).toBe(false);
  });

  it("rejects the cancellation type", () => {
    // Spec D4: collectors do not cancel in the field. §6.2's list is corrected, not
    // implemented, and the schema is where that correction bites first.
    expect(
      PushEntry.safeParse({ type: "cancellation", payload: { id: randomUUID() } }).success,
    ).toBe(false);
  });

  it("accepts the four real types", () => {
    for (const type of ["collection", "spoiled_form", "shift_open", "shift_close"]) {
      const parsed = PushEntry.safeParse({ type, payload: {} });
      // Payload shape differs per type; we only assert the discriminator is known.
      expect(parsed.success || parsed.error.issues.every((i) => i.path.length > 1)).toBe(true);
    }
  });
});

describe("PushResult", () => {
  it("accepts an accepted result", () => {
    expect(
      PushResult.safeParse({
        index: 0,
        type: "collection",
        status: "accepted",
        collection_id: randomUUID(),
      }).success,
    ).toBe(true);
  });

  it("accepts a rejection carrying a known reason and the retryable flag", () => {
    expect(
      PushResult.safeParse({
        index: 1,
        type: "collection",
        status: "rejected",
        reason: "stale_allocations",
        retryable: true,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown reason code", () => {
    // A reason the SQL can return but the TypeScript does not know about renders as
    // `undefined` to a collector standing at a stall.
    expect(
      PushResult.safeParse({
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "something_new",
      }).success,
    ).toBe(false);
  });

  it("accepts the three reasons sync_push raises that post_collection never does", () => {
    // These are sync_push's own vocabulary, not the engine's, so they live in PUSH_REASONS
    // rather than REJECT_REASONS. If PushResult were built on REJECT_REASONS it would
    // reject three responses the server genuinely sends.
    for (const reason of [
      "collector_not_on_device",
      "unknown_entry_type",
      "server_error",
    ]) {
      expect(
        PushResult.safeParse({ index: 0, type: "collection", status: "rejected", reason })
          .success,
      ).toBe(true);
    }
  });

  it("keeps REJECT_REASONS free of sync_push's own vocabulary", () => {
    // reason-codes.ts documents REJECT_REASONS as "the vocabulary post_collection() answers
    // with". This is what keeps that comment honest.
    expect(REJECT_REASONS).not.toContain("collector_not_on_device");
    expect(REJECT_REASONS).not.toContain("unknown_entry_type");
    expect(REJECT_REASONS).not.toContain("server_error");
  });
});

describe("CloseoutRequest", () => {
  it("requires both the count and the total", () => {
    const base = {
      credential_id: "c",
      secret: "s",
      shift_id: randomUUID(),
      declared_total: "100.00",
    };
    expect(CloseoutRequest.safeParse({ ...base, device_count: 1 }).success).toBe(false);
    expect(CloseoutRequest.safeParse({ ...base, device_total: "100.00" }).success).toBe(false);
    expect(
      CloseoutRequest.safeParse({ ...base, device_count: 1, device_total: "100.00" }).success,
    ).toBe(true);
  });
});
