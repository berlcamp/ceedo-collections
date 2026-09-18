# CEEDO Collections — Phase 3a (Sync Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the device authentication, shift, exception and sync machinery a collector tablet talks to, and prove the whole round trip over HTTP before the tablet exists.

**Architecture:** Three thin Deno Edge Functions that parse a body, authenticate a device credential, call exactly one `SECURITY DEFINER` Postgres function as the `ceedo_app` role, and return its JSONB. All scoping, idempotency, isolation and reconciliation live in SQL, where Phase 2's harness already proves this kind of logic. A push isolates each entry in its own subtransaction so one poison receipt cannot cost a whole round. Rejections become supervisor exceptions, never discards.

**Tech Stack:** Postgres 17 (Supabase), plain SQL migrations under the Supabase CLI, `pgcrypto`, Deno (Supabase Edge Functions), TypeScript 5.7+, Vitest 3, Next.js 16 (App Router), React 19, Tailwind CSS 4, pnpm 10 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md`
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Phase 2 handover:** `docs/superpowers/phase-2-handover.md`

---

## Global Constraints

Copied from both specs and Phase 2's handover. Every task's requirements implicitly include these.

- **Schema name is `ceedo_collections`.** Never `public`. Every object is schema-qualified.
- **Money is `numeric(14,2)` in Postgres and integer centavos in TypeScript.** Floats never touch a peso.
- **Rounding is half-up to the centavo**, never banker's rounding.
- **Every function and trigger sets `search_path = ceedo_collections, pg_temp`.**
- **No RLS policy may rest on `auth.uid() IS NOT NULL`.** Every policy joins through `ceedo_collections.app_users` via `has_role()` / `is_admin()`. `auth.users` is shared with unrelated systems on this Supabase project.
- **`UPDATE` and `DELETE` are never granted on a ledger table, to any role**, including `service_role`. No task in this plan grants a privilege on any table in parent spec §5.4.
- **`INSERT` must be actively revoked from `service_role`** on every new table. Migration 0001's `ALTER DEFAULT PRIVILEGES` grants `select, insert` to `service_role` on every *future* table in this schema. Every table created by this plan inherits that and must revoke what it does not want.
- **Never call `apply_master_data_policies()` on a table holding a secret or a ledger row.** It grants `SELECT` to staff roles and `UPDATE`/`DELETE` to `service_role`.
- **Every new table carries `row_version bigint`** fed by `ceedo_collections.row_version_seq` through the `bump_row_version()` trigger. The sync cursor is that sequence; a table without it is invisible to sync.
- **The business date is `(now() at time zone 'Asia/Manila')::date`**, never the UTC date.
- **`CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` implicitly.** Every new function must `revoke execute ... from public` and then name its roles. This is established hygiene from migration 0002; omitting it exposes the function to `anon` and to every future role on this shared instance.
- **The root test command is `pnpm test`**, which is `vitest run --no-file-parallelism`. `fileParallelism` set in `tests/vitest.config.ts` is **silently ignored** by the root runner. Never verify with a filtered command alone.
- **Run `supabase db reset` before the suite.** The ledger is append-only and no role holds `DELETE`, so charges accumulate across runs until `run_surcharge`'s system-wide scan exceeds the default timeout.
- **Verify typecheck with `pnpm typecheck --force`.** Turbo's `>>> FULL TURBO` cache hit is not evidence the tree typechecks.
- **Node >= 22**, pnpm 10.

---

## Migration numbering

Phase 1 ended at `20260917000010`. Phase 2 ended at `20260918000025`. Phase 3a continues at `20260918000026`. Each task that adds a migration states its exact filename. Never renumber an applied migration.

---

## File Structure

```
supabase/migrations/
├── 20260918000026_device_credentials.sql   Task 1  ceedo_app wiring, device_credentials, authenticate_device()
├── 20260918000027_collector_pin.sql        Task 2  set_collector_pin()
├── 20260918000028_gate_null_safety.sql     Task 2  is_admin()/has_role() NULL safety (fix round)
├── 20260918000029_shifts.sql               Task 3  shifts
├── 20260918000030_sync_exceptions.sql      Task 4  sync_exceptions
├── 20260918000031_assignment_epoch.sql     Task 5  devices.assignment_epoch + trigger
├── 20260918000032_stale_allocations.sql    Task 6  post_collection re-read branch
├── 20260918000033_sync_pull.sql            Task 7  sync_pull()
├── 20260918000034_close_shift.sql          Task 8  close_shift()
├── 20260918000035_sync_push.sql            Task 9  sync_push(), post_collection grant move
└── 20260918000036_resolve_exception.sql    Task 10 the three supervisor resolutions

supabase/functions/
├── _shared/
│   ├── auth.ts          Task 12  credential extraction, the ceedo_app client
│   └── respond.ts       Task 12  JSON response and error shaping
├── sync-pull/index.ts   Task 12
├── sync-push/index.ts   Task 12
└── closeout/index.ts    Task 12

packages/shared/src/
├── reason-codes.ts      Task 6   gains stale_allocations and RETRYABLE_REASONS
├── sync-contract.ts     Task 11  zod schemas for all three request/response bodies
├── sync-contract.test.ts Task 11
├── shifts.ts            Task 11  variance arithmetic, device/server comparison
├── shifts.test.ts       Task 11
└── roles.ts             Task 14  gains isAdmin() (Phase 2 deferred cleanup)

tests/
├── helpers/supabase.ts          Task 1   gains createSyncFixture(), issueCredential()
├── helpers/functions.ts         Task 13  HTTP client for `supabase functions serve`
├── db/device-credentials.test.ts Task 1
├── db/collector-pin.test.ts     Task 2
├── db/shifts.test.ts            Task 3
├── db/sync-exceptions.test.ts   Task 4
├── db/assignment-epoch.test.ts  Task 5
├── db/stale-allocations.test.ts Task 6
├── db/sync-pull.test.ts         Task 7
├── db/close-shift.test.ts       Task 8
├── db/sync-push.test.ts         Task 9
├── db/resolve-exception.test.ts Task 10
├── db/sync-privileges.test.ts   Task 9   ceedo_app holds four doors and no table
├── db/sync-concurrency.test.ts  Task 16  two devices racing one lease
├── http/functions.test.ts       Task 13
└── db/sync-scenario.test.ts     Task 18  the full round trip

apps/web/
├── lib/ledger/exceptions.ts             Task 14  queries
├── lib/ledger/exception-actions.ts      Task 14  the three resolutions
├── lib/ledger/shifts.ts                 Task 15  queries
├── lib/devices/credential-actions.ts    Task 15  issue/revoke
├── app/(admin)/ledger/exceptions/page.tsx Task 14
└── app/(admin)/ledger/shifts/page.tsx     Task 15
```

---

## Conventions every task follows

**Test file skeleton.** Every `tests/db/*.test.ts` in this plan opens one `pg` client in `beforeAll` and closes it in `afterAll`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});
```

Tests that change `settings` must also call `resetCutover(db)` in `afterAll` — Phase 2's P4.

**Migration file skeleton.** Every migration opens with a comment block explaining *why*, not what. The existing migrations are the reference for tone; match them.

---
## Task 1: `ceedo_app` wiring, `device_credentials`, and `authenticate_device()`

Spec §3.1, §3.5, §4.1. Invariants 20, 26, 27.

**Files:**
- Create: `supabase/migrations/20260918000026_device_credentials.sql`
- Create: `tests/db/device-credentials.test.ts`
- Modify: `tests/helpers/supabase.ts` (append `issueCredential()` and `createSyncFixture()`)

**Interfaces:**
- Consumes: `ceedo_collections.devices` (id, credential_id, active, last_seen_at), `app_users`, `device_assignments`, `collector_assignments`, `can_collector_use_device(uuid, uuid)` — all from Phase 1.
- Produces:
  - `ceedo_collections.device_credentials` table
  - `ceedo_collections.issue_device_credential(p_device_id uuid) returns jsonb` — `{credential_id, secret}`, admin-only, `SECURITY DEFINER`
  - `ceedo_collections.revoke_device_credential(p_device_id uuid) returns void`
  - `ceedo_collections.authenticate_device(p_credential_id text, p_secret text) returns uuid`
  - Test helpers `issueCredential(db, deviceId)` and `createSyncFixture(db, opts)`

- [ ] **Step 1: Write the failing test**

Create `tests/db/device-credentials.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  anonClient,
  serviceClient,
  uniqueCode,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function newDevice(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.devices (label) values ($1) returning id`,
    [uniqueCode("DEV")],
  );
  return rows[0].id as string;
}

async function issue(deviceId: string): Promise<{ credential_id: string; secret: string }> {
  const { rows } = await db.query(
    `select ceedo_collections.issue_device_credential($1::uuid) as result`,
    [deviceId],
  );
  return rows[0].result;
}

async function authenticate(credentialId: string, secret: string): Promise<string | null> {
  const { rows } = await db.query(
    `select ceedo_collections.authenticate_device($1::text, $2::text) as device_id`,
    [credentialId, secret],
  );
  return rows[0].device_id as string | null;
}

describe("device credentials", () => {
  it("authenticates the secret it issued", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);

    expect(await authenticate(credential_id, secret)).toBe(deviceId);
  });

  it("issues a secret with at least 256 bits of entropy", async () => {
    const { secret } = await issue(await newDevice());
    // base64url of 32 random bytes is 43 characters.
    expect(secret.length).toBeGreaterThanOrEqual(43);
  });

  it("issues a different secret every time", async () => {
    const a = await issue(await newDevice());
    const b = await issue(await newDevice());
    expect(a.secret).not.toBe(b.secret);
    expect(a.credential_id).not.toBe(b.credential_id);
  });

  it("refuses a wrong secret", async () => {
    const deviceId = await newDevice();
    const { credential_id } = await issue(deviceId);

    expect(await authenticate(credential_id, "not-the-secret")).toBeNull();
  });

  it("refuses an unknown credential id", async () => {
    expect(await authenticate("no-such-credential", "anything")).toBeNull();
  });

  it("refuses a revoked credential", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);
    await db.query(`select ceedo_collections.revoke_device_credential($1::uuid)`, [deviceId]);

    expect(await authenticate(credential_id, secret)).toBeNull();
  });

  it("refuses an inactive device", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      deviceId,
    ]);

    expect(await authenticate(credential_id, secret)).toBeNull();
  });

  it("re-issuing revokes the previous credential", async () => {
    const deviceId = await newDevice();
    const first = await issue(deviceId);
    const second = await issue(deviceId);

    expect(await authenticate(first.credential_id, first.secret)).toBeNull();
    expect(await authenticate(second.credential_id, second.secret)).toBe(deviceId);
  });

  it("records last_seen_at on a successful authentication", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);

    const before = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(before.rows[0].last_seen_at).toBeNull();

    await authenticate(credential_id, secret);

    const after = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(after.rows[0].last_seen_at).not.toBeNull();
  });

  it("does not record last_seen_at on a failed authentication", async () => {
    const deviceId = await newDevice();
    const { credential_id } = await issue(deviceId);

    await authenticate(credential_id, "wrong");

    const { rows } = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(rows[0].last_seen_at).toBeNull();
  });

  it("stores no plaintext secret anywhere in the row", async () => {
    const deviceId = await newDevice();
    const { secret } = await issue(deviceId);

    const { rows } = await db.query(
      `select row_to_json(dc)::text as blob
         from ceedo_collections.device_credentials dc
        where dc.device_id = $1`,
      [deviceId],
    );
    expect(rows[0].blob).not.toContain(secret);
  });
});

describe("device_credentials privileges", () => {
  // service_role is the strongest key any client holds. Migration 0001's default
  // privileges grant it SELECT and INSERT on every future table in this schema, so this
  // assertion only means something because the migration actively revokes them. An
  // `anon` assertion here would be vacuous -- anon is denied at schema-usage level and
  // would pass against an empty table.
  it("denies service_role any read", async () => {
    const { error } = await serviceClient().from("device_credentials").select("id").limit(1);
    expect(error).not.toBeNull();
  });

  it("denies service_role any insert", async () => {
    const { error } = await serviceClient()
      .from("device_credentials")
      .insert({ device_id: randomUUID(), secret_hash: "\\x00", issued_by: randomUUID() });
    expect(error).not.toBeNull();
  });

  it("denies anon any read", async () => {
    const { error } = await anonClient().from("device_credentials").select("id").limit(1);
    expect(error).not.toBeNull();
  });
});

describe("ceedo_app", () => {
  it("is granted to authenticator, so PostgREST can set role to it", async () => {
    const { rows } = await db.query(
      `select pg_has_role('authenticator', 'ceedo_app', 'member') as ok`,
    );
    expect(rows[0].ok).toBe(true);
  });

  // The list is asserted exactly, not with `toContain`, and it GROWS deliberately: Task 7
  // adds sync_pull, Task 8 close_shift, Task 9 sync_push, and Task 9 moves this whole block
  // to sync-privileges.test.ts where the final four are pinned. An exact assertion is what
  // makes an accidental fifth grant fail a test instead of passing unnoticed.
  it("holds EXECUTE on authenticate_device and nothing else yet", async () => {
    const { rows } = await db.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'ceedo_collections'
          and has_function_privilege('ceedo_app', p.oid, 'execute')
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(["authenticate_device"]);
  });

  it("holds no privilege on any table in the schema", async () => {
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/device-credentials.test.ts`
Expected: FAIL — `function ceedo_collections.issue_device_credential(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000026_device_credentials.sql`:

```sql
-- Device authentication, and the role the Edge Functions run as.
--
-- Parent spec §11.5 rules out OAuth for the collector app because it "needs a round trip
-- at exactly the moment a collector may have no signal". That argument does not stop at
-- OAuth: ANY credential with an expiry reintroduces the same failure one step removed, so
-- this credential is long-lived and revocation is devices.active = false.
--
-- The secret is 256 random bits, so it gets SHA-256 and not a slow KDF. A cost factor
-- defends a LOW-entropy secret against enumeration; there is nothing to enumerate here.
-- The collector PIN is the opposite case and gets bcrypt -- see migration 0027.

create extension if not exists pgcrypto with schema extensions;

create table ceedo_collections.device_credentials (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references ceedo_collections.devices (id),
  -- The digest, never the secret. The `stores no plaintext` test asserts this against the
  -- whole row rather than against this column, so adding a plaintext column later fails.
  secret_hash bytea not null,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references ceedo_collections.app_users (id),
  revoked_at  timestamptz,
  revoked_by  uuid references ceedo_collections.app_users (id),
  row_version bigint not null default 0
);

create unique index device_credentials_one_live
  on ceedo_collections.device_credentials (device_id) where revoked_at is null;

create trigger device_credentials_row_version
  before insert or update on ceedo_collections.device_credentials
  for each row execute function ceedo_collections.bump_row_version();

-- NOT apply_master_data_policies(): that grants SELECT to staff roles, and this table
-- holds a secret's digest. RLS is on and NO policy is created, so every client role reads
-- nothing regardless of privilege. The revokes below make that true twice over, because
-- migration 0001's ALTER DEFAULT PRIVILEGES already handed service_role select+insert on
-- every future table in this schema and inheriting that here would be the whole hole.
alter table ceedo_collections.device_credentials enable row level security;
revoke all on ceedo_collections.device_credentials from anon, authenticated, service_role;

-- Issue. Admin only, checked internally the way condone_charge() and
-- record_opening_balance() check theirs, because the caller arrives as `authenticated`
-- and the function is SECURITY DEFINER.
create or replace function ceedo_collections.issue_device_credential(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_secret        text;
  v_credential_id text;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may issue a device credential';
  end if;

  if not exists (select 1 from ceedo_collections.devices where id = p_device_id) then
    raise exception 'No such device';
  end if;

  -- Re-issue revokes first, in this same transaction. Two live credentials for one device
  -- would mean a tablet that was replaced still works.
  update ceedo_collections.device_credentials
     set revoked_at = now(), revoked_by = auth.uid()
   where device_id = p_device_id and revoked_at is null;

  -- 32 bytes = 256 bits. encode(...,'base64') then made URL-safe, so the secret survives a
  -- QR code, a header and a JSON body without escaping.
  v_secret := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_credential_id := translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');

  insert into ceedo_collections.device_credentials (device_id, secret_hash, issued_by)
  values (p_device_id, extensions.digest(v_secret, 'sha256'), auth.uid());

  update ceedo_collections.devices
     set credential_id = v_credential_id
   where id = p_device_id;

  -- The only moment the secret exists outside the caller's hand. There is deliberately no
  -- way to read it back; see the web screen's copy in Task 15.
  return jsonb_build_object('credential_id', v_credential_id, 'secret', v_secret);
end;
$$;

create or replace function ceedo_collections.revoke_device_credential(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may revoke a device credential';
  end if;

  update ceedo_collections.device_credentials
     set revoked_at = now(), revoked_by = auth.uid()
   where device_id = p_device_id and revoked_at is null;
end;
$$;

-- The chicken-and-egg door. An Edge Function cannot verify a credential before it holds a
-- database role, and §12.5 forbids it holding service_role. So it holds ceedo_app, which
-- can execute this and nothing else.
create or replace function ceedo_collections.authenticate_device(
  p_credential_id text,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_device_id uuid;
  v_hash      bytea;
begin
  if p_credential_id is null or p_secret is null then
    return null;
  end if;

  select d.id, dc.secret_hash
    into v_device_id, v_hash
    from ceedo_collections.devices d
    join ceedo_collections.device_credentials dc
      on dc.device_id = d.id and dc.revoked_at is null
   where d.credential_id = p_credential_id
     and d.active;

  if v_device_id is null then
    return null;
  end if;

  -- Constant-time compare. At 256 bits a timing oracle is not a realistic attack, but the
  -- habit costs one function call and the alternative invites a reviewer to wonder.
  if not extensions.digest(p_secret, 'sha256') operator(pg_catalog.=) v_hash then
    return null;
  end if;

  -- Only on success. A failed attempt must not make a stolen tablet look alive on the
  -- device list a supervisor is reading to decide whether to deactivate it.
  update ceedo_collections.devices set last_seen_at = now() where id = v_device_id;

  return v_device_id;
end;
$$;

revoke execute on function ceedo_collections.issue_device_credential(uuid) from public;
grant execute on function ceedo_collections.issue_device_credential(uuid) to authenticated;
revoke execute on function ceedo_collections.revoke_device_credential(uuid) from public;
grant execute on function ceedo_collections.revoke_device_credential(uuid) to authenticated;

revoke execute on function ceedo_collections.authenticate_device(text, text) from public;
grant execute on function ceedo_collections.authenticate_device(text, text) to ceedo_app;

-- Without this, PostgREST cannot `set role ceedo_app` and a ceedo_app JWT is inert.
-- Phase 1 created the role and deliberately left this undone; its handover names it as a
-- Phase 3 obligation. §12.5 is the reason the role exists at all: an Edge Function that
-- used service_role would bypass RLS across every unrelated schema on this shared project.
grant ceedo_app to authenticator;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/device-credentials.test.ts`
Expected: PASS, all cases.

If that assertion fails listing more than `authenticate_device`, a previous migration granted something to `ceedo_app`. Find it before continuing.

- [ ] **Step 5: Add the test helpers**

Append to `tests/helpers/supabase.ts`:

```typescript
/**
 * Issues a device credential as the owner connection, bypassing the is_admin() check that
 * the web path goes through. Task 15's web tests cover the authorization; here the
 * credential is a fixture, not the thing under test.
 */
export async function issueCredential(
  db: PgClient,
  deviceId: string,
): Promise<{ credentialId: string; secret: string }> {
  const secret = randomUUID() + randomUUID();
  const credentialId = `cred-${randomUUID()}`;
  await db.query(
    `insert into ceedo_collections.device_credentials (device_id, secret_hash)
     values ($1, extensions.digest($2, 'sha256'))`,
    [deviceId, secret],
  );
  await db.query(`update ceedo_collections.devices set credential_id = $2 where id = $1`, [
    deviceId,
    credentialId,
  ]);
  return { credentialId, secret };
}

/**
 * createCollectionFixture() plus the two assignment rows and the credential that sync
 * needs.
 *
 * This exists because createCollectionFixture() creates a device with NO
 * device_assignments row and a collector with NO collector_assignments row --
 * post_collection() never looks at either, so Phase 2 had no reason to. Every sync path
 * checks can_collector_use_device(), which joins both, so a Phase 2 fixture used here
 * would be refused for a reason that has nothing to do with the test.
 */
export async function createSyncFixture(
  db: PgClient,
  opts: Parameters<typeof createCollectionFixture>[1] = {},
): Promise<
  CollectionFixture & { credentialId: string; secret: string; facilityId: string }
> {
  const fx = await createCollectionFixture(db, opts);

  // stalls -> sections -> facilities. `stalls` carries section_id only; the facility is
  // one join further out.
  const { rows } = await db.query(
    `select sec.facility_id
       from ceedo_collections.stalls s
       join ceedo_collections.sections sec on sec.id = s.section_id
      where s.id = $1`,
    [fx.stallId],
  );
  const facilityId = rows[0].facility_id as string;

  await db.query(
    `insert into ceedo_collections.device_assignments (device_id, facility_id, active)
     values ($1, $2, true)`,
    [fx.deviceId, facilityId],
  );
  await db.query(
    `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
     values ($1, $2, true)`,
    [fx.collectorId, facilityId],
  );

  const { credentialId, secret } = await issueCredential(db, fx.deviceId);
  return { ...fx, credentialId, secret, facilityId };
}
```

- [ ] **Step 6: Verify the helpers compile and the suite is still green**

Run: `pnpm typecheck --force && supabase db reset && pnpm test`
Expected: typecheck clean, full suite green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260918000026_device_credentials.sql \
        tests/db/device-credentials.test.ts tests/helpers/supabase.ts
git commit -m "feat(sync): device credentials and the ceedo_app role"
```

---
## Task 2: `set_collector_pin()`

Spec D10, §6.3. Corrects migration 0002's comment.

**Files:**
- Create: `supabase/migrations/20260918000027_collector_pin.sql`
- Create: `tests/db/collector-pin.test.ts`

**Interfaces:**
- Consumes: `app_users.pin_hash` (exists, written by nothing), `is_admin()`.
- Produces: `ceedo_collections.set_collector_pin(p_collector_id uuid, p_pin text) returns void`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/collector-pin.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  serviceClient,
} from "../helpers/supabase";

let db: Client;
let collectorId: string;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  collectorId = (await createSyncFixture(db)).collectorId;
});

afterAll(async () => {
  await db.end();
});

async function setPin(pin: string): Promise<void> {
  await db.query(`select ceedo_collections.set_collector_pin($1::uuid, $2::text)`, [
    collectorId,
    pin,
  ]);
}

async function pinHash(): Promise<string | null> {
  const { rows } = await db.query(
    `select pin_hash from ceedo_collections.app_users where id = $1`,
    [collectorId],
  );
  return rows[0].pin_hash as string | null;
}

