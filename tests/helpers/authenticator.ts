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
/**
 * DERIVED FROM `DB_URL`, NOT HARDCODED.
 *
 * This read the literal `127.0.0.1:54322` — the Supabase DEFAULT port — while this
 * project declares 56322 in `supabase/config.toml`, because more than one stack runs on
 * the development machine. Nothing ever sets `SUPABASE_AUTHENTICATOR_URL`:
 * `supabase status -o env` does not emit it, and neither does CI. So the fallback was the
 * only value that ever applied, and it pointed at ANOTHER PROJECT'S POSTGRES.
 *
 * It failed loudly rather than silently, which is the one mercy here — `role "ceedo_app"
 * does not exist`, because that role belongs to this project and not to whatever answers
 * on 54322. But it read as a schema or migration defect, and the two files that use this
 * helper (`first-sync-budget`, `role-exemptions`) failed on every local run for a reason
 * that had nothing to do with either.
 *
 * Deriving the URL from the same `DB_URL` that `supabase.ts` already reads means the port
 * can never drift from the project's own config again: `eval $(supabase status -o env)`
 * now configures both helpers from one value. Only the role changes — `authenticator` is
 * the login PostgREST uses, and its password is fixed at `postgres` by the local stack.
 *
 * Same class as `5d69970`, where the port change missed both env examples and cost a real
 * sign-in. This is the last copy of that default in the repo.
 */
function asAuthenticator(dbUrl: string): string {
  try {
    const url = new URL(dbUrl);
    url.username = "authenticator";
    url.password = "postgres";
    return url.toString();
  } catch {
    // A malformed DB_URL is the caller's problem to see, not ours to paper over: hand it
    // back untouched so `pg` reports it rather than this helper swallowing it.
    return dbUrl;
  }
}

const AUTHENTICATOR_URL =
  process.env.SUPABASE_AUTHENTICATOR_URL ??
  asAuthenticator(
    process.env.SUPABASE_DB_URL ??
      process.env.DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
  );

export async function authenticatorClient(): Promise<PgClient> {
  const client = new PgClient({ connectionString: AUTHENTICATOR_URL });
  await client.connect();
  // PostgREST issues this per request after authenticating the JWT's `role` claim.
  await client.query("set role ceedo_app");
  return client;
}
