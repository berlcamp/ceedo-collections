import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { computeSurcharge, fromCentavos, generatePeriods } from "@ceedo/shared";
import { POSTGRES_URL } from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/**
 * Calls lease_periods() directly, exactly as Task 5's accrual.test.ts does (see its
 * leasePeriods() helper) rather than inventing a second calling convention. `::text`
 * casts, not `Date#toISOString()`: node-postgres parses `date` at local midnight and
 * `toISOString()` renders in UTC, which rolls the date back a day in Asia/Manila
 * (documented on accrual.test.ts's "raises nothing before the cutover date" and reasserted
 * as a controller ruling for this task). lease_periods is `immutable` and takes every
 * bound as a plain argument, so no `settings` row or `resetCutover` is needed here.
 */
async function sqlPeriods(c: {
  accrualPeriod: "daily" | "weekly" | "monthly";
  leaseStart: string;
  leaseEnd: string | null;
  cutover: string;
  through: string;
  dueDay: number | null;
}): Promise<Array<{ period_start: string; period_end: string; due_date: string }>> {
  const { rows } = await db.query(
    `select period_start::text as period_start, period_end::text as period_end,
            due_date::text as due_date
       from ceedo_collections.lease_periods(
         $1::ceedo_collections.accrual_period, $2::date, $3::date, $4::date, $5::date, $6::smallint)
      order by period_start`,
    [c.accrualPeriod, c.leaseStart, c.leaseEnd, c.cutover, c.through, c.dueDay],
  );
  return rows;
}

/** Maps generatePeriods()'s camelCase ChargePeriod[] onto lease_periods()'s snake_case shape. */
function tsPeriods(c: Parameters<typeof generatePeriods>[0]) {
  return generatePeriods(c).map((p) => ({
    period_start: p.periodStart,
    period_end: p.periodEnd,
    due_date: p.dueDate,
  }));
}

/**
 * Fixtures chosen to hit the boundaries, not the middle -- this exact boundary
 * (greatest(lease_start, cutover)) has already been gotten wrong twice in this project,
 * once in a written instruction and once in the TypeScript's first implementation.
 *
 * Task 5's accrual.test.ts already pins lease_periods()'s SQL-only behaviour at this same
 * boundary (its "lease_periods (Ruling 11: greatest(lease_start, cutover))" describe
 * block). These fixtures deliberately use different dates so as to extend that coverage
 * -- by adding TypeScript-vs-SQL parity, the 1st/2nd-of-month off-by-one pair, an explicit
 * lease-end truncation via lease_periods() directly (accrual.test.ts only exercises that
 * guard through run_accrual(), never lease_periods() directly), and February in both a
 * leap and a non-leap year -- rather than re-asserting the same cases a second time.
 */
