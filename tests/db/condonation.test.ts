import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createCollectionFixture,
  createLeaseFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
  type TestClient,
} from "../helpers/supabase.js";

let db: Client;
let admin: TestClient;
let adminUserId: string;

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
  ({ client: admin, userId: adminUserId } = await createAppUser({
    email: "condonation-admin",
    role: "admin",
  }));
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

  it("refuses an outsider with no app_users row", async () => {
    // The population migration 0002's "THE GATE" comment says to expect on this shared
    // project: signed in, but with no app_users row at all. active_role() is NULL for this
    // caller; before migration 0028 that NULL propagated through is_admin() uncoalesced,
    // so `if not is_admin() then raise` silently no-op'd instead of refusing them.
    const { chargeId } = await accruedLease();
    const outsider = await createOutsiderClient();
    const { error } = await outsider.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.charge_condonations where charge_id = $1",
      [chargeId],
    );
    expect(rows[0].n).toBe(0);
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

/**
 * Demonstrations, not assertions about the design -- the same shape post-collection.test.ts
 * uses: two real connections, two overlapping transactions, a proof that the second is
 * still blocked while the first holds its locks, and then a read of what the second
 * actually did once it woke up.
 *
 * What is being demonstrated is that condone_charge now takes `for update` on the charge
 * row before it reads charge_balances. Before that lock it read and inserted while holding
 * nothing, so it neither blocked nor was blocked by post_collection's own `for update`
 * (migration 20260918000022, STEP 4b), and this interleaving went through:
 *
 *   charge C, amount 50.00, outstanding 50.00
 *   T1 condone_charge reads outstanding = 50.00
 *   T2 post_collection locks C, re-reads 50.00, allocates 50.00, COMMITS
 *   T1 passes `p_amount > v_outstanding` on its stale read and inserts a 50.00 condonation
 *
 * leaving allocated 50 + condoned 50 against amount 50: outstanding -50.00, is_settled
 * true. lease_balances and aging_of_receivables both filter `where not is_settled`, so
 * that -50.00 shows up on no report at all -- 50 pesos of cash attributed to nothing. The
 * final reads in each test below are what would catch that: they check the sign of
 * `outstanding` on the real view, not merely that an error came back.
 *
 * condone_charge is called over a raw Postgres connection rather than supabase-js, because
 * PostgREST cannot hold a transaction open across two statements. `request.jwt.claims` is
 * set on the connection so `auth.uid()` -- and therefore is_admin() and the `condoned_by`
 * stamp -- resolves to a genuine administrator, exactly as it does through PostgREST.
 */
describe("condone_charge — concurrency", () => {
  const OPEN_TX_WAIT_MS = 400;

  /** Resolves to true if `promise` is still pending after `ms`. */
  async function stillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let pending = true;
    void promise.then(
      () => {
        pending = false;
      },
      () => {
        pending = false;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, ms));
    return pending;
  }

  /** Opens a connection that condone_charge will see as the fixture administrator. */
  async function adminConnection(): Promise<Client> {
    const conn = new Client({ connectionString: POSTGRES_URL });
    await conn.connect();
    await conn.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: adminUserId, role: "authenticated" }),
    ]);
    return conn;
  }

  function condoneOn(conn: Client, chargeId: string, amount: number, reason: string) {
    return conn.query(
      "select ceedo_collections.condone_charge($1::uuid, $2::numeric, $3, $4) as id",
      [chargeId, amount, "Ordinance 2026-114", reason],
    );
  }

  async function outstandingOf(chargeId: string) {
    const { rows } = await db.query(
      `select outstanding, is_settled,
              (select count(*)::int from ceedo_collections.charge_condonations
                where charge_id = $1) as condonations
         from ceedo_collections.charge_balances where id = $1`,
      [chargeId],
    );
    return rows[0];
  }

  it("waits behind an in-flight payment against the charge, then refuses to over-condone", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const chargeId = await chargeFor(fx.leaseId);

    const payer = new Client({ connectionString: POSTGRES_URL });
    await payer.connect();
    const condoner = await adminConnection();

    try {
      await payer.query("begin");
      await condoner.query("begin");

      // The payment settles the charge in full and holds the row lock, uncommitted.
      await postCollectionAsOwner(payer, fx, { groupRanks: [1] });

      // 50.00 was outstanding a moment ago and this admin has every reason to believe it
      // still is. The lock is what stops that belief becoming a fact.
      const condonation = condoneOn(condoner, chargeId, 50.0, "Typhoon amnesty");
      expect(await stillPending(condonation, OPEN_TX_WAIT_MS)).toBe(true);

      await payer.query("commit");

      // Awake, re-read, and refused on the post-wait truth: nothing is outstanding now.
      await expect(condonation).rejects.toThrow(/Cannot condone/);
    } finally {
      await payer.query("rollback").catch(() => undefined);
      await condoner.query("rollback").catch(() => undefined);
      await payer.end();
      await condoner.end();
    }

    const after = await outstandingOf(chargeId);
    expect(after.condonations).toBe(0);
    expect(Number(after.outstanding)).toBe(0);
    expect(after.is_settled).toBe(true);
  });

  it("serialises two condonations of one charge, so the pair cannot overshoot together", async () => {
    // The sibling race the handover already documented: two administrators applying the
    // same ordinance at the same moment. 60 + 60 against a 100.00 charge is individually
    // valid twice over and only overshoots in aggregate.
    const { chargeId } = await accruedLease();

    const first = await adminConnection();
    const second = await adminConnection();

    try {
      await first.query("begin");
      await second.query("begin");

      await condoneOn(first, chargeId, 60.0, "first");

      const racing = condoneOn(second, chargeId, 60.0, "second");
      expect(await stillPending(racing, OPEN_TX_WAIT_MS)).toBe(true);

      await first.query("commit");

      await expect(racing).rejects.toThrow(/Cannot condone/);
    } finally {
      await first.query("rollback").catch(() => undefined);
      await second.query("rollback").catch(() => undefined);
      await first.end();
      await second.end();
    }

    const after = await outstandingOf(chargeId);
    expect(after.condonations).toBe(1);
    expect(Number(after.outstanding)).toBe(40);
  });
});
