import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  CHARGE_TYPE_ORDER,
  computeSurcharge,
  fromCentavos,
  generatePeriods,
  isContiguousPrefix,
  parsePesoInput,
  REJECT_REASONS,
  unpaidPeriodGroups,
  type PeriodGroup,
} from "@ceedo/shared";
import {
  createCollectionFixture,
  createLeaseFixture,
  POSTGRES_URL,
  type CollectionFixture,
  retireCollectionAreas,
} from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Every tablet pulls every active collection area; start this file from its own.
  await retireCollectionAreas(db);
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

/**
 * Every `reason` string post_collection() can hand back is a member of the TypeScript
 * `REJECT_REASONS` vocabulary.
 *
 * This is the direction that actually bites a collector: the SQL is the source of truth
 * for what gets returned, and a reason code it can produce but TypeScript does not know
 * about renders as `undefined` on the device standing at a stall, not a helpful message.
 * (The reverse -- a TypeScript reason the SQL never produces -- is a looser vocabulary,
 * not a rendering bug, and is not what this check is for.)
 *
 * Reads post_collection()'s own source via pg_get_functiondef() rather than hardcoding a
 * second copy of the list: a reason string added to the function without a matching
 * update here would otherwise pass silently.
 */
describe("post_collection()'s reason vocabulary agrees with REJECT_REASONS", () => {
  it("every reason literal in the function body is in REJECT_REASONS", async () => {
    const { rows } = await db.query(
      `select pg_get_functiondef('ceedo_collections.post_collection(jsonb)'::regprocedure) as def`,
    );
    const def = rows[0].def as string;

    const found = new Set<string>();
    for (const m of def.matchAll(/'reason',\s*'([a-z_]+)'/g)) {
      if (m[1]) found.add(m[1]);
    }

    // Sanity check on the extraction itself: a regex that matched nothing would make every
    // assertion below vacuously true.
    expect(found.size).toBeGreaterThan(0);

    for (const reason of found) {
      expect(REJECT_REASONS).toContain(reason);
    }
  });
});

/**
 * `CHARGE_TYPE_ORDER` agrees with the `charge_type` enum's DECLARATION order.
 *
 * `unpaid_period_groups()` builds `charge_ids` with `array_agg(b.id order by b.charge_type)`
 * and a Postgres enum sorts by declaration position, not alphabetically. outstanding.ts
 * mirrors that with a hand-written map whose doc comment says in capitals that it must stay
 * in step with migration 0011 -- and until now nothing checked it. The unit test pins the
 * ordering against a hardcoded assumption of what the enum order is, which cannot catch
 * drift, and the fixture in the block below contains only `rental` and `surcharge`: the one
 * pairing that sorts identically under the enum AND a naive string sort, which is exactly
 * the coincidence that let a `localeCompare` implementation pass every test on this branch
 * while disagreeing with the SQL for any group containing an `opening_balance`.
 *
 * `enum_range` is read off the live type rather than parsed out of the migration file, so
 * adding a value, reordering values or dropping one all fail here.
 */
describe("CHARGE_TYPE_ORDER agrees with the charge_type enum", () => {
  it("the enum's own sort order is this map's order, value for value", async () => {
    const { rows } = await db.query<{ types: string[] }>(
      `select array_agg(t::text order by t) as types
         from unnest(enum_range(null::ceedo_collections.charge_type)) t`,
    );

    const mapped = Object.keys(CHARGE_TYPE_ORDER).sort(
      (a, b) => (CHARGE_TYPE_ORDER[a] ?? 0) - (CHARGE_TYPE_ORDER[b] ?? 0),
    );
    expect(rows[0]!.types).toEqual(mapped);
  });
});

