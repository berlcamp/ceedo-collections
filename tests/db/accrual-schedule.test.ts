import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createLeaseFixture, POSTGRES_URL, resetCutover } from "../helpers/supabase";

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
