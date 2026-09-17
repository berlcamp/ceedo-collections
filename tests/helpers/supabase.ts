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

/**
 * Finds the seeded accruing market fee type matching an accrual period (`MKT_DAILY`,
 * `MKT_MONTHLY`), or creates it if it does not exist yet — `weekly` has no seed row, and a
 * `supabase db reset` skipped in a given test run must not be a hard requirement either.
 */
async function ensureAccrualFeeType(db: PgClient, accrualPeriod: string): Promise<string> {
  const code =
    accrualPeriod === "daily" ? "MKT_DAILY" : accrualPeriod === "monthly" ? "MKT_MONTHLY" : "MKT_WEEKLY";
  const { rows } = await db.query(
    "select id from ceedo_collections.fee_types where code = $1",
    [code],
  );
  if (rows.length > 0) return rows[0].id as string;

  const { rows: created } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps)
     values ($1, $2, true, 300)
     returning id`,
    [code, `Market stall rental (${accrualPeriod})`],
  );
  return created[0].id as string;
}

/**
 * Builds a minimal facility -> section -> stall -> tenant -> lease chain plus the matching
 * accruing fee type, over a direct Postgres connection (as table owner, so it works
 * regardless of client-role privileges — every ledger test needs this same chain, which is
 * why it lives here rather than being rebuilt per test file.
 *
 * `db` must already be connected; the caller owns its lifecycle (connect/end).
 */
export async function createLeaseFixture(
  db: PgClient,
  opts: {
    accrualPeriod?: "daily" | "weekly" | "monthly";
    startDate?: string;
    endDate?: string | null;
    dueDay?: number | null;
    // string | number, not just number: a string is the safer way to express an exact
    // decimal for a numeric(14,2) column (no float round-trip through JS), and the Task 5
    // accrual tests already pass amounts this way (e.g. "50.00"). Do not narrow this back
    // to `number` -- pg accepts both and coerces identically, but the string form is the
    // one callers should actually prefer.
    rateAmount?: number | string;
    status?: "active" | "ended" | "terminated";
  } = {},
): Promise<{ leaseId: string; feeTypeId: string; stallId: string; tenantId: string }> {
  const accrualPeriod = opts.accrualPeriod ?? "daily";
  const startDate = opts.startDate ?? "2026-01-01";
  const endDate = opts.endDate ?? null;
  // due_day is required for a monthly lease (leases_monthly_needs_due_day) and constrained
  // to 1-28 (leases.due_day check); irrelevant, so left null, for daily/weekly.
  const dueDay = opts.dueDay ?? (accrualPeriod === "monthly" ? 5 : null);
  const rateAmount = opts.rateAmount ?? 100.0;
  const status = opts.status ?? "active";

  const facilityCode = uniqueCode("LFX");
  const { rows: facilityRows } = await db.query(
    `insert into ceedo_collections.facilities (code, name, type)
     values ($1, $2, 'market') returning id`,
    [facilityCode, `Lease Fixture Market ${facilityCode}`],
  );
  const facilityId = facilityRows[0].id as string;

  const { rows: sectionRows } = await db.query(
    `insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
     values ($1, $2, $3) returning id`,
    [facilityId, `Section ${uniqueCode("SEC")}`, accrualPeriod],
  );
  const sectionId = sectionRows[0].id as string;

  const { rows: stallRows } = await db.query(
    `insert into ceedo_collections.stalls (section_id, stall_no) values ($1, '01') returning id`,
    [sectionId],
  );
  const stallId = stallRows[0].id as string;

  const { rows: tenantRows } = await db.query(
    `insert into ceedo_collections.tenants (full_name) values ($1) returning id`,
    [`Lease Fixture Tenant ${uniqueCode("TEN")}`],
  );
  const tenantId = tenantRows[0].id as string;

  const feeTypeId = await ensureAccrualFeeType(db, accrualPeriod);

  const { rows: leaseRows } = await db.query(
    `insert into ceedo_collections.leases
       (stall_id, tenant_id, start_date, end_date, rate_amount, accrual_period, due_day, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [stallId, tenantId, startDate, endDate, rateAmount, accrualPeriod, dueDay, status],
  );
  const leaseId = leaseRows[0].id as string;

  return { leaseId, feeTypeId, stallId, tenantId };
}

