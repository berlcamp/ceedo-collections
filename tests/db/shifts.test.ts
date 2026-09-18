import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, serviceClient } from "../helpers/supabase";

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

  it("denies DELETE to every role", async () => {
    // 'postgres' owns every table in this schema (migrations run as it), so it holds every
    // privilege regardless of grants -- excluded by name, not because it lacks DELETE.
    // 'pg_write_all_data' is a Postgres-predefined role: has_table_privilege() reports it as
    // holding INSERT/UPDATE/DELETE/TRUNCATE on every relation in the cluster as a hardcoded
    // system behaviour, not a normal ACL entry -- confirmed by REVOKE against a scratch table
    // making no difference. No login role is a member of it, so it grants no one anything;
    // excluding it here is not the same mistake as excluding a role that is genuinely
    // reachable. rolsuper covers supabase_admin, the only actual superuser on this instance.
    const { rows } = await db.query(
      `select r.rolname
         from pg_roles r
        where has_table_privilege(r.rolname, 'ceedo_collections.shifts', 'DELETE')
          and r.rolname not in ('postgres', 'supabase_admin', 'pg_write_all_data')
          and not r.rolsuper`,
    );
    expect(rows).toEqual([]);
  });
});
