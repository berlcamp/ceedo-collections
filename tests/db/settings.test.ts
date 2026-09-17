import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser } from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  // This is the one file permitted to delete/mutate the singleton settings row (it owns
  // testing that behaviour). Every other file, and local development, expects the fixed
  // seeded cutover date, so restore it here regardless of what the tests above left behind.
  await db.query("delete from ceedo_collections.settings");
  await db.query(
    "insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')",
  );
  await db.end();
});

describe("settings holds exactly one row", () => {
  it("refuses a second row", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')",
    );
    await expect(
      db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-11-01')"),
    ).rejects.toThrow(/settings_pkey/);
  });

  it("refuses a row with id false", async () => {
    await expect(
      db.query(
        "insert into ceedo_collections.settings (id, cutover_date) values (false, '2026-11-01')",
      ),
    ).rejects.toThrow(/settings_id_check/);
  });
});

describe("cutover_date()", () => {
  it("fails loudly rather than returning null when unconfigured", async () => {
    await db.query("delete from ceedo_collections.settings");
    await expect(db.query("select ceedo_collections.cutover_date()")).rejects.toThrow(
      /No cutover date configured/,
    );
  });

  it("returns the configured date", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')",
    );
    // Cast to text in SQL rather than reading back a JS Date and calling toISOString():
    // node-postgres parses `date` into a JS Date at LOCAL midnight, and toISOString()
    // then renders it in UTC, which rolls the date back a day in any zone ahead of UTC
    // (observed directly in this environment, Asia/Manila, UTC+8: '2026-10-01' came back
    // as '2026-09-30'). Casting in SQL sidesteps the client-timezone conversion entirely.
    const { rows } = await db.query("select ceedo_collections.cutover_date()::text as d");
    expect(rows[0].d).toBe("2026-10-01");
  });
});

describe("settings access control", () => {
  it("a non-admin cannot change the cutover date", async () => {
    const { client } = await createAppUser({ email: "accounting", role: "accounting" });
    // RLS filters rather than errors here: settings_admin_write's USING clause makes the
    // row invisible to an UPDATE from a non-admin, and with 0 candidate rows Postgres
    // reports success with nothing affected rather than a permission-denied error --
    // confirmed by direct observation against the local stack (error came back null).
    // The grant is genuinely held (`grant ... update on settings to authenticated`), so an
    // error is never the right assertion here; the absence of any affected row is.
    const { data, error } = await client
      .from("settings")
      .update({ cutover_date: "2020-01-01" })
      .eq("id", true)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { rows } = await db.query(
      "select cutover_date::text as d from ceedo_collections.settings where id",
    );
    expect(rows[0].d).not.toBe("2020-01-01");
  });

  it("an admin can change the cutover date", async () => {
    const { client } = await createAppUser({ email: "admin", role: "admin" });
    const { error } = await client
      .from("settings")
      .update({ cutover_date: "2026-10-02" })
      .eq("id", true);
    expect(error).toBeNull();
  });

  it("records the change in the audit log", async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'settings' and action = 'update'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