/**
 * Finds the seeded OR51 accountable-form type, or creates it if it does not exist yet —
 * the same guard `ensureAccrualFeeType` applies, for the same reason: a `supabase db
 * reset` skipped in a given test run must not be a hard requirement.
 */
async function ensureFormType(db: PgClient): Promise<string> {
  const { rows } = await db.query(
    "select id from ceedo_collections.form_types where code = 'OR51'",
  );
  if (rows.length > 0) return rows[0].id as string;

  const { rows: created } = await db.query(
    `insert into ceedo_collections.form_types (code, name)
     values ('OR51', 'Official Receipt (Accountable Form 51)')
     returning id`,
  );
  return created[0].id as string;
}

/**
 * The cutover date every Phase 2 test's dates are designed against, and the one
 * `supabase/seed.sql` installs.
 */
export const SEEDED_CUTOVER_DATE = "2026-10-01";

/**
 * The serial range on the booklet `createCollectionFixture` builds, exported so a test
 * picking OR numbers checks itself against the fixture instead of against a comment.
 */
export const FIXTURE_BOOKLET_START_NO = 1000;
export const FIXTURE_BOOKLET_END_NO = 1999;

/**
 * When the fixture booklet was received and handed to its collector. A FIXED date, not
 * `current_date - 30` / `current_date - 7`.
 *
 * post_collection authorises a post by checking that the booklet was assigned to the
 * collector ON THE BUSINESS DATE, and every Phase 2 test posts at a fixed 2026-10-05 --
 * fixed because the suite's real wall-clock date is before the seeded 2026-10-01 cutover,
 * so nothing accrues at `current_date` at all. An assignment dated relative to today
 * therefore walks forward while the collection date stands still, and on 2026-10-13
 * `current_date - 7` would overtake 2026-10-05 and fail every post in
 * post-collection.test.ts with `booklet_not_assigned` -- on a day nobody changed anything,
 * blaming whatever commit happened to land that morning. A fixture that expires is worse
 * than one that is simply wrong, so both dates are literals well before any test's
 * collection date.
 */
export const FIXTURE_BOOKLET_DATE = "2026-01-01";

/**
 * Puts `settings.cutover_date` back to the seeded date, whether or not a row exists.
 *
 * `settings` is a singleton shared by every test file, and `vitest.config.ts` sets
 * `fileParallelism: false`, so whatever one file leaves behind is what the next file
 * starts from. Six files mutate this row; five of them happened to re-insert the seeded
 * date and so restored it by coincidence rather than by design, and the sixth
 * (surcharge.test.ts, which legitimately needs a 2027 cutover) did not — which made the
 * suite pass only on the first run after `supabase db reset` and then fail, on a second
 * run, inside files that never touched settings at all. Every file that mutates it calls
 * this in `afterAll`, so each one leaves the world as it found it.
 *
 * `on conflict ((true))` rather than delete-then-insert: `settings_singleton` is a unique
 * index on the constant expression `(true)`, so a plain insert fails whenever a row
 * already exists, and this infers that index by its expression and updates in place
 * instead. One statement, no window in which the row is missing, and it works from either
 * starting state.
 */
export async function resetCutover(db: PgClient): Promise<void> {
  await db.query(
    `insert into ceedo_collections.settings (cutover_date) values ($1::date)
     on conflict ((true)) do update set cutover_date = excluded.cutover_date`,
    [SEEDED_CUTOVER_DATE],
  );
}

/**
 * Finds the seeded non-accruing per-head fee type (`SLAUGHTER`) and its `hog` rate, or
 * creates both if they do not exist yet — the same guard `ensureAccrualFeeType` and
 * `ensureFormType` apply, for the same reason.
 *
 * Every collection fixture carries this so `post_collection`'s line pricing has something
 * to price: `collection_lines` needs a fee type with a rate class and a rate row, and the
 * accruing market fee type has neither (its rate lives on the lease). The seeded rate is
 * 85.00 per head, but the amount is read back rather than assumed — tests multiply by
 * `perHeadRate`, so a reseed at a different figure changes the expectation with it.
 */