describe("ledger parity: unpaid_period_groups", () => {
  it("SQL and TypeScript agree on a lease carrying all four inputs", async () => {
    // A lease with several overdue monthly periods, so a prefix is meaningful.
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "monthly",
      startDate: "2026-01-01",
      dueDay: 5,
      rateAmount: "1500.00",
    });

    // The charges are inserted directly rather than raised through run_accrual() /
    // run_surcharge(). Those two functions are NOT scoped to one lease: run_accrual's
    // loop is `for v_lease in select ... from leases where status = 'active' ...` over
    // EVERY active lease in the database, and run_surcharge similarly scans every
    // unsettled rental via charge_balances. This suite's fixtures are never cleaned up
    // between files (tests/helpers/supabase.ts, "Nothing clears auth.users..."), so
    // every earlier test file's still-active lease is also sitting in that scan.
    // A first attempt here called run_accrual('2027-02-01') to get several overdue
    // months for JUST this lease, and it did -- but it also raised new rental charges
    // for every other fixture lease left active by every other test file, all the way
    // through February 2027. That corrupted global state for tests never touched by
    // this file: db/sync-pull.test.ts's "returns nothing new when the cursor is
    // current" saw surprise charges, db/sync-payload-size.test.ts's first-sync budget
    // blew past 8 MB, and db/accrual-schedule.test.ts's run_nightly assertions on exact
    // counts broke -- none of them about this task at all. charge_balances and
    // unpaid_period_groups() (the actual object under test here) only care that valid
    // charge rows exist for this lease; how they got there is not part of what this
    // test pins. Direct INSERT produces the identical shape with zero blast radius.
    const periods = [
      { start: "2026-10-01", end: "2026-10-31", due: "2026-10-05" },
      { start: "2026-11-01", end: "2026-11-30", due: "2026-11-05" },
      { start: "2026-12-01", end: "2026-12-31", due: "2026-12-05" },
      { start: "2027-01-01", end: "2027-01-31", due: "2027-01-05" },
    ];
    const chargeRows: { id: string }[] = [];
    for (const p of periods) {
      const { rows } = await db.query<{ id: string }>(
        `insert into ceedo_collections.charges
           (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
            amount, surcharge_bps, source)
         values ($1, $2, 'rental', $3, $4, $5, '1500.00', 0, 'accrual')
         returning id`,
        [fx.leaseId, fx.feeTypeId, p.start, p.end, p.due],
      );
      chargeRows.push(rows[0]!);
    }
    // A surcharge on the two oldest periods only (Oct, Nov) -- enough to satisfy the
    // fixture's own "carries a surcharge" assertion below while leaving Dec and Jan
    // as plain rentals, which is closer to what a real overdue ledger looks like than
    // surcharging everything.
    for (const parent of chargeRows.slice(0, 2)) {
      await db.query(
        `insert into ceedo_collections.charges
           (lease_id, fee_type_id, charge_type, parent_charge_id, period_start,
            period_end, due_date, amount, surcharge_bps, source)
         select lease_id, fee_type_id, 'surcharge', id, period_start, period_end,
                due_date, '45.00', 300, 'accrual'
           from ceedo_collections.charges where id = $1`,
        [parent.id],
      );
    }
    expect(chargeRows.length).toBe(4);

    // A condonation on one charge, and a collection that is then cancelled. Without these
    // the fixture exercises neither subtraction and the comparison is vacuous.
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, reason, authority_ref, condoned_by)
       values ($1, '100.00', 'parity fixture', 'ORD-PARITY', $2)`,
      [chargeRows[1]!.id, fx.collectorId],
    );

    const cancelledId = randomUUID();
    // 1000, not an out-of-range literal: createCollectionFixture's booklet always runs
    // FIXTURE_BOOKLET_START_NO..FIXTURE_BOOKLET_END_NO (1000-1999), and this fixture's
    // booklet is otherwise untouched.
    await db.query("select ceedo_collections.post_collection($1::jsonb)", [
      JSON.stringify({
        id: cancelledId,
        or_no: 1000,
        booklet_id: fx.bookletId,
        collector_id: fx.collectorId,
        device_id: fx.deviceId,
        collected_at: new Date().toISOString(),
        fee_type_id: fx.feeTypeId,
        lease_id: fx.leaseId,
        allocations: [{ group_rank: 1 }],
        lines: [],
      }),
    ]);
    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by) values ($1, 'parity fixture', $2)`,
      [cancelledId, fx.collectorId],
    );

    // --- the SQL side ---
    const { rows: sqlGroups } = await db.query<{
      group_rank: number;
      due_date: string;
      period_start: string;
      charge_ids: string[];
      outstanding: string;
    }>(
      `select group_rank, due_date::text, period_start::text, charge_ids, outstanding::text
         from ceedo_collections.unpaid_period_groups($1) order by group_rank`,
      [fx.leaseId],
    );

    // --- the TypeScript side, fed the same rows the device would hold ---
    //
    // `order by due_date desc` -- the NEWEST period first, the opposite of FIFO order --
    // deliberately, so that a correct answer can only come from unpaidPeriodGroups()
    // doing its own sort. A device's local rows arrive in no particular order (sync,
    // not a single ordered query), and a query here that happened to already return
    // due-date order would let a broken comparator (falsification 8a) pass by
    // coincidence rather than by being exercised.
    const { rows: charges } = await db.query(
      `select id, lease_id, charge_type, due_date::text as due_date,
              period_start::text as period_start, period_end::text as period_end,
              amount::text as amount
         from ceedo_collections.charges where lease_id = $1
        order by due_date desc`,
      [fx.leaseId],
    );
    const { rows: allocations } = await db.query(
      `select collection_id, charge_id, amount::text as amount
         from ceedo_collections.collection_allocations`,
    );
    const { rows: condonations } = await db.query(
      `select charge_id, amount::text as amount from ceedo_collections.charge_condonations`,
    );
    const { rows: cancelled } = await db.query(
      `select collection_id from ceedo_collections.collection_cancellations`,
    );

    const tsGroups = unpaidPeriodGroups(
      {
        charges: charges.map((r) => ({
          id: r.id,
          leaseId: r.lease_id,
          chargeType: r.charge_type,
          dueDate: r.due_date,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          amount: parsePesoInput(r.amount),
        })),
        allocations: allocations.map((r) => ({
          collectionId: r.collection_id,
          chargeId: r.charge_id,
          amount: parsePesoInput(r.amount),
        })),
        condonations: condonations.map((r) => ({
          chargeId: r.charge_id,
          amount: parsePesoInput(r.amount),
        })),
        cancelledCollectionIds: new Set(cancelled.map((r) => r.collection_id)),
      },
      fx.leaseId,
    );

    // The fixture is only meaningful if it produced several groups AND exercised all four
    // inputs. Asserting that here stops a future change quietly emptying it.
    expect(sqlGroups.length).toBeGreaterThan(2);
    expect(condonations.length).toBeGreaterThan(0);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(
      charges.some((r: { charge_type: string }) => r.charge_type === "surcharge"),
    ).toBe(true);

    expect(tsGroups).toEqual(
      sqlGroups.map((g) => ({
        groupRank: g.group_rank,
        dueDate: g.due_date,
        periodStart: g.period_start,
        chargeIds: g.charge_ids,
        outstanding: parsePesoInput(g.outstanding),
      })),
    );
  });
});
