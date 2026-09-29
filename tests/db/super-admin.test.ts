import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, type TestClient } from "../helpers/supabase";

/**
 * Migration 0052: wiping the data and loading test data are for an admin on the
 * super_admins allowlist only. The wipe itself is not exercised here: this suite shares one
 * database across files, and emptying it would fail every file that runs after.
 */
let db: Client;
let admin: TestClient;
let supervisor: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  admin = (await createAppUser({ email: "plain-admin@example.com", role: "admin" })).client;
  supervisor = (await createAppUser({ email: "super-sup@example.com", role: "supervisor" })).client;
});

afterAll(async () => {
  await db.end();
});

describe("super admin tools", () => {
  it("treats an admin off the allowlist as no super admin", async () => {
    const { data } = await admin.rpc("is_super_admin");
    expect(data).toBe(false);
  });

  for (const fn of ["clear_all_data", "seed_test_data"] as const) {
    it(`refuses ${fn} to an admin off the allowlist and to other roles`, async () => {
      for (const client of [admin, supervisor]) {
        const { error } = await client.rpc(fn);
        expect(error?.code).toBe("42501");
      }
    });
  }

  it("keeps the allowlist out of every client's reach", async () => {
    const { error } = await admin.from("super_admins" as never).select("*");
    expect(error?.code).toBe("42501");
    const { rows } = await db.query(
      `select has_table_privilege('service_role', 'ceedo_collections.super_admins', 'INSERT') as insert_priv`,
    );
    expect(rows[0]).toEqual({ insert_priv: false });
  });
});