const PERIOD_CASES: Array<{
  name: string;
  accrualPeriod: "daily" | "weekly" | "monthly";
  leaseStart: string;
  leaseEnd: string | null;
  cutover: string;
  through: string;
  dueDay: number | null;
}> = [
  {
    name: "daily: basic run of elapsed days",
    accrualPeriod: "daily",
    leaseStart: "2026-10-01",
    leaseEnd: null,
    cutover: "2026-10-01",
    through: "2026-10-05",
    dueDay: null,
  },
  {
    name: "daily: cutover binds against a lease running well before it",
    accrualPeriod: "daily",
    leaseStart: "2024-01-01",
    leaseEnd: null,
    cutover: "2026-10-01",
    through: "2026-10-03",
    dueDay: null,
  },
  {
    name: "daily: lease end truncates the series",
    accrualPeriod: "daily",
    leaseStart: "2026-10-01",
    leaseEnd: "2026-10-02",
    cutover: "2026-10-01",
    through: "2026-10-09",
    dueDay: null,
  },
  {
    name: "weekly: two full weeks, partial trailing week not billed",
    accrualPeriod: "weekly",
    leaseStart: "2026-10-01",
    leaseEnd: null,
    cutover: "2026-10-01",
    through: "2026-10-15",
    dueDay: null,
  },
  {
    name: "weekly: one full week, partial trailing week not billed",
    accrualPeriod: "weekly",
    leaseStart: "2026-10-01",
    leaseEnd: null,
    cutover: "2026-10-01",
    through: "2026-10-10",
    dueDay: null,
  },
  {
    name: "monthly: two full months, partial trailing month not billed",
    accrualPeriod: "monthly",
    leaseStart: "2026-10-01",
    leaseEnd: null,
    cutover: "2026-10-01",
    through: "2026-12-15",
    dueDay: 5,
  },
  {
    name: "monthly: lease starts on the 2nd -- that first month is skipped (off-by-one, skipped direction)",
    accrualPeriod: "monthly",
    leaseStart: "2026-10-02",
    leaseEnd: null,
    cutover: "2026-01-01",
    through: "2026-11-30",
    dueDay: 5,
  },
  {
    name: "monthly: lease starts exactly on the 1st -- that month is billed (off-by-one, billed direction)",
    accrualPeriod: "monthly",
    leaseStart: "2026-10-01",
    leaseEnd: null,
    cutover: "2026-01-01",
    through: "2026-11-30",
    dueDay: 5,
  },
  {
    name: "monthly: lease start binds mid-month -- that month is skipped",
    accrualPeriod: "monthly",
    leaseStart: "2026-10-15",
    leaseEnd: null,
    cutover: "2026-01-01",
    through: "2026-12-31",
    dueDay: 5,
  },
  {
    name: "monthly: cutover binds mid-month against a lease running well before it",
    accrualPeriod: "monthly",
    leaseStart: "2025-01-01",
    leaseEnd: null,
    cutover: "2026-03-17",
    through: "2026-05-31",
    dueDay: 15,
  },
  {
    name: "monthly: lease start and cutover coincide on the same date",
    accrualPeriod: "monthly",
    leaseStart: "2027-06-01",
    leaseEnd: null,
    cutover: "2027-06-01",
    through: "2027-07-31",
    dueDay: 20,
  },
  {
    name: "monthly: lease end truncates the series (via lease_periods() directly, not run_accrual())",
    accrualPeriod: "monthly",
    leaseStart: "2026-10-01",
    leaseEnd: "2026-11-15",
    cutover: "2026-10-01",
    through: "2027-01-31",
    dueDay: 5,
  },
  {
    name: "monthly: February in a non-leap year, due_day at its constrained maximum of 28",
    accrualPeriod: "monthly",
    leaseStart: "2027-01-01",
    leaseEnd: null,
    cutover: "2027-01-01",
    through: "2027-03-31",
    dueDay: 28,
  },
  {
    name: "monthly: February in a leap year, due_day at its constrained maximum of 28",
    accrualPeriod: "monthly",
    leaseStart: "2028-01-01",
    leaseEnd: null,
    cutover: "2028-01-01",
    through: "2028-03-31",
    dueDay: 28,
  },
];

describe("period generation agrees between TypeScript and SQL", () => {
  for (const c of PERIOD_CASES) {
    it(c.name, async () => {
      const sql = await sqlPeriods(c);
      const ts = tsPeriods(c);
      expect(sql).toEqual(ts);
    });
  }
});

describe("surcharge arithmetic agrees between TypeScript and SQL", () => {
  // 83.50 at 3% is the documented float trap: 0.03 * 8350 is 250.49999999999997 in IEEE
  // 754 and floors to 250 where the correct half-up answer is 251. 0.01, 1.67 and 33.33
  // are small values and repeating decimals; 99999.99 is a large value -- exactly where a
  // rounding difference would show.
  const AMOUNTS = ["83.50", "50.00", "1500.00", "0.01", "1.67", "33.33", "99999.99", "7.15"];

  for (const pesos of AMOUNTS) {
    it(`${pesos} at 3%`, async () => {
      const centavos = Math.round(Number(pesos) * 100);
      const ts = computeSurcharge(fromCentavos(centavos), 300);

      const { rows } = await db.query(
        "select floor((round($1::numeric * 100) * 300 + 5000) / 10000) as centavos",
        [pesos],
      );
      expect(Number(rows[0].centavos)).toBe(ts);
    });
  }
});
