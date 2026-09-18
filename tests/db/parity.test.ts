import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  computeSurcharge,
  fromCentavos,
  generatePeriods,
  isContiguousPrefix,
  type PeriodGroup,
} from "@ceedo/shared";
import {
  createCollectionFixture,
  createLeaseFixture,
  POSTGRES_URL,
  type CollectionFixture,
} from "../helpers/supabase.js";

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

/**
 * BREADTH ONLY, not true parity: this re-derives the surcharge formula as a literal SQL
 * expression hand-copied from run_surcharge() (migration 20260918000021_surcharge.sql),
 * rather than calling that function. If the migration's rate, rounding offset or operand
 * order ever changed without this string changing too, these cases would keep passing
 * while the two sides had actually diverged -- a hardcoded FORMULA standing in for the
 * real one, the same failure this whole task exists to catch, one level up. They are kept
 * for breadth across many amounts; the describe block below this one calls the real
 * run_surcharge() function and is what actually proves parity.
 */
describe("surcharge arithmetic against a literal copy of the SQL formula (breadth only)", () => {
  // 83.50 at 3% pins an exact half-up TIE, not a float-representation error: 0.03 * 8350
  // is exactly 250.5 in IEEE 754, with no rounding noise to blame. The hazard here is
  // rounding DIRECTION -- Math.floor(250.5) is 250 where half-up gives the correct 251 --
  // and this fixture would also catch a dropped `+5000` rounding offset. 0.01, 1.67 and
  // 33.33 are small values and repeating decimals; 99999.99 is a large value.
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

describe("surcharge arithmetic agrees with the real run_surcharge() function", () => {
  it("₱83.50 at 3%, raised end to end through run_accrual() and run_surcharge()", async () => {
    // A fresh lease, well before the seeded 2026-10-01 cutover so the very first daily
    // period (2026-10-01) is billed immediately. MKT_DAILY (ensureAccrualFeeType) carries
    // surcharge_bps = 300, matching the 300 used on the TypeScript side below.
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-01-01",
      rateAmount: "83.50",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");

    // Strictly more than a calendar month past the 2026-10-01 due date, and still unpaid.
    await db.query("select ceedo_collections.run_surcharge('2026-11-02')");

    const { rows } = await db.query(
      `select amount::text as amount from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'surcharge'`,
      [leaseId],
    );
    expect(rows).toHaveLength(1);

    const sqlCentavos = Math.round(Number(rows[0].amount) * 100);
    const ts = computeSurcharge(fromCentavos(8350), 300);
    expect(sqlCentavos).toBe(ts);
  });
});

/**
 * FIFO prefix selection agrees between TypeScript and SQL.
 *
 * The brief's own rationale for this task is this exact case: "a device that computes a
 * different FIFO prefix than the server accepts produces a rejection the collector cannot
 * understand while holding a spent receipt." Both sides are driven from the SAME group
 * list -- built from unpaid_period_groups(), the one place FIFO order is defined -- so
 * this checks agreement, not just that each side independently does what its own author
 * expected.
 *
 * Each case gets a FRESH fixture (a fresh lease with three unpaid daily periods) rather
 * than sharing one lease across cases: an ACCEPTED post changes the unpaid set, and
 * unpaid_period_groups() renumbers what remains -- rank 2 before a post is not rank 2
 * after one. Reusing a lease across the accept cases ([1], [1,2], [1,2,3]) would make each
 * later case's "rank 2" or "rank 3" mean something different than the group list it was
 * checked against. A fresh fixture per case sidesteps that entirely, at the cost of a
 * fixture build per case rather than per file -- cheap here, and every other file in this
 * suite already pays it per test.
 */
describe("FIFO prefix selection agrees between TypeScript and SQL", () => {
  /** A fresh lease with three unpaid daily periods (ranks 1, 2, 3), and their group list. */
  async function freshGroups(): Promise<{ fx: CollectionFixture; groups: PeriodGroup[] }> {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");

    const { rows } = await db.query(
      `select group_rank, due_date::text as due_date, period_start::text as period_start,
              charge_ids, outstanding::text as outstanding
         from ceedo_collections.unpaid_period_groups($1)
        order by group_rank`,
      [fx.leaseId],
    );
    const groups: PeriodGroup[] = rows.map((r) => ({
      groupRank: r.group_rank as number,
      dueDate: r.due_date as string,
      periodStart: r.period_start as string,
      chargeIds: r.charge_ids as string[],
      outstanding: fromCentavos(Math.round(Number(r.outstanding) * 100)),
    }));
    expect(groups.map((g) => g.groupRank)).toEqual([1, 2, 3]);
    return { fx, groups };
  }

  async function postRanks(fx: CollectionFixture, ranks: number[]) {
    const payload = {
      id: randomUUID(),
      or_no: 1000,
      booklet_id: fx.bookletId,
      collector_id: fx.collectorId,
      device_id: fx.deviceId,
      collected_at: "2026-10-05T02:00:00+00:00",
      fee_type_id: fx.feeTypeId,
      lease_id: fx.leaseId,
      allocations: ranks.map((group_rank) => ({ group_rank })),
      lines: [],
    };
    const { rows } = await db.query(
      "select ceedo_collections.post_collection($1::jsonb) as result",
      [JSON.stringify(payload)],
    );
    return rows[0].result as { status: string; reason?: string };
  }

  // `reason` defaults to "allocation_not_prefix". [] is the one deliberate exception --
  // see the comment on that case below, which is a genuine (and narrow) difference in
  // where the two layers draw the line, surfaced by this test rather than papered over.
  const CASES: Array<{ name: string; ranks: number[]; valid: boolean; reason?: string }> = [
    { name: "[1]", ranks: [1], valid: true },
    { name: "[1,2]", ranks: [1, 2], valid: true },
    { name: "[1,2,3]", ranks: [1, 2, 3], valid: true },
    { name: "[2] (skips the oldest)", ranks: [2], valid: false },
    { name: "[1,3] (gap)", ranks: [1, 3], valid: false },
    { name: "[1,1] (duplicate)", ranks: [1, 1], valid: false },
    { name: "[1,99] (unknown rank)", ranks: [1, 99], valid: false },
    // NOT a disagreement about FIFO: post_collection's prefix check (STEP 4) only runs
    // `if jsonb_array_length(allocations) > 0` (migration 20260918000022_post_collection.sql)
    // -- an empty allocations array skips the FIFO rule entirely rather than failing it, and
    // is instead caught by the earlier, unrelated "a collection needs allocations or lines"
    // guard, which reports `no_parts`. isContiguousPrefix([], ...) answering `false` is a
    // different question ("is this a non-empty valid selection") than "will the server
    // accept this envelope" -- with lines also empty here, both sides still refuse the
    // empty case, just for reasons that live one guard apart. This was found BY this test
    // (first draft asserted allocation_not_prefix uniformly and failed here), not smoothed
    // over into it.
    { name: "[] (empty)", ranks: [], valid: false, reason: "no_parts" },
  ];

  for (const c of CASES) {
    it(`${c.name} -> ${c.valid ? "a valid prefix, post_collection accepts" : "not a valid prefix, post_collection rejects"}`, async () => {
      const { fx, groups } = await freshGroups();

      const ts = isContiguousPrefix(groups, c.ranks);
      expect(ts).toBe(c.valid);

      const result = await postRanks(fx, c.ranks);
      if (c.valid) {
        expect(result.status).toBe("accepted");
      } else {
        expect(result.status).toBe("rejected");
        expect(result.reason).toBe(c.reason ?? "allocation_not_prefix");
      }
    });
  }
});
