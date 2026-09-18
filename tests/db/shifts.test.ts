import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  anonClient,
  createAppUser,
  createSyncFixture,
  serviceClient,
  type TestClient,
} from "../helpers/supabase";

// Well-formed nil UUID rather than `.neq("id", "")`: an empty string fails to cast to
// `uuid` (22P02) before the query ever reaches the permission check, which would assert
// the wrong thing entirely. Mirrors ledger-privileges.test.ts's NIL_UUID exactly.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

let db: Client;
let fx: Awaited<ReturnType<typeof createSyncFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createSyncFixture(db);
});

afterAll(async () => {
  await db.end();
});

async function openShift(
  id = randomUUID(),
  deviceId = fx.deviceId,
): Promise<string> {
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, '2026-10-05'::date, now(), 'open')`,
    [id, fx.collectorId, deviceId],
  );
  return id;
}

describe("shifts", () => {
  it("has no default on id, so the client must generate it", async () => {
    // Idempotency depends on this, exactly as collections.id does: a shift opens offline,
    // before the server has heard of it, and a retried push must not mint a second one.
    const { rows } = await db.query(
      `select column_default
         from information_schema.columns
        where table_schema = 'ceedo_collections'
          and table_name = 'shifts'
          and column_name = 'id'`,
    );
    expect(rows[0].column_default).toBeNull();
  });

  it("permits one open shift per device", async () => {
    const deviceId = (await createSyncFixture(db)).deviceId;
    await openShift(randomUUID(), deviceId);

    await expect(openShift(randomUUID(), deviceId)).rejects.toThrow(
      /shifts_one_open_per_device/,
    );
  });

  it("permits a second shift once the first is closed", async () => {
    const deviceId = (await createSyncFixture(db)).deviceId;
    const first = await openShift(randomUUID(), deviceId);
    await db.query(
      `update ceedo_collections.shifts set status = 'closed', closed_at = now() where id = $1`,
      [first],
    );

    await expect(openShift(randomUUID(), deviceId)).resolves.toBeDefined();
  });

  it("permits open shifts on two different devices at once", async () => {
    const a = (await createSyncFixture(db)).deviceId;
    const b = (await createSyncFixture(db)).deviceId;
    await openShift(randomUUID(), a);
    await expect(openShift(randomUUID(), b)).resolves.toBeDefined();
  });

  it("refuses an unknown status", async () => {
    await expect(
      db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, status)
         values ($1, $2, $3, '2026-10-05'::date, now(), 'finished')`,
        [randomUUID(), fx.collectorId, fx.deviceId],
      ),
    ).rejects.toThrow(/shifts_status_check/);
  });

  it("carries a row_version bumped on insert and on update", async () => {
    const id = await openShift(randomUUID(), (await createSyncFixture(db)).deviceId);
    const { rows: first } = await db.query(
      `select row_version from ceedo_collections.shifts where id = $1`,
      [id],
    );
    expect(Number(first[0].row_version)).toBeGreaterThan(0);

    await db.query(`update ceedo_collections.shifts set status = 'closed' where id = $1`, [id]);
    const { rows: second } = await db.query(
      `select row_version from ceedo_collections.shifts where id = $1`,
      [id],
    );
    expect(Number(second[0].row_version)).toBeGreaterThan(Number(first[0].row_version));
  });
});

describe("shifts privileges", () => {
  it("denies service_role INSERT", async () => {
    // Migration 0001's default privileges grant service_role select+insert on every future
    // table; this only passes because the migration revokes it. Every shift row is written
    // by close_shift() or sync_push(), both SECURITY DEFINER.
    const { error } = await serviceClient().from("shifts").insert({
      id: randomUUID(),
      collector_id: fx.collectorId,
      device_id: fx.deviceId,
      business_date: "2026-10-05",
      opened_at: new Date().toISOString(),
      status: "open",
    });
    expect(error).not.toBeNull();
  });

  // Structural check, alongside the behavioural probes below rather than instead of them
  // (Phase 2 handover item P5: a `security_invoker` flag whose removal passed every
  // behavioural test until a structural one was added). `information_schema.table_privileges`
  // lists only real ACL grant rows, so unlike `has_table_privilege()` over `pg_roles` it
  // never reports a predefined role's built-in bypass (e.g. `pg_write_all_data`, which
  // `has_table_privilege()` reports as holding DELETE on every relation in the cluster as
  // hardcoded behaviour, not a revocable grant -- confirmed by REVOKE against a scratch
  // table making no difference). No exclusion list needed: 'postgres' is the table owner
  // (migrations run as it), and it is the only grantee this query can ever legitimately
  // return.
  it("grants DELETE to no role but the table owner", async () => {
    const { rows } = await db.query(
      `select grantee
         from information_schema.table_privileges
        where table_schema = 'ceedo_collections'
          and table_name = 'shifts'
          and privilege_type = 'DELETE'
          and grantee <> 'postgres'`,
    );
    expect(rows).toEqual([]);
  });

  describe("DELETE probes", () => {
    // A real authenticated session, exactly as ledger-privileges.test.ts uses one: the
    // revoke is a table-level grant, checked against the underlying Postgres role
    // (`authenticated`) before RLS or `has_role()` ever runs, so which app_user role signs
    // in does not matter here -- only that the session is a genuine `authenticated` one.
    let adminClient: TestClient;

    beforeAll(async () => {
      ({ client: adminClient } = await createAppUser({
        email: "shifts-privileges-admin",
        role: "admin",
      }));
    });

    it("anon cannot DELETE", async () => {
      const { error } = await anonClient().from("shifts").delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("authenticated cannot DELETE", async () => {
      const { error } = await adminClient.from("shifts").delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("service_role cannot DELETE", async () => {
      const { error } = await serviceClient().from("shifts").delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });
  });
});
