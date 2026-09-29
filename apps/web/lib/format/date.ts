// "Sept", not "Sep": the office's own spelling, which Intl does not give for every locale.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** True for an ISO date ("2026-09-05") or timestamp, as PostgREST returns them. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && (DATE_ONLY.test(value) || TIMESTAMP.test(value));
}

function manilaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), time: `${get("hour")}:${get("minute")}` };
}

/**
 * "05 Sept 2026". A calendar date is shown as written — it has no time zone to shift.
 * A timestamp is read in Manila time and keeps its time of day, "05 Sept 2026 14:03",
 * because for a last-seen or an issued-at the hour is the point. Anything else is
 * returned unchanged.
 */
export function formatDate(value: string): string {
  const date = DATE_ONLY.exec(value);
  if (date) return `${date[3]} ${MONTHS[Number(date[2]) - 1]} ${date[1]}`;
  if (!TIMESTAMP.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const { year, month, day, time } = manilaParts(parsed);
  return `${day} ${MONTHS[Number(month) - 1]} ${year} ${time}`;
}