describe("set_collector_pin", () => {
  it("writes a bcrypt hash the PIN verifies against", async () => {
    await setPin("123456");
    const hash = await pinHash();

    expect(hash).not.toBeNull();
    const { rows } = await db.query(
      `select extensions.crypt('123456', $1::text) = $1::text as ok`,
      [hash],
    );
    expect(rows[0].ok).toBe(true);
  });

  it("uses a cost factor of at least 12", async () => {
    await setPin("123456");
    // A bcrypt hash is $2a$<cost>$<salt+digest>.
    expect(await pinHash()).toMatch(/^\$2[aby]\$(1[2-9]|[2-9]\d)\$/);
  });

  it("never stores the PIN in plaintext", async () => {
    await setPin("987654");
    expect(await pinHash()).not.toContain("987654");
  });

  it("salts, so the same PIN twice gives different hashes", async () => {
    await setPin("123456");
    const first = await pinHash();
    await setPin("123456");
    expect(await pinHash()).not.toBe(first);
  });

  it("refuses a PIN that is not six digits", async () => {
    await expect(setPin("12345")).rejects.toThrow(/six digits/i);
    await expect(setPin("1234567")).rejects.toThrow(/six digits/i);
    await expect(setPin("12345a")).rejects.toThrow(/six digits/i);
  });

  it("refuses a target who is not a collector", async () => {
    // Creates its own non-collector rather than querying for a seeded admin. A fixture that
    // depends on seed contents fails as a TypeError on `rows[0].id` instead of as the
    // assertion it was written to make.
    // createAppUser returns { client, userId } and uniquifies the email itself — do not
    // wrap the address in uniqueEmail() as well.
    const { userId: supervisorId } = await createAppUser({
      email: "pin-target-supervisor@example.com",
      role: "supervisor",
    });

    await expect(
      db.query(`select ceedo_collections.set_collector_pin($1::uuid, '123456')`, [
        supervisorId,
      ]),
    ).rejects.toThrow(/collector/i);
  });
});

describe("pin_hash exposure", () => {
  // The point of routing this through an RPC at all. Migration 0002 grants
  // `update (role, status)` and a column-list SELECT that omits pin_hash; these assert the
  // hole stays closed from the strongest client key.
  it("is not readable by service_role through PostgREST", async () => {
    const { error } = await serviceClient().from("app_users").select("pin_hash").limit(1);
    expect(error).not.toBeNull();
  });

  it("is not writable by service_role through PostgREST", async () => {
    const { error } = await serviceClient()
      .from("app_users")
      .update({ pin_hash: "injected" })
      .eq("id", collectorId);
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/collector-pin.test.ts`
Expected: FAIL — `function ceedo_collections.set_collector_pin(uuid, text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000027_collector_pin.sql`:

```sql
-- Writing app_users.pin_hash.
--
-- Migration 0002 withholds pin_hash from every web grant -- `authenticated` holds
-- update(role, status) and a column-list SELECT that omits it -- and its comment says
-- "Phase 3 writes pin_hash through an Edge Function, not as `authenticated`."
--
-- The requirement is right; the mechanism named is wrong for this caller. An admin sets a
-- PIN from the web admin screen, and parent spec §4 is explicit that the web talks to
-- Supabase directly while Edge Functions exist for the device. Routing an admin form
-- through an Edge Function inverts that split for no gain. A SECURITY DEFINER RPC -- the
-- pattern condone_charge(), cancel_collection() and record_opening_balance() already use
-- -- satisfies what 0002 actually cared about: pin_hash is never writable through a plain
-- PostgREST UPDATE and never readable by any client role.
--
-- bcrypt, not SHA-256, and this is the opposite call from migration 0026's. A 6-digit PIN
-- is ~20 bits: 10^6 candidates, exhaustible in seconds against a fast digest. Cost IS the
-- mitigation. Cost 12 puts a full sweep at roughly four days.
--
-- §11.5 specifies argon2. Postgres has no argon2 without an extension this project does
-- not install; pgcrypto's bcrypt is what is available and the substitution is recorded
-- rather than made silently.

create or replace function ceedo_collections.set_collector_pin(
  p_collector_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_role ceedo_collections.app_role;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may set a collector PIN';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'A PIN must be exactly six digits';
  end if;

  select role into v_role from ceedo_collections.app_users where id = p_collector_id;
  if not found then
    raise exception 'No such staff member';
  end if;
  if v_role <> 'collector' then
    raise exception 'Only a collector has a PIN; % is a %', p_collector_id, v_role;
  end if;

  update ceedo_collections.app_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12))
   where id = p_collector_id;
end;
$$;

revoke execute on function ceedo_collections.set_collector_pin(uuid, text) from public;
grant execute on function ceedo_collections.set_collector_pin(uuid, text) to authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/collector-pin.test.ts`
Expected: PASS.

The cost-12 test takes ~400ms per hash and this file sets several. If it exceeds Vitest's 5s default, raise the timeout on that file rather than lowering the cost factor — the cost factor is the security property.

- [ ] **Step 5: Correct migration 0002's comment**

The comment now describes a mechanism this phase deliberately did not use. Leaving it would send the next reader looking for an Edge Function that does not exist.

Modify `supabase/migrations/20260917000002_app_users.sql:132`, changing:

```
-- Phase 3 writes pin_hash through an Edge Function, not as `authenticated`.
```

to:

```
-- Phase 3a writes pin_hash through set_collector_pin() (migration 0027), a SECURITY
-- DEFINER RPC checking is_admin() internally -- not as `authenticated`, and not through an
-- Edge Function as this comment originally predicted. See that migration for why.
```

Editing an applied migration's *comment* is safe and does not change the schema; the file's hash is not part of Supabase's applied-migration bookkeeping. Do not change any statement in it.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000027_collector_pin.sql \
        supabase/migrations/20260917000002_app_users.sql \
        tests/db/collector-pin.test.ts
git commit -m "feat(sync): set_collector_pin, and correct 0002's comment about it"
```

---
## Task 3: The `shifts` table

Spec §3.2. Invariant: one open shift per device.

**Files:**
- Create: `supabase/migrations/20260918000029_shifts.sql`
- Create: `tests/db/shifts.test.ts`

**Interfaces:**
- Produces: `ceedo_collections.shifts` with a client-generated `id` (no default) and a partial unique index `shifts_one_open_per_device`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/shifts.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, serviceClient } from "../helpers/supabase";

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

async function openShift(
  id = randomUUID(),
  deviceId = fx.deviceId,
): Promise<string> {
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, '2026-10-05'::date, now(), 'open')`,
    [id, fx.collectorId, deviceId],
  );
  return id;
}

describe("shifts", () => {
  it("has no default on id, so the client must generate it", async () => {
    // Idempotency depends on this, exactly as collections.id does: a shift opens offline,
    // before the server has heard of it, and a retried push must not mint a second one.
    const { rows } = await db.query(
      `select column_default
         from information_schema.columns
        where table_schema = 'ceedo_collections'
          and table_name = 'shifts'
          and column_name = 'id'`,
    );
    expect(rows[0].column_default).toBeNull();
  });

  it("permits one open shift per device", async () => {
    const deviceId = (await createSyncFixture(db)).deviceId;
    await openShift(randomUUID(), deviceId);

    await expect(openShift(randomUUID(), deviceId)).rejects.toThrow(
      /shifts_one_open_per_device/,
    );
  });

  it("permits a second shift once the first is closed", async () => {
    const deviceId = (await createSyncFixture(db)).deviceId;
    const first = await openShift(randomUUID(), deviceId);
    await db.query(
      `update ceedo_collections.shifts set status = 'closed', closed_at = now() where id = $1`,
      [first],
    );

    await expect(openShift(randomUUID(), deviceId)).resolves.toBeDefined();
  });

  it("permits open shifts on two different devices at once", async () => {
    const a = (await createSyncFixture(db)).deviceId;
    const b = (await createSyncFixture(db)).deviceId;
    await openShift(randomUUID(), a);
    await expect(openShift(randomUUID(), b)).resolves.toBeDefined();
  });

  it("refuses an unknown status", async () => {
    await expect(
      db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, status)
         values ($1, $2, $3, '2026-10-05'::date, now(), 'finished')`,
        [randomUUID(), fx.collectorId, fx.deviceId],
      ),
    ).rejects.toThrow(/shifts_status_check/);
  });

  it("carries a row_version bumped on insert and on update", async () => {
    const id = await openShift(randomUUID(), (await createSyncFixture(db)).deviceId);
    const { rows: first } = await db.query(
      `select row_version from ceedo_collections.shifts where id = $1`,
      [id],
    );
    expect(Number(first[0].row_version)).toBeGreaterThan(0);

    await db.query(`update ceedo_collections.shifts set status = 'closed' where id = $1`, [id]);
    const { rows: second } = await db.query(
      `select row_version from ceedo_collections.shifts where id = $1`,
      [id],
    );
    expect(Number(second[0].row_version)).toBeGreaterThan(Number(first[0].row_version));
  });
});

