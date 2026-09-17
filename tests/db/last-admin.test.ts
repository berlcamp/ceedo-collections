import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POSTGRES_URL } from "../helpers/supabase.js";

/**
 * These run inside a transaction that is always rolled back.
 *
 * "Is this the last active administrator" is global state, and vitest runs test files
 * concurrently — other files create admins while these run. Suspending the others inside a
 * transaction is the only way to reach the condition deterministically without making the
 * whole suite serial.
 */
describe("last active administrator", () => {
  let db: Client;

  beforeEach(async () => {
    db = new Client({ connectionString: POSTGRES_URL });
    await db.connect();
    await db.query("begin");
  });

  afterEach(async () => {
    await db.query("rollback");
    await db.end();
  });

  /** Creates an auth user plus an app_users row, inside the open transaction. */
  async function makeStaff(role: string, status = "active"): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (id, instance_id, aud, role, email)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', gen_random_uuid() || '@example.com')
       returning id`,
    );
    const id = rows[0]!.id;
    await db.query(
      `insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
       values ($1::uuid, 'E-' || substr($1::uuid::text, 1, 8), 'Fixture',
               $2::ceedo_collections.app_role, $3::ceedo_collections.user_status)`,
      [id, role, status],
    );
    return id;
  }

  /**
   * Leaves exactly one active admin: the one returned.
   *
   * Create ours FIRST, then suspend the others. The guard fires per row, so suspending every
   * active admin in one statement would hit the guard on the last of them — the condition
   * this helper exists to reach, reached a step too early.
   */
  async function soleAdmin(): Promise<string> {
    const id = await makeStaff("admin");
    await db.query(
      `update ceedo_collections.app_users set status = 'suspended'
       where role = 'admin' and status = 'active' and id <> $1::uuid`,
      [id],
    );
    return id;
  }

  it("refuses to demote the last active administrator", async () => {
    const id = await soleAdmin();
    await expect(
      db.query("update ceedo_collections.app_users set role = 'collector' where id = $1", [id]),
    ).rejects.toThrow(/last active administrator/i);
  });

  it("refuses to suspend the last active administrator", async () => {
    const id = await soleAdmin();
    await expect(
      db.query("update ceedo_collections.app_users set status = 'suspended' where id = $1", [id]),
    ).rejects.toThrow(/last active administrator/i);
  });

  it("refuses to delete the last active administrator", async () => {
    const id = await soleAdmin();
    await expect(
      db.query("delete from ceedo_collections.app_users where id = $1", [id]),
    ).rejects.toThrow(/last active administrator/i);
  });

  it("permits demoting an administrator while another remains", async () => {
    const first = await soleAdmin();
    await makeStaff("admin");
    await expect(
      db.query("update ceedo_collections.app_users set role = 'collector' where id = $1", [first]),
    ).resolves.toBeDefined();
  });

  it("permits suspending a non-administrator when one admin remains", async () => {
    await soleAdmin();
    const collector = await makeStaff("collector");
    await expect(
      db.query("update ceedo_collections.app_users set status = 'suspended' where id = $1", [
        collector,
      ]),
    ).resolves.toBeDefined();
  });

  it("permits editing the last administrator without changing role or status", async () => {
    const id = await soleAdmin();
    await expect(
      db.query("update ceedo_collections.app_users set full_name = 'Renamed' where id = $1", [id]),
    ).resolves.toBeDefined();
  });
});
