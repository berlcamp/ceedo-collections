import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { createLeaseFixture, POSTGRES_URL, resetCutover } from "../helpers/supabase";

// These tests call run_nightly(), whose run_surcharge() leg scans charge_balances
// SYSTEM-WIDE with no lease filter (design §9). They nominally finish in 0.5-1.2s against
// Vitest's 5s default, but that margin is thin: the scan's cost grows with total ledger
// size, not with the night's activity, so a machine under load or a database carrying
// fixtures from a previous un-reset run pushes them over. Observed twice during Phase 3a —
// four timeouts on one run, green on an immediate re-run with no code change.
//
// 20s is not a fix for the scan; design §9's materialised charge_balances is. It buys
// headroom so an environmental blip does not read as a regression, and so a genuine
// slowdown still fails rather than being masked by a number nobody chose deliberately.
vi.setConfig({ testTimeout: 20_000 });

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  // `settings` is a shared singleton and vitest.config.ts runs files sequentially, so
  // whatever this file leaves behind is what the next file starts from. This file both
  // sets a fixed cutover and deletes the row outright, so it must restore it.
  await resetCutover(db);
  await db.end();
});

describe("the nightly schedule", () => {
  it("is registered with pg_cron", async () => {
    const { rows } = await db.query(
      "select schedule, command, active from cron.job where jobname = 'ceedo_nightly_accrual'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toBe("0 18 * * *");
    expect(rows[0].active).toBe(true);
  });

  it("runs at 02:00 Manila", async () => {
    // 18:00 UTC. Asserting the conversion rather than trusting the comment.
    const { rows } = await db.query(
      "select (timestamptz '2026-10-01 18:00:00+00' at time zone 'Asia/Manila') as local",
    );
    expect(rows[0].local.getHours()).toBe(2);
  });
});

describe("run_nightly", () => {
  it("accrues and surcharges in one call", async () => {
    await db.query("delete from ceedo_collections.settings");
    // A fixed literal, not `current_date - 400`: this only needs to precede both the
    // lease's 2025-08-01 start and the real business date, and a relative date drifts
    // with the clock the way a fixture date in Task 12 was found to expire.
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values ('2024-01-01')",
    );
    // Ruling 14: no `market_rental` fee type exists. The seed already ships MKT_DAILY/
    // MKT_WEEKLY/MKT_MONTHLY with accrues = true and surcharge_bps = 300, which is what
    // createLeaseFixture's monthly lease resolves to via ensureAccrualFeeType.
    await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "1500.00",
    });

    const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("succeeded");
    expect(run[0].charges_raised).toBeGreaterThan(0);
    expect(run[0].surcharges_raised).toBeGreaterThan(0);
  });

  it("does not surcharge when the accrual failed", async () => {
    // A fresh lease (not the one above, which the previous test already surcharged in
    // full) with a rental charge that is genuinely eligible for a surcharge -- more than
    // a month overdue and unpaid -- raised while settings still holds the 2024-01-01
    // cutover left by the previous test, and BEFORE it is deleted below. Without this,
    // "surcharges_raised is 0" is true whether or not the guard exists, because nothing
    // eligible is left unsurcharged for run_nightly to find either way -- the guard would
    // not actually be exercised.
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "1500.00",
    });
    await db.query("select ceedo_collections.run_accrual()");
    const { rows: before } = await db.query(
      `select count(*)::int as n from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'surcharge'`,
      [leaseId],
    );
    expect(before[0].n).toBe(0);

    await db.query("delete from ceedo_collections.settings");
    const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("failed");
    expect(run[0].surcharges_raised).toBe(0);

    // The property that actually matters: the eligible charge from this lease was not
    // surcharged by the failed run, scoped to this lease rather than trusting the run's
    // own counter.
    const { rows: after } = await db.query(
      `select count(*)::int as n from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'surcharge'`,
      [leaseId],
    );
    expect(after[0].n).toBe(0);
  });

  /** Pins the cutover far enough back that a 2025-08-01 lease has a year of arrears. */
  async function cutoverAt(date: string): Promise<void> {
    await db.query("delete from ceedo_collections.settings");
    await db.query("insert into ceedo_collections.settings (cutover_date) values ($1)", [date]);
  }

  async function countCharges(leaseId: string, chargeType: string): Promise<number> {
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.charges
        where lease_id = $1 and charge_type = $2`,
      [leaseId, chargeType],
    );
    return rows[0].n;
  }

  /**
   * A lease keyed in at ten centavos must not be able to break every night from here on.
   *
   * run_surcharge computes floor((round(amount*100)*bps + 5000)/10000)/100. At 3% that is
   * 0.00 for any parent at or below 0.16 -- it takes 17 centavos to round up to a positive
   * centavo -- and `charges` carries `check (amount > 0)`. `on conflict do nothing` does
   * not swallow a CHECK violation, and run_accrual's own filter is only `rate_amount > 0`,
   * so such a lease accrues happily and then poisons the surcharge step from the day its
   * first charge passes a month overdue. Every subsequent night would fail the same way.
   *
   * The 0.17 lease is here so the exclusion cannot be over-broad: the smallest parent that
   * still rounds to a positive centavo must still be surcharged, at 0.01.
   */
  it("survives a lease whose surcharge would round to nothing, without skipping the ones that do not", async () => {
    await cutoverAt("2024-01-01");
    const { leaseId: centavo } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "0.10",
    });
    const { leaseId: boundary } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "0.17",
    });

    const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("succeeded");

    // Both leases accrued -- the exclusion is on the surcharge, not on the rental.
    expect(await countCharges(centavo, "rental")).toBeGreaterThan(0);
    expect(await countCharges(centavo, "surcharge")).toBe(0);

    const { rows: raised } = await db.query(
      `select distinct amount::text as amount from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'surcharge'`,
      [boundary],
    );
    expect(raised).toHaveLength(1);
    expect(Number(raised[0].amount)).toBe(0.01);
  });

  /**
   * A surcharge failure must cost the night its surcharges and nothing else.
   *
   * cron invokes run_nightly() as a single statement, so the whole night is one
   * transaction. An unguarded `perform run_surcharge` propagating an exception rolls back
   * the charges run_accrual just raised AND the accrual_runs row recording them, leaving
   * accrual_health reporting 'missing' -- indistinguishable from cron never having fired,
   * and exactly the failure run_accrual's own handler exists to prevent.
   *
   * Forced with a temporary trigger on `charges` rather than by replacing run_surcharge:
   * the exception then comes out of the real function, through the real call site, and the
   * trigger is dropped in a `finally`. The predicate added above closes the one trigger
   * this failure actually had in production, so a synthetic one is the only way left to
   * exercise the handler.
   */
  it("records a surcharge failure durably, with the night's accrual left standing", async () => {
    await cutoverAt("2024-01-01");
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "1500.00",
    });

    await db.query(
      `create function pg_temp.fail_surcharge() returns trigger
       language plpgsql as $fn$
       begin
         if new.charge_type = 'surcharge' then
           raise exception 'forced surcharge failure';
         end if;
         return new;
       end;
       $fn$`,
    );
    await db.query(
      `create trigger zz_fail_surcharge before insert on ceedo_collections.charges
       for each row execute function pg_temp.fail_surcharge()`,
    );

    try {
      // The call itself must not raise. That is the fix.
      const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
      const { rows: run } = await db.query(
        "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
      );

      expect(run[0].status).toBe("failed");
      expect(run[0].error).toMatch(/forced surcharge failure/);
      expect(run[0].finished_at).not.toBeNull();

      // The accrual's own work survived: the subtransaction rolled back the surcharge
      // attempt only. charges_raised is therefore a true count here, unlike on a run that
      // failed inside run_accrual (where the rollback took the charges with it).
      const rentals = await countCharges(leaseId, "rental");
      expect(rentals).toBeGreaterThan(0);
      // Not an equality: run_accrual has no lease filter, so charges_raised counts this
      // lease's charges plus any other lease in the database that gained a period in the
      // same run. What must hold is that the count is real and covers what survived.
      expect(run[0].charges_raised).toBeGreaterThanOrEqual(rentals);
      expect(await countCharges(leaseId, "surcharge")).toBe(0);

      // The monitoring surface calls it failed, not missing -- an alert either way, but
      // only one of them tells whoever is on call what actually broke.
      const { rows: health } = await db.query(
        `select status, error from ceedo_collections.accrual_health
          where business_date = ceedo_collections.business_date()`,
      );
      expect(health[0].status).toBe("failed");
      expect(health[0].error).toMatch(/forced surcharge failure/);
    } finally {
      await db.query("drop trigger if exists zz_fail_surcharge on ceedo_collections.charges");
    }
  });
});

describe("accrual_health", () => {
  it("reports a night that never ran as missing", async () => {
    await db.query("delete from ceedo_collections.accrual_runs");
    // Scoped to the one business date this test controls, not a row count over the whole
    // 15-day window -- that window's shape depends on the real clock and on whatever
    // other test files (running earlier in this sequential suite) left in accrual_runs.
    const { rows } = await db.query(
      `select * from ceedo_collections.accrual_health
        where business_date = ceedo_collections.business_date()`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("missing");
  });

  it("reports a failed night as failed", async () => {
    await db.query("delete from ceedo_collections.accrual_runs");
    await db.query("delete from ceedo_collections.settings");
    await db.query("select ceedo_collections.run_nightly()");
    const { rows } = await db.query(
      `select * from ceedo_collections.accrual_health
        where business_date = ceedo_collections.business_date()`,
    );
    expect(rows[0].status).toBe("failed");
  });
});
