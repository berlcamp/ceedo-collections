import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createCollectionFixture, createOutsiderClient,
  postCollectionAsOwner, resetCutover, signIn,
} from "../helpers/supabase";

let db: Client;
let fx: any;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-02')");
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

describe("cancel_collection", () => {
  it("restores the outstanding balance", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });

    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "Recorded against the wrong stall",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select outstanding, is_settled from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date limit 1`, [fx.leaseId],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("leaves the collection row byte-identical", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows: before } = await db.query(
      "select * from ceedo_collections.collections where id = $1", [collectionId],
    );
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    expect(error).toBeNull();
    const { rows: after } = await db.query(
      "select * from ceedo_collections.collections where id = $1", [collectionId],
    );
    // Compare the whole row, not one column: if the migration ever added an UPDATE
    // path to `collections`, a column-by-column check that happened to only look at
    // e.g. `notes` would miss it entirely.
    expect(after[0]).toEqual(before[0]);
  });

  it("puts the period back at the front of the FIFO queue", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select group_rank, due_date::text as due_date
         from ceedo_collections.unpaid_period_groups($1)`, [fx.leaseId],
    );
    expect(rows[0].due_date).toBe("2026-10-01");
    expect(rows[0].group_rank).toBe(1);
  });

  it("refuses a second cancellation", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const first = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "first",
    });
    expect(first.error).toBeNull();
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "second",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already cancelled/);
  });

  it("refuses a blank reason", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/written reason/);

    // A refused blank-reason attempt must not have left a cancellation row behind either.
    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collection_cancellations where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses an accounting user", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: accounting } = await createAppUser({
      email: "accounting@example.com", role: "accounting",
    });
    const { error } = await accounting.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "not allowed",
    });
    // Ruling 9: an RPC explicitly raises, unlike a bare RLS read/update refusal, so an
    // error IS expected here -- assert the message actually observed.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collection_cancellations where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses an outsider with no app_users row", async () => {
    // The population migration 0002's "THE GATE" comment says to expect on this shared
    // project: signed in, but with no app_users row at all. active_role() is NULL for this
    // caller; before migration 0028 that NULL propagated through has_role() uncoalesced,
    // so `if not has_role(...) then raise` silently no-op'd instead of refusing them.
    // cancel_collection is the only guarded RPC in this phase gated by has_role() rather
    // than is_admin(), so this is the only place that half of the coalesce fix is tested.
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const outsider = await createOutsiderClient();
    const { error } = await outsider.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collection_cancellations where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("records the cancellation in the audit log against the acting user", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: admin, userId: adminId } = await createAppUser({
      email: "admin@example.com", role: "admin",
    });
    const { error } = await admin.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "audited",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select actor_id from ceedo_collections.audit_log
        where entity = 'collection_cancellations' and action = 'insert'
          and entity_id = (
            select id from ceedo_collections.collection_cancellations
             where collection_id = $1
          )`,
      [collectionId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actor_id).toBe(adminId);
  });

  it("frees the serial for nothing -- a cancelled OR is still spent", async () => {
    // 1010 is inside the fixture booklet's 1000-1999 range but below the 1500+
    // auto-incrementing counter postCollectionAsOwner uses by default elsewhere in this
    // file, so it cannot collide with another test's OR number.
    const orNo = 1010;
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1], orNo });
    const { client: admin } = await createAppUser({ email: "admin@example.com", role: "admin" });
    const { error } = await admin.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "void",
    });
    expect(error).toBeNull();

    // The paper receipt is void but the serial is consumed: it must still be accounted
    // for in the booklet reconciliation, not reissued. Assert the specific reason code
    // (postCollectionAsOwner puts it in the thrown message) rather than a bare
    // `.rejects.toThrow()` -- otherwise this test would still pass, proving nothing,
    // if the repost failed for any unrelated reason (a broken FK, fixture drift, a new
    // validation added earlier in post_collection's branch order).
    await expect(
      postCollectionAsOwner(db, fx, { groupRanks: [1], orNo }),
    ).rejects.toThrow(/or_already_used/);
  });
});

describe("reinstate_collection", () => {
  async function cancelled() {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor, userId } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    expect(error).toBeNull();
    return { collectionId, supervisor, userId };
  }

  const outstanding = async () => {
    const { rows } = await db.query(
      `select outstanding from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date limit 1`, [fx.leaseId],
    );
    return Number(rows[0].outstanding);
  };

  it("counts the receipt again and keeps both rows on the record", async () => {
    const { collectionId, supervisor, userId } = await cancelled();
    expect(await outstanding()).toBe(50);

    const { error } = await supervisor.rpc("reinstate_collection", {
      p_collection_id: collectionId, p_reason: "Cancelled the wrong OR",
    });
    expect(error).toBeNull();
    expect(await outstanding()).toBe(0);

    const { rows } = await db.query(
      `select cc.id, r.reinstated_by
         from ceedo_collections.collection_cancellations cc
         join ceedo_collections.collection_reinstatements r on r.cancellation_id = cc.id
        where cc.collection_id = $1`, [collectionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reinstated_by).toBe(userId);

    const { rows: ledger } = await db.query(
      `select cancelled from ceedo_collections.subsidiary_ledger
        where entry_type = 'collection' and source_id = $1`, [collectionId],
    );
    expect(ledger[0].cancelled).toBe(false);
  });

  it("allows cancelling again after a reinstatement", async () => {
    const { collectionId, supervisor } = await cancelled();
    await supervisor.rpc("reinstate_collection", { p_collection_id: collectionId, p_reason: "undo" });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "void after all",
    });
    expect(error).toBeNull();
    expect(await outstanding()).toBe(50);
  });

  it("refuses a receipt that is not cancelled", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { client: supervisor } = await createAppUser({
      email: "supervisor@example.com", role: "supervisor",
    });
    const { error } = await supervisor.rpc("reinstate_collection", {
      p_collection_id: collectionId, p_reason: "nothing to undo",
    });
    expect(error!.message).toMatch(/not cancelled/);
  });

  it("refuses a blank reason and an accounting user", async () => {
    const { collectionId, supervisor } = await cancelled();
    const blank = await supervisor.rpc("reinstate_collection", {
      p_collection_id: collectionId, p_reason: "  ",
    });
    expect(blank.error!.message).toMatch(/written reason/);

    const { client: accounting } = await createAppUser({
      email: "accounting@example.com", role: "accounting",
    });
    const { error } = await accounting.rpc("reinstate_collection", {
      p_collection_id: collectionId, p_reason: "not allowed",
    });
    expect(error!.message).toMatch(/supervisor or administrator/);
    expect(await outstanding()).toBe(50);
  });
});
