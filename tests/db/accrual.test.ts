import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture, resetCutover } from "../helpers/supabase.js";

let db: Client;

// Every test in this file is designed against the seeded 2026-10-01 cutover
// (supabase/seed.sql). settings.test.ts owns mutating that row; this file must not
// reset it before each test. The two failure-path tests below do briefly delete it
// (that is the only way to make cutover_date() raise), and each restores it in a
// `finally` immediately after asserting, so no other test in this file or in any file
// that runs after it (fileParallelism: false) ever observes a missing cutover.
async function restoreCutover(): Promise<void> {
  await db.query(
    "insert into ceedo_collections.settings (cutover_date) select '2026-10-01' where not exists (select 1 from ceedo_collections.settings)",
  );
}

async function countCharges(leaseId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from ceedo_collections.charges where lease_id = $1 and charge_type = 'rental'",
    [leaseId],
  );
  return rows[0].n;
}

/**
 * Calls lease_periods() directly. It is `immutable` and takes the cutover as a plain
 * argument, so it needs no `settings` row at all -- unlike every test above, which only
 * ever reaches it through run_accrual() with the cutover pinned at the seeded 2026-10-01
 * (Ruling 3). That route can vary lease_start against a FIXED cutover, but never the
 * other way around, so it structurally cannot exercise the half of Ruling 11's
 * greatest(lease_start, cutover) guard where the cutover itself is the binding bound.
 * These tests pin both halves, and the boundary between them, independently.
 */
async function leasePeriods(
  accrualPeriod: "daily" | "weekly" | "monthly",
  leaseStart: string,
  leaseEnd: string | null,
  cutover: string,
  through: string,
  dueDay: number | null,
): Promise<Array<{ period_start: string; period_end: string; due_date: string }>> {
  const { rows } = await db.query(
    `select period_start::text as period_start, period_end::text as period_end,
            due_date::text as due_date
       from ceedo_collections.lease_periods(
         $1::ceedo_collections.accrual_period, $2::date, $3::date, $4::date, $5::date, $6::smallint)
      order by period_start`,
    [accrualPeriod, leaseStart, leaseEnd, cutover, through, dueDay],
  );
  return rows;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  // Leave the cutover as this file found it: `settings` is a shared singleton and
  // fileParallelism is off, so whatever is left here is what the next file starts from.
  await resetCutover(db);
  await db.end();
});

