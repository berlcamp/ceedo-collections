export interface BookletRange {
  id: string;
  serialPrefix: string;
  startNo: number;
  endNo: number;
}

/**
 * A serial's identity within `consumed`/`spoiled` is `` `${bookletId}:${orNo}` ``, NOT the
 * bare number. Ruling R9: `consumed_serials` is keyed `(booklet_id, or_no)` in the schema
 * -- the booklet is part of what makes a serial "used" -- and parent spec §6.1 has a device
 * pulling the booklet assignments of EVERY collector permitted to sign in to it, so these
 * sets routinely carry other booklets' serials. A bare number would make serial 1005 spent
 * in one booklet block serial 1005 in an entirely different one: a receipt the collector is
 * entitled to write, refused with a vendor standing there, and nothing in the app clears it.
 */
export function orKey(bookletId: string, orNo: number): string {
  return `${bookletId}:${orNo}`;
}

export interface OrEntryContext {
  /** Booklets currently assigned to this collector. */
  booklets: readonly BookletRange[];
  /** `orKey(bookletId, orNo)` for every serial already used, as known to this device. */
  consumed: ReadonlySet<string>;
  /** `orKey(bookletId, orNo)` for every serial marked spoiled or cancelled. */
  spoiled: ReadonlySet<string>;
}

export type OrRejectReason =
  | "not_in_assigned_booklet"
  | "already_consumed"
  | "marked_spoiled"
  | "ambiguous_booklet";

export type OrEntryResult =
  | { ok: true; bookletId: string; warning?: "sequence_skipped" }
  | { ok: false; reason: OrRejectReason };

export function formatSerial(prefix: string, orNo: number): string {
  return `${prefix}-${String(orNo).padStart(7, "0")}`;
}

/**
 * The OR serial a collector typed, or `null` if what they typed is not one.
 *
 * NEVER `Number.parseInt`. `parseInt("12a", 10)` is `12`; `"1005x"` is `1005`; `"12.9"` is
 * `12`; `"1e3"` is `1`. Only a lone "-" or "." yields NaN, so every other kind of garbage
 * TRUNCATES SILENTLY -- the entry screen's button enables and the truncated number is
 * recorded against a real paper receipt the tenant is holding. A number-pad keyboard is not
 * a guarantee either: a paste, a hardware keyboard or an accessibility input all reach the
 * same field.
 *
 * The digit-string test is the one ambulant.tsx already applies to a quantity, for the same
 * reason and with the same shape: test first, `Number()` second, never `parseInt`.
 * `isSafeInteger` catches the absurdly long paste that `/^\d+$/` would otherwise accept and
 * float arithmetic would then round.
 */
export function parseOrNo(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const orNo = Number(trimmed);
  return Number.isSafeInteger(orNo) && orNo > 0 ? orNo : null;
}

/**
 * Validates an OR number at the point of sale.
 *
 * These checks exist to catch honest mistakes while the vendor is still standing
 * there; the server re-validates authoritatively on sync and is the only
 * authority. A skipped serial is a warning rather than a rejection because
 * booklets legitimately get skipped.
 */
export function validateOrEntry(context: OrEntryContext, orNo: number): OrEntryResult {
  // The schema only bars serial overlap within the same form type and prefix, so a
  // collector holding two booklets of different form types can have overlapping
  // ranges. Ambiguity is never resolved silently in this system: a silently wrong
  // booklet id on a real receipt is unrecoverable once the vendor walks away, so a
  // tie is reported rather than broken by "first match wins".
  const candidates = context.booklets.filter(
    (candidate) => orNo >= candidate.startNo && orNo <= candidate.endNo,
  );
  if (candidates.length === 0) return { ok: false, reason: "not_in_assigned_booklet" };
  if (candidates.length > 1) return { ok: false, reason: "ambiguous_booklet" };
  const booklet = candidates[0]!;
  const key = orKey(booklet.id, orNo);
  if (context.spoiled.has(key)) return { ok: false, reason: "marked_spoiled" };
  if (context.consumed.has(key)) return { ok: false, reason: "already_consumed" };

  // Booklet-scoped and exact, now that a serial's identity carries its booklet: no more
  // filtering bare numbers by numeric range as an approximation of "within this booklet".
  //
  // SPOILED SERIALS COUNT AS USED HERE, and leaving them out made this warning fire on the
  // canonical correct behaviour. `consumed_serials` is built server-side from the
  // `collections` table and never carries a spoiled serial, but §1.2 makes spoil-then-
  // reissue THE remedy for a wrongly written form: spoil 1003, write 1004, and a
  // consumed-only highest of 1002 makes `1004 > 1002 + 1` true. Permanently, on every
  // device, online or offline -- and the same warning now sits on the spoil screen too, so
  // two bad forms in a row warn on the second. F8 states the rule verbatim: "a warning that
  // fires on correct behaviour is a warning that gets ignored, including on the day it is
  // right."
  //
  // The serial is taken from after the LAST colon, not from `prefix.length`. Unreachable
  // today -- booklet ids are UUIDs -- but a booklet id that was itself a string-prefix of
  // another followed by ':' would have this slice a second key's tail and hand `Number` a
  // string it answers NaN to, which then poisons `Math.max`.
  const prefix = `${booklet.id}:`;
  const usedInBooklet = [...context.consumed, ...context.spoiled]
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => Number(entry.slice(entry.lastIndexOf(":") + 1)));
  const highestUsed = usedInBooklet.length > 0 ? Math.max(...usedInBooklet) : booklet.startNo - 1;

  return orNo > highestUsed + 1
    ? { ok: true, bookletId: booklet.id, warning: "sequence_skipped" }
    : { ok: true, bookletId: booklet.id };
}
