/**
 * An ISO timestamp as a collector reads a clock.
 *
 * The shift screen was printing `opened_at` raw -- "2026-09-21T15:07:09.884Z" -- which is
 * a wire value shown to a person, and it is also in UTC, so a collector who opened their
 * shift at 11pm local read a time eight hours off with no indication why.
 *
 * NEVER THROWS, and returns null rather than a guess. `Intl` under Hermes can be absent or
 * partial depending on how the JS engine was built, `new Date(...)` on a malformed string
 * yields an Invalid Date whose `toLocaleTimeString` is the string "Invalid Date", and none
 * of that may reach a render. Null means the caller states it has no time rather than
 * printing a plausible wrong one.
 */
export function clockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    const formatted = at.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    // A partial Intl build can hand back an empty string or the literal "Invalid Date"
    // instead of throwing, so the result is checked rather than trusted.
    if (!formatted || formatted.toLowerCase().includes("invalid")) return null;
    return formatted;
  } catch {
    return null;
  }
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A calendar date ("2026-07-25") as a collector reads it: "July 25, 2026".
 *
 * Built by hand, not through `Intl`, for the reason `clockTime` gives above -- and because
 * `new Date("2026-07-25")` is UTC midnight, which a local-time formatter can shift to the
 * previous day. Anything that is not a plain date comes back unchanged rather than guessed.
 */
export function longDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return date;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}