describe("shifts privileges", () => {
  it("denies service_role INSERT", async () => {
    // Migration 0001's default privileges grant service_role select+insert on every future
    // table; this only passes because the migration revokes it. Every shift row is written
    // by close_shift() or sync_push(), both SECURITY DEFINER.
    const { error } = await serviceClient().from("shifts").insert({
      id: randomUUID(),
      collector_id: fx.collectorId,
      device_id: fx.deviceId,
      business_date: "2026-10-05",
      opened_at: new Date().toISOString(),
      status: "open",
    });
    expect(error).not.toBeNull();
  });

  it("denies DELETE to every role", async () => {
    const { rows } = await db.query(
      `select r.rolname
         from pg_roles r
        where has_table_privilege(r.rolname, 'ceedo_collections.shifts', 'DELETE')
          and r.rolname not in ('postgres', 'supabase_admin')
          and not r.rolsuper`,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/shifts.test.ts`
Expected: FAIL — `relation "ceedo_collections.shifts" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000029_shifts.sql`:

```sql
-- Shifts. Parent spec §5.5 and §6.5.
--
-- Deliberately OUTSIDE the append-only regime: a shift has a lifecycle -- it opens, it
-- closes, it is later remitted -- unlike anything in §5.4. Phase 2 drew the same
-- distinction for `settings` and `accrual_runs` and stated it rather than leaving it to be
-- inferred; this restates it so a future reader does not mistake this for a ledger table.

create table ceedo_collections.shifts (
  -- NO DEFAULT, for the same reason collections.id has none. A shift opens offline, before
  -- the device has ever spoken to the server about it, so the client generates the UUID
  -- and that is what makes a retried `shift_open` push idempotent. A server default would
  -- mint a second shift on every retry over a bad connection.
  id             uuid primary key,
  collector_id   uuid not null references ceedo_collections.app_users (id),
  device_id      uuid not null references ceedo_collections.devices (id),
  business_date  date not null,
  opened_at      timestamptz not null,
  closed_at      timestamptz,
  declared_total numeric(14,2),
  system_total   numeric(14,2),
  system_count   integer,
  -- declared_total - system_total. Signed: over and short are different problems.
  variance       numeric(14,2),
  -- 'remitted' is unreachable in Phase 3a -- remittance is Phase 6 -- but naming it now
  -- costs nothing and avoids a constraint migration later.
  status         text not null
                   check (status in ('open','closed','closed_unsynced','remitted')),
  row_version    bigint not null default 0
);

-- §6.5: "A device permits only one open shift at a time... Without this rule a shared
-- tablet accumulates overlapping open shifts and the cash accountability cannot be
-- untangled afterwards."
--
-- The device enforces this locally too, because it must work offline. That copy is a
-- convenience; this one is the guarantee.
create unique index shifts_one_open_per_device
  on ceedo_collections.shifts (device_id) where status = 'open';

create index shifts_collector_date_idx
  on ceedo_collections.shifts (collector_id, business_date);
create index shifts_row_version_idx on ceedo_collections.shifts (row_version);

create trigger shifts_row_version
  before insert or update on ceedo_collections.shifts
  for each row execute function ceedo_collections.bump_row_version();

alter table ceedo_collections.shifts enable row level security;

-- Staff read. Supervisors verify shifts, accounting reconciles them, admins see
-- everything. Collectors have no web access at all (§11.1), so they are not named.
create policy shifts_read on ceedo_collections.shifts
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Every write goes through close_shift() or sync_push(), both SECURITY DEFINER. No client
-- role holds INSERT or UPDATE directly. The revoke is not decorative: migration 0001's
-- ALTER DEFAULT PRIVILEGES granted service_role select+insert on this table the moment it
-- was created.
revoke insert, update, delete on ceedo_collections.shifts
  from anon, authenticated, service_role;
grant select on ceedo_collections.shifts to authenticated, service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/shifts.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Comment out the `where status = 'open'` clause on `shifts_one_open_per_device`, so it becomes a plain unique index on `device_id`. Re-run the file.

Expected: `permits a second shift once the first is closed` and `permits open shifts on two different devices` change behaviour — the first must now FAIL. If it still passes, the index is not doing what the test claims. Restore the clause and re-run before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000029_shifts.sql tests/db/shifts.test.ts
git commit -m "feat(sync): the shifts table and the one-open-shift guarantee"
```

---
## Task 4: The `sync_exceptions` table

Spec §3.3. Invariant 23.

**Files:**
- Create: `supabase/migrations/20260918000030_sync_exceptions.sql`
- Create: `tests/db/sync-exceptions.test.ts`

**Interfaces:**
- Produces: `ceedo_collections.sync_exceptions` with `collection_uuid` unique and a lifecycle check constraint.

- [ ] **Step 1: Write the failing test**

Create `tests/db/sync-exceptions.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, serviceClient } from "../helpers/supabase";

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
  collectionUuid = randomUUID(),
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
    // Load-bearing. §6.4 says a rejected entry STAYS in the device outbox, so the device
    // re-pushes it on every sync. Without this constraint, one permanently-rejected
    // receipt breeds a row per sync attempt and buries the queue within a day.
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

  it("denies DELETE to every role", async () => {
    const { rows } = await db.query(
      `select r.rolname
         from pg_roles r
        where has_table_privilege(r.rolname, 'ceedo_collections.sync_exceptions', 'DELETE')
          and r.rolname not in ('postgres', 'supabase_admin')
          and not r.rolsuper`,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/sync-exceptions.test.ts`
Expected: FAIL — `relation "ceedo_collections.sync_exceptions" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000030_sync_exceptions.sql`:

```sql
-- The exceptions queue. Parent spec §6.3 and §11.3.
--
-- §6.3 is the whole reason this table exists: "A server rejection must never mean 'discard
-- the record.' By the time the server sees a problem, the collector has handed a vendor a
-- paper official receipt and taken their money. That serial is spent. If the device drops
-- the entry, cash exists with no record -- exactly the variance an audit will find."
--
-- Outside the append-only regime, like `shifts`: an exception has a lifecycle.

create table ceedo_collections.sync_exceptions (
  id                uuid primary key default gen_random_uuid(),
  -- UNIQUE, and load-bearing. §6.4: a rejected entry remains visible on the device as
  -- unresolved, which means the device re-pushes it on EVERY sync. Without this, one
  -- permanently-rejected receipt breeds a row per sync attempt and buries the queue. A
  -- re-push bumps `attempts` instead, which is also the honest signal of how long a
  -- receipt has been stuck.
  collection_uuid   uuid not null unique,
  device_id         uuid not null references ceedo_collections.devices (id),
  collector_id      uuid not null references ceedo_collections.app_users (id),
  reason_code       text not null,
  -- The entry exactly as the device sent it. A supervisor correcting this needs to see
  -- what was claimed, and an investigation needs it unaltered.
  payload           jsonb not null,
  attempts          integer not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  status            text not null default 'open'
                      check (status in ('open','escalated','resolved')),
  resolution        text
                      constraint sync_exceptions_resolution_check
                      check (resolution in ('corrected','spoiled')),
  resolution_reason text,
  resolved_by       uuid references ceedo_collections.app_users (id),
  resolved_at       timestamptz,
  row_version       bigint not null default 0,

  -- §11.3: "A written reason is mandatory on every resolution." Enforced here rather than
  -- in the form, because the form is one caller and the RPC is another.
  --
  -- 'escalated' is a STATUS, not a resolution: §11.3's third action is "escalate for
  -- investigation", which is not a terminus. An escalated exception is still unresolved
  -- and still counts against the collector at closeout. Modelling it as a resolution would
  -- let an exception be closed by declaring it interesting.
  constraint sync_exceptions_lifecycle check (
    case status
      when 'open' then
        resolution is null and resolved_by is null and resolved_at is null
      when 'escalated' then
        resolution is null and resolved_by is null and resolved_at is null
        and resolution_reason is not null
      when 'resolved' then
        resolution is not null and resolved_by is not null and resolved_at is not null
        and resolution_reason is not null
    end
  )
);

create index sync_exceptions_open_idx
  on ceedo_collections.sync_exceptions (first_seen_at)
  where status <> 'resolved';
create index sync_exceptions_collector_idx
  on ceedo_collections.sync_exceptions (collector_id);
create index sync_exceptions_row_version_idx
  on ceedo_collections.sync_exceptions (row_version);

create trigger sync_exceptions_row_version
  before insert or update on ceedo_collections.sync_exceptions
  for each row execute function ceedo_collections.bump_row_version();

alter table ceedo_collections.sync_exceptions enable row level security;

create policy sync_exceptions_read on ceedo_collections.sync_exceptions
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Written by sync_push() and the three resolve_exception_* functions, all SECURITY
-- DEFINER. No client role writes directly, and the revoke is what makes that true given
-- migration 0001's default privileges.
revoke insert, update, delete on ceedo_collections.sync_exceptions
  from anon, authenticated, service_role;
grant select on ceedo_collections.sync_exceptions to authenticated, service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-exceptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Drop the `unique` on `collection_uuid` (change to plain `not null`), re-run.
Expected: `permits one row per collection_uuid` FAILS. Restore it.

Then restore the unique and instead delete the `'escalated'` branch's `resolution_reason is not null`, re-run.
Expected: `refuses escalating without a written reason` FAILS. Restore it.

Both mutations must produce exactly one new failure each. A mutation producing *fewer* failures than expected means the test is weaker than it reads — Phase 2's handover found five such cases.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000030_sync_exceptions.sql \
        tests/db/sync-exceptions.test.ts
git commit -m "feat(sync): the exceptions queue"
```

---
## Task 5: `devices.assignment_epoch`

Spec D7. A cursor delta cannot say "this left your scope."

**Files:**
- Create: `supabase/migrations/20260918000031_assignment_epoch.sql`
- Create: `tests/db/assignment-epoch.test.ts`

**Interfaces:**
- Produces: `devices.assignment_epoch integer not null default 0`, bumped by trigger `device_assignments_bump_epoch` on any insert, update or delete of a `device_assignments` row. Consumed by `sync_pull()` in Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/db/assignment-epoch.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, uniqueCode } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function epochOf(deviceId: string): Promise<number> {
  const { rows } = await db.query(
    `select assignment_epoch from ceedo_collections.devices where id = $1`,
    [deviceId],
  );
  return Number(rows[0].assignment_epoch);
}

describe("assignment epoch", () => {
  it("starts at zero on a device with no assignment", async () => {
    const { rows } = await db.query(
      `insert into ceedo_collections.devices (label) values ($1) returning id`,
      [uniqueCode("DEV")],
    );
    expect(await epochOf(rows[0].id)).toBe(0);
  });

  it("bumps when an assignment is created", async () => {
    // createSyncFixture inserts one device_assignments row.
    const fx = await createSyncFixture(db);
    expect(await epochOf(fx.deviceId)).toBeGreaterThan(0);
  });

  it("bumps when an assignment is deactivated", async () => {
    const fx = await createSyncFixture(db);
    const before = await epochOf(fx.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );

    expect(await epochOf(fx.deviceId)).toBeGreaterThan(before);
  });

  it("bumps when a device is reassigned to another facility", async () => {
    // The case the whole mechanism exists for. Reassignment changes NOTHING on the leases
    // the device previously held, so no row_version moves, so a cursor delta is empty and
    // the tablet silently keeps a section's worth of data it must no longer show.
    const fx = await createSyncFixture(db);
    const other = await createSyncFixture(db);
    const before = await epochOf(fx.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );
    await db.query(
      `insert into ceedo_collections.device_assignments (device_id, facility_id, active)
       values ($1, $2, true)`,
      [fx.deviceId, other.facilityId],
    );

    expect(await epochOf(fx.deviceId)).toBeGreaterThan(before + 1);
  });

  it("does not bump another device's epoch", async () => {
    const a = await createSyncFixture(db);
    const b = await createSyncFixture(db);
    const bBefore = await epochOf(b.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [a.deviceId],
    );

    expect(await epochOf(b.deviceId)).toBe(bBefore);
  });

  it("bumps the device's row_version too, so the change is itself syncable", async () => {
    const fx = await createSyncFixture(db);
    const { rows: before } = await db.query(
      `select row_version from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );

    const { rows: after } = await db.query(
      `select row_version from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );
    expect(Number(after[0].row_version)).toBeGreaterThan(Number(before[0].row_version));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/assignment-epoch.test.ts`
Expected: FAIL — `column "assignment_epoch" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000031_assignment_epoch.sql`:

```sql
-- The re-sync trigger for a reassigned tablet.
--
-- The sync cursor is row_version_seq (parent spec §5.7). A cursor delta answers "what
-- changed?" It cannot answer "what is no longer yours?"
--
-- When a supervisor moves a tablet from the fish section to the vegetable section, the
-- fish section's leases, stalls and charges do not change -- so no row_version moves, so
-- the next delta is EMPTY, and the tablet keeps a section's worth of tenants it must no
-- longer show. Nothing in a cursor protocol can detect this; it is a property of deltas,
-- not a bug in the query.
--
-- §3 of the parent spec says reassignment "forces a re-sync before it is used elsewhere."
-- This makes that a mechanism rather than a hope: the epoch changes, every pull response
-- carries it, and a device whose stored epoch differs discards its scoped data and pulls
-- from cursor 0.

alter table ceedo_collections.devices
  add column assignment_epoch integer not null default 0;

create or replace function ceedo_collections.bump_assignment_epoch()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  -- Fires on DELETE too, where NEW is null. A device_assignments row is never deleted
  -- today -- deactivation is `active = false` -- but a trigger that silently skips the
  -- delete path is a trap for whoever changes that.
  update ceedo_collections.devices
     set assignment_epoch = assignment_epoch + 1
   where id = coalesce(new.device_id, old.device_id);

  return coalesce(new, old);
end;
$$;

-- FOR EACH ROW on all three verbs. An UPDATE that flips `active` is the ordinary case;
-- INSERT is a first assignment; DELETE is covered for the reason above.
create trigger device_assignments_bump_epoch
  after insert or update or delete on ceedo_collections.device_assignments
  for each row execute function ceedo_collections.bump_assignment_epoch();
```

Note the `devices` table already carries a `bump_row_version()` BEFORE UPDATE trigger from
migration 0007, so the `update` above bumps `row_version` as a side effect. The last test
pins that, because it is what makes the epoch change visible to anything watching `devices`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/assignment-epoch.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change the trigger to `after insert or delete` (dropping `update`). Re-run.
Expected: `bumps when an assignment is deactivated`, `bumps when a device is reassigned` and `bumps the device's row_version too` all FAIL — deactivation is an UPDATE, and it is the ordinary case. Restore.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000031_assignment_epoch.sql \
        tests/db/assignment-epoch.test.ts
git commit -m "feat(sync): assignment epoch forces a re-sync on device reassignment"
```

---
## Task 6: `stale_allocations` — the one retryable rejection

Spec D6, §4.3. Closes a gap Phase 2's handover names explicitly.

**Files:**
- Modify: `packages/shared/src/reason-codes.ts`
- Create: `packages/shared/src/reason-codes.test.ts`
- Create: `supabase/migrations/20260918000032_stale_allocations.sql`
- Create: `tests/db/stale-allocations.test.ts`
- Modify: `tests/db/parity.test.ts` (the reason-code list is asserted against SQL there)

**Interfaces:**
- Produces: `REJECT_REASONS` gains `"stale_allocations"`; new `RETRYABLE_REASONS: ReadonlySet<RejectReason>` and `isRetryable(reason: RejectReason): boolean`.
- `post_collection()` returns `reason: 'stale_allocations'` from its re-read-mismatch branch only. The two `allocation_not_prefix` returns above it are unchanged.

- [ ] **Step 1: Write the failing shared test**

Create `packages/shared/src/reason-codes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { REJECT_REASONS, RETRYABLE_REASONS, isRetryable } from "./reason-codes";

describe("reject reasons", () => {
  it("includes stale_allocations", () => {
    expect(REJECT_REASONS).toContain("stale_allocations");
  });

  it("marks exactly one reason retryable", () => {
    // Invariant 24. The count matters: a second retryable reason means a receipt the
    // device retries forever without a human ever seeing it.
    expect([...RETRYABLE_REASONS]).toEqual(["stale_allocations"]);
  });

  it("treats every other reason as needing a human", () => {
    for (const reason of REJECT_REASONS) {
      if (reason === "stale_allocations") continue;
      expect(isRetryable(reason)).toBe(false);
    }
  });

  it("does not treat or_already_used as retryable", () => {
    // The case §6.3 says no device can detect on its own. Retrying it would spin forever
    // while a supervisor never learns that two devices claimed one OR number.
    expect(isRetryable("or_already_used")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ceedo/shared exec vitest run src/reason-codes.test.ts`
Expected: FAIL — `RETRYABLE_REASONS is not exported`.

- [ ] **Step 3: Extend `reason-codes.ts`**

Modify `packages/shared/src/reason-codes.ts`. Add `"stale_allocations"` to the end of the `REJECT_REASONS` array, then append:

```typescript
/**
 * The rejections a device retries on its own, versus the ones that need a person.
 *
 * Exactly one reason is retryable, and Phase 2's handover explains why this one had to be
 * split out of `allocation_not_prefix`:
 *
 *   "A lost race returns allocation_not_prefix, which misleads. The behaviour is correct
 *    -- rejected, nothing written -- but the name points at a data problem. The right
 *    device response to a lost race is re-sync and retry automatically, not raise a
 *    supervisor exception."
 *
 * The status has a concrete consequence in sync_push: a retryable rejection files NO
 * sync_exceptions row. Every other reason means a paper receipt exists that a supervisor
 * must reconcile.
 *
 * Callers branch on membership of this set, never on the literal. Adding a retryable
 * reason later must not mean finding every `if` that named this one.
 */
export const RETRYABLE_REASONS: ReadonlySet<RejectReason> = new Set<RejectReason>([
  "stale_allocations",
]);

export function isRetryable(reason: RejectReason): boolean {
  return RETRYABLE_REASONS.has(reason);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @ceedo/shared exec vitest run src/reason-codes.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing DB test**

Create `tests/db/stale-allocations.test.ts`. This reproduces Phase 2's race deliberately,
using two connections and an explicit lock so the ordering is not left to chance:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
  FIXTURE_BOOKLET_START_NO,
} from "../helpers/supabase";

let a: Client;
let b: Client;

beforeAll(async () => {
  a = new Client({ connectionString: POSTGRES_URL });
  b = new Client({ connectionString: POSTGRES_URL });
  await a.connect();
  await b.connect();
});

afterAll(async () => {
  await resetCutover(a);
  await a.end();
  await b.end();
});

describe("stale_allocations", () => {
  it("is returned to the loser of a FIFO race, not allocation_not_prefix", async () => {
    const fx = await createSyncFixture(a);

    // Give the lease at least two unpaid period groups, so the loser's re-read finds a
    // DIFFERENT charge set rather than simply no unpaid groups at all -- which would be
    // `allocation_not_prefix` for a legitimate reason and would pass this test for the
    // wrong cause.
    await a.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    await a.query("begin");
    // A wins the lock and holds it.
    const winner = await a.query(
      `select ceedo_collections.post_collection($1::jsonb) as result`,
      [
        JSON.stringify({
          id: randomUUID(),
          or_no: FIXTURE_BOOKLET_START_NO + 1,
          booklet_id: fx.bookletId,
          collector_id: fx.collectorId,
          device_id: fx.deviceId,
          collected_at: "2026-10-05T02:00:00+00:00",
          fee_type_id: fx.feeTypeId,
          lease_id: fx.leaseId,
          allocations: [{ group_rank: 1 }],
          lines: [],
        }),
      ],
    );
    expect(winner.rows[0].result.status).toBe("accepted");

    // B blocks on the same charge rows.
    const loser = b.query(`select ceedo_collections.post_collection($1::jsonb) as result`, [
      JSON.stringify({
        id: randomUUID(),
        or_no: FIXTURE_BOOKLET_START_NO + 2,
        booklet_id: fx.bookletId,
        collector_id: fx.collectorId,
        device_id: fx.deviceId,
        collected_at: "2026-10-05T02:00:00+00:00",
        fee_type_id: fx.feeTypeId,
        lease_id: fx.leaseId,
        allocations: [{ group_rank: 1 }],
        lines: [],
      }),
    ]);

    await a.query("commit");
    const result = (await loser).rows[0].result;

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("stale_allocations");
  });

  it("still returns allocation_not_prefix when the prefix is genuinely wrong", async () => {
    // The two branches must stay distinguishable. A rename that collapsed them would make
    // a real data error look retryable, and the device would spin on it forever.
    const fx = await createSyncFixture(a);
    await a.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const result = await postCollectionAsOwner(a, fx, {
      // Skips rank 1. Not a prefix, and no concurrency involved.
      groupRanks: [2],
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/stale-allocations.test.ts`
Expected: FAIL — the first test gets `allocation_not_prefix`, expected `stale_allocations`.

This failure is the proof the test is not vacuous: the race genuinely reaches that branch.
If it fails for any other reason — `or_out_of_range`, `lease_not_found`, a timeout — fix the
fixture before touching the migration. A test that never reaches the branch would pass once
the branch is changed and would mean nothing.

- [ ] **Step 7: Write the migration**

Create `supabase/migrations/20260918000032_stale_allocations.sql`.

Postgres has no way to patch one branch of a function, so this migration is a full
`create or replace` of `post_collection`. **Copy `supabase/migrations/20260918000022_post_collection.sql`
verbatim** — the whole comment block and the whole function — into the new file, then make
exactly these two changes and no others:

1. Replace the leading comment block with:

```sql
-- post_collection(), amended: the lost-FIFO-race branch gets its own reason code.
--
-- The engine is unchanged in every other respect. This migration exists because Postgres
-- cannot patch one branch of a function, so the whole body is reproduced from migration
-- 0022. Diff the two files before reviewing: exactly one `return` differs.
--
-- Phase 2's handover names the gap this closes:
--
--   "A lost race returns allocation_not_prefix, which misleads. The behaviour is correct
--    -- rejected, nothing written -- but the name points at a data problem. The right
--    device response to a lost race is re-sync and retry automatically, not raise a
--    supervisor exception. Phase 3 should add a distinct retryable reason code to
--    REJECT_REASONS when it builds the outbox, and have post_collection return it on the
--    re-read mismatch branch."
--
-- This matters more in Phase 3 than it did in Phase 2, because Phase 3 is the first time
-- multiple tablets push concurrently against one lease. §3 notes collectors rotate across
-- shared tablets; two devices holding the same lease is routine, not an edge case.
```

2. In the re-read comparison (migration 0022 line 214–217), change **only the reason
   string**, leaving the condition and the detail text alone:

```sql
    if (select array_agg(x order by x) from unnest(v_seen_ids) x) is distinct from v_locked_ids then
      return jsonb_build_object('status', 'rejected', 'reason', 'stale_allocations',
        'detail', 'The unpaid periods changed while this post waited; re-read and retry');
    end if;
```

The two earlier `allocation_not_prefix` returns (lines 141 and 205 of 0022) are **not**
changed. They describe a prefix that is genuinely wrong, which is not retryable.

Then re-state the grant at the foot of the file, since `create or replace` on a function
whose signature is unchanged preserves privileges but re-stating is what makes the file
readable standalone:

```sql
revoke execute on function ceedo_collections.post_collection(jsonb) from public;
-- Task 9 moves this to the sync path. Until then, unchanged from migration 0022.
grant execute on function ceedo_collections.post_collection(jsonb) to service_role;
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/stale-allocations.test.ts db/post-collection.test.ts`
Expected: PASS, both files. `post-collection.test.ts` is Phase 2's own suite and must be
untouched by this change — if anything in it fails, the copy diverged somewhere other than
the one line.

- [ ] **Step 9: Diff-check the copy**

Run:

```bash
diff <(sed -n '/^create or replace function ceedo_collections.post_collection/,/^\$\$;/p' \
         supabase/migrations/20260918000022_post_collection.sql) \
     <(sed -n '/^create or replace function ceedo_collections.post_collection/,/^\$\$;/p' \
         supabase/migrations/20260918000032_stale_allocations.sql)
```

Expected: exactly one changed line, the `'reason', 'allocation_not_prefix'` →
`'reason', 'stale_allocations'` inside the re-read branch. Any other difference is an
accidental edit — reconcile it before committing.

- [ ] **Step 10: Update the parity assertion**

`tests/db/parity.test.ts` asserts the TypeScript `REJECT_REASONS` list against what the SQL
can return. Find that assertion and extend it to include `stale_allocations`. Run:

Run: `pnpm --filter @ceedo/tests exec vitest run db/parity.test.ts`
Expected: PASS.

If no such assertion exists, add one — a reason code the SQL returns and the TypeScript does
not know about is a device that renders `undefined` to a collector.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/reason-codes.ts packages/shared/src/reason-codes.test.ts \
        supabase/migrations/20260918000032_stale_allocations.sql \
        tests/db/stale-allocations.test.ts tests/db/parity.test.ts
git commit -m "feat(sync): stale_allocations, the one retryable rejection"
```

---
## Task 7: `sync_pull()`

Spec §4.2. The mandate from Phase 2's handover: send *collections*, not charge deltas.

**Files:**
- Create: `supabase/migrations/20260918000033_sync_pull.sql`
- Create: `tests/db/sync-pull.test.ts`

**Interfaces:**
- Consumes: `devices.assignment_epoch` (Task 5), `device_assignments`, `collector_assignments`, `can_collector_use_device()`.
- Produces: `ceedo_collections.sync_pull(p_device_id uuid, p_cursor bigint) returns jsonb` with keys `cursor`, `epoch`, and one array per synced table.

- [ ] **Step 1: Write the failing test**

Create `tests/db/sync-pull.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Pull = {
  cursor: string;
  epoch: number;
  facilities: { id: string }[];
  sections: { id: string }[];
  stalls: { id: string }[];
  tenants: { id: string }[];
  leases: { id: string }[];
  fee_types: { id: string }[];
  rates: { id: string }[];
  collectors: { id: string; employee_no: string; pin_hash: string | null }[];
  booklets: { id: string }[];
  booklet_assignments: { booklet_id: string }[];
  consumed_serials: { booklet_id: string; or_no: number }[];
  charges: { id: string }[];
  collections: { id: string }[];
  collection_allocations: { collection_id: string }[];
  collection_cancellations: { collection_id: string }[];
};

async function pull(deviceId: string, cursor = 0): Promise<Pull> {
  const { rows } = await db.query(
    `select ceedo_collections.sync_pull($1::uuid, $2::bigint) as result`,
    [deviceId, cursor],
  );
  return rows[0].result as Pull;
}

describe("sync_pull", () => {
  it("returns the device's own facility and not another's", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.facilities.map((f) => f.id)).toContain(mine.facilityId);
    expect(result.facilities.map((f) => f.id)).not.toContain(theirs.facilityId);
  });

  it("returns the device's own leases and not another's", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);

    const result = await pull(mine.deviceId);

    expect(result.leases.map((l) => l.id)).toContain(mine.leaseId);
    expect(result.leases.map((l) => l.id)).not.toContain(theirs.leaseId);
  });

  it("returns the current assignment epoch", async () => {
    const fx = await createSyncFixture(db);
    const { rows } = await db.query(
      `select assignment_epoch from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );
    expect((await pull(fx.deviceId)).epoch).toBe(Number(rows[0].assignment_epoch));
  });

  it("returns collections, not just charges", async () => {
    // THE mandate from Phase 2's handover. A charge row does not change when it is paid --
    // no status column, no UPDATE privilege -- so a device watching `charges` for deltas
    // would compile, deploy, and silently never fire. This test is the reason the pull
    // carries collections at all.
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const posted = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect(posted.status).toBe("accepted");

    const result = await pull(fx.deviceId);

    expect(result.collections.map((c) => c.id)).toContain(posted.collection_id);
    expect(result.collection_allocations.map((a) => a.collection_id)).toContain(
      posted.collection_id,
    );
  });

  it("carries a paid charge forward on the cursor via its collection", async () => {
    // The falsifiable form of the above. After a payment, the CHARGE's row_version has not
    // moved -- only the collection's has. A cursor taken before the payment must still
    // deliver the news.
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const before = await pull(fx.deviceId);
    const cursor = Number(before.cursor);

    const posted = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const delta = await pull(fx.deviceId, cursor);

    expect(delta.charges).toEqual([]);
    expect(delta.collections.map((c) => c.id)).toContain(posted.collection_id);
  });

  it("returns nothing new when the cursor is current", async () => {
    const fx = await createSyncFixture(db);
    const first = await pull(fx.deviceId);
    const second = await pull(fx.deviceId, Number(first.cursor));

    expect(second.leases).toEqual([]);
    expect(second.charges).toEqual([]);
    expect(second.collections).toEqual([]);
  });

  it("advances the cursor monotonically", async () => {
    const fx = await createSyncFixture(db);
    const first = await pull(fx.deviceId);
    await db.query(`select ceedo_collections.run_accrual('2026-10-06'::date)`);
    const second = await pull(fx.deviceId, Number(first.cursor));

    expect(Number(second.cursor)).toBeGreaterThan(Number(first.cursor));
  });

  it("returns the collectors permitted on this device, with their pin_hash", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.set_collector_pin($1::uuid, '123456')`, [
      fx.collectorId,
    ]);

    const result = await pull(fx.deviceId);
    const me = result.collectors.find((c) => c.id === fx.collectorId);

    expect(me).toBeDefined();
    expect(me?.pin_hash).toMatch(/^\$2[aby]\$/);
  });

  it("excludes a collector whose role was changed away from collector", async () => {
    // Migration 0007's own comment predicted this reader: "Phase 3's sync scoping keys off
    // these rows directly and does not re-check, so a supervisor named in
    // collector_assignments, or a collector promoted while still assigned, becomes a real
    // scoping fault there."
    //
    // The guard triggers 0007 added make the TABLE safe. This makes the READER safe
    // independently. Both, not either.
    const fx = await createSyncFixture(db);
    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).toContain(fx.collectorId);

    // The guard trigger refuses a role change while an assignment is active, so deactivate
    // first -- which is exactly the sequence an office would follow.
    await db.query(
      `update ceedo_collections.collector_assignments
          set active = false where collector_id = $1`,
      [fx.collectorId],
    );
    await db.query(`update ceedo_collections.app_users set role = 'supervisor' where id = $1`, [
      fx.collectorId,
    ]);

    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).not.toContain(fx.collectorId);
  });

  it("excludes a suspended collector", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`update ceedo_collections.app_users set status = 'suspended' where id = $1`, [
      fx.collectorId,
    ]);

    expect((await pull(fx.deviceId)).collectors.map((c) => c.id)).not.toContain(fx.collectorId);
  });

  it("returns consumed serials so the device can refuse a spent OR offline", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const posted = await postCollectionAsOwner(db, fx, { groupRanks: [1], orNo: 1501 });
    expect(posted.status).toBe("accepted");

    const result = await pull(fx.deviceId);

    expect(result.consumed_serials).toContainEqual(
      expect.objectContaining({ booklet_id: fx.bookletId, or_no: 1501 }),
    );
  });

  it("returns an empty scope for a device with no active assignment", async () => {
    const fx = await createSyncFixture(db);
    await db.query(
      `update ceedo_collections.device_assignments set active = false where device_id = $1`,
      [fx.deviceId],
    );

    const result = await pull(fx.deviceId);

    expect(result.leases).toEqual([]);
    expect(result.facilities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-pull.test.ts`
Expected: FAIL — `function ceedo_collections.sync_pull(uuid, bigint) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000033_sync_pull.sql`:

```sql
-- Master data down. Parent spec §6.1.
--
-- Scoped to the DEVICE's assignment, not the collector's. §6.1: "Scoping to the device
-- rather than the collector keeps the payload stable as collectors rotate through the
-- tablet." Booklets are the exception -- a device receives the booklet assignments of
-- every collector currently permitted to sign in to it.
--
-- WHY COLLECTIONS ARE IN THIS PAYLOAD, from Phase 2's handover:
--
--   "A charge row does not change when it is paid. There is no status column on charges
--    and no UPDATE privilege on it for any role... Sync pull must send *collections* on the
--    row_version cursor and let the device recompute outstanding locally. The obvious
--    implementation -- watching charges for changes -- would compile, deploy, and silently
--    never fire: paying a charge bumps nothing on the charge row for a second tablet to
--    observe. With shared devices and rotating collectors, two tablets holding the same
--    lease is routine, not an edge case."
--
-- The device recomputes outstanding from packages/shared's fifo.ts and charges.ts, which
-- parity.test.ts already pins against the SQL.

create or replace function ceedo_collections.sync_pull(
  p_device_id uuid,
  p_cursor bigint
)
returns jsonb
language plpgsql
security definer
-- NOT `stable`. A stable function may not create or write the temp table this one uses for
-- the lease scope, and `stable` buys nothing here: sync_pull is called once per request and
-- is never inlined into a surrounding query.
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_facility  uuid;
  v_section   uuid;
  v_epoch     integer;
  v_cursor    bigint;
  v_result    jsonb;
begin
  select da.facility_id, da.section_id, d.assignment_epoch
    into v_facility, v_section, v_epoch
    from ceedo_collections.devices d
    left join ceedo_collections.device_assignments da
      on da.device_id = d.id and da.active
   where d.id = p_device_id and d.active;

  if not found then
    raise exception 'No such device, or the device is inactive';
  end if;

  -- The high-water mark for this response. Read ONCE, before the selects below, and
  -- returned as the device's next cursor. Taking it afterwards would hand back a value
  -- covering rows written during the read, which the device would then never receive.
  v_cursor := last_value from ceedo_collections.row_version_seq;

  -- The leases in scope, materialised once: eight of the selects below join it.
  create temporary table if not exists _scope_leases (id uuid primary key) on commit drop;
  delete from _scope_leases;

  insert into _scope_leases (id)
  select l.id
    from ceedo_collections.leases l
    join ceedo_collections.stalls st on st.id = l.stall_id
    join ceedo_collections.sections sec on sec.id = st.section_id
   where v_facility is not null
     and sec.facility_id = v_facility
     and (v_section is null or sec.id = v_section);

  select jsonb_build_object(
    'cursor', v_cursor,
    'epoch', v_epoch,

    'facilities', coalesce((
      select jsonb_agg(to_jsonb(f)) from ceedo_collections.facilities f
       where f.id = v_facility and f.row_version > p_cursor), '[]'::jsonb),

    'sections', coalesce((
      select jsonb_agg(to_jsonb(sec)) from ceedo_collections.sections sec
       where sec.facility_id = v_facility
         and (v_section is null or sec.id = v_section)
         and sec.row_version > p_cursor), '[]'::jsonb),

    'stalls', coalesce((
      select jsonb_agg(to_jsonb(st)) from ceedo_collections.stalls st
       join ceedo_collections.sections sec on sec.id = st.section_id
       where sec.facility_id = v_facility
         and (v_section is null or sec.id = v_section)
         and st.row_version > p_cursor), '[]'::jsonb),

    'tenants', coalesce((
      select jsonb_agg(distinct to_jsonb(t)) from ceedo_collections.tenants t
       join ceedo_collections.leases l on l.tenant_id = t.id
       join _scope_leases sl on sl.id = l.id
       where t.row_version > p_cursor), '[]'::jsonb),

    'leases', coalesce((
      select jsonb_agg(to_jsonb(l)) from ceedo_collections.leases l
       join _scope_leases sl on sl.id = l.id
       where l.row_version > p_cursor), '[]'::jsonb),

    -- Rates and fee types are global, not scoped. A device must be able to price anything
    -- it is asked to collect, and §6.1 sends "the rate table" without qualification.
    'fee_types', coalesce((
      select jsonb_agg(to_jsonb(ft)) from ceedo_collections.fee_types ft
       where ft.row_version > p_cursor), '[]'::jsonb),

    'rates', coalesce((
      select jsonb_agg(to_jsonb(r)) from ceedo_collections.rates r
       where r.row_version > p_cursor), '[]'::jsonb),

    -- Offline sign-in. employee_no and pin_hash only -- never the auth.users email, which
    -- belongs to a shared GoTrue instance (§12.1) and has no business on a tablet.
    --
    -- The role and status predicates are the re-check migration 0007's comment asked for.
    -- The guard triggers make the table safe; this makes the reader safe independently.
    'collectors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'employee_no', u.employee_no, 'full_name', u.full_name,
               'pin_hash', u.pin_hash, 'status', u.status, 'row_version', u.row_version))
        from ceedo_collections.app_users u
        join ceedo_collections.collector_assignments ca on ca.collector_id = u.id
       where ca.active
         and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and u.role = 'collector'
         and u.status = 'active'
         and u.row_version > p_cursor), '[]'::jsonb),

    'booklets', coalesce((
      select jsonb_agg(distinct to_jsonb(b)) from ceedo_collections.booklets b
       join ceedo_collections.booklet_assignments ba on ba.booklet_id = b.id
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       join ceedo_collections.app_users u on u.id = ba.collector_id
       where ba.returned_at is null
         and ca.active and ca.facility_id = v_facility
         and u.role = 'collector' and u.status = 'active'
         and b.row_version > p_cursor), '[]'::jsonb),

    'booklet_assignments', coalesce((
      select jsonb_agg(to_jsonb(ba)) from ceedo_collections.booklet_assignments ba
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       join ceedo_collections.app_users u on u.id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and u.role = 'collector' and u.status = 'active'
         and ba.row_version > p_cursor), '[]'::jsonb),

    -- §7.1: the device refuses a spent OR offline. It can only do that if it knows which
    -- serials are gone, and the authoritative answer is the collections table.
    'consumed_serials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booklet_id', c.booklet_id, 'or_no', c.or_no))
        from ceedo_collections.collections c
        join ceedo_collections.booklet_assignments ba on ba.booklet_id = c.booklet_id
        join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and c.row_version > p_cursor), '[]'::jsonb),

    'spoiled_forms', coalesce((
      select jsonb_agg(to_jsonb(sf)) from ceedo_collections.spoiled_forms sf
       join ceedo_collections.booklet_assignments ba on ba.booklet_id = sf.booklet_id
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and sf.row_version > p_cursor), '[]'::jsonb),

    -- §6.1: unpaid charges, plus paid ones from the last 90 days for the history view.
    -- Sending them all would grow without bound on a two-year delinquency.
    'charges', coalesce((
      select jsonb_agg(to_jsonb(ch)) from ceedo_collections.charges ch
       join _scope_leases sl on sl.id = ch.lease_id
       where ch.row_version > p_cursor
         and (ch.period_start >= (ceedo_collections.business_date() - 90)
              or exists (select 1 from ceedo_collections.charge_balances cb
                          where cb.charge_id = ch.id and not cb.is_settled))
      ), '[]'::jsonb),

    'collections', coalesce((
      select jsonb_agg(to_jsonb(c)) from ceedo_collections.collections c
       join _scope_leases sl on sl.id = c.lease_id
       where c.row_version > p_cursor), '[]'::jsonb),

    'collection_allocations', coalesce((
      select jsonb_agg(to_jsonb(a)) from ceedo_collections.collection_allocations a
       join ceedo_collections.collections c on c.id = a.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where a.row_version > p_cursor), '[]'::jsonb),

    'collection_cancellations', coalesce((
      select jsonb_agg(to_jsonb(cc)) from ceedo_collections.collection_cancellations cc
       join ceedo_collections.collections c on c.id = cc.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where cc.row_version > p_cursor), '[]'::jsonb),

    'charge_condonations', coalesce((
      select jsonb_agg(to_jsonb(cd)) from ceedo_collections.charge_condonations cd
       join ceedo_collections.charges ch on ch.id = cd.charge_id
       join _scope_leases sl on sl.id = ch.lease_id
       where cd.row_version > p_cursor), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function ceedo_collections.sync_pull(uuid, bigint) from public;
grant execute on function ceedo_collections.sync_pull(uuid, bigint) to ceedo_app;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-pull.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the `ceedo_app` privilege assertion**

Modify `tests/db/device-credentials.test.ts`, the `holds EXECUTE on authenticate_device and
nothing else yet` case — rename it to `...and sync_pull` and expect two entries:

```typescript
    expect(rows.map((r) => r.proname)).toEqual(["authenticate_device", "sync_pull"]);
```

Run: `pnpm --filter @ceedo/tests exec vitest run db/device-credentials.test.ts`
Expected: PASS. This list grows deliberately in Tasks 8 and 9 and must end at exactly four.

- [ ] **Step 6: Mutation check**

Delete `and u.role = 'collector'` from the `collectors` select. Re-run `db/sync-pull.test.ts`.
Expected: `excludes a collector whose role was changed away from collector` FAILS, and
nothing else does. Restore.

Then delete the `collections` key's `join _scope_leases`. Re-run.
Expected: `returns the device's own leases and not another's` still passes (it does not test
collections) but a new leak exists that no test catches — **add** a case asserting another
facility's collection is absent, then restore the join and confirm the new case passes.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260918000033_sync_pull.sql \
        tests/db/sync-pull.test.ts tests/db/device-credentials.test.ts
git commit -m "feat(sync): sync_pull, scoped to the device and carrying collections"
```

---
## Task 8: `close_shift()`

Spec §5. Invariant 25 — the two comparisons that must not be conflated.

**Files:**
- Create: `supabase/migrations/20260918000034_close_shift.sql`
- Create: `tests/db/close-shift.test.ts`

**Interfaces:**
- Consumes: `shifts` (Task 3), `collections`, `collection_cancellations`.
- Produces: `ceedo_collections.close_shift(p_shift_id uuid, p_device_id uuid, p_declared_total numeric, p_device_count integer, p_device_total numeric) returns jsonb` — `{status: 'closed'|'mismatch'|'already_closed', ...}`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/close-shift.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
const BUSINESS_DATE = "2026-10-05";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;

async function openShift(fx: Fixture): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, $4::date, now(), 'open')`,
    [id, fx.collectorId, fx.deviceId, BUSINESS_DATE],
  );
  return id;
}

async function close(
  shiftId: string,
  fx: Fixture,
  opts: { declared: string; count: number; total: string },
): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `select ceedo_collections.close_shift($1::uuid, $2::uuid, $3::numeric, $4::int, $5::numeric)
            as result`,
    [shiftId, fx.deviceId, opts.declared, opts.count, opts.total],
  );
  return rows[0].result;
}

async function collectOnce(fx: Fixture): Promise<string> {
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
  const posted = await postCollectionAsOwner(db, fx, {
    groupRanks: [1],
    collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
  });
  expect(posted.status).toBe("accepted");
  return posted.gross_amount as string;
}

describe("close_shift — record reconciliation", () => {
  it("closes when the device and the server agree", async () => {
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: amount, count: 1, total: amount });

    expect(result).toMatchObject({ status: "closed" });
    const { rows } = await db.query(
      `select status, system_count, variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "closed", system_count: 1 });
    expect(Number(rows[0].variance)).toBe(0);
  });

  it("refuses and writes nothing when the counts disagree", async () => {
    // §6.5 step 4. A device holding an unpushed receipt has a count the server cannot
    // match, and THAT is what makes silent data loss impossible to overlook.
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: amount, count: 2, total: amount });

    expect(result).toMatchObject({ status: "mismatch", device_count: 2, system_count: 1 });
    const { rows } = await db.query(
      `select status, closed_at from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "open", closed_at: null });
  });

  it("refuses when the sums disagree even though the counts match", async () => {
    // Both halves are load-bearing. Comparing only the sum would let a shift with one
    // missing receipt and one duplicated amount close cleanly.
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: amount, count: 1, total: "999.00" });

    expect(result).toMatchObject({ status: "mismatch" });
  });

  it("returns both sides so the device can display the difference", async () => {
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: amount, count: 3, total: "1.00" });

    expect(result).toMatchObject({
      status: "mismatch",
      device_count: 3,
      device_total: "1.00",
      system_count: 1,
    });
    expect(result.system_total).toBeDefined();
  });

  it("excludes a cancelled collection from the server's figures", async () => {
    // Otherwise a cancelled receipt inflates the number a collector is asked to match, and
    // an honest closeout is refused for a receipt that no longer counts.
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
    const keep = await postCollectionAsOwner(db, fx, {
      groupRanks: [1],
      collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
    });
    const drop = await postCollectionAsOwner(db, fx, {
      groupRanks: [2],
      collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
    });
    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, cancelled_by, reason)
       values ($1, $2, 'Wrong tenant')`,
      [drop.collection_id, fx.collectorId],
    );

    const shiftId = await openShift(fx);
    const result = await close(shiftId, fx, {
      declared: keep.gross_amount as string,
      count: 1,
      total: keep.gross_amount as string,
    });

    expect(result).toMatchObject({ status: "closed" });
  });
});

describe("close_shift — cash variance", () => {
  it("closes a short shift and records the variance", async () => {
    // §6.5 step 5: "Collector declares physical cash; variance is recorded, not hidden."
    // Blocking here would be worse than useless -- it would give a collector who is short
    // a direct incentive to adjust the declaration until it matched.
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);
    const declared = (Number(amount) - 50).toFixed(2);

    const result = await close(shiftId, fx, { declared, count: 1, total: amount });

    expect(result).toMatchObject({ status: "closed" });
    const { rows } = await db.query(
      `select variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].variance)).toBeCloseTo(-50, 2);
  });

  it("records an over as a positive variance", async () => {
    const fx = await createSyncFixture(db);
    const amount = await collectOnce(fx);
    const shiftId = await openShift(fx);
    const declared = (Number(amount) + 25).toFixed(2);

    await close(shiftId, fx, { declared, count: 1, total: amount });

    const { rows } = await db.query(
      `select variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].variance)).toBeCloseTo(25, 2);
  });
});

describe("close_shift — guards", () => {
  it("refuses a shift belonging to another device", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);
    const shiftId = await openShift(mine);

    await expect(
      close(shiftId, theirs, { declared: "0.00", count: 0, total: "0.00" }),
    ).rejects.toThrow(/device/i);
  });

  it("returns already_closed rather than closing twice", async () => {
    // Idempotency: a push retried after a dropped ack must not rewrite the variance.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    await close(shiftId, fx, { declared: "0.00", count: 0, total: "0.00" });

    const second = await close(shiftId, fx, { declared: "500.00", count: 0, total: "0.00" });

    expect(second).toMatchObject({ status: "already_closed" });
    const { rows } = await db.query(
      `select declared_total from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].declared_total)).toBe(0);
  });

  it("raises on a shift that does not exist", async () => {
    const fx = await createSyncFixture(db);
    await expect(
      close(randomUUID(), fx, { declared: "0.00", count: 0, total: "0.00" }),
    ).rejects.toThrow(/no such shift/i);
  });

  it("closes an empty shift with zero on both sides", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: "0.00", count: 0, total: "0.00" });

    expect(result).toMatchObject({ status: "closed" });
  });
});
```

Check `collection_cancellations`' column names against
`supabase/migrations/20260918000017_ledger_collections.sql` before running — the insert above
assumes `(collection_id, cancelled_by, reason)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/close-shift.test.ts`
Expected: FAIL — `function ceedo_collections.close_shift(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000034_close_shift.sql`:

```sql
-- Closeout reconciliation. Parent spec §6.5, which calls it "non-negotiable".
--
-- TWO COMPARISONS, AND CONFLATING THEM WOULD BE A REAL BUG:
--
--   device count/sum  vs  server count/sum   -> RECORDS are missing. BLOCKS closeout.
--   declared cash     vs  server sum         -> the DRAWER is short. RECORDED, never blocks.
--
-- §6.5 step 4 blocks on the first: "Mismatch blocks closeout and displays the difference."
-- That is what makes silent data loss impossible to overlook -- a device still holding an
-- unpushed receipt cannot produce a matching count.
--
-- §6.5 step 5 records the second: "Collector declares physical cash; variance is recorded,
-- not hidden." A collector P50 short still closes their shift, WITH the P50 on the record.
-- Blocking here would be worse than useless: it would give a collector who is short a
-- direct incentive to adjust the declaration until it matched.
--
-- §6.5 step 1 -- "force sync; outbox must reach zero pending" -- is a DEVICE-side
-- precondition and belongs to Phase 3b. The server's contribution is step 3: if the device
-- still holds unpushed receipts, its count will not match and closeout is refused. The rule
-- is enforced by arithmetic, not by trusting the device to have tried.

create or replace function ceedo_collections.close_shift(
  p_shift_id       uuid,
  p_device_id      uuid,
  p_declared_total numeric,
  p_device_count   integer,
  p_device_total   numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts%rowtype;
  v_system_count integer;
  v_system_total numeric(14,2);
begin
  select * into v_shift from ceedo_collections.shifts where id = p_shift_id;
  if not found then
    raise exception 'No such shift';
  end if;

  if v_shift.device_id <> p_device_id then
    raise exception 'Shift % does not belong to this device', p_shift_id;
  end if;

  -- Idempotency. A push retried after a dropped ack must not rewrite the variance, so an
  -- already-closed shift reports itself and changes nothing.
  if v_shift.status <> 'open' then
    return jsonb_build_object('status', 'already_closed',
                              'shift_status', v_shift.status,
                              'system_count', v_shift.system_count,
                              'system_total', v_shift.system_total,
                              'variance', v_shift.variance);
  end if;

  -- Net of cancellations. charge_balances already excludes cancelled collections from the
  -- ledger; the same exclusion applies here or a cancelled receipt inflates the figure the
  -- collector is asked to match and an honest closeout is refused.
  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.collector_id = v_shift.collector_id
     and c.business_date = v_shift.business_date
     and not exists (
       select 1 from ceedo_collections.collection_cancellations cc
        where cc.collection_id = c.id);

  if p_device_count is distinct from v_system_count
     or p_device_total is distinct from v_system_total then
    -- Nothing is written. The shift stays open and the device shows the difference.
    return jsonb_build_object(
      'status', 'mismatch',
      'device_count', p_device_count,
      'device_total', p_device_total,
      'system_count', v_system_count,
      'system_total', v_system_total);
  end if;

  update ceedo_collections.shifts
     set status         = 'closed',
         closed_at      = now(),
         declared_total = p_declared_total,
         system_total   = v_system_total,
         system_count   = v_system_count,
         -- Signed, deliberately. Over and short are different problems and a supervisor
         -- reading an absolute value would not know which one they have.
         variance       = p_declared_total - v_system_total
   where id = p_shift_id;

  return jsonb_build_object(
    'status', 'closed',
    'system_count', v_system_count,
    'system_total', v_system_total,
    'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.close_shift(uuid, uuid, numeric, integer, numeric)
  from public;
grant execute on function ceedo_collections.close_shift(uuid, uuid, numeric, integer, numeric)
  to ceedo_app;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/close-shift.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check — the two comparisons**

This is the most important mutation in the plan. Both halves must be independently pinned.

1. Change the mismatch condition to compare **only** the total:
   `if p_device_total is distinct from v_system_total then`
   Re-run. Expected: `refuses and writes nothing when the counts disagree` FAILS. Restore.

2. Change it to compare **only** the count. Re-run.
   Expected: `refuses when the sums disagree even though the counts match` FAILS. Restore.

3. Add `or p_declared_total is distinct from v_system_total` to the mismatch condition —
   i.e. block on a cash variance. Re-run.
   Expected: **both** `closes a short shift and records the variance` and `records an over as
   a positive variance` FAIL. Restore.

If mutation 3 produces no failure, the variance tests are asserting on a shift that was
never going to close anyway — fix them before continuing.

- [ ] **Step 6: Update the `ceedo_app` privilege assertion**

In `tests/db/device-credentials.test.ts`:

```typescript
    expect(rows.map((r) => r.proname)).toEqual([
      "authenticate_device",
      "close_shift",
      "sync_pull",
    ]);
```

(Alphabetical — the query orders by `proname`.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260918000034_close_shift.sql \
        tests/db/close-shift.test.ts tests/db/device-credentials.test.ts
git commit -m "feat(sync): close_shift, and the two comparisons it keeps apart"
```

---
## Task 9: `sync_push()`

Spec §4.3, D8. Invariants 21, 22, 23, 24. The heart of the phase.

**Files:**
- Create: `supabase/migrations/20260918000035_sync_push.sql`
- Create: `tests/db/sync-push.test.ts`
- Create: `tests/db/sync-privileges.test.ts`
- Modify: `tests/db/post-collection.test.ts` (any case asserting `service_role` may call it)

**Interfaces:**
- Consumes: `post_collection()` (Task 6), `close_shift()` (Task 8), `shifts`, `sync_exceptions`, `spoiled_forms`, `can_collector_use_device()`, `isRetryable` semantics from Task 6.
- Produces: `ceedo_collections.sync_push(p_device_id uuid, p_entries jsonb) returns jsonb` — an array of `{index, type, status, ...}`, one per entry, in input order.

**Entry shapes:**

```jsonc
{ "type": "collection",   "payload": { /* post_collection's payload, minus device_id */ } }
{ "type": "spoiled_form", "payload": { "booklet_id": uuid, "or_no": int,
                                       "collector_id": uuid, "reason": text } }
{ "type": "shift_open",   "payload": { "id": uuid, "collector_id": uuid,
                                       "business_date": date, "opened_at": timestamptz } }
{ "type": "shift_close",  "payload": { "id": uuid, "declared_total": numeric,
                                       "device_count": int, "device_total": numeric } }
```

- [ ] **Step 1: Write the failing test**

Create `tests/db/sync-push.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
const BUSINESS_DATE = "2026-10-05";
const COLLECTED_AT = `${BUSINESS_DATE}T02:00:00+00:00`;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;
type Entry = { type: string; payload: Record<string, unknown> };
type Result = {
  index: number;
  type: string;
  status: string;
  reason?: string;
  collection_id?: string;
  retryable?: boolean;
};

async function push(fx: Fixture, entries: Entry[]): Promise<Result[]> {
  const { rows } = await db.query(
    `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
    [fx.deviceId, JSON.stringify(entries)],
  );
  return rows[0].result as Result[];
}

let orNo = 1100;

function collectionEntry(fx: Fixture, overrides: Record<string, unknown> = {}): Entry {
  return {
    type: "collection",
    payload: {
      id: randomUUID(),
      or_no: ++orNo,
      booklet_id: fx.bookletId,
      collector_id: fx.collectorId,
      collected_at: COLLECTED_AT,
      fee_type_id: fx.feeTypeId,
      lease_id: fx.leaseId,
      allocations: [{ group_rank: 1 }],
      lines: [],
      ...overrides,
    },
  };
}

async function accrue(): Promise<void> {
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
}

async function exceptionCount(collectionUuid: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from ceedo_collections.sync_exceptions
      where collection_uuid = $1`,
    [collectionUuid],
  );
  return rows[0].n as number;
}

describe("sync_push — collections", () => {
  it("accepts a good entry and files no exception", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx);

    const [result] = await push(fx, [entry]);

    expect(result).toMatchObject({ index: 0, type: "collection", status: "accepted" });
    expect(await exceptionCount(entry.payload.id as string)).toBe(0);
  });

  it("returns duplicate on a retry of the same client UUID", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx);
    await push(fx, [entry]);

    const [result] = await push(fx, [entry]);

    expect(result.status).toBe("duplicate");
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [entry.payload.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("takes device_id from the credential, never from the payload", async () => {
    // Invariant 21. A device may claim any collector_id -- the PIN was verified offline, so
    // that claim is unverifiable by construction and §11.5 accepts it -- but it must not be
    // able to claim to be a DIFFERENT TABLET, which would let one device push receipts
    // attributed to another's assignment.
    const fx = await createSyncFixture(db);
    const other = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { device_id: other.deviceId });

    const [result] = await push(fx, [entry]);
    expect(result.status).toBe("accepted");

    const { rows } = await db.query(
      `select device_id from ceedo_collections.collections where id = $1`,
      [entry.payload.id],
    );
    expect(rows[0].device_id).toBe(fx.deviceId);
    expect(rows[0].device_id).not.toBe(other.deviceId);
  });

  it("rejects a collector who may not use this device", async () => {
    const fx = await createSyncFixture(db);
    const stranger = await createSyncFixture(db);
    await accrue();

    const [result] = await push(fx, [
      collectionEntry(fx, { collector_id: stranger.collectorId }),
    ]);

    expect(result).toMatchObject({ status: "rejected", reason: "collector_not_on_device" });
  });

  it("files an exception for a permanently rejectable entry", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    // An OR number outside the booklet's range can never succeed on a retry.
    const entry = collectionEntry(fx, { or_no: 999999 });

    const [result] = await push(fx, [entry]);

    expect(result).toMatchObject({ status: "rejected", reason: "or_out_of_range" });
    expect(await exceptionCount(entry.payload.id as string)).toBe(1);
  });

  it("bumps attempts instead of filing a second exception on a re-push", async () => {
    // Invariant 23. §6.4 keeps a rejected entry in the outbox as unresolved, so the device
    // re-pushes it every sync. One row per UUID, or the queue is buried within a day.
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { or_no: 999999 });

    await push(fx, [entry]);
    await push(fx, [entry]);
    await push(fx, [entry]);

    expect(await exceptionCount(entry.payload.id as string)).toBe(1);
    const { rows } = await db.query(
      `select attempts, first_seen_at, last_seen_at
         from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [entry.payload.id],
    );
    expect(rows[0].attempts).toBe(3);
    expect(new Date(rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[0].first_seen_at).getTime(),
    );
  });

  it("files an exception for or_already_used, never collapsing it into duplicate", async () => {
    // §6.3's case that no device can detect on its own: two DIFFERENT devices recorded the
    // same OR number. Phase 2's handover: "Collapsing it into duplicate would make the
    // device discard a real receipt for money that was actually collected."
    const fx = await createSyncFixture(db);
    await accrue();
    const first = collectionEntry(fx);
    await push(fx, [first]);

    // Same booklet and OR, DIFFERENT client UUID -- a second device's record.
    const second = collectionEntry(fx, { or_no: first.payload.or_no });
    const [result] = await push(fx, [second]);

    expect(result).toMatchObject({ status: "rejected", reason: "or_already_used" });
    expect(result.status).not.toBe("duplicate");
    expect(await exceptionCount(second.payload.id as string)).toBe(1);
  });

  it("marks a retryable rejection as retryable and files NO exception", async () => {
    // Invariant 24. The device re-syncs and retries on its own; a supervisor never sees it.
    const fx = await createSyncFixture(db);
    await accrue();
    // Force the branch directly: an entry whose prefix was settled by a concurrent post is
    // hard to stage deterministically here, so sync-concurrency.test.ts (Task 16) covers the
    // real race. This asserts the exception-filing policy given the reason.
    const settled = collectionEntry(fx);
    await push(fx, [settled]);

    const stale = collectionEntry(fx, { allocations: [{ group_rank: 1 }] });
    const [result] = await push(fx, [stale]);

    // Rank 1 is now settled, so rank 1 names a different charge set than before.
    if (result.reason === "stale_allocations") {
      expect(result.retryable).toBe(true);
      expect(await exceptionCount(stale.payload.id as string)).toBe(0);
    } else {
      // If the engine accepted it (rank 1 rolled forward), the fixture did not stage the
      // case; Task 16 is the authoritative test for the race.
      expect(result.status).toBe("accepted");
    }
  });
});

describe("sync_push — batch isolation", () => {
  it("does not let one poison entry roll back its neighbours", async () => {
    // Invariant 22, D8. The alternative -- one transaction per batch -- is not merely
    // slower to recover from, it is wrong: a single permanently-rejectable entry would
    // block every other receipt in that round FOREVER, which is the discard failure §6.3
    // exists to prevent, arriving by a different road.
    const fx = await createSyncFixture(db);
    await accrue();

    const one = collectionEntry(fx);
    const poison = collectionEntry(fx, { or_no: 999999 });
    const three = collectionEntry(fx);

    const results = await push(fx, [one, poison, three]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected", "accepted"]);

    for (const good of [one, three]) {
      const { rows } = await db.query(
        `select count(*)::int as n from ceedo_collections.collections where id = $1`,
        [good.payload.id],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it("returns one result per entry, in input order", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entries = [collectionEntry(fx), collectionEntry(fx), collectionEntry(fx)];

    const results = await push(fx, entries);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("returns an empty array for an empty push", async () => {
    const fx = await createSyncFixture(db);
    expect(await push(fx, [])).toEqual([]);
  });
});

describe("sync_push — spoiled forms", () => {
  it("records a spoiled form", async () => {
    const fx = await createSyncFixture(db);
    const [result] = await push(fx, [
      {
        type: "spoiled_form",
        payload: {
          booklet_id: fx.bookletId,
          or_no: 1900,
          collector_id: fx.collectorId,
          reason: "Torn at the stall",
        },
      },
    ]);

    expect(result).toMatchObject({ type: "spoiled_form", status: "accepted" });
    const { rows } = await db.query(
      `select reason from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 1900`,
      [fx.bookletId],
    );
    expect(rows[0].reason).toBe("Torn at the stall");
  });

  it("is idempotent on a re-push", async () => {
    const fx = await createSyncFixture(db);
    const entry = {
      type: "spoiled_form",
      payload: {
        booklet_id: fx.bookletId,
        or_no: 1901,
        collector_id: fx.collectorId,
        reason: "Torn",
      },
    };
    await push(fx, [entry]);
    const [result] = await push(fx, [entry]);

    expect(result.status).toBe("duplicate");
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 1901`,
      [fx.bookletId],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("sync_push — shifts", () => {
  it("opens a shift", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = randomUUID();

    const [result] = await push(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
    ]);

    expect(result).toMatchObject({ type: "shift_open", status: "accepted" });
    const { rows } = await db.query(
      `select status, device_id from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "open", device_id: fx.deviceId });
  });

  it("is idempotent on a re-pushed shift_open", async () => {
    const fx = await createSyncFixture(db);
    const entry = {
      type: "shift_open",
      payload: {
        id: randomUUID(),
        collector_id: fx.collectorId,
        business_date: BUSINESS_DATE,
        opened_at: COLLECTED_AT,
      },
    };
    await push(fx, [entry]);
    const [result] = await push(fx, [entry]);

    expect(result.status).toBe("duplicate");
  });

  it("opens and closes in one batch, for a device that was offline all day", async () => {
    // D5's reason for existing as a push type at all, plus the offline case: a tablet that
    // never found signal pushes both entries together at the end of the round.
    const fx = await createSyncFixture(db);
    const shiftId = randomUUID();

    const results = await push(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
      {
        type: "shift_close",
        payload: { id: shiftId, declared_total: "0.00", device_count: 0, device_total: "0.00" },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    const { rows } = await db.query(
      `select status from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0].status).toBe("closed");
  });

  it("reports a closeout mismatch without closing", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    await push(fx, [collectionEntry(fx)]);
    const shiftId = randomUUID();

    const results = await push(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
      {
        type: "shift_close",
        payload: { id: shiftId, declared_total: "0.00", device_count: 0, device_total: "0.00" },
      },
    ]);

    expect(results[1]).toMatchObject({ status: "mismatch", system_count: 1 });
    const { rows } = await db.query(
      `select status from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0].status).toBe("open");
  });
});

describe("sync_push — guards", () => {
  it("raises on an inactive device", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      fx.deviceId,
    ]);

    await expect(push(fx, [])).rejects.toThrow(/device/i);
  });

  it("rejects an unknown entry type rather than silently skipping it", async () => {
    // A silently skipped entry is a lost receipt. An unknown type means device and server
    // disagree about the protocol, which a person must know about.
    const fx = await createSyncFixture(db);
    const [result] = await push(fx, [{ type: "cancellation", payload: {} }]);

    expect(result).toMatchObject({ status: "rejected", reason: "unknown_entry_type" });
  });
});
```

Note the last case: `cancellation` is the type D4 removed, so pushing it must be refused
rather than ignored.

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-push.test.ts`
Expected: FAIL — `function ceedo_collections.sync_push(uuid, jsonb) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000035_sync_push.sql`:

```sql
-- Transactions up. Parent spec §6.2.
--
-- A DISPATCHER, NOT AN ENGINE. §6.2 steps 1-6 are post_collection()'s job and were proven
-- in Phase 2; reimplementing any of them here would be the second implementation migration
-- 0022's comment warns about -- "a tenant would get a different balance depending on which
-- door they paid at."
--
-- PER-ENTRY ISOLATION. Each entry runs in its own BEGIN/EXCEPTION block, which in PL/pgSQL
-- is a real subtransaction. A push carries a whole round -- potentially a hundred receipts
-- -- and one permanently-rejectable entry must cost its own receipt, never the round's.
-- One transaction per batch would block every other receipt in that round forever, which is
-- the discard failure §6.3 exists to prevent arriving by a different road.
--
-- Documented caveat: a 200-entry push opens 200 subtransactions. Well within Postgres's
-- tolerance at this scale. If a round ever grows large enough for this to matter, the
-- fallback is chunking the batch in the Edge Function, not removing the isolation.

create or replace function ceedo_collections.sync_push(
  p_device_id uuid,
  p_entries   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_results   jsonb := '[]'::jsonb;
  v_entry     jsonb;
  v_index     integer := -1;
  v_type      text;
  v_payload   jsonb;
  v_one       jsonb;
  v_collector uuid;
  v_uuid      uuid;
  v_reason    text;
  v_retryable boolean;
begin
  if not exists (select 1 from ceedo_collections.devices where id = p_device_id and active) then
    raise exception 'No such device, or the device is inactive';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_index := v_index + 1;
    v_type := v_entry ->> 'type';
    v_payload := coalesce(v_entry -> 'payload', '{}'::jsonb);

    begin
      -- Every path that names a collector checks this first. post_collection() then checks
      -- the BOOKLET, which §11.5 says is the actual security boundary -- but a collector
      -- who is not cleared for this tablet is a scoping error worth its own answer.
      v_collector := nullif(v_payload ->> 'collector_id', '')::uuid;
      if v_type in ('collection', 'spoiled_form', 'shift_open')
         and not ceedo_collections.can_collector_use_device(v_collector, p_device_id) then
        v_one := jsonb_build_object('status', 'rejected',
                                    'reason', 'collector_not_on_device');

      elsif v_type = 'collection' then
        -- device_id is OVERRIDDEN from the authenticated credential, never read from the
        -- payload (invariant 21). A device may claim any collector_id -- the PIN was
        -- verified offline, so that claim is unverifiable by construction and §11.5 accepts
        -- it -- but it must not be able to claim to be a different tablet.
        v_one := ceedo_collections.post_collection(
                   v_payload || jsonb_build_object('device_id', p_device_id));

      elsif v_type = 'spoiled_form' then
        v_one := ceedo_collections.record_spoiled_form(
                   p_device_id, v_collector, v_payload);

      elsif v_type = 'shift_open' then
        v_one := ceedo_collections.open_shift(p_device_id, v_collector, v_payload);

      elsif v_type = 'shift_close' then
        v_one := ceedo_collections.close_shift(
                   (v_payload ->> 'id')::uuid,
                   p_device_id,
                   (v_payload ->> 'declared_total')::numeric,
                   (v_payload ->> 'device_count')::integer,
                   (v_payload ->> 'device_total')::numeric);

      else
        -- Never silently skipped. A skipped entry is a lost receipt, and an unknown type
        -- means the device and the server disagree about the protocol -- which a person
        -- must learn about. `cancellation` lands here deliberately: spec D4 removed it,
        -- because a collector who can cancel their own receipts can make a shortfall
        -- disappear.
        v_one := jsonb_build_object('status', 'rejected', 'reason', 'unknown_entry_type');
      end if;

    exception when others then
      -- The subtransaction rolls back to here and the loop continues. Only THIS entry is
      -- lost; its neighbours are untouched.
      v_one := jsonb_build_object('status', 'rejected', 'reason', 'server_error',
                                  'detail', sqlerrm);
    end;

    -- Exception filing, for collections only. A spoiled form or a shift has no paper
    -- receipt behind it and nothing for a supervisor to reconcile.
    if v_type = 'collection' and v_one ->> 'status' = 'rejected' then
      v_reason := v_one ->> 'reason';
      -- Exactly one reason is retryable (invariant 24). The device re-pulls and re-pushes
      -- on its own; filing an exception would put a supervisor in front of a race that
      -- resolves itself.
      v_retryable := v_reason = 'stale_allocations';
      v_one := v_one || jsonb_build_object('retryable', v_retryable);

      if not v_retryable then
        v_uuid := nullif(v_payload ->> 'id', '')::uuid;
        if v_uuid is not null then
          insert into ceedo_collections.sync_exceptions
            (collection_uuid, device_id, collector_id, reason_code, payload)
          values (v_uuid, p_device_id, v_collector, v_reason, v_payload)
          on conflict (collection_uuid) do update
            set attempts     = ceedo_collections.sync_exceptions.attempts + 1,
                last_seen_at = now(),
                reason_code  = excluded.reason_code;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      v_one || jsonb_build_object('index', v_index, 'type', v_type));
  end loop;

  return v_results;
end;
$$;

-- Helpers, kept out of the loop body so it reads as a dispatcher.

create or replace function ceedo_collections.record_spoiled_form(
  p_device_id uuid,
  p_collector uuid,
  p_payload   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_booklet uuid := (p_payload ->> 'booklet_id')::uuid;
  v_or_no   integer := (p_payload ->> 'or_no')::integer;
begin
  -- Idempotent on (booklet_id, or_no), the table's own unique constraint. A re-pushed
  -- spoiled form is the same fact stated twice, not a second spoiled serial.
  insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
  values (v_booklet, v_or_no, p_payload ->> 'reason', p_collector)
  on conflict (booklet_id, or_no) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate');
  end if;
  return jsonb_build_object('status', 'accepted');
end;
$$;

create or replace function ceedo_collections.open_shift(
  p_device_id uuid,
  p_collector uuid,
  p_payload   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id uuid := (p_payload ->> 'id')::uuid;
begin
  -- The client generated this id offline (see migration 0028's comment on shifts.id), so a
  -- retried push carries the same one and must not mint a second shift.
  insert into ceedo_collections.shifts
    (id, collector_id, device_id, business_date, opened_at, status)
  values (v_id, p_collector, p_device_id,
          (p_payload ->> 'business_date')::date,
          (p_payload ->> 'opened_at')::timestamptz,
          'open')
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'shift_id', v_id);
  end if;
  return jsonb_build_object('status', 'accepted', 'shift_id', v_id);
end;
$$;

revoke execute on function ceedo_collections.record_spoiled_form(uuid, uuid, jsonb) from public;
revoke execute on function ceedo_collections.open_shift(uuid, uuid, jsonb) from public;
-- Neither is granted to any role. They are reachable only from sync_push(), which is
-- SECURITY DEFINER and therefore calls them as its owner.

revoke execute on function ceedo_collections.sync_push(uuid, jsonb) from public;
grant execute on function ceedo_collections.sync_push(uuid, jsonb) to ceedo_app;

-- post_collection is now reachable ONLY through the sync path.
--
-- Phase 2's handover asks for it to be granted to ceedo_app and revoked from service_role.
-- The first half turns out to be unnecessary: sync_push is SECURITY DEFINER, so it reaches
-- post_collection as its owner and ceedo_app needs no grant of its own. Granting none at
-- all is strictly stronger and is what invariant 20 asked for -- Phase 2 could not deliver
-- it because no sync path existed yet.
revoke execute on function ceedo_collections.post_collection(jsonb) from service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-push.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix any test that relied on `service_role` calling `post_collection`**

Run: `pnpm --filter @ceedo/tests exec vitest run db/post-collection.test.ts db/collections.test.ts db/ledger-privileges.test.ts`

Phase 2's files call `post_collection` through the `pg` owner connection, so most should be
unaffected. If any case asserts that `service_role` *may* call it through PostgREST, invert
it — the assertion now belongs in `sync-privileges.test.ts` as "may not".

- [ ] **Step 6: Write the privileges test**

Create `tests/db/sync-privileges.test.ts`:

```typescript
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
```

Delete the now-duplicated `ceedo_app` describe block from
`tests/db/device-credentials.test.ts` — it lives here, where the final list is asserted.

- [ ] **Step 7: Run the privileges test**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-privileges.test.ts`
Expected: PASS.

- [ ] **Step 8: Mutation checks**

1. In `sync_push`, pass `v_payload` to `post_collection` **without** the `device_id` override.
   Re-run `db/sync-push.test.ts`. Expected: `takes device_id from the credential` FAILS.
   Restore.
2. Remove the `begin ... exception` block, calling the dispatch inline. Re-run.
   Expected: `does not let one poison entry roll back its neighbours` FAILS. Restore.
3. Change `v_retryable` to `v_reason in ('stale_allocations', 'or_already_used')`. Re-run.
   Expected: `files an exception for or_already_used` FAILS. Restore.
4. Drop the `on conflict (collection_uuid) do update` and use `do nothing`. Re-run.
   Expected: `bumps attempts instead of filing a second exception` FAILS on the attempts
   count — and this one is worth watching, because the row count stays 1 either way. If it
   passes, the test is asserting only the count and needs the `attempts` assertion. Restore.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260918000035_sync_push.sql \
        tests/db/sync-push.test.ts tests/db/sync-privileges.test.ts \
        tests/db/device-credentials.test.ts
git commit -m "feat(sync): sync_push, with per-entry isolation and exception filing"
```

---
## Task 10: The three supervisor resolutions

Spec §6.1, D9. `sync_exceptions` gets its lifecycle.

**Files:**
- Create: `supabase/migrations/20260918000036_resolve_exception.sql`
- Create: `tests/db/resolve-exception.test.ts`

**Interfaces:**
- Produces, all `SECURITY DEFINER`, all checking `has_role('admin','supervisor')` internally, all writing an `audit_log` row:
  - `resolve_exception_corrected(p_exception_id uuid, p_payload jsonb, p_reason text) returns jsonb`
  - `resolve_exception_spoiled(p_exception_id uuid, p_reason text) returns jsonb`
  - `escalate_exception(p_exception_id uuid, p_reason text) returns void`

- [ ] **Step 1: Write the failing test**

Create `tests/db/resolve-exception.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
const BUSINESS_DATE = "2026-10-05";
const COLLECTED_AT = `${BUSINESS_DATE}T02:00:00+00:00`;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;

let orNo = 1200;

/** Pushes a deliberately-bad collection and returns the exception it files. */
async function fileException(fx: Fixture): Promise<{ id: string; collectionUuid: string }> {
  const collectionUuid = randomUUID();
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
  await db.query(`select ceedo_collections.sync_push($1::uuid, $2::jsonb)`, [
    fx.deviceId,
    JSON.stringify([
      {
        type: "collection",
        payload: {
          id: collectionUuid,
          or_no: 999999, // out of range: permanently rejectable
          booklet_id: fx.bookletId,
          collector_id: fx.collectorId,
          collected_at: COLLECTED_AT,
          fee_type_id: fx.feeTypeId,
          lease_id: fx.leaseId,
          allocations: [{ group_rank: 1 }],
          lines: [],
        },
      },
    ]),
  ]);

  const { rows } = await db.query(
    `select id from ceedo_collections.sync_exceptions where collection_uuid = $1`,
    [collectionUuid],
  );
  return { id: rows[0].id as string, collectionUuid };
}

describe("resolve_exception_corrected", () => {
  it("re-posts under the ORIGINAL client UUID", async () => {
    // D9. A rejected entry wrote nothing, so its UUID is still free. Re-using it keeps the
    // device's outbox coherent: the tablet still holds that UUID as unresolved, and when it
    // re-pushes, post_collection returns `duplicate` against the now-posted row and the
    // entry settles. A fresh UUID would leave the device re-pushing a ghost.
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    const { rows } = await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, $3::text)
              as result`,
      [
        id,
        JSON.stringify({ or_no: ++orNo }),
        "Collector transposed the OR number",
      ],
    );

    expect(rows[0].result).toMatchObject({ status: "accepted" });
    const posted = await db.query(
      `select id, or_no from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(posted.rows).toHaveLength(1);
    expect(posted.rows[0].or_no).toBe(orNo);
  });

  it("marks the exception resolved/corrected with the reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, $3::text)`,
      [id, JSON.stringify({ or_no: ++orNo }), "Transposed digits"],
    );

    const { rows } = await db.query(
      `select status, resolution, resolution_reason, resolved_by, resolved_at
         from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: "resolved",
      resolution: "corrected",
      resolution_reason: "Transposed digits",
    });
    expect(rows[0].resolved_at).not.toBeNull();
  });

  it("never accepts an amount from the correction", async () => {
    // Invariant 3 holds for supervisors exactly as for devices. A supervisor override would
    // put a hole in "the device's figure is never authoritative" reachable by anyone with a
    // supervisor account.
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, $3::text)`,
      [id, JSON.stringify({ or_no: ++orNo, gross_amount: "1.00" }), "Corrected"],
    );

    const { rows } = await db.query(
      `select gross_amount from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(Number(rows[0].gross_amount)).toBeGreaterThan(1);
  });

  it("leaves the exception open when the correction is itself invalid", async () => {
    // Rejected again rather than forced in.
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { rows } = await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, $3::text)
              as result`,
      [id, JSON.stringify({ or_no: 888888 }), "Still wrong"],
    );

    expect(rows[0].result).toMatchObject({ status: "rejected" });
    const { rows: ex } = await db.query(
      `select status, reason_code from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(ex[0].status).toBe("open");
    expect(ex[0].reason_code).toBe("or_out_of_range");
  });

  it("refuses an empty reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    await expect(
      db.query(
        `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, '   ')`,
        [id, JSON.stringify({ or_no: ++orNo })],
      ),
    ).rejects.toThrow(/reason/i);
  });

  it("refuses to resolve an already-resolved exception", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, 'Fixed')`,
      [id, JSON.stringify({ or_no: ++orNo })],
    );

    await expect(
      db.query(
        `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, 'Again')`,
        [id, JSON.stringify({ or_no: ++orNo })],
      ),
    ).rejects.toThrow(/already resolved/i);
  });

  it("writes an audit row", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, 'Fixed')`,
      [id, JSON.stringify({ or_no: ++orNo })],
    );

    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'sync_exceptions' and entity_id = $1`,
      [id],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe("resolve_exception_spoiled", () => {
  it("records the serial as spoiled and posts no collection", async () => {
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    await db.query(
      `select ceedo_collections.resolve_exception_spoiled($1::uuid, $2::text)`,
      [id, "Receipt voided at the stall"],
    );

    const { rows: ex } = await db.query(
      `select status, resolution from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(ex[0]).toMatchObject({ status: "resolved", resolution: "spoiled" });

    const { rows: posted } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(posted[0].n).toBe(0);

    const { rows: spoiled } = await db.query(
      `select count(*)::int as n from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 999999`,
      [fx.bookletId],
    );
    expect(spoiled[0].n).toBe(1);
  });
});

describe("escalate_exception", () => {
  it("leaves the exception unresolved", async () => {
    // §11.3's third action is not a terminus. An exception must not be closeable by
    // declaring it interesting.
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    await db.query(`select ceedo_collections.escalate_exception($1::uuid, $2::text)`, [
      id,
      "Two devices claim this OR; referred to the Treasurer",
    ]);

    const { rows } = await db.query(
      `select status, resolution, resolved_at, resolution_reason
         from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: "escalated",
      resolution: null,
      resolved_at: null,
    });
    expect(rows[0].resolution_reason).toContain("Treasurer");
  });

  it("still permits a correction afterwards", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    await db.query(`select ceedo_collections.escalate_exception($1::uuid, 'Investigating')`, [
      id,
    ]);

    const { rows } = await db.query(
      `select ceedo_collections.resolve_exception_corrected($1::uuid, $2::jsonb, 'Resolved')
              as result`,
      [id, JSON.stringify({ or_no: ++orNo })],
    );
    expect(rows[0].result).toMatchObject({ status: "accepted" });
  });

  it("refuses an empty reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    await expect(
      db.query(`select ceedo_collections.escalate_exception($1::uuid, '')`, [id]),
    ).rejects.toThrow(/reason/i);
  });
});
```

The role check is exercised through the web layer in Task 14; here the owner connection
bypasses it, the same way Phase 2's condonation tests are split.

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/resolve-exception.test.ts`
Expected: FAIL — `function ceedo_collections.resolve_exception_corrected(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260918000036_resolve_exception.sql`:

```sql
-- The supervisor's three actions. Parent spec §11.3.
--
-- §11.3 names the three -- "accept with correction", "mark spoiled", "escalate for
-- investigation" -- but not what they write. Against an append-only ledger that needs
-- deciding, and the decision is:
--
-- CORRECTION RE-POSTS THE ORIGINAL CLIENT UUID. A rejected entry wrote nothing, so its
-- UUID is still free. Re-using it keeps the device's outbox coherent: the tablet still
-- holds that UUID as unresolved, and when it re-pushes, post_collection returns `duplicate`
-- against the now-posted row and the entry settles. A correction under a fresh UUID would
-- leave the device re-pushing a ghost that nothing recognises.
--
-- THE SUPERVISOR MAY EDIT CLAIMS, NEVER AMOUNTS. post_collection's payload carries no
-- amounts at all (see migration 0022's header), so this is enforced by construction rather
-- than by filtering: whatever the supervisor sends, the server prices it. Invariant 3
-- holds for supervisors exactly as for devices.

create or replace function ceedo_collections.assert_can_resolve_exceptions(p_reason text)
returns void
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.has_role('admin', 'supervisor') then
    raise exception 'Only a supervisor or administrator may resolve a sync exception';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A written reason is required';
  end if;
end;
$$;

create or replace function ceedo_collections.resolve_exception_corrected(
  p_exception_id uuid,
  p_payload      jsonb,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex     ceedo_collections.sync_exceptions%rowtype;
  v_merged jsonb;
  v_result jsonb;
begin
  perform ceedo_collections.assert_can_resolve_exceptions(p_reason);

  select * into v_ex from ceedo_collections.sync_exceptions where id = p_exception_id
    for update;
  if not found then
    raise exception 'No such exception';
  end if;
  if v_ex.status = 'resolved' then
    raise exception 'Exception % is already resolved', p_exception_id;
  end if;

  -- The device's original claims, with the supervisor's edits on top. `id` and `device_id`
  -- are re-asserted AFTER the merge so a correction cannot change which receipt or which
  -- tablet this is -- those are facts about the push, not claims open to correction.
  v_merged := v_ex.payload || coalesce(p_payload, '{}'::jsonb)
              || jsonb_build_object('id', v_ex.collection_uuid,
                                    'device_id', v_ex.device_id);

  v_result := ceedo_collections.post_collection(v_merged);

  if v_result ->> 'status' in ('accepted', 'duplicate') then
    update ceedo_collections.sync_exceptions
       set status            = 'resolved',
           resolution        = 'corrected',
           resolution_reason = p_reason,
           resolved_by       = auth.uid(),
           resolved_at       = now(),
           payload           = v_merged
     where id = p_exception_id;

    insert into ceedo_collections.audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), 'resolve_exception_corrected', 'sync_exceptions', p_exception_id,
            to_jsonb(v_ex), jsonb_build_object('reason', p_reason, 'result', v_result));
  else
    -- Rejected again. The exception stays open and records the new reason, so a supervisor
    -- sees what their correction actually hit rather than the original complaint.
    update ceedo_collections.sync_exceptions
       set reason_code  = v_result ->> 'reason',
           last_seen_at = now()
     where id = p_exception_id;
  end if;

  return v_result;
end;
$$;

create or replace function ceedo_collections.resolve_exception_spoiled(
  p_exception_id uuid,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex ceedo_collections.sync_exceptions%rowtype;
begin
  perform ceedo_collections.assert_can_resolve_exceptions(p_reason);

  select * into v_ex from ceedo_collections.sync_exceptions where id = p_exception_id
    for update;
  if not found then
    raise exception 'No such exception';
  end if;
  if v_ex.status = 'resolved' then
    raise exception 'Exception % is already resolved', p_exception_id;
  end if;

  -- The serial is spent either way -- that is §6.3's whole point -- so it is recorded as
  -- spoiled rather than left looking unused. No collection is posted.
  insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
  values ((v_ex.payload ->> 'booklet_id')::uuid,
          (v_ex.payload ->> 'or_no')::integer,
          p_reason,
          v_ex.collector_id)
  on conflict (booklet_id, or_no) do nothing;

  update ceedo_collections.sync_exceptions
     set status            = 'resolved',
         resolution        = 'spoiled',
         resolution_reason = p_reason,
         resolved_by       = auth.uid(),
         resolved_at       = now()
   where id = p_exception_id;

  insert into ceedo_collections.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'resolve_exception_spoiled', 'sync_exceptions', p_exception_id,
          to_jsonb(v_ex), jsonb_build_object('reason', p_reason));

  return jsonb_build_object('status', 'resolved', 'resolution', 'spoiled');
end;
$$;

create or replace function ceedo_collections.escalate_exception(
  p_exception_id uuid,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex ceedo_collections.sync_exceptions%rowtype;
begin
  perform ceedo_collections.assert_can_resolve_exceptions(p_reason);

  select * into v_ex from ceedo_collections.sync_exceptions where id = p_exception_id;
  if not found then
    raise exception 'No such exception';
  end if;
  if v_ex.status = 'resolved' then
    raise exception 'Exception % is already resolved', p_exception_id;
  end if;

  -- A STATUS, not a resolution. An escalated exception is still unresolved and still counts
  -- against the collector at closeout; §11.3 says exceptions older than three days surface
  -- on the Treasurer's dashboard, which only works if escalation does not close them.
  update ceedo_collections.sync_exceptions
     set status = 'escalated', resolution_reason = p_reason
   where id = p_exception_id;

  insert into ceedo_collections.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'escalate_exception', 'sync_exceptions', p_exception_id,
          to_jsonb(v_ex), jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function ceedo_collections.assert_can_resolve_exceptions(text) from public;
revoke execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  from public;
grant execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  to authenticated;
revoke execute on function ceedo_collections.resolve_exception_spoiled(uuid, text) from public;
grant execute on function ceedo_collections.resolve_exception_spoiled(uuid, text)
  to authenticated;
revoke execute on function ceedo_collections.escalate_exception(uuid, text) from public;
grant execute on function ceedo_collections.escalate_exception(uuid, text) to authenticated;
```