describe("run_accrual", () => {
  it("raises one charge per elapsed day for a daily lease", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(5);
  });

  it("is idempotent — three runs raise the same charges once", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(5);
  });

  it("catches up after an outage without doubling", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    await db.query("select ceedo_collections.run_accrual('2026-10-07')");
    expect(await countCharges(leaseId)).toBe(7);
  });

  it("raises nothing before the cutover date", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2024-01-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    expect(await countCharges(leaseId)).toBe(3);

    // Cast in SQL rather than reading back a JS Date and calling toISOString(): node-postgres
    // parses `date` at local midnight and toISOString() renders in UTC, which rolls the date
    // back a day in Asia/Manila (observed directly on an earlier task).
    const { rows } = await db.query(
      "select min(period_start)::text as first from ceedo_collections.charges where lease_id = $1",
      [leaseId],
    );
    expect(rows[0].first).toBe("2026-10-01");
  });

  it("raises whole months for a monthly lease, due on its due day", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2026-10-01", dueDay: 5, rateAmount: "1500.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-12-15')");
    const { rows } = await db.query(
      `select period_start::text as period_start, period_end::text as period_end,
              due_date::text as due_date
         from ceedo_collections.charges
        where lease_id = $1 order by period_start`,
      [leaseId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].due_date).toBe("2026-10-05");
    expect(rows[1].period_end).toBe("2026-11-30");
  });

  it("does not raise a period that has not fully elapsed", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "weekly", startDate: "2026-10-01", rateAmount: "300.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-10')");
    expect(await countCharges(leaseId)).toBe(1);
  });

  it("stops at the lease end date", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", endDate: "2026-10-03",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-10')");
    expect(await countCharges(leaseId)).toBe(3);
  });

  it("ignores leases that are not active", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", status: "terminated",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(0);
  });

  it("logs a succeeded run with the row count", async () => {
    await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    const { rows } = await db.query(
      "select ceedo_collections.run_accrual('2026-10-04') as id",
    );
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("succeeded");
    expect(run[0].charges_raised).toBeGreaterThan(0);
    expect(run[0].finished_at).not.toBeNull();
  });

  // Ruling 11: no period may begin before greatest(lease_start, cutover). The seeded
  // cutover (2026-10-01) already falls on the first of a month, so exercising the guard's
  // "cutover lands mid-month" case would require mutating settings, which this file must
  // not do. A lease that itself starts mid-month, after the cutover, exercises the exact
  // same code path in lease_periods(): v_start (= lease_start here, since it is later than
  // the cutover) is not the first of a month, so the month-truncated cursor starts before
  // it and must be skipped rather than turned into a partial first charge.
  it("does not bill a partial first month for a lease that starts mid-month", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2026-11-15", dueDay: 5, rateAmount: "1500.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-12-31')");
    const { rows } = await db.query(
      `select period_start::text as period_start, period_end::text as period_end
         from ceedo_collections.charges
        where lease_id = $1 order by period_start`,
      [leaseId],
    );
    // Without the guard this would wrongly include a "2026-11-01..2026-11-30" charge
    // covering two weeks before the lease even started.
    expect(rows).toHaveLength(1);
    expect(rows[0].period_start).toBe("2026-12-01");
    expect(rows[0].period_end).toBe("2026-12-31");
  });

  it("records a failed run durably instead of rolling it back", async () => {
    // The failure must survive the transaction. Re-raising would roll back the very row
    // that records it, leaving a failed night indistinguishable from an unscheduled one.
    await db.query("delete from ceedo_collections.settings");
    try {
      const { rows } = await db.query(
        "select ceedo_collections.run_accrual('2026-10-04') as id",
      );
      const { rows: run } = await db.query(
        "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
      );
      expect(run[0].status).toBe("failed");
      expect(run[0].error).toMatch(/cutover/);
      expect(run[0].finished_at).not.toBeNull();
    } finally {
      await restoreCutover();
    }
  });

  it("raises no charges when it fails", async () => {
    await db.query("delete from ceedo_collections.settings");
    try {
      const { leaseId } = await createLeaseFixture(db, {
        accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
      });
      await db.query("select ceedo_collections.run_accrual('2026-10-04')");
      expect(await countCharges(leaseId)).toBe(0);
    } finally {
      await restoreCutover();
    }
  });

  /**
   * charges_raised on a FAILED run must be 0, not the count the loop had reached.
   *
   * The two failure tests above cannot see this: both make cutover_date() raise on the
   * first statement inside the block, so v_raised is 0 when the handler runs and writing
   * either value produces the same row. The bug only shows when the accrual fails PART
   * WAY THROUGH -- `begin ... exception` is a subtransaction, so entering the handler has
   * already rolled back every insert the loop made, while v_raised (a plpgsql variable)
   * survives. The row would then claim charges that do not exist, and accrual_health
   * prints that number to whoever is deciding whether the night needs re-running.
   *
   * Forced with a temporary trigger rather than by replacing run_accrual or
   * lease_periods: the failure has to happen at the INSERT, after earlier inserts in the
   * same loop have succeeded, which is the only arrangement that separates v_raised from
   * the truth. It is scoped to this one lease's third charge, so nothing else in the
   * database can trip it, and it is dropped in a `finally`.
   *
   * The lease is fresh, and run_accrual walks a lease's periods in date order, so
   * 2026-10-01 and 2026-10-02 are both inserted (v_raised reaches 2) before 2026-10-03
   * raises.
   */
  it("reports zero charges raised on a failed run, because the rollback discarded them", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query(
      `create function pg_temp.fail_third_charge() returns trigger
       language plpgsql as $fn$
       begin
         if new.lease_id = '${leaseId}'::uuid and new.due_date = '2026-10-03'::date then
           raise exception 'forced accrual failure on the third charge';
         end if;
         return new;
       end;
       $fn$`,
    );
    await db.query(
      `create trigger zz_fail_third_charge before insert on ceedo_collections.charges
       for each row execute function pg_temp.fail_third_charge()`,
    );
    try {
      const { rows } = await db.query(
        "select ceedo_collections.run_accrual('2026-10-03') as id",
      );
      const { rows: run } = await db.query(
        "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
      );
      expect(run[0].status).toBe("failed");
      expect(run[0].error).toMatch(/forced accrual failure/);
      // The number on the row and the number of charges that exist are the same number.
      // Before the fix this read 2 against a lease holding none.
      expect(run[0].charges_raised).toBe(0);
      expect(await countCharges(leaseId)).toBe(0);
    } finally {
      await db.query("drop trigger if exists zz_fail_third_charge on ceedo_collections.charges");
    }
  });
});

