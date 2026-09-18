import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, serviceClient } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("ceedo_app", () => {
  it("holds EXECUTE on exactly four functions", async () => {
    // Invariant 26. The role is a key to four doors and holds no table privilege of its
    // own, so a compromised ceedo_app JWT can call four functions -- each with its own
    // internal authorization -- and read no table directly.
    const { rows } = await db.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'ceedo_collections'
          and has_function_privilege('ceedo_app', p.oid, 'execute')
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "authenticate_device",
      "close_shift",
      "sync_pull",
      "sync_push",
    ]);
  });

  it("holds no privilege on any table or view in the schema", async () => {
    const { rows } = await db.query(
      `select c.relname, priv.p
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv(p)
        where n.nspname = 'ceedo_collections'
          and c.relkind in ('r', 'v')
          and has_table_privilege('ceedo_app', c.oid, priv.p)`,
    );
    expect(rows).toEqual([]);
  });

  it("cannot execute post_collection directly", async () => {
    const { rows } = await db.query(
      `select has_function_privilege(
                'ceedo_app',
                'ceedo_collections.post_collection(jsonb)', 'execute') as ok`,
    );
    expect(rows[0].ok).toBe(false);
  });

  it("is granted to authenticator", async () => {
    const { rows } = await db.query(
      `select pg_has_role('authenticator', 'ceedo_app', 'member') as ok`,
    );
    expect(rows[0].ok).toBe(true);
  });
});

describe("post_collection reachability", () => {
  it("is no longer callable by service_role", async () => {
    // Phase 2 granted this so integration tests could reach it through PostgREST. Once the
    // sync path exists, nothing outside it should be able to settle a collection.
    const { rows } = await db.query(
      `select has_function_privilege(
                'service_role',
                'ceedo_collections.post_collection(jsonb)', 'execute') as ok`,
    );
    expect(rows[0].ok).toBe(false);
  });

  it("is refused over PostgREST as service_role", async () => {
    const { error } = await serviceClient().rpc("post_collection", { p_payload: {} });
    expect(error).not.toBeNull();
  });
});