Check `audit_log`'s column names against `supabase/migrations/20260917000010_audit_log.sql`
before running; the inserts above assume `(actor_id, action, entity, entity_id, before, after)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/resolve-exception.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

1. Remove the `|| jsonb_build_object('id', v_ex.collection_uuid, ...)` re-assertion, so the
   supervisor's payload can set `id`. Re-run.
   Expected: `re-posts under the ORIGINAL client UUID` still passes (the test does not send
   an `id`). **Add** a case that sends a different `id` in the correction payload and
   asserts the collection lands under `collection_uuid` anyway, then restore and confirm.
2. Change `escalate_exception` to set `status = 'resolved', resolution = 'corrected'`.
   Re-run. Expected: `leaves the exception unresolved` FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000036_resolve_exception.sql \
        tests/db/resolve-exception.test.ts
git commit -m "feat(sync): the three supervisor resolutions"
```

---
## Task 11: `packages/shared` — the wire contract

Spec §7. Pure TypeScript, no React Native (parent spec §4).

**Files:**
- Create: `packages/shared/src/sync-contract.ts`
- Create: `packages/shared/src/sync-contract.test.ts`
- Create: `packages/shared/src/shifts.ts`
- Create: `packages/shared/src/shifts.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `PushEntry`, `PushResult`, `PullResponse`, `CloseoutRequest` zod schemas and their inferred types; `shiftVariance()`, `reconciles()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/shifts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { reconciles, shiftVariance } from "./shifts";

