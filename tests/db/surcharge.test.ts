import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  createAppUser,
  createCollectionFixture,
  createLeaseFixture,
  POSTGRES_URL,
  uniqueCode,
  type TestClient,
} from "../helpers/supabase";

let db: Client;
let admin: TestClient;
let adminUserId: string;

async function surchargesFor(leaseId: string) {
  const { rows } = await db.query(
    `select amount, surcharge_bps, due_date, period_start, parent_charge_id
       from ceedo_collections.charges
      where lease_id = $1 and charge_type = 'surcharge' order by due_date`,
    [leaseId],
  );
  return rows;
}

/**
 * Inserts a collection settling (or over/partially settling) one charge, as the table
 * owner. No client role holds INSERT on the ledger (migration 0011), and post_collection
 * does not exist until Task 12, so balance behaviour is exercised through the owner
 * connection here, exactly as Task 8's charge-balances.test.ts does. One transaction so
 * Task 6's deferred collections_balance trigger sees a balanced collection at COMMIT.
 */
async function settle(
  fx: { bookletId: string; collectorId: string; deviceId: string; feeTypeId: string; leaseId: string },
  chargeId: string,
  amount: string,
  orNo: number,
) {
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
  ({ client: admin, userId: adminUserId } = await createAppUser({
    email: "surcharge-admin",
    role: "admin",
  }));
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2027-01-01')");
});

afterAll(async () => {
  await db.end();
});