async function ensurePerHeadFeeType(
  db: PgClient,
): Promise<{ feeTypeId: string; rate: string }> {
  const { rows: found } = await db.query(
    "select id from ceedo_collections.fee_types where code = 'SLAUGHTER'",
  );
  const feeTypeId =
    found.length > 0
      ? (found[0].id as string)
      : ((
          await db.query(
            `insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps)
             values ('SLAUGHTER', 'Slaughter fee', false, 0)
             returning id`,
          )
        ).rows[0].id as string);

  // ::text, not a JS number: numeric(14,2) round-tripped through a float is exactly the
  // kind of cent-level drift this ledger exists to avoid.
  const { rows: rateRows } = await db.query(
    `select amount::text as amount from ceedo_collections.rates
      where fee_type_id = $1 and rate_class = 'hog'`,
    [feeTypeId],
  );
  if (rateRows.length > 0) return { feeTypeId, rate: rateRows[0].amount as string };

  const { rows: created } = await db.query(
    `insert into ceedo_collections.rates
       (fee_type_id, rate_class, effective_from, amount, basis)
     values ($1, 'hog', '2026-01-01', 85.00, 'per_head')
     returning amount::text as amount`,
    [feeTypeId],
  );
  return { feeTypeId, rate: created[0].amount as string };
}

/**
 * Builds everything `createLeaseFixture` builds, plus the collector/device/booklet chain
 * every collections test needs: an `app_users` row with role `collector` (the only role
 * `booklet_assignments`' trigger accepts — see migration 0006), a shared `devices` row, a
 * `booklets` row whose 1000-1999 serial range comfortably covers the OR numbers tests use,
 * and a `booklet_assignments` row linking the two with `assigned_at` in the past and
 * `returned_at` null (an open assignment).
 *
 * The collector is inserted straight into `auth.users` (mirroring
 * `createAuthUserWithoutProvider`) rather than through the admin API: nothing here needs
 * the collector to sign in, only to exist as a valid `app_users.id`. A random per-fixture
 * `serial_prefix` (via `uniqueCode`) keeps concurrent fixtures from colliding on
 * `booklets_no_serial_overlap`, which excludes on `(form_type_id, serial_prefix,
 * int4range(start_no, end_no))` — two fixtures sharing a prefix and range would collide,
 * distinct prefixes never do.
 *
 * `db` must already be connected; the caller owns its lifecycle (connect/end), same as
 * `createLeaseFixture`.
 */
export async function createCollectionFixture(
  db: PgClient,
  opts: Parameters<typeof createLeaseFixture>[1] = {},
): Promise<{
  leaseId: string;
  feeTypeId: string;
  collectorId: string;
  deviceId: string;
  bookletId: string;
  stallId: string;
  tenantId: string;
  perHeadFeeTypeId: string;
  perHeadRate: string;
}> {
  const { leaseId, feeTypeId, stallId, tenantId } = await createLeaseFixture(db, opts);
  const perHead = await ensurePerHeadFeeType(db);

  const collectorId = randomUUID();
  const collectorEmail = uniqueEmail("collection-fixture-collector@example.com");
  await db.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, is_sso_user, is_anonymous)
     values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', false, false)`,
    [collectorId, collectorEmail],
  );
  await db.query(
    `insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
     values ($1, $2, $3, 'collector', 'active')`,
    [collectorId, `E-${uniqueCode("CFX")}`, `Collection Fixture Collector ${uniqueCode("CFX")}`],
  );

  const { rows: deviceRows } = await db.query(
    `insert into ceedo_collections.devices (label) values ($1) returning id`,
    [uniqueCode("DEV")],
  );
  const deviceId = deviceRows[0].id as string;

  const formTypeId = await ensureFormType(db);
  const { rows: bookletRows } = await db.query(
    `insert into ceedo_collections.booklets
       (form_type_id, serial_prefix, start_no, end_no, received_date)
     values ($1, $2, $3, $4, $5::date)
     returning id`,
    [
      formTypeId,
      uniqueCode("BK"),
      FIXTURE_BOOKLET_START_NO,
      FIXTURE_BOOKLET_END_NO,
      FIXTURE_BOOKLET_DATE,
    ],
  );
  const bookletId = bookletRows[0].id as string;

  await db.query(
    `insert into ceedo_collections.booklet_assignments
       (booklet_id, collector_id, assigned_at, returned_at)
     values ($1, $2, $3::date, null)`,
    [bookletId, collectorId, FIXTURE_BOOKLET_DATE],
  );

  return {
    leaseId,
    feeTypeId,
    collectorId,
    deviceId,
    bookletId,
    stallId,
    tenantId,
    perHeadFeeTypeId: perHead.feeTypeId,
    perHeadRate: perHead.rate,
  };
}