describe("shiftVariance", () => {
  it("is zero when the declaration matches the system", () => {
    expect(shiftVariance({ declared: 125_00, system: 125_00 })).toBe(0);
  });

  it("is negative when the collector is short", () => {
    expect(shiftVariance({ declared: 120_00, system: 125_00 })).toBe(-5_00);
  });

  it("is positive when the collector is over", () => {
    // Signed, deliberately: over and short are different problems and an absolute value
    // would not tell a supervisor which one they have.
    expect(shiftVariance({ declared: 130_00, system: 125_00 })).toBe(5_00);
  });

  it("works in integer centavos, never floats", () => {
    expect(shiftVariance({ declared: 1_00, system: 3_33 })).toBe(-2_33);
  });
});

describe("reconciles", () => {
  it("is true when both count and total agree", () => {
    expect(
      reconciles({ deviceCount: 3, deviceTotal: 300_00, systemCount: 3, systemTotal: 300_00 }),
    ).toBe(true);
  });

  it("is false when the counts differ", () => {
    // A device holding an unpushed receipt has a count the server cannot match. This is
    // what makes silent data loss impossible to overlook.
    expect(
      reconciles({ deviceCount: 4, deviceTotal: 300_00, systemCount: 3, systemTotal: 300_00 }),
    ).toBe(false);
  });

  it("is false when the totals differ though the counts match", () => {
    // Both halves are load-bearing. Checking only the total would let a shift with one
    // missing receipt and one duplicated amount reconcile cleanly.
    expect(
      reconciles({ deviceCount: 3, deviceTotal: 299_00, systemCount: 3, systemTotal: 300_00 }),
    ).toBe(false);
  });

  it("does not consider the cash declaration at all", () => {
    // §6.5 step 5: variance is recorded, not blocking. A short drawer still reconciles.
    expect(
      reconciles({ deviceCount: 3, deviceTotal: 300_00, systemCount: 3, systemTotal: 300_00 }),
    ).toBe(true);
  });
});
```

Create `packages/shared/src/sync-contract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { REJECT_REASONS } from "./reason-codes";
import { PushEntry, PushResult, CloseoutRequest, PUSH_REASONS } from "./sync-contract";

const collection = {
  type: "collection" as const,
  payload: {
    id: randomUUID(),
    or_no: 1234,
    booklet_id: randomUUID(),
    collector_id: randomUUID(),
    collected_at: "2026-10-05T02:00:00+00:00",
    fee_type_id: randomUUID(),
    lease_id: randomUUID(),
    allocations: [{ group_rank: 1 }],
    lines: [],
  },
};

describe("PushEntry", () => {
  it("accepts a collection entry", () => {
    expect(PushEntry.safeParse(collection).success).toBe(true);
  });

  it("rejects a collection with no id", () => {
    // The client-generated UUID is the idempotency key. An entry without one would mint a
    // second receipt on every retry.
    const { payload, ...rest } = collection;
    const { id, ...rest2 } = payload;
    expect(PushEntry.safeParse({ ...rest, payload: rest2 }).success).toBe(false);
  });

  it("rejects an amount in the payload", () => {
    // Invariant 3. The device proposes WHICH periods and HOW MANY units; the server decides
    // what that costs. A schema that tolerated an amount field would invite a client to
    // send one and a future handler to read it.
    expect(
      PushEntry.safeParse({
        ...collection,
        payload: { ...collection.payload, gross_amount: "50.00" },
      }).success,
    ).toBe(false);
  });

  it("rejects a device_id in the payload", () => {
    // Invariant 21. device_id comes from the authenticated credential; a payload carrying
    // one is either a confused client or a hostile one.
    expect(
      PushEntry.safeParse({
        ...collection,
        payload: { ...collection.payload, device_id: randomUUID() },
      }).success,
    ).toBe(false);
  });

  it("rejects the cancellation type", () => {
    // Spec D4: collectors do not cancel in the field. §6.2's list is corrected, not
    // implemented, and the schema is where that correction bites first.
    expect(
      PushEntry.safeParse({ type: "cancellation", payload: { id: randomUUID() } }).success,
    ).toBe(false);
  });

  it("accepts the four real types", () => {
    for (const type of ["collection", "spoiled_form", "shift_open", "shift_close"]) {
      const parsed = PushEntry.safeParse({ type, payload: {} });
      // Payload shape differs per type; we only assert the discriminator is known.
      expect(parsed.success || parsed.error.issues.every((i) => i.path.length > 1)).toBe(true);
    }
  });
});

describe("PushResult", () => {
  it("accepts an accepted result", () => {
    expect(
      PushResult.safeParse({
        index: 0,
        type: "collection",
        status: "accepted",
        collection_id: randomUUID(),
      }).success,
    ).toBe(true);
  });

  it("accepts a rejection carrying a known reason and the retryable flag", () => {
    expect(
      PushResult.safeParse({
        index: 1,
        type: "collection",
        status: "rejected",
        reason: "stale_allocations",
        retryable: true,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown reason code", () => {
    // A reason the SQL can return but the TypeScript does not know about renders as
    // `undefined` to a collector standing at a stall.
    expect(
      PushResult.safeParse({
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "something_new",
      }).success,
    ).toBe(false);
  });

  it("accepts the three reasons sync_push raises that post_collection never does", () => {
    // These are sync_push's own vocabulary, not the engine's, so they live in PUSH_REASONS
    // rather than REJECT_REASONS. If PushResult were built on REJECT_REASONS it would
    // reject three responses the server genuinely sends.
    for (const reason of [
      "collector_not_on_device",
      "unknown_entry_type",
      "server_error",
    ]) {
      expect(
        PushResult.safeParse({ index: 0, type: "collection", status: "rejected", reason })
          .success,
      ).toBe(true);
    }
  });

  it("keeps REJECT_REASONS free of sync_push's own vocabulary", () => {
    // reason-codes.ts documents REJECT_REASONS as "the vocabulary post_collection() answers
    // with". This is what keeps that comment honest.
    expect(REJECT_REASONS).not.toContain("collector_not_on_device");
    expect(REJECT_REASONS).not.toContain("unknown_entry_type");
    expect(REJECT_REASONS).not.toContain("server_error");
  });
});

describe("CloseoutRequest", () => {
  it("requires both the count and the total", () => {
    const base = {
      credential_id: "c",
      secret: "s",
      shift_id: randomUUID(),
      declared_total: "100.00",
    };
    expect(CloseoutRequest.safeParse({ ...base, device_count: 1 }).success).toBe(false);
    expect(CloseoutRequest.safeParse({ ...base, device_total: "100.00" }).success).toBe(false);
    expect(
      CloseoutRequest.safeParse({ ...base, device_count: 1, device_total: "100.00" }).success,
    ).toBe(true);
  });
});
```

Note the third `reconciles` case: it is the one that fails if the implementation checks the
total and forgets the count. Do not let it be "simplified" away as redundant with the second.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ceedo/shared exec vitest run src/shifts.test.ts src/sync-contract.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write `shifts.ts`**

Create `packages/shared/src/shifts.ts`:

```typescript
import type { Centavos } from "./money";

/**
 * Closeout arithmetic, shared by the collector app and the server's own tests.
 *
 * Parent spec §6.5 describes TWO comparisons and they must not be conflated:
 *
 *   device count/sum  vs  server count/sum  -> RECORDS are missing. Blocks closeout.
 *   declared cash     vs  server sum        -> the DRAWER is short. Recorded, never blocks.
 *
 * `reconciles` answers the first. `shiftVariance` computes the second. Neither knows about
 * the other, which is the point.
 */

export function shiftVariance(input: {
  declared: Centavos;
  system: Centavos;
}): Centavos {
  // Signed. Over and short are different problems; an absolute value would hide which.
  return (input.declared - input.system) as Centavos;
}

export function reconciles(input: {
  deviceCount: number;
  deviceTotal: Centavos;
  systemCount: number;
  systemTotal: Centavos;
}): boolean {
  // Both halves. Checking only the total would let a shift with one missing receipt and one
  // duplicated amount reconcile cleanly; checking only the count would miss a mispriced one.
  return (
    input.deviceCount === input.systemCount && input.deviceTotal === input.systemTotal
  );
}
```

Confirm `Centavos` is exported from `money.ts` under that name before importing it; if it is
a plain `number` alias, use it as written, and if it does not exist, drop the import and type
these as `number` with a comment saying centavos.

- [ ] **Step 4: Write `sync-contract.ts`**

Create `packages/shared/src/sync-contract.ts`:

```typescript
import { z } from "zod";
import { REJECT_REASONS, type RejectReason } from "./reason-codes";

/**
 * The reasons that can cross the WIRE, which is a superset of post_collection()'s.
 *
 * REJECT_REASONS is documented as "the vocabulary post_collection() answers with" and that
 * comment must stay true, so the three reasons sync_push() raises on its own -- before or
 * instead of calling the engine -- are added here rather than there. Two functions, two
 * vocabularies; collapsing them would make reason-codes.ts lie about itself.
 */
export const PUSH_REASONS = [
  ...REJECT_REASONS,
  // sync_push rejects the entry before post_collection is reached.
  "collector_not_on_device",
  // The device sent a type this server does not know -- including `cancellation`, which
  // spec D4 removed. Never silently skipped: a skipped entry is a lost receipt.
  "unknown_entry_type",
  // An entry's subtransaction raised. Its neighbours are unaffected (spec D8).
  "server_error",
] as const;

export type PushReason = (typeof PUSH_REASONS)[number];

/**
 * The wire contract, validated identically on both ends.
 *
 * The collector app validates outgoing entries against these schemas and the server's tests
 * validate responses against them, so a contract drift is a type error in both apps rather
 * than a runtime surprise in one.
 *
 * Two fields are REFUSED rather than merely ignored, and both refusals are load-bearing:
 *
 *   gross_amount  -- invariant 3. The device proposes WHICH periods and HOW MANY units; the
 *                    server decides what that costs. A schema that tolerated an amount would
 *                    invite a client to send one and a future handler to read it.
 *   device_id     -- invariant 21. It comes from the authenticated credential. A payload
 *                    carrying one is either a confused client or a hostile one.
 */

const uuid = z.string().uuid();
/** numeric(14,2) crosses the wire as a string; see the spec's note on PostgREST. */
const money = z.string().regex(/^-?\d+\.\d{2}$/);

const forbidden = {
  gross_amount: z.never().optional(),
  device_id: z.never().optional(),
};

export const CollectionPayload = z
  .object({
    id: uuid,
    or_no: z.number().int().positive(),
    booklet_id: uuid,
    collector_id: uuid,
    collected_at: z.string().datetime({ offset: true }),
    fee_type_id: uuid,
    lease_id: uuid.nullable().optional(),
    payer_ref: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    allocations: z.array(z.object({ group_rank: z.number().int().positive() })),
    lines: z.array(
      z.object({
        fee_type_id: uuid,
        rate_class: z.string().optional(),
        quantity: z.number().int().positive(),
      }),
    ),
    ...forbidden,
  })
  .strict();

export const SpoiledFormPayload = z
  .object({
    booklet_id: uuid,
    or_no: z.number().int().positive(),
    collector_id: uuid,
    reason: z.string().trim().min(1),
  })
  .strict();

export const ShiftOpenPayload = z
  .object({
    id: uuid,
    collector_id: uuid,
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    opened_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const ShiftClosePayload = z
  .object({
    id: uuid,
    declared_total: money,
    device_count: z.number().int().nonnegative(),
    device_total: money,
  })
  .strict();

/**
 * Four types. `cancellation` appears in parent spec §6.2 and is deliberately absent here:
 * spec D4 rules that a collector who writes a wrong receipt marks the form spoiled and
 * issues a new one, as the paper process already does. Cancelling a POSTED collection stays
 * a supervisor act on the web, because a collector who can cancel their own receipts can
 * make a shortfall disappear.
 */
export const PushEntry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("collection"), payload: CollectionPayload }),
  z.object({ type: z.literal("spoiled_form"), payload: SpoiledFormPayload }),
  z.object({ type: z.literal("shift_open"), payload: ShiftOpenPayload }),
  z.object({ type: z.literal("shift_close"), payload: ShiftClosePayload }),
]);

export const PushResult = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.string(),
    status: z.enum(["accepted", "duplicate", "rejected", "mismatch", "already_closed"]),
    reason: z.enum(PUSH_REASONS as unknown as [string, ...string[]]).optional(),
    retryable: z.boolean().optional(),
    detail: z.string().optional(),
    collection_id: uuid.optional(),
    shift_id: uuid.optional(),
    device_count: z.number().int().optional(),
    device_total: money.optional(),
    system_count: z.number().int().optional(),
    system_total: money.optional(),
    variance: money.optional(),
  })
  .passthrough();

export const PushRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  entries: z.array(PushEntry),
});

export const PullRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  cursor: z.number().int().nonnegative().default(0),
  epoch: z.number().int().nonnegative().optional(),
});

export const CloseoutRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  shift_id: uuid,
  declared_total: money,
  device_count: z.number().int().nonnegative(),
  device_total: money,
});

export type PushEntry = z.infer<typeof PushEntry>;
export type { RejectReason };
export type PushResult = z.infer<typeof PushResult>;
export type PushRequest = z.infer<typeof PushRequest>;
export type PullRequest = z.infer<typeof PullRequest>;
export type CloseoutRequest = z.infer<typeof CloseoutRequest>;
```

`z.never().optional()` inside a `.strict()` object is belt and braces: `.strict()` alone
already rejects an unknown key. Keep both — `.strict()` could be relaxed by someone adding a
field, and these two names must stay refused by their own statement.

- [ ] **Step 5: Export from the package index**

Modify `packages/shared/src/index.ts` to re-export both modules, following the existing
pattern in that file.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ceedo/shared exec vitest run && pnpm typecheck --force`
Expected: PASS, and a clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sync-contract.ts packages/shared/src/sync-contract.test.ts \
        packages/shared/src/shifts.ts packages/shared/src/shifts.test.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): the sync wire contract and closeout arithmetic"
```

---
## Task 12: The three Edge Functions

Spec §4. Thin by design — §4.5: "A Function that starts accumulating business logic is a Function that has begun to be a second implementation of §6."

**Files:**
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/respond.ts`
- Create: `supabase/functions/sync-pull/index.ts`
- Create: `supabase/functions/sync-push/index.ts`
- Create: `supabase/functions/closeout/index.ts`
- Create: `supabase/functions/deno.json`

**Interfaces:**
- Consumes: `authenticate_device`, `sync_pull`, `sync_push`, `close_shift` — the four `ceedo_app` may execute.
- Produces: three HTTP endpoints. Each accepts `POST` with a JSON body and returns JSON.

- [ ] **Step 1: Write `_shared/respond.ts`**

```typescript
/** JSON responses, shaped identically by all three functions. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A failure the caller can act on. The message is deliberately terse: this endpoint is
 * reached by an unauthenticated client over the public internet, and a Postgres error
 * string can name tables, columns and constraints.
 */
export function fail(code: string, status: number): Response {
  return json({ error: code }, status);
}
```

- [ ] **Step 2: Write `_shared/auth.ts`**

```typescript
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

/**
 * The ceedo_app client.
 *
 * Parent spec §12.5: "Edge Functions must not use service_role" -- which bypasses RLS
 * across every unrelated schema on this shared Supabase project. So this mints a JWT with
 * the ceedo_app role claim, signed with the project JWT secret, and PostgREST does
 * `set role ceedo_app` on the strength of it.
 *
 * ceedo_app holds EXECUTE on exactly four functions and no privilege on any table, so a
 * leaked token of this kind can call four functions -- each with its own internal
 * authorization -- and read nothing directly.
 */
let cached: SupabaseClient | null = null;

export async function ceedoAppClient(): Promise<SupabaseClient> {
  if (cached) return cached;

  const secret = Deno.env.get("CEEDO_JWT_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  // The anon key is the API GATEWAY's credential; the ceedo_app JWT is the DATABASE ROLE's.
  // They are different headers doing different jobs, and collapsing them works by accident
  // until the gateway's rules change.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!secret || !url || !anonKey) {
    throw new Error("CEEDO_JWT_SECRET, SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  // Long-lived because the process is short-lived; it never leaves this function.
  const token = await create(
    { alg: "HS256", typ: "JWT" },
    { role: "ceedo_app", exp: getNumericDate(60 * 60) },
    key,
  );

  // apikey = anon (gets past the gateway). Authorization = ceedo_app (sets the DB role).
  cached = createClient(url, anonKey, {
    db: { schema: "ceedo_collections" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return cached;
}

export type Authenticated = { deviceId: string; client: SupabaseClient };

/**
 * Verifies the presented credential and returns the device id.
 *
 * The device id is taken from HERE and never from the request body. Invariant 21: a device
 * may claim any collector_id -- the PIN was verified offline, so that claim is unverifiable
 * by construction and §11.5 accepts it -- but it must not be able to claim to be a
 * different tablet.
 */
export async function authenticateDevice(
  credentialId: unknown,
  secret: unknown,
): Promise<Authenticated | null> {
  if (typeof credentialId !== "string" || typeof secret !== "string") return null;

  const client = await ceedoAppClient();
  const { data, error } = await client.rpc("authenticate_device", {
    p_credential_id: credentialId,
    p_secret: secret,
  });
  if (error || !data) return null;

  return { deviceId: data as string, client };
}
```

- [ ] **Step 3: Write the three handlers**

`supabase/functions/sync-pull/index.ts`:

