import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createLeaseFixture, POSTGRES_URL } from "../helpers/supabase.js";

let db: Client;
let leaseId: string;
let feeTypeId: string;

/** Inserts a charge as the table owner, bypassing the client-role privilege model. */
async function insertCharge(overrides: Record<string, unknown> = {}) {
  const row = {
    lease_id: leaseId,
    fee_type_id: feeTypeId,
    charge_type: "rental",
    parent_charge_id: null,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    due_date: "2026-10-05",
    amount: "500.00",
    surcharge_bps: 0,
    source: "accrual",
    ...overrides,
  };
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  return db.query(
    `insert into ceedo_collections.charges (${cols.join(", ")})
     values (${params}) returning id`,
    Object.values(row),
  );
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Build a minimal facility -> section -> stall -> lease chain and a fee type.
  ({ leaseId, feeTypeId } = await createLeaseFixture(db));
});

afterAll(async () => {
  await db.end();
});

describe("charges constraints", () => {
  it("refuses a second rental charge for the same lease and period", async () => {
    await insertCharge({ period_start: "2026-11-01", period_end: "2026-11-30" });
    await expect(
      insertCharge({ period_start: "2026-11-01", period_end: "2026-11-30" }),
    ).rejects.toThrow(/charges_one_rental_per_period/);
  });

  it("refuses a second surcharge against the same parent", async () => {
    const { rows } = await insertCharge({
      period_start: "2026-12-01",
      period_end: "2026-12-31",
    });
    const parent = rows[0].id;
    await insertCharge({
      charge_type: "surcharge",
      parent_charge_id: parent,
      period_start: "2026-12-01",
      period_end: "2026-12-01",
      amount: "15.00",
      surcharge_bps: 300,
    });
    await expect(
      insertCharge({
        charge_type: "surcharge",
        parent_charge_id: parent,
        period_start: "2026-12-01",
        period_end: "2026-12-01",
        amount: "15.00",
        surcharge_bps: 300,
      }),
    ).rejects.toThrow(/charges_one_surcharge_per_parent/);
  });

  it("refuses a surcharge with no parent", async () => {
    await expect(
      insertCharge({ charge_type: "surcharge", parent_charge_id: null }),
    ).rejects.toThrow(/charges_surcharge_has_parent/);
  });

  it("refuses a rental that names a parent", async () => {
    const { rows } = await insertCharge({
      period_start: "2027-01-01",
      period_end: "2027-01-31",
    });
    await expect(
      insertCharge({
        period_start: "2027-02-01",
        period_end: "2027-02-28",
        parent_charge_id: rows[0].id,
      }),
    ).rejects.toThrow(/charges_surcharge_has_parent/);
  });

  it("refuses a second opening balance for the same lease", async () => {
    await insertCharge({
      charge_type: "opening_balance",
      period_start: "2024-03-01",
      period_end: "2026-09-30",
      due_date: "2024-03-01",
      source: "opening_balance",
    });
    await expect(
      insertCharge({
        charge_type: "opening_balance",
        period_start: "2024-04-01",
        period_end: "2026-09-30",
        due_date: "2024-04-01",
        source: "opening_balance",
      }),
    ).rejects.toThrow(/charges_one_opening_balance_per_lease/);
  });

  it("refuses an opening balance carrying a surcharge rate", async () => {
    await expect(
      insertCharge({
        charge_type: "opening_balance",
        surcharge_bps: 300,
        source: "opening_balance",
      }),
    ).rejects.toThrow(/charges_opening_balance_no_surcharge/);
  });

  it("refuses a zero or negative amount", async () => {
    await expect(insertCharge({ amount: "0.00" })).rejects.toThrow(/amount/);
  });

  it("stamps row_version from the shared sequence", async () => {
    const { rows } = await insertCharge({
      period_start: "2027-03-01",
      period_end: "2027-03-31",
    });
    const { rows: got } = await db.query(
      "select row_version from ceedo_collections.charges where id = $1",
      [rows[0].id],
    );
    expect(Number(got[0].row_version)).toBeGreaterThan(0);
  });
});
