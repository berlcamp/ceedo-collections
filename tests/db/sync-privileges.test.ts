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

  it("holds no privilege on any relation in the schema", async () => {
    // relkind was 'r','v' only, which is every relation this schema happens to contain
    // TODAY. A stray grant on a materialized view, a partitioned table or a foreign table
    // would have sailed past — and the reporting views (migration 0024) are exactly the
    // sort of thing that becomes a matview the first time one of them is slow. The kinds
    // are enumerated rather than left open so the next kind added to Postgres is a
    // deliberate decision, not a silent hole.
    //
    //   r = ordinary table   p = partitioned table   f = foreign table
    //   v = view             m = materialized view
    const { rows } = await db.query(
      `select c.relname, c.relkind, priv.p
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv(p)
        where n.nspname = 'ceedo_collections'
          and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and has_table_privilege('ceedo_app', c.oid, priv.p)`,
    );
    expect(rows).toEqual([]);
  });

  it("holds USAGE and SELECT on exactly two sequences, and UPDATE on none", async () => {
    // "No privilege on any table" is true and is NOT the whole story. Migration 0001's
    // `alter default privileges ... grant usage, select on sequences ... to ceedo_app`,
    // plus an explicit grant on `row_version_seq` (which predates it), give ceedo_app read
    // access to two sequences. Reading a counter is not reading a row, so this does not
    // weaken the "a leaked ceedo_app token reads no data" position — but it is a standing
    // grant, so it is pinned by name rather than left as an unstated exception.
    //
    // The default privilege applies to every sequence created in this schema from now on,
    // so a new sequence inherits it silently. That is precisely why this list is exact:
    // adding one has to be a decision someone writes down here.
    const { rows } = await db.query(
      `select c.relname,
              has_sequence_privilege('ceedo_app', c.oid, 'USAGE')  as usage_priv,
              has_sequence_privilege('ceedo_app', c.oid, 'SELECT') as select_priv,
              has_sequence_privilege('ceedo_app', c.oid, 'UPDATE') as update_priv
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ceedo_collections'
          and c.relkind = 'S'
          and (has_sequence_privilege('ceedo_app', c.oid, 'USAGE')
            or has_sequence_privilege('ceedo_app', c.oid, 'SELECT')
            or has_sequence_privilege('ceedo_app', c.oid, 'UPDATE'))
        order by c.relname`,
    );

    expect(rows).toEqual([
      { relname: "audit_log_id_seq", usage_priv: true, select_priv: true, update_priv: false },
      { relname: "row_version_seq", usage_priv: true, select_priv: true, update_priv: false },
    ]);
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
