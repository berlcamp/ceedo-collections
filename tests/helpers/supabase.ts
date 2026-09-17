import { randomUUID } from "node:crypto";
import type { Role } from "@ceedo/shared";
import { createClient } from "@supabase/supabase-js";

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

async function signIn(email: string): Promise<TestClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

/**
 * Makes a fixture email collision-proof by tagging its local part.
 *
 * `resetFixtures` can clear `app_users`, but it cannot clear `auth.users` — that is
 * shared GoTrue state on a shared Supabase project. Without this, running any suite a
 * second time without `supabase db reset` fails on "email already registered", and
 * every task from 5 onward uses fixed fixture addresses. Tests never assert on the
 * address itself, only on the client and id that come back.
 */
function uniqueEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local}+${randomUUID().slice(0, 8)}@${domain}`;
}

/**
 * Makes a fixture facility or fee-type code collision-proof.
 *
 * resetFixtures() clears app_users but not master data, so re-running a suite without
 * `supabase db reset` collides on fixed codes with a unique violation. That fails loudly
 * rather than silently, but it has twice been mistaken for a real failure while debugging
 * something else. Tests never assert on the code itself.
 */
export function uniqueCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

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

/** Clears fixture data between suites. Order matters: children before parents. */
export async function resetFixtures(): Promise<void> {
  const client = serviceClient();
  for (const table of ["app_users"]) {
    await client.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }
}