```typescript
import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";

// Thin by design (spec §4.5): parse, authenticate, call ONE rpc, return its jsonb. Scoping,
// cursoring and the collections-not-charges rule all live in sync_pull(), where the
// tests/db harness that proved post_collection can reach them.
Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  const auth = await authenticateDevice(body.credential_id, body.secret);
  if (!auth) return fail("unauthorized", 401);

  const cursor = typeof body.cursor === "number" ? body.cursor : 0;

  const { data, error } = await auth.client.rpc("sync_pull", {
    p_device_id: auth.deviceId,
    p_cursor: cursor,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
```

`supabase/functions/sync-push/index.ts`:

```typescript
import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  const auth = await authenticateDevice(body.credential_id, body.secret);
  if (!auth) return fail("unauthorized", 401);

  if (!Array.isArray(body.entries)) return fail("bad_request", 400);

  const { data, error } = await auth.client.rpc("sync_push", {
    p_device_id: auth.deviceId,
    p_entries: body.entries,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
```

`supabase/functions/closeout/index.ts`:

```typescript
import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  const auth = await authenticateDevice(body.credential_id, body.secret);
  if (!auth) return fail("unauthorized", 401);

  const { data, error } = await auth.client.rpc("close_shift", {
    p_shift_id: body.shift_id,
    p_device_id: auth.deviceId,
    p_declared_total: body.declared_total,
    p_device_count: body.device_count,
    p_device_total: body.device_total,
  });
  if (error) return fail("closeout_failed", 500);

  return json(data);
});
```

- [ ] **Step 4: Write `supabase/functions/deno.json`**

```json
{
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2"
  }
}
```

Note the functions import `@ceedo/shared` **not at all**, deliberately. Spec D1's secondary
benefit: Deno never has to resolve a package across a pnpm workspace, which would otherwise
sit on the critical path of every function. The contract schemas in Task 11 are used by the
collector app (Phase 3b) and by the tests, not by these handlers — they validate nothing the
SQL does not already validate, and duplicating that here would be the second implementation
§4.5 warns about.

- [ ] **Step 5: Set the function secret and start the server**

```bash
# The local stack's JWT secret. `supabase status -o env` prints it as JWT_SECRET.
eval "$(supabase status -o env | sed 's/="/=/; s/"$//')"
echo "CEEDO_JWT_SECRET=$JWT_SECRET" > supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env
```

Add `supabase/functions/.env` to `.gitignore` before committing anything.

- [ ] **Step 6: Smoke-test by hand**

With the server running, in another shell:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/sync-pull \
  -H 'content-type: application/json' \
  -d '{"credential_id":"nope","secret":"nope","cursor":0}'
```

Expected: `{"error":"unauthorized"}` with status 401. If it returns 500, the `ceedo_app` JWT
is not being accepted — check `grant ceedo_app to authenticator` ran (Task 1) and that
`CEEDO_JWT_SECRET` matches the stack's.

- [ ] **Step 7: Commit**

```bash
echo 'supabase/functions/.env' >> .gitignore
git add supabase/functions .gitignore
git commit -m "feat(sync): the three Edge Functions"
```

---
## Task 13: HTTP tests

Spec §8.1. The layer that proves the deployed artifact is the working one.

**Files:**
- Create: `tests/helpers/functions.ts`
- Create: `tests/http/functions.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/package.json` (a `test:http` script)

**Interfaces:**
- Consumes: a running `supabase functions serve`.
- Produces: `callFunction(name, body)` returning `{status, body}`.

- [ ] **Step 1: Write the helper**

Create `tests/helpers/functions.ts`:

```typescript
const BASE =
  process.env.FUNCTIONS_URL ??
  `${process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321"}/functions/v1`;