describe("run_surcharge", () => {
  it("computes 3% exactly on the case floats get wrong", async () => {
    // 83.50 at 3% is 2.505, half-up 2.51. A float gives 250.49999999999997 centavos.
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-31",
      rateAmount: "83.50",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-31')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");

    const rows = await surchargesFor(leaseId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(2.51);
    expect(rows[0].surcharge_bps).toBe(300);
  });

  it("uses calendar months: a 31 January charge is delinquent on 1 March, not before", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-31",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-31')");

    // 31 Jan + 1 month is 28 Feb (Postgres clamps rather than overflows). On 28 Feb it is
    // exactly a month, not yet past one.
    await db.query("select ceedo_collections.run_surcharge('2027-02-28')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);

    await db.query("select ceedo_collections.run_surcharge('2027-03-01')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("raises at most one surcharge per rental charge however often it runs", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-06')");
    await db.query("select ceedo_collections.run_surcharge('2027-04-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("never surcharges a surcharge — it does not compound", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-06-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("never surcharges an opening balance", async () => {
    // Ruling 14: the brief's version of this insert selects a fee_type by
    // `code = 'market_rental'`, which does not exist in supabase/seed.sql (its accruing
    // market codes are MKT_DAILY/MKT_WEEKLY/MKT_MONTHLY). An opening balance only needs
    // *some* valid fee_type_id, so this uses the fixture's own fee type directly.
    const { leaseId, feeTypeId } = await createLeaseFixture(db);
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source)
       values ($1, $2, 'opening_balance', '2024-01-01', '2026-12-31', '2024-01-01',
               5000.00, 0, 'opening_balance')`,
      [leaseId, feeTypeId],
    );
    await db.query("select ceedo_collections.run_surcharge('2027-06-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("does not surcharge a charge that was condoned", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1",
      [leaseId],
    );
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by)
       values ($1, 100.00, 'Ordinance 2027-001', 'amnesty', $2)`,
      [ch[0].id, adminUserId],
    );
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("gives the surcharge its parent's due date and period", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-10",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-10')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    // Cast to text in SQL rather than round-tripping through JS Date#toISOString(): observed
    // on this machine to shift a `date` column's calendar day back by one when the local
    // timezone is ahead of UTC.
    const { rows } = await db.query(
      `select due_date::text as due_date_text, period_start::text as period_start_text
         from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'surcharge'`,
      [leaseId],
    );
    expect(rows[0].due_date_text).toBe("2027-01-10");
    expect(rows[0].period_start_text).toBe("2027-01-10");
  });

  it("raises nothing for a fee type with a zero surcharge rate", async () => {
    // Ruling 14 addendum: createLeaseFixture resolves its fee type to the shared seeded
    // MKT_DAILY row. Mutating that row's surcharge_bps to 0 (as the brief's test does) and
    // not restoring it would silently disable surcharge for every test file running
    // afterwards. Instead this uses a dedicated fee type that nothing else references, and
    // attaches the rental charge to it directly (rental_fee_type() always resolves a
    // lease's own accrual period to MKT_DAILY/WEEKLY/MONTHLY, so the charge, not the lease,
    // is what needs to point at the zero-rate fee type to exercise run_surcharge's filter).
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    const { rows: ft } = await db.query(
      `insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps)
       values ($1, 'Zero-rate surcharge fixture', true, 0)
       returning id`,
      [uniqueCode("ZERO")],
    );
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source)
       values ($1, $2, 'rental', '2027-01-05', '2027-01-05', '2027-01-05', 100.00, 0, 'accrual')`,
      [leaseId, ft[0].id],
    );
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("records the count on the accrual run when given one", async () => {
    const { rows } = await db.query(
      "insert into ceedo_collections.accrual_runs (business_date) values ('2027-03-05') returning id",
    );
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05', $1)", [rows[0].id]);
    const { rows: run } = await db.query(
      "select surcharges_raised from ceedo_collections.accrual_runs where id = $1",
      [rows[0].id],
    );
    expect(run[0].surcharges_raised).toBeGreaterThan(0);
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  /**
   * Coverage gap (a) from the Task 8 review: a rental charge and its surcharge share
   * (due_date, period_start, period_end) by construction, so unpaid_period_groups should
   * fold them into one row. No test drove a real surcharge through it until now.
   */
  it("collapses a rental charge and its surcharge into one unpaid_period_groups row", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");

    const surcharges = await surchargesFor(leaseId);
    expect(surcharges).toHaveLength(1);
    expect(Number(surcharges[0].amount)).toBe(3.0); // 100.00 at 3% = 3.00 exactly

    const { rows } = await db.query(
      "select charge_ids, outstanding from ceedo_collections.unpaid_period_groups($1)",
      [leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].charge_ids).toHaveLength(2);
    expect(Number(rows[0].outstanding)).toBe(103.0);
  });

  /**
   * Coverage gap (b) from the Task 8 review: charge_balances.is_settled must use `<= 0`,
   * not `= 0`. Without this, a future `<=` -> `=` edit would flip an overpaid charge back
   * to unpaid and re-enter it into FIFO, asking a tenant who overpaid to pay again.
   */
  it("treats an over-allocated charge as settled (is_settled must be <= 0, not = 0)", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1",
      [fx.leaseId],
    );
    await settle(fx, ch[0].id, "150.00", 9001);

    const { rows } = await db.query(
      "select outstanding, is_settled from ceedo_collections.charge_balances where id = $1",
      [ch[0].id],
    );
    expect(Number(rows[0].outstanding)).toBe(-50);
    expect(rows[0].is_settled).toBe(true);
  });

  /**
   * Coverage gap (c) from the Task 8 review: a partially settled group must appear with
   * the remaining balance, not the original amount.
   */
  it("shows a partially settled group's remaining balance, not its original amount", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily",
      startDate: "2027-01-05",
      rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");

    const { rows: ch } = await db.query(
      `select id from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'rental'`,
      [fx.leaseId],
    );
    // Rental (100.00) + surcharge (3.00) = 103.00 outstanding before any payment.
    await settle(fx, ch[0].id, "40.00", 9002);

    const { rows } = await db.query(
      "select charge_ids, outstanding from ceedo_collections.unpaid_period_groups($1)",
      [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].charge_ids).toHaveLength(2);
    expect(Number(rows[0].outstanding)).toBe(63.0);
  });
});
