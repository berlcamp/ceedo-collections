import { Client as PgClient } from "pg";

/**
 * A connection made AS `authenticator`, which then assumes `ceedo_app` -- the exact
 * sequence PostgREST performs on every request.
 *
 * WHY NOT `set role ceedo_app` ON THE EXISTING `postgres` CONNECTION:
 *
 * Phase 3a found two production-blocking bugs that a 641-test green suite could not see,
 * because every SQL test connects as `postgres` and every real caller arrives as
 * `ceedo_app` via `authenticator`. FIVE things exempt that connection, and `set role`
 * reproduces only two of them:
 *
 *   1. object ownership   -- reproduced by `set role`
 *   2. rolbypassrls       -- reproduced by `set role`
 *   3. pg_safeupdate      -- NOT reproduced. `session_preload_libraries` is loaded per
 *                            SESSION for `authenticator` alone (pg_db_role_setting), so a
 *                            `postgres` session never loads the library at all.
 *   4. statement_timeout  -- NOT reproduced. 8s for authenticator, 0 for postgres.
 *   5. lock_timeout       -- NOT reproduced. 8s for authenticator, 0 for postgres.
 *
 * Items 4 and 5 were measured during Phase 3b-i design and are NOT in the Phase 3a
 * handover's list of three. They matter: every real device query runs under an 8-second
 * ceiling that no test in this repo had ever applied.
 *
 * A harness built on `set role` would look like it closed this bug class while leaving
 * three of the five mechanisms unreproduced.
 */
const AUTHENTICATOR_URL =
  process.env.SUPABASE_AUTHENTICATOR_URL ??
  "postgresql://authenticator:postgres@127.0.0.1:54322/postgres";

export async function authenticatorClient(): Promise<PgClient> {
  const client = new PgClient({ connectionString: AUTHENTICATOR_URL });
  await client.connect();
  // PostgREST issues this per request after authenticating the JWT's `role` claim.
  await client.query("set role ceedo_app");
  return client;
}
