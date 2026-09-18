import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Pull = {
  cursor: string;
  epoch: number;
  facilities: { id: string }[];
  sections: { id: string }[];
  stalls: { id: string }[];
  tenants: { id: string }[];
  leases: { id: string }[];
  fee_types: { id: string }[];
  rates: { id: string }[];
  collectors: { id: string; employee_no: string; pin_hash: string | null }[];
  booklets: { id: string }[];
  booklet_assignments: { booklet_id: string }[];
  consumed_serials: { booklet_id: string; or_no: number }[];
  charges: { id: string }[];
  collections: { id: string }[];
  collection_allocations: { collection_id: string }[];
  collection_cancellations: { collection_id: string }[];
};

async function pull(deviceId: string, cursor = 0): Promise<Pull> {
  const { rows } = await db.query(
    `select ceedo_collections.sync_pull($1::uuid, $2::bigint) as result`,
    [deviceId, cursor],
  );
  return rows[0].result as Pull;
}

describe("sync_pull", () => {
  it("returns the device's own facility and not another's", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.facilities.map((f) => f.id)).toContain(mine.facilityId);
    expect(result.facilities.map((f) => f.id)).not.toContain(theirs.facilityId);
  });

  it("returns the device's own leases and not another's", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.leases.map((l) => l.id)).toContain(mine.leaseId);
    expect(result.leases.map((l) => l.id)).not.toContain(theirs.leaseId);
  });

  it("returns the current assignment epoch", async () => {
    const fx = await createSyncFixture(db);
    const { rows } = await db.query(
      `select assignment_epoch from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );
    expect((await pull(fx.deviceId)).epoch).toBe(Number(rows[0].assignment_epoch));
  });

  it("returns collections, not just charges", async () => {
    // THE mandate from Phase 2's handover. A charge row does not change when it is paid --
    // no status column, no UPDATE privilege -- so a device watching `charges` for deltas
    // would compile, deploy, and silently never fire. This test is the reason the pull
    // carries collections at all.
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const posted = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const collection_id = posted;

    const result = await pull(fx.deviceId);

    expect(result.collections.map((c) => c.id)).toContain(collection_id);
    expect(result.collection_allocations.map((a) => a.collection_id)).toContain(collection_id);
  });

  it("carries a paid charge forward on the cursor via its collection", async () => {
    // The falsifiable form of the above. After a payment, the CHARGE's row_version has not
    // moved -- only the collection's has. A cursor taken before the payment must still
    // deliver the news.
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const before = await pull(fx.deviceId);
    const cursor = Number(before.cursor);

    const collection_id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const delta = await pull(fx.deviceId, cursor);

    expect(delta.charges).toEqual([]);
    expect(delta.collections.map((c) => c.id)).toContain(collection_id);
  });

  it("returns nothing new when the cursor is current", async () => {
    const fx = await createSyncFixture(db);
    const first = await pull(fx.deviceId);
    const second = await pull(fx.deviceId, Number(first.cursor));

    expect(second.leases).toEqual([]);
    expect(second.charges).toEqual([]);
    expect(second.collections).toEqual([]);
  });

  it("advances the cursor monotonically", async () => {
    const fx = await createSyncFixture(db);
    const first = await pull(fx.deviceId);
    await db.query(`select ceedo_collections.run_accrual('2026-10-06'::date)`);
    const second = await pull(fx.deviceId, Number(first.cursor));

    expect(Number(second.cursor)).toBeGreaterThan(Number(first.cursor));
  });

  it("returns the collectors permitted on this device, with their pin_hash", async () => {
    // set_collector_pin() is is_admin()-gated (migration 0027), checked via auth.uid(),
    // which resolves from `request.jwt.claims` -- not from the raw Postgres role the `db`
    // connection uses (`postgres`, itself a superuser and so not blocked by the missing
    // grant either way, but also not an admin as far as is_admin() is concerned). Without
    // this, the call fails with "Only an administrator may set a collector PIN" -- the
    // brief's version of this test called it with no admin context at all and could never
    // have passed. condonation.test.ts's `adminConnection()` establishes the same pattern.
    const fx = await createSyncFixture(db);
    const { userId: adminUserId } = await createAppUser({
      email: "sync-pull-admin@example.com",
      role: "admin",
    });
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: adminUserId, role: "authenticated" }),
    ]);
    await db.query(`select ceedo_collections.set_collector_pin($1::uuid, '123456')`, [
      fx.collectorId,
    ]);

    const result = await pull(fx.deviceId);
    const me = result.collectors.find((c) => c.id === fx.collectorId);

    expect(me).toBeDefined();
    expect(me?.pin_hash).toMatch(/^\$2[aby]\$/);
  });

  it("excludes a collector whose role was changed away from collector", async () => {
    // Migration 0007's own comment predicted this reader: "Phase 3's sync scoping keys off
    // these rows directly and does not re-check, so a supervisor named in
    // collector_assignments, or a collector promoted while still assigned, becomes a real
    // scoping fault there."
    //
    // The guard triggers 0007 added make the TABLE safe. This makes the READER safe
    // independently. Both, not either.
    //
    // Getting an app_users row into that state (role != 'collector' while its
    // collector_assignments row is still ACTIVE) is exactly what the two guard triggers
    // (migration 0006 for held booklets, migration 0007 for active assignments) exist to
    // prevent through ordinary SQL -- so a version of this test that deactivates the
    // assignment FIRST (to get the role change to succeed) never actually exercises
    // sync_pull's own role re-check at all: `ca.active` is already false by the time
    // sync_pull runs, so the collector_assignments JOIN drops the row regardless of
    // whether sync_pull also filters on role. Confirmed empirically: with `and u.role =
    // 'collector'` deleted from the migration, that version of this test still passed.
    //
    // The scenario the migration 0007 comment actually warns about -- "a collector
    // promoted while still assigned" -- is precisely the case the guard trigger makes
    // unreachable from ordinary SQL. Reproducing it to test the reader's OWN defence
    // therefore requires bypassing that trigger deliberately, the same way a future
    // migration accidentally dropping or disabling it would. `db` connects as the table
    // owner, so it can do this and undo it within the test.
    const fx = await createSyncFixture(db);
    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).toContain(fx.collectorId);

    // A second, unrelated guard (migration 0006) blocks the same role change over an open
    // booklet_assignment -- return it first so only the assignment guard is in play.
    await db.query(
      `update ceedo_collections.booklet_assignments
          set returned_at = current_date
        where collector_id = $1 and returned_at is null`,
      [fx.collectorId],
    );

    await db.query(
      `alter table ceedo_collections.app_users
         disable trigger app_users_no_active_assignments_on_role_change`,
    );
    try {
      // The collector_assignments row is left ACTIVE throughout -- the guard trigger is
      // what is bypassed, not the assignment itself.
      await db.query(`update ceedo_collections.app_users set role = 'supervisor' where id = $1`, [
        fx.collectorId,
      ]);
    } finally {
      await db.query(
        `alter table ceedo_collections.app_users
           enable trigger app_users_no_active_assignments_on_role_change`,
      );
    }

    const { rows } = await db.query(
      `select active from ceedo_collections.collector_assignments where collector_id = $1`,
      [fx.collectorId],
    );
    expect(rows[0].active).toBe(true);

    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).not.toContain(fx.collectorId);
  });

  it("excludes a suspended collector", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`update ceedo_collections.app_users set status = 'suspended' where id = $1`, [
      fx.collectorId,
    ]);

    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).not.toContain(fx.collectorId);
  });

  it("returns consumed serials so the device can refuse a spent OR offline", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const collection_id = await postCollectionAsOwner(db, fx, {
      groupRanks: [1],
      orNo: 1501,
    });
    expect(collection_id).toBeTruthy();

    const result = await pull(fx.deviceId);

    expect(result.consumed_serials).toContainEqual(
      expect.objectContaining({ booklet_id: fx.bookletId, or_no: 1501 }),
    );
  });

  it("returns an empty scope for a device with no active assignment", async () => {
    const fx = await createSyncFixture(db);
    await db.query(
      `update ceedo_collections.device_assignments set active = false where device_id = $1`,
      [fx.deviceId],
    );

    const result = await pull(fx.deviceId);

    expect(result.leases).toEqual([]);
    expect(result.facilities).toEqual([]);
  });

  it("excludes another facility's collections from the payload", async () => {
    // A coverage hole found and closed during Task 7's mutation check: deleting the
    // `collections` key's `join _scope_leases` left `returns the device's own leases and
    // not another's` still green (it never looks at collections at all), while every
    // collection in the WHOLE SYSTEM leaked to every device. This is the test that would
    // have caught it.
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const theirCollectionId = await postCollectionAsOwner(db, theirs, { groupRanks: [1] });

    const result = await pull(mine.deviceId);

    expect(result.collections.map((c) => c.id)).not.toContain(theirCollectionId);
  });
});