describe("lease_periods (Ruling 11: greatest(lease_start, cutover))", () => {
  it("suppresses a partial month when the CUTOVER lands mid-month", async () => {
    // Lease running well before a mid-month cutover: v_start resolves to the cutover, not
    // to lease_start. October would be the naive first month (truncating the cursor to
    // the 1st) but must be suppressed -- it starts twelve days before the cutover.
    const rows = await leasePeriods("monthly", "2026-09-15", null, "2026-10-20", "2026-11-30", 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      period_start: "2026-11-01", period_end: "2026-11-30", due_date: "2026-11-05",
    });
  });

  it("suppresses a partial month when the LEASE START lands mid-month", async () => {
    // Mirror of the above: cutover is on the 1st, lease starts mid-October. v_start
    // resolves to lease_start. October must still be suppressed.
    const rows = await leasePeriods("monthly", "2026-10-15", null, "2026-10-01", "2026-12-31", 5);
    expect(rows.map((r) => r.period_start)).toEqual(["2026-11-01", "2026-12-01"]);
    expect(rows.some((r) => r.period_start === "2026-10-01")).toBe(false);
  });

  it("bills the first month when both bounds land on its 1st (lease start far in the past)", async () => {
    const rows = await leasePeriods("monthly", "2024-01-01", null, "2026-10-01", "2026-11-30", 5);
    expect(rows.map((r) => r.period_start)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("bills the first month at the exact boundary (lease start == cutover)", async () => {
    const rows = await leasePeriods("monthly", "2026-10-01", null, "2026-10-01", "2026-10-31", 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      period_start: "2026-10-01", period_end: "2026-10-31", due_date: "2026-10-05",
    });
  });

  it("bills the first month when the cutover itself falls on the 1st", async () => {
    // Cutover does not bisect this month -- it lands exactly on its boundary -- so October
    // is owed in full even though the lease predates the cutover by a month.
    const rows = await leasePeriods("monthly", "2026-09-01", null, "2026-10-01", "2026-11-30", 5);
    expect(rows.map((r) => r.period_start)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("does not misfire for a daily lease with a mid-month cutover", async () => {
    // The guard only bites monthly: daily initialises v_cursor := v_start directly, so
    // period_start can never land before v_start in the first place.
    const rows = await leasePeriods("daily", "2026-09-01", null, "2026-10-15", "2026-10-18", null);
    expect(rows.map((r) => r.period_start)).toEqual([
      "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
  });

  it("does not misfire for a weekly lease with a mid-month cutover", async () => {
    const rows = await leasePeriods("weekly", "2026-09-01", null, "2026-10-14", "2026-10-27", null);
    expect(rows).toEqual([
      { period_start: "2026-10-14", period_end: "2026-10-20", due_date: "2026-10-20" },
      { period_start: "2026-10-21", period_end: "2026-10-27", due_date: "2026-10-27" },
    ]);
  });
});