export type CollectionFixture = Awaited<ReturnType<typeof createCollectionFixture>>;

/**
 * Serial numbers for `postCollectionAsOwner`. Booklets built by `createCollectionFixture`
 * run 1000-1999; this half of the range is left alone by the test files that pick their
 * own OR numbers, so a fixture used both ways does not collide on
 * `collections_serial_spent_once`.
 */
let ownerOrNo = 1500;

/**
 * Fails loudly when a counter walks off the end of the fixture booklet.
 *
 * An OR number outside the booklet's range is not an error the caller sees as one: the
 * engine returns `or_out_of_range`, which is a perfectly valid rejection, so a test file
 * that quietly overran its range would fail with the wrong reason -- or, worse, an
 * `or_out_of_range` test would keep passing for the wrong cause. This turns the overrun
 * into the message that explains it.
 */
export function assertOrNoInFixtureRange(orNo: number): number {
  if (orNo < FIXTURE_BOOKLET_START_NO || orNo > FIXTURE_BOOKLET_END_NO) {
    throw new Error(
      `OR ${orNo} is outside the fixture booklet range ` +
        `${FIXTURE_BOOKLET_START_NO}-${FIXTURE_BOOKLET_END_NO}. ` +
        "Reset the counter per test, or widen the range in createCollectionFixture.",
    );
  }
  return orNo;
}

/**
 * Posts a collection through `post_collection` over the owner connection, and returns the
 * new collection's id.
 *
 * The one way money enters the ledger, so every test that needs a settled charge to exist
 * goes through it rather than inserting rows directly — an inserted row can be shaped in a
 * way the engine would never produce, and a test built on one proves nothing about the
 * system that actually runs.
 *
 * Throws on anything but `accepted`, carrying the reason code: a fixture that silently
 * failed to settle anything makes the test that depends on it fail somewhere else entirely.
 * Tests asserting on rejections call the RPC directly instead.
 *
 * `db` must already be connected; the caller owns its lifecycle.
 */
export async function postCollectionAsOwner(
  db: PgClient,
  fixture: {
    leaseId: string;
    feeTypeId: string;
    collectorId: string;
    deviceId: string;
    bookletId: string;
  },
  opts: {
    groupRanks?: number[];
    orNo?: number;
    id?: string;
    collectedAt?: string;
    leaseId?: string | null;
    feeTypeId?: string;
    lines?: { fee_type_id: string; rate_class?: string; quantity: number }[];
    payerRef?: string;
    notes?: string;
  } = {},
): Promise<string> {
  const groupRanks = opts.groupRanks ?? [1];
  const id = opts.id ?? randomUUID();
  const payload = {
    id,
    or_no: assertOrNoInFixtureRange(opts.orNo ?? ++ownerOrNo),
    booklet_id: fixture.bookletId,
    collector_id: fixture.collectorId,
    device_id: fixture.deviceId,
    // A timestamptz literal with an explicit offset. Never Date#toISOString(): it converts
    // through the runner's local zone, and the business date this resolves to (Asia/Manila)
    // is what the booklet assignment and the rate lookup are checked against.
    collected_at: opts.collectedAt ?? "2026-10-05T02:00:00+00:00",
    fee_type_id: opts.feeTypeId ?? fixture.feeTypeId,
    lease_id: opts.leaseId === undefined ? fixture.leaseId : opts.leaseId,
    payer_ref: opts.payerRef ?? null,
    notes: opts.notes ?? null,
    allocations: groupRanks.map((group_rank) => ({ group_rank })),
    lines: opts.lines ?? [],
  };

  const { rows } = await db.query(
    "select ceedo_collections.post_collection($1::jsonb) as result",
    [JSON.stringify(payload)],
  );
  const result = rows[0].result as {
    status: string;
    collection_id?: string;
    reason?: string;
    detail?: string;
  };
  if (result.status !== "accepted") {
    throw new Error(
      `post_collection did not accept: ${result.status}` +
        `${result.reason ? ` (${result.reason})` : ""}` +
        `${result.detail ? `: ${result.detail}` : ""}`,
    );
  }
  return result.collection_id as string;
}
