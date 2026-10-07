/**
 * Report parameters, read from the URL. Every report link is therefore shareable and every
 * export reproduces exactly the screen it was taken from.
 */
export interface ReportParams {
  /** A business date, YYYY-MM-DD (Asia/Manila). */
  date: string;
  /** A month, YYYY-MM. */
  month: string;
  collectorId: string | null;
  leaseId: string | null;
  /** Narrows a report to one facility; null means every facility. */
  facilityId: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today in Manila: the office's business date, whatever timezone the server runs in. */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function readParams(
  search: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): ReportParams {
  const one = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : "");
  const today = manilaToday(now);
  const date = DATE.test(one("date")) ? one("date") : today;
  const month = MONTH.test(one("month")) ? one("month") : today.slice(0, 7);
  return {
    date,
    month,
    collectorId: UUID.test(one("collector")) ? one("collector") : null,
    leaseId: UUID.test(one("lease")) ? one("lease") : null,
    facilityId: UUID.test(one("facility")) ? one("facility") : null,
  };
}

/** The first and last day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function longMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}
