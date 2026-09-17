import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture } from "../helpers/supabase.js";

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

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
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
});
