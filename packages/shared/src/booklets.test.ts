import { describe, expect, it } from "vitest";
import { orKey, parseOrNo, validateOrEntry, type OrEntryContext } from "./booklets.js";

const context = (over: Partial<OrEntryContext> = {}): OrEntryContext => ({
  booklets: [{ id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 }],
  consumed: new Set<string>(),
  spoiled: new Set<string>(),
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
    const ctx = context({ consumed: new Set([orKey("b1", 1001)]) });
    expect(validateOrEntry(ctx, 1001)).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("rejects a serial marked spoiled", () => {
    const ctx = context({ spoiled: new Set([orKey("b1", 1002)]) });
    expect(validateOrEntry(ctx, 1002)).toEqual({ ok: false, reason: "marked_spoiled" });
  });

  it("warns but accepts when serials are skipped", () => {
    // Booklets legitimately get skipped, so this is a soft warning, never a block.
    const ctx = context({ consumed: new Set([orKey("b1", 1001)]) });
    expect(validateOrEntry(ctx, 1005)).toEqual({
      ok: true,
      bookletId: "b1",
      warning: "sequence_skipped",
    });
  });

  it("does not warn when the serial follows the last consumed one", () => {
    const ctx = context({ consumed: new Set([orKey("b1", 1001), orKey("b1", 1002)]) });
    expect(validateOrEntry(ctx, 1003)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("does not warn when the skipped serial is one this booklet SPOILED", () => {
    // Spec §1.2 makes spoil-then-reissue THE remedy for a wrongly written form, and
    // `consumed_serials` is built server-side from the `collections` table, so it never
    // carries a spoiled serial. Computing highestUsed from `consumed` alone made 1003's
    // spoil invisible and fired `sequence_skipped` on 1004 -- permanently, on every device,
    // online or offline. F8: "a warning that fires on correct behaviour is a warning that
    // gets ignored, including on the day it is right."
    const ctx = context({
      consumed: new Set([orKey("b1", 1001), orKey("b1", 1002)]),
      spoiled: new Set([orKey("b1", 1003)]),
    });
    expect(validateOrEntry(ctx, 1004)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("still warns on a genuine skip past a spoiled serial", () => {
    // The other direction, so the fix above cannot be "never warn". 1003 is spoiled, 1004
    // is simply missing, and 1005 skips it.
    const ctx = context({
      consumed: new Set([orKey("b1", 1001), orKey("b1", 1002)]),
      spoiled: new Set([orKey("b1", 1003)]),
    });
    expect(validateOrEntry(ctx, 1005)).toEqual({
      ok: true,
      bookletId: "b1",
      warning: "sequence_skipped",
    });
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

  it("rejects as ambiguous when two assigned booklets both cover the serial", () => {
    // The schema only bars serial overlap within the same form type and prefix, so a
    // collector can legitimately hold two overlapping booklets of different form
    // types. This must never be resolved by picking the first match.
    const ctx = context({
      booklets: [
        { id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 },
        { id: "b2", serialPrefix: "AF", startNo: 1001, endNo: 1050 },
      ],
    });
    expect(validateOrEntry(ctx, 1010)).toEqual({ ok: false, reason: "ambiguous_booklet" });
  });

  it("reports a serial that is both spoiled and consumed as spoiled", () => {
    // Spoiled must win: a spoiled serial should never present as merely "already used".
    const ctx = context({
      consumed: new Set([orKey("b1", 1002)]),
      spoiled: new Set([orKey("b1", 1002)]),
    });
    expect(validateOrEntry(ctx, 1002)).toEqual({ ok: false, reason: "marked_spoiled" });
  });

  it("does not confuse the same serial number spent in a DIFFERENT booklet (ruling R9)", () => {
    // `consumed_serials` is keyed (booklet_id, or_no) in the schema -- the booklet is part
    // of a serial's identity. Parent spec §6.1 means a device pulls the booklet assignments
    // of EVERY collector permitted to sign in to it, so `consumed` routinely carries other
    // booklets' serials before a shared tablet's own local_collections even enter into it.
    // Before ruling R9, `consumed` held bare numbers, so this exact fixture -- 1001-1004
    // legitimately spent in booklet b2, PLUS serial 1005 spent in an unrelated booklet b1
    // that happens to number-overlap -- made entering 1005 into b2 (its true next serial)
    // report already_consumed: a legitimate receipt refused with a vendor standing there,
    // and nothing in the app clears it. Booklet-scoped keys make "b1:1005" and "b2:1005"
    // different facts, and this fixture is built so no sequence-skip warning is in play
    // either -- the failure this isolates is the confusion itself, nothing else.
    const ctx = context({
      booklets: [{ id: "b2", serialPrefix: "OR", startNo: 1001, endNo: 1050 }],
      consumed: new Set([
        orKey("b2", 1001),
        orKey("b2", 1002),
        orKey("b2", 1003),
        orKey("b2", 1004),
        orKey("b1", 1005),
      ]),
    });
    expect(validateOrEntry(ctx, 1005)).toEqual({ ok: true, bookletId: "b2" });
  });

  it("scopes the sequence-skip warning to the resolved booklet's own entries", () => {
    // highestUsed used to range-filter bare numbers as an approximation of "within this
    // booklet"; with booklet keys it is exact. A high serial consumed in a DIFFERENT
    // booklet must not suppress -- or wrongly trigger -- this booklet's own skip warning.
    const ctx = context({
      booklets: [{ id: "b2", serialPrefix: "OR", startNo: 1001, endNo: 1050 }],
      consumed: new Set([orKey("other", 1049)]),
    });
    expect(validateOrEntry(ctx, 1005)).toEqual({
      ok: true,
      bookletId: "b2",
      warning: "sequence_skipped",
    });
  });
});

describe("parseOrNo", () => {
  it("accepts a plain digit string", () => {
    expect(parseOrNo("1005")).toBe(1005);
    expect(parseOrNo(" 1005 ")).toBe(1005);
  });

  it("REFUSES what Number.parseInt would silently truncate", () => {
    // Every one of these is a parseInt success: 12, 1005, 12, 1. On the entry screens that
    // meant the button enabled and a truncated number was recorded against a real paper
    // receipt in the tenant's hand.
    expect(Number.parseInt("12a", 10)).toBe(12);
    expect(Number.parseInt("1005x", 10)).toBe(1005);
    expect(Number.parseInt("12.9", 10)).toBe(12);
    expect(Number.parseInt("1e3", 10)).toBe(1);

    expect(parseOrNo("12a")).toBeNull();
    expect(parseOrNo("1005x")).toBeNull();
    expect(parseOrNo("12.9")).toBeNull();
    expect(parseOrNo("1e3")).toBeNull();
  });

  it("refuses the empty, partial and non-positive cases", () => {
    expect(parseOrNo("")).toBeNull();
    expect(parseOrNo("-")).toBeNull();
    expect(parseOrNo(".")).toBeNull();
    expect(parseOrNo("-5")).toBeNull();
    expect(parseOrNo("0")).toBeNull();
  });

  it("refuses a paste too long to survive float arithmetic", () => {
    expect(parseOrNo("99999999999999999999")).toBeNull();
  });
});
