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
    // settings.id is a generated uuid (not the boolean the single-row trick usually uses:
    // a real uuid is what lets write_audit() audit this table unmodified). The singleton
    // is enforced by settings_singleton, a unique index on the constant expression
    // `(true)`, so a second row collides on that index regardless of its own id.
    await expect(
      db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-11-01')"),
    ).rejects.toThrow(/settings_singleton/);
  });

  it("refuses a second row regardless of the id supplied", async () => {
    // Same guarantee, from the other direction: since id is a generated uuid rather than a
    // fixed sentinel, a caller could supply any distinct id and get past a primary-key
    // check alone. settings_singleton refuses it anyway.
    await expect(
      db.query(
        "insert into ceedo_collections.settings (id, cutover_date) values (gen_random_uuid(), '2026-11-01')",
      ),
    ).rejects.toThrow(/settings_singleton/);
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
    // PostgREST refuses an UPDATE with no WHERE clause at all ("UPDATE requires a WHERE
    // clause", confirmed by direct observation) -- id is a generated uuid the client
    // never sees up front, so it is fetched via a SELECT (settings_read permits it for
    // accounting) and used as the filter, as a real caller would.
    const { data: current } = await client.from("settings").select("id").single();

    // RLS filters rather than errors here: settings_admin_write's USING clause makes the
    // row invisible to an UPDATE from a non-admin, and with 0 candidate rows Postgres
    // reports success with nothing affected rather than a permission-denied error --
    // confirmed by direct observation against the local stack (error came back null).
    // The grant is genuinely held (`grant ... update on settings to authenticated`), so an
    // error is never the right assertion here; the absence of any affected row is.
    const { data, error } = await client
      .from("settings")
      .update({ cutover_date: "2020-01-01" })
      .eq("id", current!.id)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { rows } = await db.query("select cutover_date::text as d from ceedo_collections.settings");
    expect(rows[0].d).not.toBe("2020-01-01");
  });

  it("an admin can change the cutover date", async () => {
    const { client } = await createAppUser({ email: "admin", role: "admin" });
    const { data: current } = await client.from("settings").select("id").single();
    const { error } = await client
      .from("settings")
      .update({ cutover_date: "2026-10-02" })
      .eq("id", current!.id);
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
