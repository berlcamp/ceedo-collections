import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  anonClient,
  createAppUser,
  createSyncFixture,
  serviceClient,
} from "../helpers/supabase";

// A well-formed UUID that matches nothing. See the DELETE probes for why this matters.
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

async function fileException(
  collectionUuid: string = randomUUID(),
  reason = "or_already_used",
): Promise<string> {
  await db.query(
    `insert into ceedo_collections.sync_exceptions
       (collection_uuid, device_id, collector_id, reason_code, payload)
     values ($1, $2, $3, $4, '{}'::jsonb)`,
    [collectionUuid, fx.deviceId, fx.collectorId, reason],
  );
  return collectionUuid;
}

describe("sync_exceptions", () => {
  it("permits one row per collection_uuid", async () => {
    // Load-bearing. §6.4 says a rejected entry STAYS in the device outbox as unresolved, so
    // the device re-pushes it on every sync. Without this constraint, one permanently-
    // rejected receipt breeds a row per sync attempt and buries the queue within a day.
    const uuid = await fileException();
    await expect(fileException(uuid)).rejects.toThrow(/sync_exceptions_collection_uuid_key/);
  });

  it("starts open with one attempt and no resolution", async () => {
    const uuid = await fileException();
    const { rows } = await db.query(
      `select status, attempts, resolution, resolved_by, resolved_at
         from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [uuid],
    );
    expect(rows[0]).toMatchObject({
      status: "open",
      attempts: 1,
      resolution: null,
      resolved_by: null,
      resolved_at: null,
    });
  });

  it("refuses a resolution while the status is open", async () => {
    const uuid = await fileException();
    await expect(
      db.query(
        `update ceedo_collections.sync_exceptions
            set resolution = 'corrected' where collection_uuid = $1`,
        [uuid],
      ),
    ).rejects.toThrow(/sync_exceptions_lifecycle/);
  });

  it("refuses a resolution_reason while the status is open", async () => {
    const uuid = await fileException();
    await expect(
      db.query(
        `update ceedo_collections.sync_exceptions
            set resolution_reason = 'premature' where collection_uuid = $1`,
        [uuid],
      ),
    ).rejects.toThrow(/sync_exceptions_lifecycle/);
  });

  it("refuses resolving without a written reason", async () => {
    // §11.3: "A written reason is mandatory on every resolution." A constraint, not a form
    // validation -- the form is one caller and the RPC is another.
    const uuid = await fileException();
    await expect(
      db.query(
        `update ceedo_collections.sync_exceptions
            set status = 'resolved', resolution = 'corrected',
                resolved_by = $2, resolved_at = now()
          where collection_uuid = $1`,
        [uuid, fx.collectorId],
      ),
    ).rejects.toThrow(/sync_exceptions_lifecycle/);
  });

  it("refuses escalating without a written reason", async () => {
    const uuid = await fileException();
    await expect(
      db.query(
        `update ceedo_collections.sync_exceptions
            set status = 'escalated' where collection_uuid = $1`,
        [uuid],
      ),
    ).rejects.toThrow(/sync_exceptions_lifecycle/);
  });

  it("accepts a complete resolution", async () => {
    const uuid = await fileException();
    await db.query(
      `update ceedo_collections.sync_exceptions
          set status = 'resolved', resolution = 'spoiled',
              resolution_reason = 'Receipt voided at the stall',
              resolved_by = $2, resolved_at = now()
        where collection_uuid = $1`,
      [uuid, fx.collectorId],
    );
    const { rows } = await db.query(
      `select status, resolution from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [uuid],
    );
    expect(rows[0]).toMatchObject({ status: "resolved", resolution: "spoiled" });
  });

  it("treats escalated as still unresolved", async () => {
    // Not a resolution. An exception must not be closeable by declaring it interesting.
    const uuid = await fileException();
    await db.query(
      `update ceedo_collections.sync_exceptions
          set status = 'escalated', resolution_reason = 'Two devices claim OR 1234'
        where collection_uuid = $1`,
      [uuid],
    );
    const { rows } = await db.query(
      `select status, resolution, resolved_at from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [uuid],
    );
    expect(rows[0]).toMatchObject({ status: "escalated", resolution: null, resolved_at: null });
  });

  it("refuses an unknown resolution", async () => {
    const uuid = await fileException();
    await expect(
      db.query(
        `update ceedo_collections.sync_exceptions
            set status = 'resolved', resolution = 'forgiven',
                resolution_reason = 'x', resolved_by = $2, resolved_at = now()
          where collection_uuid = $1`,
        [uuid, fx.collectorId],
      ),
    ).rejects.toThrow(/sync_exceptions_resolution_check/);
  });
});

describe("sync_exceptions privileges", () => {
  it("denies service_role INSERT", async () => {
    const { error } = await serviceClient().from("sync_exceptions").insert({
      collection_uuid: randomUUID(),
      device_id: fx.deviceId,
      collector_id: fx.collectorId,
      reason_code: "or_already_used",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  // STRUCTURAL: real ACL grants only. `information_schema.table_privileges` lists actual
  // grant rows, so it does NOT report Postgres's predefined `pg_write_all_data` role, whose
  // DELETE is a hardcoded ACL bypass in the C code that no REVOKE can affect. An earlier
  // draft of this test introspected `has_table_privilege` over `pg_roles` and could never
  // pass for that reason. Do not reintroduce an exclusion list: the list is the trap, and
  // the next predefined role with the same property silently reopens it.
  it("grants DELETE to no role but the table owner", async () => {
    const { rows } = await db.query(
      `select grantee
         from information_schema.table_privileges
        where table_schema = 'ceedo_collections'
          and table_name = 'sync_exceptions'
          and privilege_type = 'DELETE'
          and grantee <> 'postgres'`,
    );
    expect(rows).toEqual([]);
  });

  // BEHAVIOURAL: the same property through the door a client actually uses, matching
  // `tests/db/ledger-privileges.test.ts`'s idiom. Phase 2's handover (item P5) concluded that
  // a structural and a behavioural check belong side by side: it had a flag whose removal
  // failed zero behavioural tests. The structural test above catches a stray grant to a role
  // PostgREST never routes; these catch the path an attacker actually has.
  //
  // The nil-UUID filter is load-bearing: `.neq("id", "")` fails to cast to uuid (22P02)
  // BEFORE the permission check runs, which would assert the wrong thing entirely.
  it.each(["anon", "authenticated", "service_role"])(
    "denies DELETE to %s over PostgREST",
    async (role) => {
      const client =
        role === "anon"
          ? anonClient()
          : role === "service_role"
            ? serviceClient()
            : (await createAppUser({ email: "sync-exceptions-delete-probe@example.com", role: "supervisor" }))
                .client;

      const { error } = await client.from("sync_exceptions").delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    },
  );
});
