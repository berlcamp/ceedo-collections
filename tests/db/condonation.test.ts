import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createLeaseFixture,
  resetCutover,
  type TestClient,
} from "../helpers/supabase.js";

let db: Client;
let admin: TestClient;

async function chargeFor(leaseId: string): Promise<string> {
  const { rows } = await db.query(
    "select id from ceedo_collections.charges where lease_id = $1 order by due_date limit 1",
    [leaseId],
  );
  return rows[0].id;
}

async function accruedLease(rate = "100.00") {
  const { leaseId } = await createLeaseFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: rate,
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-01')");
  return { leaseId, chargeId: await chargeFor(leaseId) };
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Ruling 2: createAppUser returns an already-signed-in { client, userId }; there is no
  // separate signIn(email) => client helper taking a bare role string.
  ({ client: admin } = await createAppUser({ email: "condonation-admin", role: "admin" }));
});

beforeEach(async () => {
  // Every fixture in this file is built around the seeded 2026-10-01 cutover; re-assert it
  // in case another file (settings.test.ts) left it mutated, mirroring opening-balance.test.ts.
  await resetCutover(db);
});

afterAll(async () => {
  // Leave the cutover as this file found it: `settings` is a shared singleton and
  // fileParallelism is off, so whatever is left here is what the next file starts from.
  await resetCutover(db);
  await db.end();
});

describe("condone_charge", () => {
  it("reduces the outstanding balance", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 40.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "Fire amnesty",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      "select outstanding, is_settled from ceedo_collections.charge_balances where id = $1",
      [chargeId],
    );
    expect(Number(rows[0].outstanding)).toBe(60);
    expect(rows[0].is_settled).toBe(false);
  });

  it("settles the charge when it condones the whole amount, with nothing collected", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 100.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "Full amnesty",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      "select is_settled, allocated from ceedo_collections.charge_balances where id = $1",
      [chargeId],
    );
    expect(rows[0].is_settled).toBe(true);
    expect(Number(rows[0].allocated)).toBe(0);
  });

  it("refuses to condone more than is outstanding", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 150.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "too much",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Cannot condone/);
  });

  it("refuses a second condonation that would overshoot in aggregate", async () => {
    const { chargeId } = await accruedLease();
    const first = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 60.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "partial",
    });
    expect(first.error).toBeNull();

    // Individually valid (60 <= 100) but the charge already carries a 60 condonation, so
    // this second one alone would not overshoot -- only the aggregate does. A naive check
    // comparing p_amount to the raw charge amount would miss this; charge_balances.outstanding
    // already nets out the prior condonation, so this must be refused.
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 60.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "again",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Cannot condone/);

    const { rows } = await db.query(
      "select outstanding from ceedo_collections.charge_balances where id = $1",
      [chargeId],
    );
    expect(Number(rows[0].outstanding)).toBe(40);
  });

  it("refuses a supervisor", async () => {
    const { chargeId } = await accruedLease();
    const { client: supervisor } = await createAppUser({
      email: "condonation-supervisor", role: "supervisor",
    });
    const { error } = await supervisor.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "not allowed",
    });
    // Ruling 9: condone_charge() raises an explicit exception via is_admin() rather than
    // filtering rows under RLS, so unlike a bare PostgREST UPDATE (silently denied) an
    // error here is expected -- confirmed by running it, not assumed.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.charge_condonations where charge_id = $1",
      [chargeId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses an accounting user", async () => {
    const { chargeId } = await accruedLease();
    const { client: accounting } = await createAppUser({
      email: "condonation-accounting", role: "accounting",
    });
    const { error } = await accounting.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);
  });

  it("refuses a blank authority reference", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0, p_authority_ref: "  ", p_reason: "no ordinance",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a blank reason", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0, p_authority_ref: "Ordinance 2026-114", p_reason: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a non-positive amount", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 0, p_authority_ref: "Ordinance 2026-114", p_reason: "zero",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/positive/);
  });

  it("records the condonation in the audit log against the acting administrator", async () => {
    const { chargeId } = await accruedLease();
    const { data, error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-115", p_reason: "audited",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select actor_id from ceedo_collections.audit_log
        where entity = 'charge_condonations' and action = 'insert' and entity_id = $1`,
      [data],
    );
    expect(rows.length).toBeGreaterThan(0);

    // The audited actor must be an admin's app_users id, not null and not some other role.
    expect(rows[0].actor_id).not.toBeNull();
    const { rows: actorRoleRows } = await db.query(
      "select role from ceedo_collections.app_users where id = $1",
      [rows[0].actor_id],
    );
    expect(actorRoleRows[0].role).toBe("admin");
  });
});
