import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  createAppUser,
  createCollectionFixture,
  createOutsiderClient,
  POSTGRES_URL,
  resetCutover,
} from "../helpers/supabase";

let db: Client;

/**
 * Inserts a collection settling one charge, as the table owner.
 *
 * No client role holds INSERT on the ledger (migration 0011), and post_collection does
 * not exist until Task 12, so balance behaviour is exercised through the owner connection
 * here. Task 12 replaces these with real engine calls.
 */
async function settle(fx: any, chargeId: string, amount: string, orNo: number) {
  const id = randomUUID();
  await db.query("begin");
  await db.query(
    `insert into ceedo_collections.collections
       (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
        fee_type_id, lease_id, gross_amount)
     values ($1, $2, $3, $4, $5, now(), current_date, $6, $7, $8)`,
    [id, orNo, fx.bookletId, fx.collectorId, fx.deviceId, fx.feeTypeId, fx.leaseId, amount],
  );
  await db.query(
    `insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
     values ($1, $2, $3)`,
    [id, chargeId, amount],
  );
  await db.query("commit");
  return id;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
});

afterAll(async () => {
  // Leave the cutover as this file found it: `settings` is a shared singleton and
  // fileParallelism is off, so whatever is left here is what the next file starts from.
  await resetCutover(db);
  await db.end();
});

describe("charge_balances", () => {
  it("reports the full amount outstanding on an untouched charge", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where lease_id = $1",
      [fx.leaseId],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("marks a charge settled once allocations cover it", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1",
      [fx.leaseId],
    );
    await settle(fx, ch[0].id, "50.00", 2001);

    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where id = $1",
      [ch[0].id],
    );
    expect(rows[0].is_settled).toBe(true);
    expect(Number(rows[0].outstanding)).toBe(0);
  });

  it("stops counting a cancelled collection's allocations", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1",
      [fx.leaseId],
    );
    const collectionId = await settle(fx, ch[0].id, "50.00", 2002);

    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by) values ($1, 'wrong tenant', $2)`,
      [collectionId, fx.collectorId],
    );

    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where id = $1",
      [ch[0].id],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("subtracts a condonation", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1",
      [fx.leaseId],
    );
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by)
       values ($1, 30.00, 'Ordinance 2026-114', 'amnesty', $2)`,
      [ch[0].id, fx.collectorId],
    );
    const { rows } = await db.query(
      "select outstanding from ceedo_collections.charge_balances where id = $1",
      [ch[0].id],
    );
    expect(Number(rows[0].outstanding)).toBe(70);
  });

  it("computes days overdue from the Manila business date", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows } = await db.query(
      `select days_overdue,
              (ceedo_collections.business_date() - due_date) as expected
         from ceedo_collections.charge_balances where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows[0].days_overdue).toBe(Math.max(0, rows[0].expected));
  });

  /**
   * Ruling 9: a non-permitted RLS read returns an empty result, not an error. This is the
   * property security_invoker = true exists to guarantee -- without it the view would run
   * with its owner's rights and RLS on `charges` would never apply to the querying role,
   * regardless of who is signed in. Exercised over PostgREST (not the owner `db` connection
   * used above, which is the table owner and bypasses RLS entirely) so the query actually
   * runs as `authenticated` under the outsider's JWT.
   */
  it("hides every row from an authenticated user with no app_users row", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");

    const outsider = await createOutsiderClient();
    const { data, error } = await outsider
      .from("charge_balances")
      .select("id")
      .eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets a registered accounting user read charge_balances", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");

    const { client } = await createAppUser({
      email: "charge-balances-accounting@example.com",
      role: "accounting",
    });
    const { data, error } = await client
      .from("charge_balances")
      .select("id, outstanding")
      .eq("lease_id", fx.leaseId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data![0]!.outstanding)).toBe(50);
  });
});

describe("unpaid_period_groups", () => {
  it("returns groups oldest first", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    // Cast due_date to text in SQL rather than round-tripping through JS Date#toISOString():
    // node-postgres returns a `date` column as a Date object at local midnight, and
    // toISOString() re-renders that in UTC, shifting the calendar day whenever the test
    // runner's local timezone is ahead of UTC (confirmed by observation on this machine --
    // it silently shifted every date back one day).
    const { rows } = await db.query(
      "select due_date::text as due_date_text, * from ceedo_collections.unpaid_period_groups($1)",
      [fx.leaseId],
    );
    expect(rows.map((r: any) => r.due_date_text)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(rows[0].group_rank).toBe(1);
  });

  it("puts an opening balance ahead of every accrued period", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    // The brief's own version of this insert selects a fee_type by
    // `code = 'market_rental'`, which does not exist in supabase/seed.sql (its accruing
    // market codes are MKT_DAILY/MKT_WEEKLY/MKT_MONTHLY) -- confirmed by inspection, not
    // assumption. An opening balance only needs *some* valid fee_type_id, so this uses the
    // fixture's own fee type directly rather than a code that does not resolve to any row
    // (which would silently insert zero charges rather than fail).
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source)
       values ($1, $2, 'opening_balance', '2024-03-01', '2026-09-30', '2024-03-01',
               9000.00, 0, 'opening_balance')`,
      [fx.leaseId, fx.feeTypeId],
    );
    const { rows } = await db.query(
      "select due_date::text as due_date_text, * from ceedo_collections.unpaid_period_groups($1)",
      [fx.leaseId],
    );
    expect(rows[0].due_date_text).toBe("2024-03-01");
    expect(Number(rows[0].outstanding)).toBe(9000);
    expect(rows[0].group_rank).toBe(1);
  });

  it("omits settled groups", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2026-10-01",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1 order by due_date",
      [fx.leaseId],
    );
    await settle(fx, ch[0].id, "50.00", 2003);
    const { rows } = await db.query(
      "select due_date::text as due_date_text, * from ceedo_collections.unpaid_period_groups($1)",
      [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].due_date_text).toBe("2026-10-02");
  });
});
