import { randomUUID } from "node:crypto";
import type { Role } from "@ceedo/shared";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

/**
 * Local Supabase connection details. `supabase status -o env` prints these;
 * CI exports them before running the suite.
 */
// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY. Accept those
// as well as SUPABASE_-prefixed names so `eval $(supabase status -o env)` just works
// locally while CI and hosted environments can use the explicit names.
const URL = process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY ?? "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Supabase keys are not set. Start the local stack and export them:\n" +
      "  supabase start && eval $(supabase status -o env)",
  );
}

const SCHEMA = "ceedo_collections";
// `supabase status -o env` also emits DB_URL, the direct Postgres connection used only by
// createGoogleAuthUser below (see its doc comment for why).
const PG_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * The direct Postgres connection string. Exported for tests that must run inside a
 * transaction they can roll back — the only way to assert on global state (such as "is this
 * the last active administrator") while other test files are concurrently creating users.
 */
export const POSTGRES_URL = PG_URL;

/** Bypasses RLS. Used only for fixtures and assertions, never to test policy behaviour. */
export function serviceClient() {
  return createClient(URL, SERVICE_KEY, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** An unauthenticated client. */
export function anonClient() {
  return createClient(URL, ANON_KEY, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The client type, inferred rather than annotated. A bare `SupabaseClient` defaults its
 * schema generic to "public" and will not accept a client built with
 * `db: { schema: "ceedo_collections" }` under exactOptionalPropertyTypes.
 */
export type TestClient = ReturnType<typeof anonClient>;

const PASSWORD = "test-password-not-a-secret";

export async function signIn(email: string): Promise<TestClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

/**
 * Makes a fixture email collision-proof by tagging its local part.
 *
 * Nothing clears `auth.users` between runs — it is shared GoTrue state on a shared
 * Supabase project, and test files run concurrently against the same `app_users`
 * table, so no file may delete rows another file depends on either. Without this,
 * running any suite a second time without `supabase db reset` fails on "email
 * already registered", and every task from 5 onward uses fixed fixture addresses.
 * Tests never assert on the address itself, only on the client and id that come back.
 */
export function uniqueEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local}+${randomUUID().slice(0, 8)}@${domain}`;
}

/**
 * Makes a fixture facility or fee-type code collision-proof.
 *
 * Nothing clears master data between runs, so re-running a suite without
 * `supabase db reset` collides on fixed codes with a unique violation. That fails loudly
 * rather than silently, but it has twice been mistaken for a real failure while debugging
 * something else. Tests never assert on the code itself.
 */
export function uniqueCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * The admin API's own default `raw_app_meta_data` is `{"provider": "email", "providers":
 * ["email"]}` (confirmed by inspection) — a real non-Google identity, which is what makes
 * this usable to test `ceedo_collections.claim_staff_invite()`'s provider gate from the
 * refusing side. It is NOT usable to construct a "google" identity for that trigger: see
 * `createGoogleAuthUser` below for why, and for the one that is.
 */
async function createAuthUser(email: string): Promise<string> {
  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create auth user ${email}: ${error.message}`);
  return data.user.id;
}

/**
 * Inserts an `auth.users` row directly via Postgres, with `raw_app_meta_data` already set
 * to `{"provider": "google", "providers": ["google"]}` in the same INSERT statement — the
 * only reliable way found to construct a row shaped like a genuine external-OAuth sign-in
 * for testing `claim_staff_invite()`'s `AFTER INSERT` provider check.
 *
 * `admin.auth.admin.createUser({ app_metadata: { provider: "google", ... } })` does NOT
 * do this: proven by attaching a temporary debug trigger (`AFTER INSERT ON auth.users`,
 * logging `NEW.raw_app_meta_data` to a scratch table, removed after use) that captured
 * `{"provider": "email", ...}` for BOTH a default-created row and one created with an
 * explicit "google" `app_metadata` override. GoTrue's admin handler inserts the row with
 * its own default metadata first and patches any caller-supplied override in afterward, as
 * a separate statement — invisible to a trigger on the original INSERT. There is no
 * supabase-js path around this (PostgREST does not expose the `auth` schema at all), so
 * this talks to Postgres directly instead — the one thing in this test suite that does.
 *
 * This could not be checked against a genuine Google sign-in (no OAuth credentials exist
 * for this project yet); it constructs the most faithful row obtainable locally, using
 * the exact `instance_id`/`aud`/`role` values a real GoTrue-created row has. No password
 * is set, so the returned identity cannot sign in — tests use `serviceClient()` to inspect
 * its effects instead.
 */
export async function createGoogleAuthUser(email: string): Promise<string> {
  const client = new PgClient({ connectionString: PG_URL });
  await client.connect();
  try {
    const id = randomUUID();
    await client.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, is_sso_user, is_anonymous)
       values
         ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
          '{"provider": "google", "providers": ["google"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', false, false)`,
      [id, email],
    );
    return id;
  } finally {
    await client.end();
  }
}

/**
 * Inserts an `auth.users` row with `raw_app_meta_data = '{}'` — no `provider` key at all —
 * reproducing the *intermediate* state of the confirmed two-step pattern documented on
 * `createGoogleAuthUser`: an initial INSERT with no meaningful metadata, followed by a
 * separate UPDATE (see `setAuthUserProvider`) that patches it in. `claim_staff_invite()`
 * now fires on both statements (`after insert or update of raw_app_meta_data`) precisely
 * so that whichever one actually carries the provider still triggers a claim.
 */
export async function createAuthUserWithoutProvider(email: string): Promise<string> {
  const client = new PgClient({ connectionString: PG_URL });
  await client.connect();
  try {
    const id = randomUUID();
    await client.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, is_sso_user, is_anonymous)
       values
         ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
          '{}'::jsonb, '{}'::jsonb, now(), now(),
          '', false, false)`,
      [id, email],
    );
    return id;
  } finally {
    await client.end();
  }
}

