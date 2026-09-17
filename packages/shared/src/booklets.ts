export interface BookletRange {
  id: string;
  serialPrefix: string;
  startNo: number;
  endNo: number;
}

export interface OrEntryContext {
  /** Booklets currently assigned to this collector. */
  booklets: readonly BookletRange[];
  /** Serials already used, as known to this device. */
  consumed: ReadonlySet<number>;
  /** Serials marked spoiled or cancelled. */
  spoiled: ReadonlySet<number>;
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
  if (context.spoiled.has(orNo)) return { ok: false, reason: "marked_spoiled" };
  if (context.consumed.has(orNo)) return { ok: false, reason: "already_consumed" };

  const usedInBooklet = [...context.consumed].filter(
    (serial) => serial >= booklet.startNo && serial <= booklet.endNo,
  );
  const highestUsed = usedInBooklet.length > 0 ? Math.max(...usedInBooklet) : booklet.startNo - 1;

  return orNo > highestUsed + 1
    ? { ok: true, bookletId: booklet.id, warning: "sequence_skipped" }
    : { ok: true, bookletId: booklet.id };
}
