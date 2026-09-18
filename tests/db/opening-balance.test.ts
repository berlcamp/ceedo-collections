import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createLeaseFixture,
  resetCutover,
  type TestClient,
} from "../helpers/supabase.js";

let db: Client;
let leaseId: string;
let adminClient: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Every test in this plan is designed around the seeded 2026-10-01 cutover. settings.test.ts
  // is the only file allowed to mutate this row, but it always restores this exact date
  // afterward, so re-asserting it here is belt-and-braces against run order rather than a
  // real dependency on that file.
  await resetCutover(db);
  ({ leaseId } = await createLeaseFixture(db));
  ({ client: adminClient } = await createAppUser({ email: "opening-balance-admin", role: "admin" }));
});

afterAll(async () => {
  // Leave the cutover as this file found it: `settings` is a shared singleton and
  // fileParallelism is off, so whatever is left here is what the next file starts from.
  await resetCutover(db);
  await db.end();
});

describe("record_opening_balance", () => {
  it("creates one charge dated to the real oldest unpaid day", async () => {
    const { data, error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: leaseId,
      p_amount: 12500.0,
      p_oldest_unpaid_date: "2024-03-01",
      p_authority_ref: "Reconciled paper ledger, 2026-09-30, T. Cruz",
    });
    expect(error).toBeNull();

    // Cast dates to text in SQL rather than reading back JS Dates and calling
    // toISOString(): node-postgres parses `date` at local midnight, and toISOString()
    // renders in UTC, which rolls the date back a day in any zone ahead of UTC (this was
    // observed directly against Asia/Manila in this environment on an earlier task).
    const { rows } = await db.query(
      `select charge_type, source, surcharge_bps,
              due_date::text as due_date, period_end::text as period_end,
              period_start::text as period_start
         from ceedo_collections.charges where id = $1`,
      [data],
    );
    expect(rows[0].charge_type).toBe("opening_balance");
    expect(rows[0].source).toBe("opening_balance");
    expect(rows[0].due_date).toBe("2024-03-01");
    expect(rows[0].period_start).toBe("2024-03-01");
    expect(rows[0].period_end).toBe("2026-09-30");
    expect(rows[0].surcharge_bps).toBe(0);
  });

  it("refuses a second opening balance for the same lease", async () => {
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: leaseId,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-05-01",
      p_authority_ref: "duplicate attempt",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already has an opening balance/);
  });

  it("refuses a date on or after the cutover", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2026-10-01",
      p_authority_ref: "too late",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/must precede the cutover date/);
  });

  it("refuses an empty authority reference", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/authority reference/);
  });

  it("refuses a non-admin", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { client: accounting } = await createAppUser({
      email: "opening-balance-accounting",
      role: "accounting",
    });
    const { error } = await accounting.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "not allowed",
    });
    // This is an RPC, not a plain table UPDATE: record_opening_balance() raises an
    // explicit exception (via ceedo_collections.is_admin()) rather than filtering rows
    // under RLS, so unlike a bare UPDATE through PostgREST (which fails silently -- see
    // settings.test.ts) an error here is actually expected. Confirmed by direct
    // observation, not assumed.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);

    // Belt-and-braces on Ruling 9: also assert the state did not change, in case the
    // message assertion above were ever loosened.
    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.charges where lease_id = $1",
      [other],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses a non-positive amount", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "zero",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/positive amount/);
  });
});
