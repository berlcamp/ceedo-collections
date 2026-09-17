import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, createAppUser, serviceClient, type TestClient } from "../helpers/supabase.js";

/**
 * The test that guards the entire COA position.
 *
 * Every other test in Phase 2 checks that the ledger computes the right answer. This one
 * checks that nobody can change the answer after the fact -- which is the property the
 * append-only argument actually rests on. If this file goes red, stop and fix it before
 * anything else: a passing suite with this test failing describes a system that merely
 * happens to be correct today.
 *
 * The 42501 assertions below were confirmed by direct observation against the local stack
 * (not assumed from the brief): an empty `.insert({})` payload against `charges` fails on
 * the GRANT check itself -- Postgres checks table-level privileges before it ever gets to
 * evaluating column defaults or NOT NULL constraints -- so every case here surfaces as
 * "permission denied for table charges" / "permission denied for schema ceedo_collections",
 * both SQLSTATE 42501, well before RLS or the empty payload's shape ever come into play.
 *
 * The UPDATE/DELETE filters use a well-formed nil UUID rather than `.neq("id", "")`: an
 * empty string fails to cast to `uuid` (22P02, "invalid input syntax for type uuid") before
 * the query ever reaches the permission check, which would assert the wrong thing entirely
 * -- also confirmed by direct observation, not assumed.
 */
const LEDGER_TABLES = ["charges"] as const;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

describe("ledger tables refuse mutation", () => {
  let adminClient: TestClient;

  beforeAll(async () => {
    ({ client: adminClient } = await createAppUser({
      email: "ledger-privileges-admin",
      role: "admin",
    }));
  });

  for (const table of LEDGER_TABLES) {
    it(`${table}: authenticated cannot INSERT`, async () => {
      const { error } = await adminClient.from(table).insert({});
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501"); // insufficient_privilege
    });

    it(`${table}: authenticated cannot UPDATE`, async () => {
      const { error } = await adminClient.from(table).update({ amount: 1 }).neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: authenticated cannot DELETE`, async () => {
      const { error } = await adminClient.from(table).delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot INSERT`, async () => {
      const { error } = await serviceClient().from(table).insert({});
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot UPDATE`, async () => {
      const { error } = await serviceClient().from(table).update({ amount: 1 }).neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot DELETE`, async () => {
      const { error } = await serviceClient().from(table).delete().neq("id", NIL_UUID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: anon reads nothing`, async () => {
      const { data, error } = await anonClient().from(table).select("id");
      expect(error === null ? data : []).toEqual([]);
    });
  }
});
