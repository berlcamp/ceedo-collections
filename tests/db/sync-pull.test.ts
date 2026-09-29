import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
  uniqueCode,
  uniqueEmail,
  retireCollectionAreas,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Every tablet pulls every active collection area; start this file from its own.
  await retireCollectionAreas(db);
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
  collector_assignments: { id: string; collector_id: string; facility_id: string; active: boolean }[];
  booklets: { id: string }[];
  booklet_assignments: { booklet_id: string }[];
  consumed_serials: { booklet_id: string; or_no: number }[];
  spoiled_forms: { booklet_id: string; or_no: number }[];
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
  // Migration 20260929000055: every tablet carries every facility. Tablets are shared, so
  // the signed-in collector's collection area scopes what they see, on the device.
  it("returns every facility, not only the one the tablet was assigned", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.facilities.map((f) => f.id)).toContain(mine.facilityId);
    expect(result.facilities.map((f) => f.id)).toContain(theirs.facilityId);
  });

  it("returns every facility's leases", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.leases.map((l) => l.id)).toContain(mine.leaseId);
    expect(result.leases.map((l) => l.id)).toContain(theirs.leaseId);
  });

  it("returns each collector's collection areas, withdrawn ones as inactive", async () => {
    const fx = await createSyncFixture(db);
    const first = await pull(fx.deviceId);
    const mine = first.collector_assignments.find((a) => a.collector_id === fx.collectorId);
    expect(mine).toMatchObject({ facility_id: fx.facilityId, active: true });

    await db.query(
      `update ceedo_collections.collector_assignments set active = false where collector_id = $1`,
      [fx.collectorId],
    );
    const delta = await pull(fx.deviceId, Number(first.cursor));
    expect(delta.collector_assignments).toContainEqual(
      expect.objectContaining({ id: mine!.id, active: false }),
    );
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
    // have passed. Mirrors condonation.test.ts's `adminConnection()` exactly, including
    // using a SHORT-LIVED, DEDICATED connection rather than `db`: `set_config(..., false)`
    // (session-scoped, not `true`/transaction-scoped) would otherwise leave a stray admin
    // claim on the shared `db` connection for every test that runs after this one in the
    // file.
    const fx = await createSyncFixture(db);
    const { userId: adminUserId } = await createAppUser({
      email: "sync-pull-admin@example.com",
      role: "admin",
    });
    const adminConn = new Client({ connectionString: POSTGRES_URL });
    await adminConn.connect();
    try {
      await adminConn.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: adminUserId, role: "authenticated" }),
      ]);
      await adminConn.query(`select ceedo_collections.set_collector_pin($1::uuid, '123456')`, [
        fx.collectorId,
      ]);
    } finally {
      await adminConn.end();
    }

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

  it("returns the full scope to a device with no assignment of its own", async () => {
    const fx = await createSyncFixture(db);
    await db.query(
      `update ceedo_collections.device_assignments set active = false where device_id = $1`,
      [fx.deviceId],
    );

    const result = await pull(fx.deviceId);

    expect(result.leases.map((l) => l.id)).toContain(fx.leaseId);
    expect(result.collectors.map((c) => c.id)).toContain(fx.collectorId);
  });

  it("returns another facility's lease collections too", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const theirCollectionId = await postCollectionAsOwner(db, theirs, { groupRanks: [1] });

    const result = await pull(mine.deviceId);

    expect(result.collections.map((c) => c.id)).toContain(theirCollectionId);
  });

  it("sends booklets, booklet_assignments, consumed_serials and spoiled_forms of a collector outside the tablet's old assignment, and drops them when the collector has no area", async () => {
    // Any tablet may be the one a collector picks up (migration 20260929000055), so their
    // booklet state goes to every tablet while they hold an active collection area. The
    // device_assignments row below, naming another section, no longer narrows anything.
    //
    // (Before 20260929000055 this test asserted the opposite: a device scoped to section A
    // was refused the booklets of a collector scoped to section B.)
    const { rows: facRows } = await db.query(
      `insert into ceedo_collections.facilities (code, name, type)
       values ($1, $2, 'market') returning id`,
      [uniqueCode("SECFX"), "Section Scoping Fixture Market"],
    );
    const facilityId = facRows[0].id as string;

    const { rows: sectionRows } = await db.query(
      `insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
       values ($1, 'Section A', 'daily'), ($1, 'Section B', 'daily')
       returning id`,
      [facilityId],
    );
    const [sectionAId, sectionBId] = sectionRows.map((r) => r.id as string);

    // The device: scoped to section A only.
    const { rows: deviceRows } = await db.query(
      `insert into ceedo_collections.devices (label) values ($1) returning id`,
      [uniqueCode("SECFX-DEV")],
    );
    const deviceId = deviceRows[0].id as string;
    await db.query(
      `insert into ceedo_collections.device_assignments (device_id, facility_id, section_id, active)
       values ($1, $2, $3, true)`,
      [deviceId, facilityId, sectionAId],
    );

    // The collector: scoped to section B only.
    const { userId: collectorId } = await createAppUser({
      email: uniqueEmail("section-b-collector@example.com"),
      role: "collector",
    });
    await db.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, section_id, active)
       values ($1, $2, $3, true)`,
      [collectorId, facilityId, sectionBId],
    );

    // OR51 and SLAUGHTER are seeded by supabase/seed.sql unconditionally -- no dependency
    // on another test file's fixtures having run first.
    const { rows: formTypeRows } = await db.query(
      `select id from ceedo_collections.form_types where code = 'OR51'`,
    );
    const formTypeId = formTypeRows[0].id as string;
    const { rows: feeTypeRows } = await db.query(
      `select id from ceedo_collections.fee_types where code = 'SLAUGHTER'`,
    );
    const feeTypeId = feeTypeRows[0].id as string;

    const { rows: bookletRows } = await db.query(
      `insert into ceedo_collections.booklets
         (form_type_id, serial_prefix, start_no, end_no, received_date)
       values ($1, $2, 1, 50, '2026-01-01') returning id`,
      [formTypeId, uniqueCode("SECFX-BK")],
    );
    const bookletId = bookletRows[0].id as string;

    await db.query(
      `insert into ceedo_collections.booklet_assignments
         (booklet_id, collector_id, assigned_at, returned_at)
       values ($1, $2, '2026-01-01', null)`,
      [bookletId, collectorId],
    );

    await db.query(
      `insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
       values ($1, 1, 'test spoilage', $2)`,
      [bookletId, collectorId],
    );

    // A direct insert, not post_collection(): this test is about sync_pull's own scoping
    // join, not about the ledger's posting rules, and `db` -- the table owner -- can write
    // the rows directly. device_id is a plain not-null FK here (consumed_serials never
    // filters on it), so the section-A device satisfies it without implying anything about
    // scope. A matching collection_lines row is required too: invariant #9's deferred
    // constraint trigger checks that a collection's lines plus allocations sum to its
    // gross_amount -- and, being DEFERRED, it fires at COMMIT, so both inserts must share
    // one explicit transaction rather than `db`'s usual one-statement-per-call autocommit.
    await db.query("begin");
    let collectionId: string;
    try {
      const { rows: collectionRows } = await db.query(
        `insert into ceedo_collections.collections
           (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
            fee_type_id, gross_amount, posted_by)
         values (gen_random_uuid(), 2, $1, $2, $3, now(), current_date, $4, 85.00, $2)
         returning id`,
        [bookletId, collectorId, deviceId, feeTypeId],
      );
      collectionId = collectionRows[0].id as string;
      await db.query(
        `insert into ceedo_collections.collection_lines
           (collection_id, fee_type_id, rate_class, quantity, unit_rate)
         values ($1, $2, 'hog', 1, 85.00)`,
        [collectionId, feeTypeId],
      );
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }

    const result = await pull(deviceId);

    expect(result.booklets.map((b) => b.id)).toContain(bookletId);
    expect(result.booklet_assignments.map((ba) => ba.booklet_id)).toContain(bookletId);
    expect(result.consumed_serials).toContainEqual(
      expect.objectContaining({ booklet_id: bookletId, or_no: 2 }),
    );
    expect(result.spoiled_forms.map((sf) => sf.booklet_id)).toContain(bookletId);

    // Withdraw the collector's area: nothing of theirs is sent on a fresh pull.
    await db.query(
      `update ceedo_collections.collector_assignments set active = false where collector_id = $1`,
      [collectorId],
    );
    const without = await pull(deviceId);

    expect(without.collectors.map((c) => c.id)).not.toContain(collectorId);
    expect(without.booklets.map((b) => b.id)).not.toContain(bookletId);
    expect(without.booklet_assignments.map((ba) => ba.booklet_id)).not.toContain(bookletId);
    expect(without.consumed_serials).not.toContainEqual(
      expect.objectContaining({ booklet_id: bookletId, or_no: 2 }),
    );
    expect(without.spoiled_forms.map((sf) => sf.booklet_id)).not.toContain(bookletId);
  });

  it("succeeds over the real ceedo_app role-switch path, not just as the postgres superuser `db` uses", async () => {
    // Fix round 1. `db` (and therefore every other test in this file, and all 641 tests
    // in this suite) connects as `postgres` -- a superuser. This local Postgres image
    // enforces a guard rejecting an unqualified DELETE or UPDATE for every non-superuser
    // role, and sync_pull's own scope-table clear (`delete from _scope_leases;`, no WHERE)
    // had exactly that shape. A superuser session is exempt from the guard -- even after
    // `set role ceedo_app` -- so no test built on `db` could ever have failed against it.
    // Confirmed directly, before the fix (migration 20260918000037): as postgres, `delete
    // from _scope_leases` succeeds; as ceedo_app reached the way described below, it
    // raises "DELETE requires a WHERE clause".
    //
    // No real caller ever reaches sync_pull as postgres. PostgREST -- and so every Edge
    // Function, and so every device -- logs in as `authenticator` (NOSUPERUSER) and does
    // `SET ROLE ceedo_app` per request, on the strength of migration 0026's `grant
    // ceedo_app to authenticator`. This test is the one in this file that takes that exact
    // path, deliberately not `db`, and asserts a genuinely successful, correctly-scoped
    // pull -- not merely the absence of a thrown error.
    const fx = await createSyncFixture(db);

    // Same host/port/database as `db`; only the login role differs. Local dev only: every
    // built-in role in this stack (postgres, authenticator, ...) shares one password, the
    // same assumption POSTGRES_URL's own default already bakes in.
    const authenticatorUrl = new URL(POSTGRES_URL);
    authenticatorUrl.username = "authenticator";

    const conn = new Client({ connectionString: authenticatorUrl.toString() });
    await conn.connect();
    try {
      await conn.query("set role ceedo_app");
      const { rows } = await conn.query(
        `select ceedo_collections.sync_pull($1::uuid, $2::bigint) as result`,
        [fx.deviceId, 0],
      );
      const result = rows[0].result as Pull;

      expect(result.facilities.map((f) => f.id)).toContain(fx.facilityId);
      expect(result.leases.map((l) => l.id)).toContain(fx.leaseId);
    } finally {
      await conn.end();
    }
  });

  it("sends a collector, and their booklets, when their collection area is added after the device last pulled", async () => {
    // Found in production 2026-09-25: collectors added on the web never reached a tablet
    // that had already synced. The collector's app_users row predated the device's cursor
    // and adding a collection area does not touch it, so `u.row_version > p_cursor` hid
    // them for good. The assignment's own row_version has to open the gate too.
    const fx = await createSyncFixture(db);
    const { userId: lateId } = await createAppUser({
      email: uniqueEmail("late-collector@example.com"),
      role: "collector",
    });
    const { rows: formTypeRows } = await db.query(
      `select id from ceedo_collections.form_types where code = 'OR51'`,
    );
    const { rows: bookletRows } = await db.query(
      `insert into ceedo_collections.booklets
         (form_type_id, serial_prefix, start_no, end_no, received_date)
       values ($1, $2, 1, 50, '2026-01-01') returning id`,
      [formTypeRows[0].id, uniqueCode("LATE-BK")],
    );
    const bookletId = bookletRows[0].id as string;
    await db.query(
      `insert into ceedo_collections.booklet_assignments
         (booklet_id, collector_id, assigned_at, returned_at)
       values ($1, $2, '2026-01-01', null)`,
      [bookletId, lateId],
    );

    const first = await pull(fx.deviceId);
    expect(first.collectors.map((c) => c.id)).not.toContain(lateId);

    await db.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, section_id, active)
       values ($1, $2, null, true)`,
      [lateId, fx.facilityId],
    );

    const delta = await pull(fx.deviceId, Number(first.cursor));
    expect(delta.collectors.map((c) => c.id)).toContain(lateId);
    expect(delta.booklets.map((b) => b.id)).toContain(bookletId);
    expect(delta.booklet_assignments.map((b) => b.booklet_id)).toContain(bookletId);
  });
});