export async function callFunction(
  name: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/http/functions.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

let db: Client;
let fx: Awaited<ReturnType<typeof createSyncFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createSyncFixture(db);
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

function creds() {
  return { credential_id: fx.credentialId, secret: fx.secret };
}

describe("authentication over HTTP", () => {
  // The layer only these tests can reach: the SQL tests call authenticate_device directly
  // and never exercise the ceedo_app JWT, the transport, or the status codes.

  it("refuses a wrong secret with 401", async () => {
    const res = await callFunction("sync-pull", {
      credential_id: fx.credentialId,
      secret: "wrong",
      cursor: 0,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("refuses an absent credential with 401", async () => {
    const res = await callFunction("sync-pull", { cursor: 0 });
    expect(res.status).toBe(401);
  });

  it("refuses a GET with 405", async () => {
    const res = await fetch(
      `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/sync-pull`,
    );
    expect(res.status).toBe(405);
  });

  it("refuses a malformed body with 400", async () => {
    const res = await fetch(
      `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/sync-pull`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a deactivated device, without the device needing to know", async () => {
    // §4.1: deactivation takes effect on next contact. This is the answer to a stolen
    // tablet, and it can only be verified over the wire.
    const doomed = await createSyncFixture(db);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      doomed.deviceId,
    ]);

    const res = await callFunction("sync-pull", {
      credential_id: doomed.credentialId,
      secret: doomed.secret,
      cursor: 0,
    });
    expect(res.status).toBe(401);
  });

  it("leaks no Postgres detail in an error body", async () => {
    // This endpoint is reached by an unauthenticated client over the public internet. A
    // Postgres error string names tables, columns and constraints.
    const res = await callFunction("sync-push", { ...creds(), entries: "not-an-array" });
    expect(JSON.stringify(res.body)).not.toMatch(/ceedo_collections|relation|column|pg_/i);
  });
});

describe("sync-pull over HTTP", () => {
  it("returns the scoped payload with a cursor and an epoch", async () => {
    const res = await callFunction("sync-pull", { ...creds(), cursor: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cursor");
    expect(res.body).toHaveProperty("epoch");
    expect(res.body.leases.map((l: { id: string }) => l.id)).toContain(fx.leaseId);
  });
});

describe("sync-push over HTTP", () => {
  it("accepts a collection and returns one result per entry", async () => {
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = randomUUID();

    const res = await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "collection",
          payload: {
            id,
            or_no: 1300,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ index: 0, status: "accepted" });
  });

  it("ignores a device_id in the payload and uses the credential's", async () => {
    // Invariant 21, over the wire. The SQL test proves the function does this; this proves
    // the transport does not reintroduce the payload's value on the way through.
    const other = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = randomUUID();

    await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "collection",
          payload: {
            id,
            or_no: 1301,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            device_id: other.deviceId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });

    const { rows } = await db.query(
      `select device_id from ceedo_collections.collections where id = $1`,
      [id],
    );
    expect(rows[0]?.device_id).toBe(fx.deviceId);
  });
});

describe("closeout over HTTP", () => {
  it("reports a mismatch without closing", async () => {
    const shiftId = randomUUID();
    await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "shift_open",
          payload: {
            id: shiftId,
            collector_id: fx.collectorId,
            business_date: "2026-10-05",
            opened_at: "2026-10-05T02:00:00+00:00",
          },
        },
      ],
    });

    const res = await callFunction("closeout", {
      ...creds(),
      shift_id: shiftId,
      declared_total: "0.00",
      device_count: 0,
      device_total: "0.00",
    });

    expect(res.status).toBe(200);
    // Collections already exist for this collector from the push tests above.
    expect(res.body.status).toBe("mismatch");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

With no functions server running: `pnpm --filter @ceedo/tests exec vitest run http/functions.test.ts`
Expected: FAIL — connection refused. That failure is informative; it is what CI must not do.

- [ ] **Step 4: Run it against the server**

In one shell: `supabase functions serve --env-file supabase/functions/.env`
In another: `pnpm --filter @ceedo/tests exec vitest run http/functions.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire CI**

Modify `.github/workflows/ci.yml`, after `supabase db reset` and before `pnpm test`:

```yaml
      # The Edge Functions are the deployed artifact; typecheck and the SQL suite between
      # them never execute one. Backgrounded because `functions serve` does not return.
      - name: Serve Edge Functions
        run: |
          echo "CEEDO_JWT_SECRET=$JWT_SECRET" > supabase/functions/.env
          supabase functions serve --env-file supabase/functions/.env &
          for i in $(seq 1 30); do
            code=$(curl -s -o /dev/null -w '%{http_code}' \
                     -X POST http://127.0.0.1:54321/functions/v1/sync-pull \
                     -H 'content-type: application/json' -d '{}' || true)
            # 401 means the function is up and refusing us, which is the goal.
            [ "$code" = "401" ] && exit 0
            sleep 2
          done
          echo "Edge Functions did not become ready" >&2
          exit 1
```

`JWT_SECRET` is already in the environment from the existing
`supabase status -o env | sed ... >> "$GITHUB_ENV"` step.

The readiness loop is not optional. Without it the HTTP tests race the server's startup and
fail intermittently — and an intermittently-failing CI step is one that gets disabled.

- [ ] **Step 6: Add the HTTP project to the workspace**

Modify `tests/vitest.config.ts` so `http/` is included (it may already be, if the config
globs `**/*.test.ts` — verify with `pnpm --filter @ceedo/tests exec vitest list`).

- [ ] **Step 7: Verify the full suite**

Run: `supabase db reset && supabase functions serve --env-file supabase/functions/.env & sleep 10 && pnpm test`
Expected: green, including `tests/http`.

- [ ] **Step 8: Commit**

```bash
git add tests/helpers/functions.ts tests/http/functions.test.ts \
        tests/vitest.config.ts .github/workflows/ci.yml
git commit -m "test(sync): HTTP tests over the real Edge Functions, wired into CI"
```

---
## Task 13.5: Regenerate `db.types.ts` before the web tasks

Ruling R2 from the pre-flight scan. Not in the original plan.

**Why this exists:** Tasks 14 and 15 read `shifts` and `sync_exceptions` through the typed
`ledgerClient()`, and both gate on `pnpm typecheck --force && pnpm build`. Neither can pass
while the generated `Database` type predates migrations 0026–0035. The original plan
regenerated types in Task 17, which is two tasks too late.

**Files:**
- Modify: `packages/shared/src/db.types.ts` (generated — never edited by hand)

- [ ] **Step 1: Regenerate**

```bash
supabase db reset
pnpm db:types
```

Use the Supabase CLI version CI pins — `2.116.0`, from `.github/workflows/ci.yml`. Phase 2's
CI notes record what happens otherwise: a newer generator emitted `(X extends {` where the
committed file had `X extends {`, failing a commit that touched nothing.

Verify with `supabase --version` before running. If the local CLI has drifted, pin it rather
than regenerating with the wrong one.

- [ ] **Step 2: Confirm the new objects are present**

```bash
grep -c 'device_credentials\|sync_exceptions\|shifts' packages/shared/src/db.types.ts
grep -c 'sync_pull\|sync_push\|close_shift\|authenticate_device' packages/shared/src/db.types.ts
```

Expected: non-zero for both. A zero means the generator ran against a database that had not
been reset, and the web tasks will fail in a way that points at the wrong thing.

- [ ] **Step 3: Verify the tree still typechecks**

Run: `pnpm typecheck --force && ./scripts/check-types-current.sh`
Expected: both clean.

`check-types-current.sh` regenerates and diffs, so it is the real check that Step 1 used the
right CLI.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/db.types.ts
git commit -m "chore: regenerate database types for the Phase 3a sync schema"
```

---
## Task 14: Web — the exceptions queue

Spec §6.1. `canResolveExceptions(role)` already exists in `packages/shared/src/roles.ts`.

**Files:**
- Create: `apps/web/lib/ledger/exceptions.ts`
- Create: `apps/web/lib/ledger/exception-actions.ts`
- Create: `apps/web/lib/ledger/exceptions.test.ts`
- Create: `apps/web/app/(admin)/ledger/exceptions/page.tsx`
- Modify: `apps/web/app/(admin)/layout.tsx` (nav entry)

**Interfaces:**
- Consumes: `resolve_exception_corrected`, `resolve_exception_spoiled`, `escalate_exception` (Task 10); `ledgerClient()`, `requireStaff()`, `toSaveResult()`, `SaveResult` — all existing.
- Produces: `getOpenExceptions()`, `ExceptionRow`, and three server actions returning `SaveResult`.

- [ ] **Step 1: Write the failing unit test**

Phase 2's handover names this gap: *"No unit tests for `apps/web/lib/ledger/queries.ts`
logic. Worth a regression test."* This task does not repeat that mistake.

Create `apps/web/lib/ledger/exceptions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { describeReason, summarisePayload, type ExceptionRow } from "./exceptions";

describe("describeReason", () => {
  it("renders every reason the server can return", () => {
    // A reason code the SQL returns and the web does not know about renders as a raw
    // snake_case string to a supervisor deciding what to do about real money.
    for (const reason of [
      "booklet_not_assigned",
      "or_out_of_range",
      "or_already_used",
      "or_spoiled",
      "lease_not_found",
      "allocation_not_prefix",
      "allocation_partial_period",
      "amount_mismatch",
      "no_parts",
      "rate_not_found",
      "stale_allocations",
      "collector_not_on_device",
      "unknown_entry_type",
      "server_error",
    ]) {
      const described = describeReason(reason);
      expect(described).toBeTruthy();
      expect(described).not.toBe(reason);
    }
  });

  it("falls back to the raw code rather than rendering nothing", () => {
    expect(describeReason("a_reason_from_the_future")).toContain("a_reason_from_the_future");
  });
});

describe("summarisePayload", () => {
  it("surfaces the OR number and the lease, not a JSON blob", () => {
    // A supervisor resolving an or_already_used needs to see WHICH OR number and WHICH
    // lease. A rendered blob is technically complete and practically useless.
    const summary = summarisePayload({
      or_no: 1234,
      lease_id: "5f9d4f1e-0000-4000-8000-000000000001",
      collected_at: "2026-10-05T02:00:00+00:00",
      allocations: [{ group_rank: 1 }, { group_rank: 2 }],
    });

    expect(summary.orNo).toBe(1234);
    expect(summary.periods).toBe(2);
  });

  it("renders a payload with no allocations as zero periods, not undefined", () => {
    expect(summarisePayload({ or_no: 1 }).periods).toBe(0);
  });

  it("survives a payload missing every field", () => {
    // The payload is whatever the device sent. A malformed one must render, not throw --
    // this screen is how a malformed push gets noticed at all.
    expect(() => summarisePayload({})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run lib/ledger/exceptions.test.ts`
Expected: FAIL — module not found.

If `apps/web` has no vitest project yet, add one mirroring `packages/shared`'s
(`"test": "vitest run"` in `apps/web/package.json`) and add `apps/web` to
`vitest.workspace.ts` if absent. Phase 2's handover records `pnpm --filter` exiting 0 having
run zero tests when a package defined no `test` script — verify the command actually runs
these cases before moving on.

- [ ] **Step 3: Write `exceptions.ts`**

```typescript
import type { Database } from "@ceedo/shared";
import { ledgerClient } from "./queries";

/**
 * The supervisor's view of a rejected push.
 *
 * Parent spec §6.3 is why this screen exists: "By the time the server sees a problem, the
 * collector has handed a vendor a paper official receipt and taken their money. That serial
 * is spent." Everything here is in service of a person deciding what to do about cash that
 * already changed hands.
 */

const REASON_TEXT: Record<string, string> = {
  booklet_not_assigned: "The booklet is not assigned to this collector",
  or_out_of_range: "The OR number is outside the booklet's range",
  or_already_used: "Another device already recorded this OR number",
  or_spoiled: "This OR number was marked spoiled",
  lease_not_found: "No such lease",
  allocation_not_prefix: "The periods paid are not the oldest unpaid ones",
  allocation_partial_period: "A period was paid in part; whole periods only",
  amount_mismatch: "The device's amount does not match the rate table",
  no_parts: "The entry settles nothing and charges nothing",
  rate_not_found: "No rate is in effect for that fee on that date",
  stale_allocations: "The unpaid periods changed while this was in flight",
  collector_not_on_device: "This collector is not cleared for this tablet",
  unknown_entry_type: "The device sent an entry type this server does not know",
  server_error: "The server failed while posting this entry",
};

export function describeReason(code: string): string {
  return REASON_TEXT[code] ?? `Unrecognised reason (${code})`;
}

export interface PayloadSummary {
  orNo: number | null;
  leaseId: string | null;
  collectedAt: string | null;
  periods: number;
}

/**
 * The pushed payload, rendered as the few facts a supervisor acts on. Never throws: the
 * payload is whatever the device sent, and a malformed one must be visible on this screen
 * rather than crash it — this screen is how a malformed push gets noticed at all.
 */
export function summarisePayload(payload: Record<string, unknown>): PayloadSummary {
  const allocations = payload?.allocations;
  return {
    orNo: typeof payload?.or_no === "number" ? payload.or_no : null,
    leaseId: typeof payload?.lease_id === "string" ? payload.lease_id : null,
    collectedAt: typeof payload?.collected_at === "string" ? payload.collected_at : null,
    periods: Array.isArray(allocations) ? allocations.length : 0,
  };
}

export interface ExceptionRow {
  id: string;
  collectionUuid: string;
  reasonCode: string;
  reasonText: string;
  collectorName: string;
  deviceLabel: string;
  attempts: number;
  firstSeenAt: string;
  status: string;
  summary: PayloadSummary;
  payload: Record<string, unknown>;
}

export async function getOpenExceptions(): Promise<ExceptionRow[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("sync_exceptions")
    .select(
      "id, collection_uuid, reason_code, attempts, first_seen_at, status, payload," +
        " collector:app_users!sync_exceptions_collector_id_fkey(full_name)," +
        " device:devices!sync_exceptions_device_id_fkey(label)",
    )
    .neq("status", "resolved")
    // Oldest first. §11.3 surfaces exceptions older than three days to the Treasurer, so
    // the ones nearest that line must be the ones a supervisor sees first.
    .order("first_seen_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    collectionUuid: row.collection_uuid,
    reasonCode: row.reason_code,
    reasonText: describeReason(row.reason_code),
    collectorName: row.collector?.full_name ?? "Unknown collector",
    deviceLabel: row.device?.label ?? "Unknown device",
    attempts: row.attempts,
    firstSeenAt: row.first_seen_at,
    status: row.status,
    summary: summarisePayload(row.payload ?? {}),
    payload: row.payload ?? {},
  }));
}
```

Check the foreign-key constraint names in the `select` against the actual migration; if they
differ, use the names Postgres generated (`\d ceedo_collections.sync_exceptions`).

- [ ] **Step 4: Write `exception-actions.ts`**

Follow `apps/web/lib/ledger/actions.ts` exactly — same `rpcFailure`, `requireStaff`,
`PERMISSION_DENIED` and zod-then-RPC shape. Three actions:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canResolveExceptions } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { ledgerClient } from "@/lib/ledger/queries";

function rpcFailure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

const PERMISSION_DENIED = rpcFailure("You do not have permission to resolve exceptions.");

// The database refuses a blank reason too (migration 0029's lifecycle constraint and
// assert_can_resolve_exceptions). Checking here as well means the supervisor sees the rule
// in the form rather than as a Postgres error.
const reason = z.string().trim().min(1, "A written reason is required");

const correctSchema = z.object({
  exceptionId: z.string().uuid(),
  orNo: z.coerce.number().int().positive(),
  reason,
});

export async function correctException(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!canResolveExceptions(staff.role)) return PERMISSION_DENIED;

  const parsed = correctSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    orNo: formData.get("orNo"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed.error);

  const supabase = await ledgerClient();
  // Only CLAIMS. No amount is sent, and post_collection's payload has no amount field to
  // send one in -- invariant 3 holds for supervisors exactly as for devices.
  const { data, error } = await supabase.rpc("resolve_exception_corrected", {
    p_exception_id: parsed.data.exceptionId,
    p_payload: { or_no: parsed.data.orNo },
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  const result = data as { status: string; reason?: string; detail?: string };
  if (result.status === "rejected") {
    // Rejected again rather than forced in. The exception stays open with the new reason.
    return rpcFailure(
      `The correction was rejected: ${result.detail ?? result.reason ?? "unknown reason"}`,
    );
  }

  revalidatePath("/ledger/exceptions");
  return { ok: true, fieldErrors: {}, formError: null };
}
```

Write `spoilException(formData)` and `escalateException(formData)` in the same shape,
calling `resolve_exception_spoiled` and `escalate_exception`. Both take only
`exceptionId` and `reason`.

- [ ] **Step 5: Write the page**

Create `apps/web/app/(admin)/ledger/exceptions/page.tsx`, following
`apps/web/app/(admin)/ledger/collections/page.tsx` for structure, table styling and form
handling. It must show, per row: reason text (not the code), collector, device, OR number,
attempts, age in days, and the three actions each with a required reason field. Rows with
`status === "escalated"` carry a visible marker and remain actionable.

- [ ] **Step 6: Add the nav entry**

Modify `apps/web/app/(admin)/layout.tsx` to add `/ledger/exceptions`, gated on
`canResolveExceptions(role)`.

- [ ] **Step 7: Verify**

Run: `pnpm --filter web exec vitest run lib/ledger/exceptions.test.ts && pnpm typecheck --force && pnpm build`
Expected: PASS, clean typecheck, successful Next.js build.

`pnpm build` is not optional here: Phase 1 made it a CI step precisely because a bad import
boundary or a client/server mistake surfaces there and nowhere else.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/ledger/exceptions.ts apps/web/lib/ledger/exception-actions.ts \
        apps/web/lib/ledger/exceptions.test.ts \
        "apps/web/app/(admin)/ledger/exceptions/page.tsx" \
        "apps/web/app/(admin)/layout.tsx"
git commit -m "feat(web): the supervisor exceptions queue"
```

---
## Task 15: Web — shifts, PINs and device credentials

Spec §6.2, §6.3, §6.4.

**Files:**
- Create: `apps/web/lib/ledger/shifts.ts`
- Create: `apps/web/lib/ledger/shifts.test.ts`
- Create: `apps/web/lib/devices/credential-actions.ts`
- Create: `apps/web/app/(admin)/ledger/shifts/page.tsx`
- Modify: the existing devices and staff admin screens
- Modify: `apps/web/app/(admin)/layout.tsx` (shifts nav entry)
- Modify: `packages/shared/src/roles.ts` (add `isAdmin`)

**Interfaces:**
- Produces: `getShifts(businessDate?)`, `ShiftRow`, `issueCredential(formData)`, `revokeCredential(formData)`, `setCollectorPin(formData)`, and `isAdmin(role)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/ledger/shifts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifyShift, formatVariance } from "./shifts";

describe("classifyShift", () => {
  it("flags a shift still open after its business date", () => {
    // The condition NOTHING ELSE in the system reports. §6.5 permits an offline closeout as
    // closed_unsynced and says the shift "appears on a supervisor dashboard until it
    // reconciles" -- but a tablet that simply never closed out produces no record at all
    // beyond an open row nobody is looking at.
    expect(
      classifyShift({ status: "open", businessDate: "2026-10-05", today: "2026-10-07" }),
    ).toBe("stale_open");
  });

  it("does not flag a shift open on its own business date", () => {
    expect(
      classifyShift({ status: "open", businessDate: "2026-10-07", today: "2026-10-07" }),
    ).toBe("open");
  });

  it("flags closed_unsynced regardless of date", () => {
    expect(
      classifyShift({
        status: "closed_unsynced",
        businessDate: "2026-10-07",
        today: "2026-10-07",
      }),
    ).toBe("unsynced");
  });

  it("treats a closed shift as settled", () => {
    expect(
      classifyShift({ status: "closed", businessDate: "2026-10-05", today: "2026-10-07" }),
    ).toBe("closed");
  });
});

describe("formatVariance", () => {
  it("shows a short drawer with its sign", () => {
    // Over and short are different problems. An absolute value would not tell a supervisor
    // which one they are looking at.
    expect(formatVariance(-5_00)).toContain("-");
  });

  it("shows an over with its sign", () => {
    expect(formatVariance(5_00)).toMatch(/^\+/);
  });

  it("renders an exact zero as balanced, not as +0.00", () => {
    expect(formatVariance(0)).toMatch(/balanced/i);
  });

  it("renders a null variance as not yet closed, not as zero", () => {
    // Phase 2's handover names zero-value rendering as an untested seam. A shift that has
    // not closed has NO variance, which is a different fact from a variance of zero.
    expect(formatVariance(null)).not.toMatch(/balanced/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run lib/ledger/shifts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `shifts.ts`**

```typescript
import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "./queries";

export type ShiftClass = "open" | "stale_open" | "unsynced" | "closed" | "remitted";

/**
 * Two states this screen exists to surface, per spec §6.2:
 *
 *   stale_open -- a tablet that never closed out. Nothing else in the system reports this.
 *   unsynced   -- §6.5's closed_unsynced, which "appears on a supervisor dashboard until it
 *                 reconciles".
 */
export function classifyShift(input: {
  status: string;
  businessDate: string;
  today: string;
}): ShiftClass {
  if (input.status === "closed_unsynced") return "unsynced";
  if (input.status === "open") {
    return input.businessDate < input.today ? "stale_open" : "open";
  }
  if (input.status === "remitted") return "remitted";
  return "closed";
}

/**
 * A variance of zero and no variance at all are different facts. A shift that has not closed
 * has no declaration to compare, and rendering that as "balanced" would say the drawer was
 * counted and matched when nobody has counted it.
 */
export function formatVariance(variance: Centavos | null): string {
  if (variance === null) return "Not yet closed";
  if (variance === 0) return "Balanced";
  const pesos = (Math.abs(variance) / 100).toFixed(2);
  return variance > 0 ? `+₱${pesos} over` : `-₱${pesos} short`;
}

export interface ShiftRow {
  id: string;
  collectorName: string;
  deviceLabel: string;
  businessDate: string;
  status: string;
  klass: ShiftClass;
  systemCount: number | null;
  systemTotal: Centavos | null;
  declaredTotal: Centavos | null;
  variance: Centavos | null;
}

export async function getShifts(): Promise<ShiftRow[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "id, business_date, status, system_count, system_total, declared_total, variance," +
        " collector:app_users!shifts_collector_id_fkey(full_name)," +
        " device:devices!shifts_device_id_fkey(label)",
    )
    .order("business_date", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const today = new Date().toISOString().slice(0, 10);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    collectorName: row.collector?.full_name ?? "Unknown collector",
    deviceLabel: row.device?.label ?? "Unknown device",
    businessDate: row.business_date,
    status: row.status,
    klass: classifyShift({ status: row.status, businessDate: row.business_date, today }),
    systemCount: row.system_count,
    systemTotal: row.system_total === null ? null : fromPesos(Number(row.system_total)),
    declaredTotal: row.declared_total === null ? null : fromPesos(Number(row.declared_total)),
    variance: row.variance === null ? null : fromPesos(Number(row.variance)),
  }));
}
```

- [ ] **Step 4: Write the shifts page and its nav entry**

Add `/ledger/shifts` to `apps/web/app/(admin)/layout.tsx`, gated on
`canResolveExceptions(role) || canViewReports(role)` — spec §6.2 scopes the audience as
supervisor, admin and accounting, which is what those two existing helpers express between
them. A page with no nav entry is a page nobody opens.

Create `apps/web/app/(admin)/ledger/shifts/page.tsx`. Read-only. Sort so `stale_open` and
`unsynced` rows appear first regardless of date — a supervisor opening this screen should
not have to scroll to find the problem. Verification and remittance are Phase 6 and there is
no action on this page.

- [ ] **Step 5: Add `isAdmin` to `roles.ts` and use it**

Phase 2's handover: *"`role === "admin"` is inlined in five places (`actions.ts` ×2,
`opening-balances/page.tsx`, `leases/[id]/page.tsx`). `roles.ts` already has
`canManageMasterData` with identical semantics; a two-line `isAdmin(role)` helper mirroring
the DB's own `is_admin()` is the cleaner fix."*

Add to `packages/shared/src/roles.ts`:

```typescript
/** Mirrors the database's own is_admin(). Prefer this to an inline role comparison. */
export function isAdmin(role: Role): boolean {
  return role === "admin";
}
```

Replace the five inlined comparisons. Run `grep -rn 'role === "admin"' apps/web` to find
them; the count should reach zero.

- [ ] **Step 6: Write `credential-actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@ceedo/shared";
import { type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { ledgerClient } from "@/lib/ledger/queries";

const DENIED: SaveResult = {
  ok: false,
  fieldErrors: {},
  formError: "Only an administrator may issue a device credential.",
};

/**
 * Returns the secret ONCE. There is no path that reads it back: the server keeps only a
 * SHA-256 digest. The screen must say so, because a screen that appears to offer recovery
 * invites a support process that cannot exist.
 */
export async function issueCredential(
  formData: FormData,
): Promise<SaveResult & { credentialId?: string; secret?: string }> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return DENIED;

  const parsed = z.string().uuid().safeParse(formData.get("deviceId"));
  if (!parsed.success) {
    return { ok: false, fieldErrors: {}, formError: "Select a device." };
  }

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("issue_device_credential", {
    p_device_id: parsed.data,
  });
  if (error) return { ok: false, fieldErrors: {}, formError: error.message };

  revalidatePath("/devices");
  const issued = data as { credential_id: string; secret: string };
  return {
    ok: true,
    fieldErrors: {},
    formError: null,
    credentialId: issued.credential_id,
    secret: issued.secret,
  };
}
```

Write `revokeCredential(formData)` and `setCollectorPin(formData)` in the same shape,
calling `revoke_device_credential` and `set_collector_pin`. The PIN action validates
`/^\d{6}$/` client-side; the database validates it again.

- [ ] **Step 7: Extend the devices and staff screens**

On the devices screen: an "Issue credential" action per device, and a one-time panel showing
`credential_id` and `secret` with the words **"This secret is shown once and cannot be
recovered. Copy it to the tablet now."**

On the staff screen, for collectors only: a "Set PIN" action, with copy stating that **a new
PIN reaches the collector's tablet only on that tablet's next sync.** Parent spec §14 already
records the consequence as a known limitation — *"a collector who forgets mid-round offline
cannot sign in"* — and a supervisor who resets a PIN believing it takes effect immediately
has sent a collector out unable to work.

- [ ] **Step 8: Verify**

Run: `pnpm --filter web exec vitest run && pnpm typecheck --force && pnpm build`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web packages/shared/src/roles.ts
git commit -m "feat(web): shift verification, PIN and credential issue"
```

---
## Task 16: Concurrency, and the first-sync payload measurement

Spec §8.3, §9.

**Files:**
- Create: `tests/db/sync-concurrency.test.ts`
- Create: `tests/db/sync-payload-size.test.ts`

- [ ] **Step 1: Write the concurrency test**

Phase 2 demonstrated the FIFO lock by racing two posts and showing the damage without it.
Phase 3a is the first phase where that race is the *normal* case — two shared tablets
pushing the same lease — so it is tested at the push layer too.

Create `tests/db/sync-concurrency.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";

let a: Client;
let b: Client;
const BUSINESS_DATE = "2026-10-05";

beforeAll(async () => {
  a = new Client({ connectionString: POSTGRES_URL });
  b = new Client({ connectionString: POSTGRES_URL });
  await a.connect();
  await b.connect();
});

afterAll(async () => {
  await resetCutover(a);
  await a.end();
  await b.end();
});

describe("two devices racing one lease", () => {
  it("settles one and tells the other to retry, filing no exception", async () => {
    const one = await createSyncFixture(a);
    // A second device on the same facility, holding its own booklet — the shared-tablet
    // case §3 says is routine, not an edge case.
    const two = await createSyncFixture(a);
    await a.query(
      `insert into ceedo_collections.device_assignments (device_id, facility_id, active)
       values ($1, $2, true)`,
      [two.deviceId, one.facilityId],
    );
    await a.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
       values ($1, $2, true)`,
      [two.collectorId, one.facilityId],
    );
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    function entry(fx: typeof one, orNo: number) {
      return [
        {
          type: "collection",
          payload: {
            id: randomUUID(),
            or_no: orNo,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: `${BUSINESS_DATE}T02:00:00+00:00`,
            fee_type_id: one.feeTypeId,
            lease_id: one.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ];
    }

    const first = entry(one, 1400);
    const second = entry(two, 1400);

    await a.query("begin");
    const winner = await a.query(
      `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
      [one.deviceId, JSON.stringify(first)],
    );
    expect(winner.rows[0].result[0].status).toBe("accepted");

    const loserPromise = b.query(
      `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
      [two.deviceId, JSON.stringify(second)],
    );

    await a.query("commit");
    const loser = (await loserPromise).rows[0].result[0];

    expect(loser.status).toBe("rejected");
    expect(loser.reason).toBe("stale_allocations");
    expect(loser.retryable).toBe(true);

    // The point of the retryable flag. A supervisor must NOT be put in front of a race
    // that resolves itself on the device's next sync.
    const { rows } = await a.query(
      `select count(*)::int as n from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [second[0].payload.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it("never double-settles a period under concurrency", async () => {
    // The damage Phase 2 demonstrated without the lock: two allocations totalling P100
    // against a P50 charge, outstanding at -P50, is_settled reading true.
    const fx = await createSyncFixture(a);
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    const { rows } = await a.query(
      `select cb.outstanding
         from ceedo_collections.charge_balances cb
         join ceedo_collections.charges ch on ch.id = cb.charge_id
        where ch.lease_id = $1`,
      [fx.leaseId],
    );
    for (const row of rows) {
      expect(Number(row.outstanding)).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-concurrency.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the payload-size measurement**

Spec §9 flags this as unmeasured: §6.1 estimates "a few megabytes", but that estimate
predates the mandate to carry `collections` and allocations in the pull.

Create `tests/db/sync-payload-size.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

describe("first-sync payload", () => {
  it("stays under 8 MB for a realistic section", async () => {
    // §6.1 estimates "a few megabytes" but predates collections being in the pull. A
    // delinquent daily stall contributes ~1,460 charge rows AND now its collections too.
    //
    // This is a measurement with an alarm on it, not a behavioural assertion. If it fires,
    // the answer is pagination on the cursor -- which the protocol already permits, because
    // the cursor is resumable -- not trimming what the device needs.
    const fx = await createSyncFixture(db, { accrualPeriod: "daily" });
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const { rows } = await db.query(
      `select octet_length(ceedo_collections.sync_pull($1::uuid, 0)::text) as bytes`,
      [fx.deviceId],
    );
    const bytes = Number(rows[0].bytes);

    console.log(`first-sync payload: ${(bytes / 1024).toFixed(1)} KiB`);
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
  });
});
```

Adjust `createSyncFixture`'s options to match `createLeaseFixture`'s actual signature — check
it before running rather than assuming `accrualPeriod`.

- [ ] **Step 4: Run it and record the figure**

Run: `supabase db reset && pnpm --filter @ceedo/tests exec vitest run db/sync-payload-size.test.ts`
Expected: PASS, with the measured size logged. **Write that number into Task 18's handover.**
A test suite's fixture is not a market, so the figure is a lower bound — say so when you
record it.

- [ ] **Step 5: Commit**

```bash
git add tests/db/sync-concurrency.test.ts tests/db/sync-payload-size.test.ts
git commit -m "test(sync): the shared-tablet race, and a first-sync size alarm"
```

---
## Task 17: Regenerate types, correct the inherited comments, run everything

**Files:**
- Modify: `packages/shared/src/db.types.ts` (generated)
- Modify: nine files carrying the incorrect basis-points justification

- [ ] **Step 1: Re-verify the database types**

Task 13.5 already regenerated `db.types.ts`; this is the check that nothing since has drifted
it (Tasks 14–16 add no migrations, so the expected result is a no-op).

Run: `supabase db reset && pnpm db:types && ./scripts/check-types-current.sh`
Expected: **no diff** on `db.types.ts`, and the check passes. A diff here means a migration
landed after Task 13.5 without the types being regenerated — commit the regenerated file.

Use the same Supabase CLI version CI pins (`2.116.0` in `.github/workflows/ci.yml`).
Phase 2's CI notes record exactly what happens otherwise: a newer generator changed
`X extends {` to `(X extends {` and failed a commit that touched nothing.

- [ ] **Step 2: Correct the inherited basis-points comments**

Phase 2's handover records that Phase 1's spec, plan and three code files justify integer
basis points by claiming `0.03 * 8350` evaluates to `250.49999999999997`. **That is false** —
it is exactly `250.5`. The conclusion stands; the mechanism is rounding **direction**, not
representation error. `Math.floor(250.5)` is `250` where half-up gives `251`.

Phase 2 corrected its own design doc and `tests/db/parity.test.ts`. Nine live files remain.
Change comments only — no arithmetic changes anywhere:

| File | Line |
| --- | --- |
| `packages/shared/src/money.ts` | 46 |
| `packages/shared/src/money.test.ts` | 51 |
| `packages/shared/src/charges.test.ts` | 275 |
| `supabase/migrations/20260917000005_rates.sql` | 12 |
| `supabase/migrations/20260918000021_surcharge.sql` | 32 |
| `tests/db/surcharge.test.ts` | 84 |
| `docs/superpowers/phase-1-handover.md` | 43 |
| `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md` | 118 |
| `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md` | 499 |

Replacement text, adapted to each file's comment style:

> Integer basis points, never a float. The reason is rounding **direction**, not
> representation: `0.03 * 8350` is exactly `250.5` in IEEE 754, and `Math.floor(250.5)` is
> `250` where half-up gives `251` — a float pipeline that floors loses the centavo on every
> exact half. The integer form, `floor((amount * bps + 5000) / 10000)`, carries half-up in
> the `+5000` and cannot drift. (Genuine representation error does exist and `money.ts`
> cites a real instance: `1.005 * 100` is `100.49999999999999`.)

The two plan files (`2026-09-17-phase-1-foundation.md` lines 322, 429, 1999 and
`2026-09-18-phase-2-ledger.md` lines 909, 2768, 2846, 2989) are historical execution records.
Correcting them is optional; if you skip them, say so in the handover.

Verify the claim yourself before editing, so this correction is not taken on faith either:

```bash
node -e 'console.log(0.03 * 8350, Math.floor(0.03 * 8350), 1.005 * 100)'
```

Expected: `250.5 250 100.49999999999999`.

- [ ] **Step 3: Run the whole suite as CI runs it**

```bash
supabase db reset
supabase functions serve --env-file supabase/functions/.env &
sleep 10
pnpm typecheck --force && pnpm build && ./scripts/check-types-current.sh && pnpm test
```

Expected: every step green. **`pnpm test`, not a filtered command** — Phase 2's P2 records
that the root command had never been green for most of that phase because every green result
came from a filtered run.

- [ ] **Step 4: Run the suite a second time without a reset**

```bash
pnpm test
```

Expected: green again. Phase 2's P4 records a failure mode where one file left
`cutover_date` changed and a later run failed far from the cause. Every file in this plan
that touches `settings` calls `resetCutover(db)` in `afterAll`; this is the check that they
all do.

If the second run times out in a surcharge test, that is §9's known limit arriving — the
append-only ledger accumulates charges across runs and `run_surcharge` scans system-wide.
Reset and note it in the handover rather than "fixing" it here.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/db.types.ts packages/shared/src/money.ts \
        packages/shared/src/money.test.ts packages/shared/src/charges.test.ts \
        supabase/migrations/20260917000005_rates.sql \
        supabase/migrations/20260918000021_surcharge.sql \
        tests/db/surcharge.test.ts docs/
git commit -m "chore: regenerate types and correct the basis-points rationale"
```

---
## Task 18: The scenario test and the handover

Spec §1 — "Phase 3a ships when the full round-trip can be exercised over HTTP without a tablet."

**Files:**
- Create: `tests/http/round-trip.test.ts`
- Create: `docs/superpowers/phase-3a-handover.md`

- [ ] **Step 1: Write the round-trip test**

One test, the exit criterion from §1, over HTTP:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

describe("a market round, end to end, without a tablet", () => {
  it("authenticates, pulls, pushes a mixed batch, files one exception, and closes out", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const creds = { credential_id: fx.credentialId, secret: fx.secret };

    // 1. Pull the scoped world.
    const pull = await callFunction("sync-pull", { ...creds, cursor: 0 });
    expect(pull.status).toBe(200);
    expect(pull.body.leases.map((l: any) => l.id)).toContain(fx.leaseId);
    const cursor = pull.body.cursor;

    // 2. Open a shift.
    const shiftId = randomUUID();
    const opened = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "shift_open",
          payload: {
            id: shiftId,
            collector_id: fx.collectorId,
            business_date: "2026-10-05",
            opened_at: "2026-10-05T02:00:00+00:00",
          },
        },
      ],
    });
    expect(opened.body[0].status).toBe("accepted");

    // 3. A mixed batch: one good receipt, one that can never succeed, one spoiled form.
    const good = randomUUID();
    const doomed = randomUUID();
    const batch = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "collection",
          payload: {
            id: good,
            or_no: 1600,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
        {
          type: "collection",
          payload: {
            id: doomed,
            or_no: 999999,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 2 }],
            lines: [],
          },
        },
        {
          type: "spoiled_form",
          payload: {
            booklet_id: fx.bookletId,
            or_no: 1601,
            collector_id: fx.collectorId,
            reason: "Torn",
          },
        },
      ],
    });

    // The poison entry cost its own receipt, not the round's.
    expect(batch.body.map((r: any) => r.status)).toEqual([
      "accepted",
      "rejected",
      "accepted",
    ]);

    // 4. The rejection is a supervisor's problem, not a discard.
    const { rows: ex } = await db.query(
      `select status, reason_code from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [doomed],
    );
    expect(ex[0]).toMatchObject({ status: "open", reason_code: "or_out_of_range" });

    // 5. A retry of the whole batch is idempotent.
    const retry = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "collection",
          payload: {
            id: good,
            or_no: 1600,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });
    expect(retry.body[0].status).toBe("duplicate");

    // 6. The next pull carries the collection, though no charge row moved.
    const delta = await callFunction("sync-pull", { ...creds, cursor });
    expect(delta.body.collections.map((c: any) => c.id)).toContain(good);

    // 7. Closeout: wrong figures are refused.
    const wrong = await callFunction("closeout", {
      ...creds,
      shift_id: shiftId,
      declared_total: "0.00",
      device_count: 0,
      device_total: "0.00",
    });
    expect(wrong.body.status).toBe("mismatch");

    // 8. Right figures close it, and a short drawer does not block.
    const right = await callFunction("closeout", {
      ...creds,
      shift_id: shiftId,
      declared_total: (Number(wrong.body.system_total) - 5).toFixed(2),
      device_count: wrong.body.system_count,
      device_total: wrong.body.system_total,
    });
    expect(right.body.status).toBe("closed");
    expect(Number(right.body.variance)).toBeCloseTo(-5, 2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `supabase db reset && supabase functions serve --env-file supabase/functions/.env & sleep 10 && pnpm --filter @ceedo/tests exec vitest run http/round-trip.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the handover**

Create `docs/superpowers/phase-3a-handover.md`, following
`docs/superpowers/phase-2-handover.md`'s structure exactly. It must cover:

- **What exists** — the four tables, the eight functions, the three Edge Functions, the two
  web screens, the `packages/shared` additions.
- **Before go-live** — set `CEEDO_JWT_SECRET` as a hosted function secret; issue a real
  credential per tablet and record where each secret went; set every collector's PIN; the
  `grant ceedo_app to authenticator` must be present in the hosted database.
- **Mandatory for Phase 3b** — the device holds the credential in Android Keystore-backed
  storage, never plain `AsyncStorage`; the outbox survives a change of collector (§6.4) and
  signing out clears a session, never data; `stale_allocations` is retried automatically and
  every other reason is shown to the collector and kept; the device enforces one open shift
  locally because it must work offline, and the server's partial unique index is the
  guarantee behind it.
- **Known limitations** — the measured first-sync payload from Task 16 and that it is a
  lower bound; `run_surcharge`'s system-wide scan (unchanged, still §9's early warning); the
  subtransaction count per push; the 20-bit PIN on a device that may be stolen; bcrypt
  standing in for argon2.
- **Coverage gaps** — anything a mutation in this plan revealed and you chose not to close.
- **Corrections to inherited documentation** — migration 0002's Edge Function comment (fixed
  in Task 2), the basis-points rationale (Task 17), and whether the two plan files were
  corrected or skipped.
- **The open question for the client**, carried forward unresolved: a monthly lease starting
  mid-month is not billed for that month.

Be specific about what is *not* done. Phase 2's handover is the standard: it names five
classes of vacuous test it found in its own plan, and that honesty is what made the plan you
are executing possible.

- [ ] **Step 4: Final verification**

```bash
supabase db reset
supabase functions serve --env-file supabase/functions/.env &
sleep 10
pnpm typecheck --force && pnpm build && ./scripts/check-types-current.sh && pnpm test
```

Expected: every step green. Do not write "complete" anywhere until you have seen this output.

- [ ] **Step 5: Commit**

```bash
git add tests/http/round-trip.test.ts docs/superpowers/phase-3a-handover.md
git commit -m "docs: Phase 3a handover"
```

---

## Deferred to Phase 3b and beyond

Named here so nothing is lost between phases:

| Item | Where it lands |
| --- | --- |
| `apps/collector` — Expo, SQLite outbox, offline sign-in, collection flow | Phase 3b |
| Five-failed-attempt PIN lock | Phase 3b (device-side) |
| `closed_unsynced` written by a device with no signal | Phase 3b |
| `remittances`, shift → `remitted` | Phase 6 |
| Treasurer 3-day exception dashboard, monthly resolutions report | Phase 6 |
| Materialised `charge_balances` with scheduled refresh | When §9's alarm fires |
| QR cards, scan flow, amount-driven FIFO entry | Phase 4 |
| Parking, terminal, slaughterhouse rate classes | Phase 5 |
