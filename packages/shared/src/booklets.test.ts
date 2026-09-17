import { describe, expect, it } from "vitest";
import { validateOrEntry, type OrEntryContext } from "./booklets.js";

const context = (over: Partial<OrEntryContext> = {}): OrEntryContext => ({
  booklets: [{ id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 }],
  consumed: new Set<number>(),
  spoiled: new Set<number>(),
  ...over,
});

describe("validateOrEntry", () => {
  it("accepts the first serial in an assigned booklet", () => {
    expect(validateOrEntry(context(), 1001)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("rejects a serial outside every assigned booklet", () => {
    expect(validateOrEntry(context(), 2001)).toEqual({
      ok: false,
      reason: "not_in_assigned_booklet",
    });
  });

  it("rejects a serial already consumed on this device", () => {
    const ctx = context({ consumed: new Set([1001]) });
    expect(validateOrEntry(ctx, 1001)).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("rejects a serial marked spoiled", () => {
    const ctx = context({ spoiled: new Set([1002]) });
    expect(validateOrEntry(ctx, 1002)).toEqual({ ok: false, reason: "marked_spoiled" });
  });

  it("warns but accepts when serials are skipped", () => {
    // Booklets legitimately get skipped, so this is a soft warning, never a block.
    const ctx = context({ consumed: new Set([1001]) });
    expect(validateOrEntry(ctx, 1005)).toEqual({
      ok: true,
      bookletId: "b1",
      warning: "sequence_skipped",
    });
  });

  it("does not warn when the serial follows the last consumed one", () => {
    const ctx = context({ consumed: new Set([1001, 1002]) });
    expect(validateOrEntry(ctx, 1003)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("picks the correct booklet when several are assigned", () => {
    const ctx = context({
      booklets: [
        { id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 },
        { id: "b2", serialPrefix: "OR", startNo: 2001, endNo: 2050 },
      ],
    });
    expect(validateOrEntry(ctx, 2010)).toMatchObject({ ok: true, bookletId: "b2" });
  });

  it("rejects when no booklet is assigned at all", () => {
    expect(validateOrEntry(context({ booklets: [] }), 1001)).toEqual({
      ok: false,
      reason: "not_in_assigned_booklet",
    });
  });
});
