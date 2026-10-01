/**
 * Whether a tablet's `last_seen_at` falls after the Manila midnight that starts a shift's
 * `business_date` -- the signal `RecoveredReceipts` warns on (spec 2026-09-30-office-
 * recovery §4.1: "last_seen_at shown" beside the recovery, to catch a tablet that is still
 * in use rather than actually wiped).
 *
 * `last_seen_at` arrives from PostgREST as a UTC timestamptz; `business_date` is a bare
 * date in Asia/Manila (UTC+8), the zone the whole app's business day is defined in. A plain
 * string compare of `lastSeenAt > businessDate + "T00:00:00"` treats the UTC instant as if
 * it were already Manila time, so a tablet heard from in the first 8 hours of the Manila
 * day -- still the PREVIOUS day in UTC -- reads as "before" the shift and never warns. Both
 * sides are parsed to instants and compared as such, with the Manila side anchored by an
 * explicit `+08:00` offset rather than relying on the runtime's local zone.
 */
export function heardFromAfterManilaMidnight(lastSeenAt: string, businessDate: string): boolean {
  return new Date(lastSeenAt).getTime() > new Date(`${businessDate}T00:00:00+08:00`).getTime();
}