/**
 * Sets `raw_app_meta_data` on an existing `auth.users` row in its own, separate UPDATE
 * statement — this is exactly the statement the trigger's `update of raw_app_meta_data`
 * clause exists to catch, and pairs with `createAuthUserWithoutProvider` to reproduce the
 * two-step pattern end to end.
 */
export async function setAuthUserProvider(userId: string, provider: string): Promise<void> {
  const client = new PgClient({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query(
      `update auth.users
         set raw_app_meta_data = jsonb_build_object('provider', $2::text, 'providers', jsonb_build_array($2::text))
       where id = $1`,
      [userId, provider],
    );
  } finally {
    await client.end();
  }
}

/** A registered user: an auth.users record plus the app_users row that grants access. */
export async function createAppUser(opts: {
  email: string;
  role: Role;
  employeeNo?: string;
  fullName?: string;
}): Promise<{ client: TestClient; userId: string }> {
  const email = uniqueEmail(opts.email);
  const userId = await createAuthUser(email);
  const { error } = await serviceClient().from("app_users").insert({
    id: userId,
    employee_no: opts.employeeNo ?? `E-${randomUUID().slice(0, 8)}`,
    full_name: opts.fullName ?? opts.email,
    role: opts.role,
    status: "active",
  });
  if (error) throw new Error(`Could not create app_user: ${error.message}`);
  return { client: await signIn(email), userId };
}

/** Authenticated against the shared Supabase project but NOT registered in this system. */
export async function createOutsiderClient(): Promise<TestClient> {
  const email = `outsider-${randomUUID().slice(0, 8)}@example.com`;
  await createAuthUser(email);
  return signIn(email);
}

/**
 * Creates an `auth.users` row for an exact, caller-chosen email (as the admin API's own
 * default "email" provider — see `createAuthUser`) and signs in as it. Unlike
 * `createAppUser` and `createOutsiderClient`, this never touches `app_users` itself —
 * used to test the `staff_invites` claim trigger's email matching (including case) and,
 * being a non-Google identity, its provider gate from the refusing side.
 */
export async function createUnregisteredAuthUser(
  email: string,
): Promise<{ userId: string; client: TestClient }> {
  const userId = await createAuthUser(email);
  const client = await signIn(email);
  return { userId, client };
}
