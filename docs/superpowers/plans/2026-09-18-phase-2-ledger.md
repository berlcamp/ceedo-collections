# CEEDO Collections — Phase 2 (Ledger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the charge ledger, the nightly accrual and surcharge jobs, and a tested settlement engine, so arrears and aging are provably correct before any collector tablet exists.

**Architecture:** Six append-only ledger tables whose settled state is never stored, only derived from a view over allocations and condonations. No client role holds `INSERT` on any of them; every write goes through a `SECURITY DEFINER` function that validates first. The nightly accrual runs inside Postgres under `pg_cron`, never over the network. One settlement engine — `post_collection()` — serves Phase 2's tests and Phase 3's `sync-push`, so the two can never drift.

**Tech Stack:** Postgres 17 (Supabase), plain SQL migrations under the Supabase CLI, `pg_cron`, TypeScript 5.7+, Vitest 3, Next.js 16 (App Router), React 19, Tailwind CSS 4, pnpm 10 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md`
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Phase 1 handover:** `docs/superpowers/phase-1-handover.md`

## Global Constraints

Copied from both specs. Every task's requirements implicitly include these.

- **Schema name is `ceedo_collections`.** Never `public`. Every object is schema-qualified.
- **Money is `numeric(14,2)` in Postgres and integer centavos in TypeScript.** Floats never touch a peso.
- **Rounding is half-up to the centavo**, never banker's rounding.
- **Percentage rates are integer basis points.** 3% is `300`. Surcharge is `floor((amount * bps + 5000) / 10000)`.
- **Every function and trigger sets `search_path = ceedo_collections, pg_temp`.**
- **No RLS policy may rest on `auth.uid() IS NOT NULL`.** Every policy joins through `ceedo_collections.app_users` via `has_role()` / `is_admin()`. `auth.users` is shared with unrelated systems on this Supabase project.
- **`UPDATE` and `DELETE` are never granted on a ledger table, to any role**, including `service_role`. Migration 0001's default privileges already withhold them.
- **`INSERT` must be actively revoked from `service_role`** on every ledger table. Migration 0001's `ALTER DEFAULT PRIVILEGES` grants `select, insert` to `service_role` on every future table in this schema; inheriting that would hand the break-glass key a direct write path into the ledger.
- **Never call `apply_master_data_policies()` on a ledger table.** It grants `UPDATE`/`DELETE` to `service_role`. Use `apply_ledger_policies()` from Task 1.
- **Every ledger table carries `row_version bigint`** fed by `ceedo_collections.row_version_seq` through the `bump_row_version()` trigger.
- **The business date is `(now() at time zone 'Asia/Manila')::date`**, never the UTC date.
- **`leases.due_day` is constrained to 1–28.** Do not write month-length clamping; it is unreachable code.
- **Node >= 22**, pnpm 10.

## Migration numbering

Phase 1 ended at `20260917000010_audit_log.sql`. Phase 2 continues at `20260918000011`. Each task that adds a migration states its exact filename.

## File Structure

```
supabase/migrations/
├── 20260918000011_ledger_charges.sql        Task 1  apply_ledger_policies(), charges
├── 20260918000012_settings_accrual_runs.sql Task 2  settings (one row), accrual_runs
├── 20260918000013_opening_balances.sql      Task 4  record_opening_balance()
├── 20260918000014_accrual.sql               Task 5  lease_periods(), run_accrual()
├── 20260918000017_ledger_collections.sql    Task 6  collections, allocations, lines, cancellations
├── 20260918000018_charge_condonations.sql   Task 7  the condonation table
├── 20260918000019_charge_balances.sql       Task 8  charge_balances, unpaid_period_groups()
├── 20260918000020_condone_charge.sql        Task 9  condone_charge()
├── 20260918000021_surcharge.sql             Task 10 run_surcharge()
├── 20260918000022_post_collection.sql       Task 12 the settlement engine
├── 20260918000023_cancel_collection.sql     Task 13 cancel_collection()
├── 20260918000024_reporting_views.sql       Task 14 aging, delinquency, subsidiary ledger
└── 20260918000025_accrual_schedule.sql      Task 15 pg_cron, run_nightly(), accrual_health

Numbers 0015 and 0016 are intentionally unused: the surcharge and balance migrations were
renumbered when the dependency order was corrected. Do not backfill them -- a gap costs
nothing, and renumbering an applied migration breaks every environment that already ran it.

packages/shared/src/
├── charges.ts        Task 3  period generation, due dates, surcharge computation
├── charges.test.ts
├── fifo.ts           Task 11 prefix validation, amount-driven selection
├── fifo.test.ts
├── reason-codes.ts   Task 11 the rejection vocabulary shared with Phase 3
├── db.types.ts       Task 19 REGENERATED -- do not hand-edit
└── index.ts          MODIFIED in Tasks 3 and 11

tests/db/
├── ledger-privileges.test.ts   Task 1, extended in Tasks 6 and 7 -- THE guarantee test
├── charges.test.ts             Task 1
├── settings.test.ts            Task 2
├── opening-balance.test.ts     Task 4
├── accrual.test.ts             Task 5
├── collections.test.ts         Task 6
├── charge-balances.test.ts     Task 8
├── condonation.test.ts         Task 9
├── surcharge.test.ts           Task 10
├── post-collection.test.ts     Task 12
├── cancellation.test.ts        Task 13
├── reporting-views.test.ts     Task 14
├── accrual-schedule.test.ts    Task 15
├── parity.test.ts              Task 16 TypeScript vs SQL
└── ledger-scenario.test.ts     Task 20 the market month

tests/helpers/supabase.ts       MODIFIED in Tasks 1, 5, 6, 8, 12, 14

apps/web/
├── lib/ledger/queries.ts                     Task 17 typed reads over the views
├── lib/ledger/actions.ts                     Task 18 server actions calling the RPCs
├── components/ledger/money.tsx               Task 17
├── components/ledger/ledger-table.tsx        Task 17
├── components/ledger/cancel-dialog.tsx       Task 18
├── components/ledger/condone-dialog.tsx      Task 18
├── app/(admin)/ledger/aging/page.tsx         Task 17
├── app/(admin)/ledger/delinquency/page.tsx   Task 17
├── app/(admin)/ledger/leases/[id]/page.tsx   Task 17
├── app/(admin)/ledger/collections/page.tsx   Task 18 read-only browser + cancel
├── app/(admin)/ledger/opening-balances/page.tsx  Task 18
└── app/(admin)/layout.tsx                    MODIFIED in Tasks 17 and 18
```

`packages/shared` must never import React, Next.js, React Native or `@supabase/supabase-js`. It is pure TypeScript so the Expo app can import the same rules.

---

### Task 1: Ledger privilege installer and the `charges` table

This task creates the installer that every later ledger table uses, and its first consumer. The privilege test written here is the single most important test in Phase 2 — it is what makes the append-only guarantee a property of the database rather than a promise in a document.

**Files:**
- Create: `supabase/migrations/20260918000011_ledger_charges.sql`
- Create: `tests/db/ledger-privileges.test.ts`
- Create: `tests/db/charges.test.ts`

**Interfaces:**
- Consumes: `ceedo_collections.bump_row_version()`, `has_role()`, `is_admin()` (Phase 1)
- Produces: `ceedo_collections.apply_ledger_policies(table_name text)`, table `ceedo_collections.charges`, type `ceedo_collections.charge_type`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000011_ledger_charges.sql`:

```sql
-- The Phase 2 ledger begins here. Everything in this file exists to make a posted
-- charge unalterable by anyone, including whoever holds the dashboard password.

-- The ledger counterpart to apply_master_data_policies(). The difference is the whole
-- point: that installer grants UPDATE and DELETE to service_role because master data is
-- legitimately mutable. A ledger table is not. Calling the wrong installer on a ledger
-- table would silently hand away the guarantee, so this one exists to be called instead.
create or replace function ceedo_collections.apply_ledger_policies(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format('alter table ceedo_collections.%I enable row level security', table_name);

  -- Read is gated on app_users membership, never on `authenticated` alone: auth.users is
  -- shared with unrelated systems on this Supabase project, so `authenticated` includes
  -- every person who ever signed up for any of them.
  execute format(
    'create policy %I on ceedo_collections.%I for select to authenticated
       using (ceedo_collections.has_role(''supervisor'', ''accounting'', ''admin''))',
    table_name || '_read', table_name);

  -- SELECT only. No INSERT: every write goes through a SECURITY DEFINER function that
  -- validates first, so there is no way to create a row that skipped validation.
  execute format(
    'grant select on ceedo_collections.%I to authenticated', table_name);

  -- Migration 0001 set ALTER DEFAULT PRIVILEGES to grant service_role SELECT and INSERT
  -- on every table this schema will ever contain. For an append-only table that INSERT is
  -- a direct write path into the ledger for the break-glass key, so it is revoked here
  -- rather than inherited. UPDATE and DELETE were never in that default and so need no
  -- revoking -- the guarantee holds because nothing granted them, not because something
  -- took them away.
  execute format(
    'revoke insert on ceedo_collections.%I from service_role', table_name);

  execute format(
    'create trigger %I before insert or update on ceedo_collections.%I
       for each row execute function ceedo_collections.bump_row_version()',
    table_name || '_row_version', table_name);
end;
$$;

revoke execute on function ceedo_collections.apply_ledger_policies(text) from public;

create type ceedo_collections.charge_type as enum
  ('rental', 'surcharge', 'opening_balance');

create type ceedo_collections.charge_source as enum
  ('accrual', 'opening_balance', 'manual');

create table ceedo_collections.charges (
  id               uuid primary key default gen_random_uuid(),
  lease_id         uuid not null references ceedo_collections.leases (id),
  fee_type_id      uuid not null references ceedo_collections.fee_types (id),
  charge_type      ceedo_collections.charge_type not null,
  parent_charge_id uuid references ceedo_collections.charges (id),
  period_start     date not null,
  period_end       date not null,
  due_date         date not null,
  amount           numeric(14,2) not null check (amount > 0),
  surcharge_bps    integer not null default 0 check (surcharge_bps between 0 and 10000),
  source           ceedo_collections.charge_source not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references ceedo_collections.app_users (id),
  row_version      bigint not null default 0,

  constraint charges_period_ordered check (period_end >= period_start),

  -- A surcharge is meaningless without the rent it penalises, and a rental that points at
  -- a parent would make the period group a cycle rather than a pair.
  constraint charges_surcharge_has_parent
    check ((charge_type = 'surcharge') = (parent_charge_id is not null)),

  -- The paper figure an opening balance carries already includes accumulated penalties.
  -- Stamping a rate on it would invite a second one.
  constraint charges_opening_balance_no_surcharge
    check (charge_type <> 'opening_balance' or surcharge_bps = 0)
);

-- THIS INDEX IS THE ACCRUAL IDEMPOTENCY. run_accrual() does not check whether a period
-- has already been charged; it inserts and lets this index refuse the duplicate. Removing
-- it does not cause a test to fail loudly -- it causes a tenant to be billed twice after
-- the job is re-run following an outage, which is exactly when it will be re-run.
create unique index charges_one_rental_per_period
  on ceedo_collections.charges (lease_id, period_start)
  where charge_type = 'rental';

-- Invariant #6: a surcharge exists at most once per rental charge, ever.
create unique index charges_one_surcharge_per_parent
  on ceedo_collections.charges (parent_charge_id)
  where charge_type = 'surcharge';

-- Invariant #19: one opening balance per lease.
create unique index charges_one_opening_balance_per_lease
  on ceedo_collections.charges (lease_id)
  where charge_type = 'opening_balance';

create index charges_lease_due_idx
  on ceedo_collections.charges (lease_id, due_date);

create index charges_due_date_idx
  on ceedo_collections.charges (due_date)
  where charge_type <> 'surcharge';

select ceedo_collections.apply_ledger_policies('charges');

comment on table ceedo_collections.charges is
  'Append-only. No status column: settled state is derived in charge_balances from '
  'allocations and condonations. Nothing in this table is ever updated or deleted.';
```

- [ ] **Step 2: Write the failing privilege test**

Create `tests/db/ledger-privileges.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signIn, createAppUser } from "../helpers/supabase";

/**
 * The test that guards the entire COA position.
 *
 * Every other test in Phase 2 checks that the ledger computes the right answer. This one
 * checks that nobody can change the answer after the fact -- which is the property the
 * append-only argument actually rests on. If this file goes red, stop and fix it before
 * anything else: a passing suite with this test failing describes a system that merely
 * happens to be correct today.
 */
const LEDGER_TABLES = ["charges"] as const;

describe("ledger tables refuse mutation", () => {
  let adminEmail: string;

  beforeAll(async () => {
    adminEmail = await createAppUser("admin");
  });

  for (const table of LEDGER_TABLES) {
    it(`${table}: authenticated cannot INSERT`, async () => {
      const client = await signIn(adminEmail);
      const { error } = await client.from(table).insert({});
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501"); // insufficient_privilege
    });

    it(`${table}: authenticated cannot UPDATE`, async () => {
      const client = await signIn(adminEmail);
      const { error } = await client.from(table).update({ amount: 1 }).neq("id", "");
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: authenticated cannot DELETE`, async () => {
      const client = await signIn(adminEmail);
      const { error } = await client.from(table).delete().neq("id", "");
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot INSERT`, async () => {
      const { error } = await serviceClient().from(table).insert({});
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot UPDATE`, async () => {
      const { error } = await serviceClient().from(table).update({ amount: 1 }).neq("id", "");
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: service_role cannot DELETE`, async () => {
      const { error } = await serviceClient().from(table).delete().neq("id", "");
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it(`${table}: anon reads nothing`, async () => {
      const { data, error } = await anonClient().from(table).select("id");
      expect(error === null ? data : []).toEqual([]);
    });
  }
});
```

This file's `LEDGER_TABLES` array grows in Task 9. Leaving it as a single-element array now is deliberate — the array is the checklist, and a new ledger table that is not added to it is a table nobody proved the guarantee for.

- [ ] **Step 3: Add the `createAppUser` helper if it does not exist**

Read `tests/helpers/supabase.ts` first. Phase 1's suite already creates role-scoped fixture users; reuse the existing helper and adjust the import above to match its real name rather than adding a duplicate. Only add a helper if none exists.

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter tests test ledger-privileges`
Expected: FAIL — `relation "charges" does not exist`.

- [ ] **Step 5: Apply the migration**

Run: `supabase db reset`
Expected: all migrations apply cleanly through `20260918000011`.

- [ ] **Step 6: Run the privilege test to verify it passes**

Run: `pnpm --filter tests test ledger-privileges`
Expected: PASS, 7 tests.

- [ ] **Step 7: Write the constraint tests**

Create `tests/db/charges.test.ts`. These insert through a direct Postgres connection (`POSTGRES_URL`) because no client role may insert into `charges` — that is the point of Task 1, and it shapes every ledger test from here on.

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase";

let db: Client;
let leaseId: string;
let feeTypeId: string;

/** Inserts a charge as the table owner, bypassing the client-role privilege model. */
async function insertCharge(overrides: Record<string, unknown> = {}) {
  const row = {
    lease_id: leaseId,
    fee_type_id: feeTypeId,
    charge_type: "rental",
    parent_charge_id: null,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    due_date: "2026-10-05",
    amount: "500.00",
    surcharge_bps: 0,
    source: "accrual",
    ...overrides,
  };
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  return db.query(
    `insert into ceedo_collections.charges (${cols.join(", ")})
     values (${params}) returning id`,
    Object.values(row),
  );
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // Build a minimal facility -> section -> stall -> lease chain and a fee type.
  // Follow the fixture pattern already used by tests/db/leases.test.ts rather than
  // inventing a second one; read that file before writing this block.
  ({ leaseId, feeTypeId } = await createLeaseFixture(db));
});

afterAll(async () => {
  await db.end();
});

describe("charges constraints", () => {
  it("refuses a second rental charge for the same lease and period", async () => {
    await insertCharge({ period_start: "2026-11-01" });
    await expect(insertCharge({ period_start: "2026-11-01" })).rejects.toThrow(
      /charges_one_rental_per_period/,
    );
  });

  it("refuses a second surcharge against the same parent", async () => {
    const { rows } = await insertCharge({ period_start: "2026-12-01" });
    const parent = rows[0].id;
    await insertCharge({
      charge_type: "surcharge",
      parent_charge_id: parent,
      period_start: "2026-12-01",
      amount: "15.00",
      surcharge_bps: 300,
    });
    await expect(
      insertCharge({
        charge_type: "surcharge",
        parent_charge_id: parent,
        period_start: "2026-12-01",
        amount: "15.00",
        surcharge_bps: 300,
      }),
    ).rejects.toThrow(/charges_one_surcharge_per_parent/);
  });

  it("refuses a surcharge with no parent", async () => {
    await expect(
      insertCharge({ charge_type: "surcharge", parent_charge_id: null }),
    ).rejects.toThrow(/charges_surcharge_has_parent/);
  });

  it("refuses a rental that names a parent", async () => {
    const { rows } = await insertCharge({ period_start: "2027-01-01" });
    await expect(
      insertCharge({ period_start: "2027-02-01", parent_charge_id: rows[0].id }),
    ).rejects.toThrow(/charges_surcharge_has_parent/);
  });

  it("refuses a second opening balance for the same lease", async () => {
    await insertCharge({
      charge_type: "opening_balance",
      period_start: "2024-03-01",
      period_end: "2026-09-30",
      due_date: "2024-03-01",
      source: "opening_balance",
    });
    await expect(
      insertCharge({
        charge_type: "opening_balance",
        period_start: "2024-04-01",
        period_end: "2026-09-30",
        due_date: "2024-04-01",
        source: "opening_balance",
      }),
    ).rejects.toThrow(/charges_one_opening_balance_per_lease/);
  });

  it("refuses an opening balance carrying a surcharge rate", async () => {
    await expect(
      insertCharge({
        charge_type: "opening_balance",
        surcharge_bps: 300,
        source: "opening_balance",
      }),
    ).rejects.toThrow(/charges_opening_balance_no_surcharge/);
  });

  it("refuses a zero or negative amount", async () => {
    await expect(insertCharge({ amount: "0.00" })).rejects.toThrow(/amount/);
  });

  it("stamps row_version from the shared sequence", async () => {
    const { rows } = await insertCharge({ period_start: "2027-03-01" });
    const { rows: got } = await db.query(
      "select row_version from ceedo_collections.charges where id = $1",
      [rows[0].id],
    );
    expect(Number(got[0].row_version)).toBeGreaterThan(0);
  });
});
```

Write `createLeaseFixture(db)` in `tests/helpers/supabase.ts` returning `{ leaseId, feeTypeId, stallId, tenantId }`. Every later ledger test needs the same chain; writing it once here is why it belongs in the helper rather than in this file.

- [ ] **Step 8: Run the constraint tests**

Run: `pnpm --filter tests test charges`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260918000011_ledger_charges.sql \
        tests/db/ledger-privileges.test.ts tests/db/charges.test.ts \
        tests/helpers/supabase.ts
git commit -m "feat(db): charges table and the ledger privilege installer

apply_ledger_policies() is the ledger counterpart to
apply_master_data_policies(): read gated on app_users membership, SELECT
only for authenticated, and INSERT actively revoked from service_role
because migration 0001's default privileges would otherwise grant it.

The unique index on (lease_id, period_start) is the accrual idempotency;
run_accrual inserts and lets the index refuse duplicates."
```

---

### Task 2: `settings` and `accrual_runs`

Two operational tables, deliberately outside the append-only regime. `settings` holds the one date that decides what the accrual job will and will not raise; `accrual_runs` is how anyone answers "did last Tuesday run?" after an outage.

**Files:**
- Create: `supabase/migrations/20260918000012_settings_accrual_runs.sql`
- Create: `tests/db/settings.test.ts`

**Interfaces:**
- Consumes: `is_admin()`, `has_role()`, `attach_audit()`, `touch_updated_at()` (Phase 1)
- Produces: tables `ceedo_collections.settings`, `ceedo_collections.accrual_runs`; function `ceedo_collections.cutover_date()` returning `date`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000012_settings_accrual_runs.sql`:

```sql
-- One row, enforced by the type system rather than by a trigger or by convention.
-- `id boolean primary key default true` with `check (id)` admits exactly one row: the
-- only permitted value is true, and the primary key stops it appearing twice. Two cutover
-- dates are therefore unrepresentable, so no code needs to decide which one applies.
create table ceedo_collections.settings (
  id           boolean primary key default true check (id),
  cutover_date date not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references ceedo_collections.app_users (id),
  row_version  bigint not null default 0
);

comment on column ceedo_collections.settings.cutover_date is
  'The accrual job raises no charge whose period begins before this date. Arrears older '
  'than this enter as one opening_balance charge per lease. Moving it after go-live '
  'changes what the nightly job will raise, which is why this table is audited.';

alter table ceedo_collections.settings enable row level security;

create policy settings_read on ceedo_collections.settings
  for select to authenticated
  using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));

create policy settings_admin_write on ceedo_collections.settings
  for all to authenticated
  using (ceedo_collections.is_admin())
  with check (ceedo_collections.is_admin());

grant select, insert, update on ceedo_collections.settings to authenticated;
grant update on ceedo_collections.settings to service_role;

create trigger settings_row_version
  before insert or update on ceedo_collections.settings
  for each row execute function ceedo_collections.bump_row_version();

create trigger settings_touch
  before update on ceedo_collections.settings
  for each row execute function ceedo_collections.touch_updated_at();

-- Moving the cutover date is a decision someone makes, with consequences for what gets
-- billed. Who and when is exactly what gets asked later.
select ceedo_collections.attach_audit('settings');

-- Reads the cutover date, or fails loudly. A missing settings row means the system was
-- never configured; returning null instead would let run_accrual() compare every period
-- against null, match nothing, and raise no charges at all -- a silent no-op that looks
-- exactly like a quiet night.
create or replace function ceedo_collections.cutover_date()
returns date
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
declare
  d date;
begin
  select cutover_date into d from ceedo_collections.settings where id;
  if d is null then
    raise exception 'No cutover date configured. Insert the ceedo_collections.settings row before running accrual.'
      using errcode = 'no_data_found';
  end if;
  return d;
end;
$$;

revoke execute on function ceedo_collections.cutover_date() from public;
grant execute on function ceedo_collections.cutover_date() to authenticated, service_role;

create table ceedo_collections.accrual_runs (
  id                uuid primary key default gen_random_uuid(),
  business_date     date not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  charges_raised    integer not null default 0,
  surcharges_raised integer not null default 0,
  status            text not null default 'running'
                      check (status in ('running', 'succeeded', 'failed')),
  error             text,
  unique (business_date, started_at)
);

create index accrual_runs_business_date_idx
  on ceedo_collections.accrual_runs (business_date desc);

-- NOT a ledger table. The job updates its own row to record completion, so UPDATE is
-- granted here where it is withheld everywhere else in Phase 2. Nothing in this table is
-- a cash fact -- it records that a job ran, not that money moved.
alter table ceedo_collections.accrual_runs enable row level security;

create policy accrual_runs_read on ceedo_collections.accrual_runs
  for select to authenticated
  using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));

grant select on ceedo_collections.accrual_runs to authenticated;
grant update on ceedo_collections.accrual_runs to service_role;
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/settings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, signIn } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("settings holds exactly one row", () => {
  it("refuses a second row", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')",
    );
    await expect(
      db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-11-01')"),
    ).rejects.toThrow(/settings_pkey/);
  });

  it("refuses a row with id false", async () => {
    await expect(
      db.query(
        "insert into ceedo_collections.settings (id, cutover_date) values (false, '2026-11-01')",
      ),
    ).rejects.toThrow(/settings_id_check/);
  });
});

describe("cutover_date()", () => {
  it("fails loudly rather than returning null when unconfigured", async () => {
    await db.query("delete from ceedo_collections.settings");
    await expect(db.query("select ceedo_collections.cutover_date()")).rejects.toThrow(
      /No cutover date configured/,
    );
  });

  it("returns the configured date", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')",
    );
    const { rows } = await db.query("select ceedo_collections.cutover_date() as d");
    expect(rows[0].d.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("settings access control", () => {
  it("a non-admin cannot change the cutover date", async () => {
    const email = await createAppUser("accounting");
    const client = await signIn(email);
    const { error } = await client
      .from("settings")
      .update({ cutover_date: "2020-01-01" })
      .eq("id", true);
    expect(error).not.toBeNull();
  });

  it("an admin can change the cutover date", async () => {
    const email = await createAppUser("admin");
    const client = await signIn(email);
    const { error } = await client
      .from("settings")
      .update({ cutover_date: "2026-10-02" })
      .eq("id", true);
    expect(error).toBeNull();
  });

  it("records the change in the audit log", async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'settings' and action = 'update'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter tests test settings`
Expected: FAIL — `relation "ceedo_collections.settings" does not exist`.

- [ ] **Step 4: Apply the migration**

Run: `supabase db reset`

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter tests test settings`
Expected: PASS, 7 tests.

- [ ] **Step 6: Seed a cutover date locally**

Modify `supabase/seed.sql` to insert a settings row so local development has one:

```sql
insert into ceedo_collections.settings (cutover_date)
values ('2026-10-01')
on conflict (id) do nothing;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260918000012_settings_accrual_runs.sql \
        tests/db/settings.test.ts supabase/seed.sql
git commit -m "feat(db): one-row settings table and the accrual run log

settings uses 'id boolean primary key check (id)' so two cutover dates are
unrepresentable rather than merely discouraged. cutover_date() raises
instead of returning null: an unconfigured system must not look like a
quiet night with no charges to raise.

accrual_runs is explicitly not a ledger table and carries UPDATE."
```

---

### Task 3: Charge period rules in `packages/shared`

Pure TypeScript. The accrual job in Task 5 implements the same rules in SQL, and Task 15 asserts the two agree. Writing the TypeScript first gives that comparison something to compare against, and gives Phase 3's device the rules it needs without importing Postgres.

**Files:**
- Create: `packages/shared/src/charges.ts`
- Create: `packages/shared/src/charges.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Centavos`, `applyBasisPoints` from `./money`
- Produces:
  - `type AccrualPeriod = "daily" | "weekly" | "monthly"`
  - `interface ChargePeriod { periodStart: string; periodEnd: string; dueDate: string }`
  - `function generatePeriods(input: GeneratePeriodsInput): ChargePeriod[]`
  - `interface GeneratePeriodsInput { accrualPeriod: AccrualPeriod; leaseStart: string; leaseEnd: string | null; cutover: string; through: string; dueDay: number | null }`
  - `function computeSurcharge(base: Centavos, bps: number): Centavos`
  - `function surchargeDueFrom(dueDate: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/charges.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import { computeSurcharge, generatePeriods, surchargeDueFrom } from "./charges";

describe("generatePeriods — daily", () => {
  it("raises one period per day, due on the day itself", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-03",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-01", dueDate: "2026-10-01" },
      { periodStart: "2026-10-02", periodEnd: "2026-10-02", dueDate: "2026-10-02" },
      { periodStart: "2026-10-03", periodEnd: "2026-10-03", dueDate: "2026-10-03" },
    ]);
  });

  it("never starts a period before the cutover date", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2024-01-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-02",
      dueDay: null,
    });
    expect(periods[0]!.periodStart).toBe("2026-10-01");
    expect(periods).toHaveLength(2);
  });

  it("stops at the lease end date", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2026-10-01",
      leaseEnd: "2026-10-02",
      cutover: "2026-10-01",
      through: "2026-10-05",
      dueDay: null,
    });
    expect(periods).toHaveLength(2);
  });

  it("returns nothing when the lease starts after the through date", () => {
    expect(
      generatePeriods({
        accrualPeriod: "daily",
        leaseStart: "2026-12-01",
        leaseEnd: null,
        cutover: "2026-10-01",
        through: "2026-10-05",
        dueDay: null,
      }),
    ).toEqual([]);
  });
});

describe("generatePeriods — weekly", () => {
  it("raises seven-day periods due on the last day", () => {
    const periods = generatePeriods({
      accrualPeriod: "weekly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-15",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-07", dueDate: "2026-10-07" },
      { periodStart: "2026-10-08", periodEnd: "2026-10-14", dueDate: "2026-10-14" },
    ]);
  });

  it("does not raise a partial week", () => {
    const periods = generatePeriods({
      accrualPeriod: "weekly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-10",
      dueDay: null,
    });
    expect(periods).toHaveLength(1);
  });
});

describe("generatePeriods — monthly", () => {
  it("raises calendar months due on the lease's due day", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-12-15",
      dueDay: 5,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-10-05" },
      { periodStart: "2026-11-01", periodEnd: "2026-11-30", dueDate: "2026-11-05" },
    ]);
  });

  it("handles February without needing to clamp — due_day is 1..28 by constraint", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2027-02-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2027-03-05",
      dueDay: 28,
    });
    expect(periods).toEqual([
      { periodStart: "2027-02-01", periodEnd: "2027-02-28", dueDate: "2027-02-28" },
    ]);
  });

  it("gets February right in a leap year", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2028-02-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2028-03-05",
      dueDay: 1,
    });
    expect(periods[0]!.periodEnd).toBe("2028-02-29");
  });

  it("rejects a monthly lease with no due day", () => {
    expect(() =>
      generatePeriods({
        accrualPeriod: "monthly",
        leaseStart: "2026-10-01",
        leaseEnd: null,
        cutover: "2026-10-01",
        through: "2026-12-01",
        dueDay: null,
      }),
    ).toThrow(/due day/i);
  });
});

describe("computeSurcharge", () => {
  it("is exact on the half-centavo case floats get wrong", () => {
    // 0.03 * 8350 is 250.49999999999997 in IEEE 754 and floors to 250.
    expect(computeSurcharge(fromCentavos(8350), 300)).toBe(251);
  });

  it("is zero for a zero rate", () => {
    expect(computeSurcharge(fromCentavos(8350), 0)).toBe(0);
  });

  it("rounds half up", () => {
    expect(computeSurcharge(fromCentavos(50000), 300)).toBe(1500);
  });
});

describe("surchargeDueFrom", () => {
  it("uses calendar-month arithmetic, so 31 January becomes 28 February", () => {
    expect(surchargeDueFrom("2027-01-31")).toBe("2027-02-28");
  });

  it("gives 29 February in a leap year", () => {
    expect(surchargeDueFrom("2028-01-31")).toBe("2028-02-29");
  });

  it("is an ordinary month step otherwise", () => {
    expect(surchargeDueFrom("2026-10-05")).toBe("2026-11-05");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ceedo/shared test charges`
Expected: FAIL — cannot resolve `./charges`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/charges.ts`:

```ts
import { applyBasisPoints, type Centavos } from "./money";

export type AccrualPeriod = "daily" | "weekly" | "monthly";

export interface ChargePeriod {
  /** ISO date, inclusive. */
  periodStart: string;
  /** ISO date, inclusive. */
  periodEnd: string;
  /** ISO date. The surcharge clock starts here. */
  dueDate: string;
}

export interface GeneratePeriodsInput {
  accrualPeriod: AccrualPeriod;
  leaseStart: string;
  leaseEnd: string | null;
  /** No period may begin before this date. */
  cutover: string;
  /** Generate periods that have fully elapsed on or before this date. */
  through: string;
  /** Day of month a monthly charge falls due. Constrained to 1..28 in the database. */
  dueDay: number | null;
}

/**
 * Dates are handled as ISO strings and UTC-noon Date objects throughout.
 *
 * Noon rather than midnight is not superstition: a Date at midnight UTC shifts to the
 * previous calendar day in any negative-offset timezone, so `toISOString().slice(0, 10)`
 * silently returns yesterday. Anchoring at noon keeps every offset on Earth inside the
 * same calendar day, so the same period boundaries come out whoever runs this.
 */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** The last day of the month `date` falls in. */
function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
}

function startOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12));
}

export function generatePeriods(input: GeneratePeriodsInput): ChargePeriod[] {
  const { accrualPeriod, leaseEnd, dueDay } = input;

  if (accrualPeriod === "monthly" && (dueDay === null || dueDay === undefined)) {
    throw new Error("A monthly lease needs a due day");
  }

  // The cutover floor is applied here, once, rather than by each caller. Invariant #18.
  const start = parse(input.leaseStart) > parse(input.cutover)
    ? parse(input.leaseStart)
    : parse(input.cutover);
  const through = parse(input.through);
  const hardEnd = leaseEnd === null ? null : parse(leaseEnd);

  const periods: ChargePeriod[] = [];
  let cursor = accrualPeriod === "monthly"
    ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12))
    : start;

  // A monthly lease starting mid-month bills from the month it starts in; the period
  // still spans the whole calendar month, because that is what the office charges for.
  while (cursor <= through) {
    let periodEnd: Date;
    let dueDate: Date;

    if (accrualPeriod === "daily") {
      periodEnd = cursor;
      dueDate = cursor;
    } else if (accrualPeriod === "weekly") {
      periodEnd = addDays(cursor, 6);
      dueDate = periodEnd;
    } else {
      periodEnd = endOfMonth(cursor);
      dueDate = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay!, 12),
      );
    }

    // Only fully elapsed periods are raised. A week that has not finished is not yet owed.
    if (periodEnd > through) break;
    if (hardEnd !== null && periodEnd > hardEnd) break;

    periods.push({
      periodStart: fmt(cursor),
      periodEnd: fmt(periodEnd),
      dueDate: fmt(dueDate),
    });

    cursor = accrualPeriod === "monthly" ? startOfNextMonth(cursor) : addDays(periodEnd, 1);
  }

  return periods;
}

/**
 * 3% of the base rental, as integer basis points. Delegates to applyBasisPoints so there
 * is one rounding rule in the codebase rather than two that agree until they do not.
 */
export function computeSurcharge(base: Centavos, bps: number): Centavos {
  return applyBasisPoints(base, bps);
}

/**
 * The date a charge becomes delinquent: one calendar month after it fell due.
 *
 * Calendar arithmetic, not 30 days. A 31 January charge becomes delinquent on 28
 * February, matching Postgres's `+ interval '1 month'` and the office's own reckoning.
 */
export function surchargeDueFrom(dueDate: string): string {
  const d = parse(dueDate);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
  const lastDay = endOfMonth(target).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return fmt(target);
}
```

- [ ] **Step 4: Export from the package index**

Modify `packages/shared/src/index.ts` — add `export * from "./charges";` alongside the existing exports, keeping alphabetical order.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ceedo/shared test charges`
Expected: PASS, 17 tests.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/charges.ts packages/shared/src/charges.test.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): charge period generation and surcharge rules

Dates are anchored at UTC noon rather than midnight: a midnight Date shifts
to the previous calendar day in any negative-offset timezone, so slicing an
ISO string would silently return yesterday.

No month-length clamping for monthly due dates -- leases.due_day is
constrained to 1..28, so the clamping path is unreachable."
```

---

### Task 4: `record_opening_balance()`

Pre-cutover arrears enter the ledger as one charge per lease. This is the only way a charge dated before the cutover can exist, and it is admin-only.

**Files:**
- Create: `supabase/migrations/20260918000013_opening_balances.sql`
- Create: `tests/db/opening-balance.test.ts`

**Interfaces:**
- Consumes: `charges` (Task 1), `cutover_date()` (Task 2), `is_admin()` (Phase 1)
- Produces: `ceedo_collections.record_opening_balance(p_lease_id uuid, p_amount numeric, p_oldest_unpaid_date date, p_authority_ref text) returns uuid`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000013_opening_balances.sql`:

```sql
-- Records reconciled paper arrears as a single charge per lease.
--
-- SECURITY DEFINER because no client role holds INSERT on charges (migration 0011). The
-- function is the only way in, and it validates before it writes.
create or replace function ceedo_collections.record_opening_balance(
  p_lease_id            uuid,
  p_amount              numeric,
  p_oldest_unpaid_date  date,
  p_authority_ref       text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_cutover     date;
  v_fee_type_id uuid;
  v_lease       ceedo_collections.leases%rowtype;
  v_charge_id   uuid;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may record an opening balance'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Opening balance must be a positive amount';
  end if;

  if p_authority_ref is null or length(trim(p_authority_ref)) = 0 then
    raise exception 'Opening balance needs an authority reference naming the reconciled paper record';
  end if;

  v_cutover := ceedo_collections.cutover_date();

  select * into v_lease from ceedo_collections.leases where id = p_lease_id;
  if not found then
    raise exception 'No such lease: %', p_lease_id;
  end if;

  -- The whole point of the opening balance is that it predates the cutover. One dated on
  -- or after it would overlap the periods run_accrual() is about to raise, and the tenant
  -- would be billed twice for the same days.
  if p_oldest_unpaid_date >= v_cutover then
    raise exception
      'Opening balance oldest-unpaid date (%) must precede the cutover date (%). Periods from the cutover onward are raised by the accrual job.',
      p_oldest_unpaid_date, v_cutover;
  end if;

  -- Market rental. Opening balances exist only for accruing streams: parking, terminal
  -- and slaughterhouse are cash-only and carry no receivable to bring forward.
  select id into v_fee_type_id
  from ceedo_collections.fee_types
  where code = 'market_rental' and accrues;

  if v_fee_type_id is null then
    raise exception 'No accruing fee type with code market_rental; seed it before recording opening balances';
  end if;

  insert into ceedo_collections.charges (
    lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
    amount, surcharge_bps, source, created_by
  )
  values (
    p_lease_id, v_fee_type_id, 'opening_balance',
    p_oldest_unpaid_date,
    v_cutover - 1,
    -- due_date is the REAL oldest unpaid date, not the cutover. This is what makes aging
    -- honest: two-year-old debt buckets as two years old, and FIFO sorts it first.
    p_oldest_unpaid_date,
    p_amount, 0, 'opening_balance', auth.uid()
  )
  returning id into v_charge_id;

  return v_charge_id;
exception
  when unique_violation then
    raise exception 'Lease % already has an opening balance', p_lease_id
      using errcode = 'unique_violation';
end;
$$;

revoke execute on function ceedo_collections.record_opening_balance(uuid, numeric, date, text) from public;
grant execute on function ceedo_collections.record_opening_balance(uuid, numeric, date, text)
  to authenticated;
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/opening-balance.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createLeaseFixture, signIn,
} from "../helpers/supabase";

let db: Client;
let leaseId: string;
let adminClient: Awaited<ReturnType<typeof signIn>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  ({ leaseId } = await createLeaseFixture(db));
  adminClient = await signIn(await createAppUser("admin"));
});

afterAll(async () => { await db.end(); });

describe("record_opening_balance", () => {
  it("creates one charge dated to the real oldest unpaid day", async () => {
    const { data, error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: leaseId,
      p_amount: 12500.0,
      p_oldest_unpaid_date: "2024-03-01",
      p_authority_ref: "Reconciled paper ledger, 2026-09-30, T. Cruz",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      "select * from ceedo_collections.charges where id = $1",
      [data],
    );
    expect(rows[0].charge_type).toBe("opening_balance");
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect(rows[0].period_end.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(rows[0].surcharge_bps).toBe(0);
  });

  it("refuses a second opening balance for the same lease", async () => {
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: leaseId,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-05-01",
      p_authority_ref: "duplicate attempt",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already has an opening balance/);
  });

  it("refuses a date on or after the cutover", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2026-10-01",
      p_authority_ref: "too late",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/must precede the cutover date/);
  });

  it("refuses an empty authority reference", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/authority reference/);
  });

  it("refuses a non-admin", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const accounting = await signIn(await createAppUser("accounting"));
    const { error } = await accounting.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 500.0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);
  });

  it("refuses a non-positive amount", async () => {
    const { leaseId: other } = await createLeaseFixture(db);
    const { error } = await adminClient.rpc("record_opening_balance", {
      p_lease_id: other,
      p_amount: 0,
      p_oldest_unpaid_date: "2024-01-01",
      p_authority_ref: "zero",
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter tests test opening-balance`
Expected: FAIL — function does not exist.

- [ ] **Step 4: Apply the migration and re-run**

Run: `supabase db reset && pnpm --filter tests test opening-balance`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add `market_rental` to the seed if absent**

Check `supabase/seed.sql` for a `fee_types` row with `code = 'market_rental'` and `accrues = true`. Add it if missing — Task 5 needs it too.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918000013_opening_balances.sql \
        tests/db/opening-balance.test.ts supabase/seed.sql
git commit -m "feat(db): record_opening_balance for pre-cutover arrears

due_date is the real oldest unpaid date from the paper record, not the
cutover: that is what makes aging bucket two-year-old debt as two years old
rather than as current, and what sorts it first in FIFO.

Refuses a date on or after the cutover, which would overlap the periods the
accrual job raises and bill the tenant twice."
```

---

### Task 5: `run_accrual()`

The nightly job. Idempotent by index, not by checking.

**Files:**
- Create: `supabase/migrations/20260918000014_accrual.sql`
- Create: `tests/db/accrual.test.ts`

**Interfaces:**
- Consumes: `charges`, `accrual_runs`, `cutover_date()`, `leases`, `fee_types`
- Produces: `ceedo_collections.run_accrual(p_business_date date default null) returns uuid` (the `accrual_runs.id`), `ceedo_collections.business_date() returns date`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000014_accrual.sql`:

```sql
-- The business date, in Manila, always.
--
-- The server runs in UTC. For eight hours of every day the UTC date and the Manila date
-- differ, and a job scheduled at 18:00 UTC runs on the NEXT UTC day. Deriving the
-- business date from current_date would then skip a day's charges roughly a third of the
-- time, and the symptom -- randomly missing charges -- looks nothing like a timezone bug.
create or replace function ceedo_collections.business_date()
returns date
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

revoke execute on function ceedo_collections.business_date() from public;
grant execute on function ceedo_collections.business_date() to authenticated, service_role;

-- Walks active leases and raises rental charges for every elapsed period from the cutover
-- date through p_business_date.
--
-- IDEMPOTENT BY INDEX. This function does not ask whether a period has already been
-- charged; it inserts every period it computes and lets charges_one_rental_per_period
-- refuse the duplicates. That is deliberate: a check-then-insert has a race between the
-- check and the insert, and this job will be re-run concurrently with a manual catch-up
-- after an outage. The index cannot race with itself.
create or replace function ceedo_collections.run_accrual(p_business_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_run_id   uuid;
  v_date     date;
  v_cutover  date;
  v_fee_type uuid;
  v_raised   integer := 0;
  v_lease    record;
  v_period   record;
begin
  v_date := coalesce(p_business_date, ceedo_collections.business_date());

  insert into ceedo_collections.accrual_runs (business_date, status)
  values (v_date, 'running')
  returning id into v_run_id;

  begin
    v_cutover := ceedo_collections.cutover_date();

    select id into v_fee_type
    from ceedo_collections.fee_types
    where code = 'market_rental' and accrues;

    if v_fee_type is null then
      raise exception 'No accruing fee type with code market_rental';
    end if;

    for v_lease in
      select l.id, l.start_date, l.end_date, l.accrual_period, l.due_day, l.rate_amount
      from ceedo_collections.leases l
      where l.status = 'active'
        and l.rate_amount > 0
        and (l.end_date is null or l.end_date >= v_cutover)
        and l.start_date <= v_date
    loop
      for v_period in
        select * from ceedo_collections.lease_periods(
          v_lease.accrual_period, v_lease.start_date, v_lease.end_date,
          v_cutover, v_date, v_lease.due_day)
      loop
        insert into ceedo_collections.charges (
          lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source
        )
        values (
          v_lease.id, v_fee_type, 'rental',
          v_period.period_start, v_period.period_end, v_period.due_date,
          v_lease.rate_amount, 0, 'accrual'
        )
        on conflict do nothing;

        if found then
          v_raised := v_raised + 1;
        end if;
      end loop;
    end loop;

    update ceedo_collections.accrual_runs
       set finished_at = now(), status = 'succeeded', charges_raised = v_raised
     where id = v_run_id;

    return v_run_id;
  exception
    when others then
      -- Catch, log, RETURN. Do not re-raise.
      --
      -- This is the one place the obvious code is wrong. Re-raising propagates out of the
      -- function, and because the whole call is a single transaction, the rollback takes
      -- the accrual_runs row with it -- including the failure this handler just recorded.
      -- A failed night would then leave no row at all, which reads identically to a night
      -- that was never scheduled.
      --
      -- Returning normally commits the 'failed' row, so the failure is durable and
      -- visible. The raise warning puts it in the Postgres log as well, for whoever is
      -- tailing it. Task 14's monitoring query treats both a 'failed' row and a MISSING
      -- row for a business date as an alert, which is what makes this safe.
      update ceedo_collections.accrual_runs
         set finished_at = now(), status = 'failed', error = sqlerrm, charges_raised = v_raised
       where id = v_run_id;
      raise warning 'run_accrual failed for %: %', v_date, sqlerrm;
      return v_run_id;
  end;
end;
$$;

revoke execute on function ceedo_collections.run_accrual(date) from public;
grant execute on function ceedo_collections.run_accrual(date) to service_role;
```

- [ ] **Step 2: Write the period generator in SQL**

Add to the same migration, **above** `run_accrual` (it is called by it). This is the SQL twin of `generatePeriods` from Task 3; Task 15 asserts they agree.

```sql
-- The SQL twin of packages/shared generatePeriods(). Task 15's parity test runs both
-- against the same fixtures and fails if they ever disagree.
--
-- Only FULLY ELAPSED periods are returned: a week that has not finished is not yet owed.
create or replace function ceedo_collections.lease_periods(
  p_accrual_period ceedo_collections.accrual_period,
  p_lease_start    date,
  p_lease_end      date,
  p_cutover        date,
  p_through        date,
  p_due_day        smallint
)
returns table (period_start date, period_end date, due_date date)
language plpgsql
immutable
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_start  date := greatest(p_lease_start, p_cutover);
  v_cursor date;
  v_end    date;
  v_due    date;
begin
  if p_accrual_period = 'monthly' and p_due_day is null then
    raise exception 'A monthly lease needs a due day';
  end if;

  v_cursor := case p_accrual_period
                when 'monthly' then date_trunc('month', v_start)::date
                else v_start
              end;

  while v_cursor <= p_through loop
    if p_accrual_period = 'daily' then
      v_end := v_cursor;
      v_due := v_cursor;
    elsif p_accrual_period = 'weekly' then
      v_end := v_cursor + 6;
      v_due := v_end;
    else
      v_end := (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date;
      -- No clamping: leases.due_day is constrained to 1..28, so this date always exists.
      v_due := date_trunc('month', v_cursor)::date + (p_due_day - 1);
    end if;

    exit when v_end > p_through;
    exit when p_lease_end is not null and v_end > p_lease_end;

    period_start := v_cursor;
    period_end   := v_end;
    due_date     := v_due;
    return next;

    v_cursor := case p_accrual_period
                  when 'monthly' then (date_trunc('month', v_cursor) + interval '1 month')::date
                  else v_end + 1
                end;
  end loop;
end;
$$;

revoke execute on function ceedo_collections.lease_periods(
  ceedo_collections.accrual_period, date, date, date, date, smallint) from public;
grant execute on function ceedo_collections.lease_periods(
  ceedo_collections.accrual_period, date, date, date, date, smallint) to service_role;
```

- [ ] **Step 3: Write the failing test**

Create `tests/db/accrual.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture } from "../helpers/supabase";

let db: Client;

async function countCharges(leaseId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from ceedo_collections.charges where lease_id = $1 and charge_type = 'rental'",
    [leaseId],
  );
  return rows[0].n;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
});

afterAll(async () => { await db.end(); });

describe("run_accrual", () => {
  it("raises one charge per elapsed day for a daily lease", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(5);
  });

  it("is idempotent — three runs raise the same charges once", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(5);
  });

  it("catches up after an outage without doubling", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    await db.query("select ceedo_collections.run_accrual('2026-10-07')");
    expect(await countCharges(leaseId)).toBe(7);
  });

  it("raises nothing before the cutover date", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2024-01-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    expect(await countCharges(leaseId)).toBe(3);

    const { rows } = await db.query(
      "select min(period_start) as first from ceedo_collections.charges where lease_id = $1",
      [leaseId],
    );
    expect(rows[0].first.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("raises whole months for a monthly lease, due on its due day", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2026-10-01", dueDay: 5, rateAmount: "1500.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-12-15')");
    const { rows } = await db.query(
      `select period_start, period_end, due_date from ceedo_collections.charges
        where lease_id = $1 order by period_start`,
      [leaseId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(rows[1].period_end.toISOString().slice(0, 10)).toBe("2026-11-30");
  });

  it("does not raise a period that has not fully elapsed", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "weekly", startDate: "2026-10-01", rateAmount: "300.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-10')");
    expect(await countCharges(leaseId)).toBe(1);
  });

  it("stops at the lease end date", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", endDate: "2026-10-03",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-10')");
    expect(await countCharges(leaseId)).toBe(3);
  });

  it("ignores leases that are not active", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", status: "terminated",
      rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    expect(await countCharges(leaseId)).toBe(0);
  });

  it("logs a succeeded run with the row count", async () => {
    await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    const { rows } = await db.query(
      "select ceedo_collections.run_accrual('2026-10-04') as id",
    );
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("succeeded");
    expect(run[0].charges_raised).toBeGreaterThan(0);
    expect(run[0].finished_at).not.toBeNull();
  });

  it("records a failed run durably instead of rolling it back", async () => {
    // The failure must survive the transaction. Re-raising would roll back the very row
    // that records it, leaving a failed night indistinguishable from an unscheduled one.
    await db.query("delete from ceedo_collections.settings");
    const { rows } = await db.query(
      "select ceedo_collections.run_accrual('2026-10-04') as id",
    );
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("failed");
    expect(run[0].error).toMatch(/cutover/);
    expect(run[0].finished_at).not.toBeNull();
  });

  it("raises no charges when it fails", async () => {
    await db.query("delete from ceedo_collections.settings");
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-04')");
    expect(await countCharges(leaseId)).toBe(0);
  });
});
```

`createLeaseFixture` needs an options argument. Extend the helper written in Task 1 to accept `{ accrualPeriod, startDate, endDate, dueDay, rateAmount, status }`, all optional with sensible defaults.

- [ ] **Step 4: Run to verify it fails, apply, re-run**

Run: `pnpm --filter tests test accrual` → FAIL (function missing)
Run: `supabase db reset && pnpm --filter tests test accrual` → PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000014_accrual.sql tests/db/accrual.test.ts \
        tests/helpers/supabase.ts
git commit -m "feat(db): nightly accrual, idempotent by index

run_accrual does not check whether a period was already charged -- it
inserts and lets charges_one_rental_per_period refuse duplicates. A
check-then-insert races with the manual catch-up run that follows an
outage, which is exactly when both run at once.

business_date() reads Asia/Manila, never current_date: at 18:00 UTC the
server is already on the next UTC day, and deriving from current_date would
skip a day's charges a third of the time.

A failed run logs and returns rather than re-raising. The call is one
transaction, so propagating the error would roll back the accrual_runs row
recording it, and a failed night would look exactly like an unscheduled
one."
```

---

### Task 6: The `collections` tables

Four tables that record money received. None of them is written by any client role; Task 11 supplies the only way in. This task creates the shapes and proves the privilege guarantee holds for all of them.

**Files:**
- Create: `supabase/migrations/20260918000017_ledger_collections.sql`
- Create: `tests/db/collections.test.ts`
- Modify: `tests/db/ledger-privileges.test.ts` — extend `LEDGER_TABLES`

**Interfaces:**
- Consumes: `apply_ledger_policies()` (Task 1), `booklets`, `app_users`, `devices`, `fee_types`, `leases` (Phase 1)
- Produces: tables `collections`, `collection_allocations`, `collection_lines`, `collection_cancellations`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000017_ledger_collections.sql`:

```sql
create table ceedo_collections.collections (
  -- NO DEFAULT. The UUID is generated by the client, and that is what makes posting
  -- idempotent (invariant #2): a retry after a dropped connection carries the same id and
  -- is recognised as a duplicate. A server-side default would mint a fresh id on every
  -- retry and issue a second receipt for one payment.
  id            uuid primary key,
  or_no         integer not null check (or_no > 0),
  booklet_id    uuid not null references ceedo_collections.booklets (id),
  collector_id  uuid not null references ceedo_collections.app_users (id),
  -- NOT NULL: every collection is recorded on a tablet. There is no office payment path
  -- (design D7), so a collection with no device is not a case to allow for, it is a bug.
  device_id     uuid not null references ceedo_collections.devices (id),
  collected_at  timestamptz not null,
  business_date date not null,
  fee_type_id   uuid not null references ceedo_collections.fee_types (id),
  -- Null for cash-only streams: parking, terminal and slaughterhouse receipts belong to
  -- no lease and settle no charge.
  lease_id      uuid references ceedo_collections.leases (id),
  payer_ref     text,
  gross_amount  numeric(14,2) not null check (gross_amount > 0),
  notes         text,
  synced_at     timestamptz,
  posted_at     timestamptz not null default now(),
  posted_by     uuid references ceedo_collections.app_users (id),
  row_version   bigint not null default 0,

  -- A serial is spent exactly once across the entire system (invariant #17). This is the
  -- ONLY mechanism that catches the same OR number recorded on two different devices --
  -- a case §6.3 of the parent spec notes a device physically cannot detect, because
  -- neither tablet can see the other's outbox.
  constraint collections_serial_spent_once unique (booklet_id, or_no)
);

create index collections_lease_idx on ceedo_collections.collections (lease_id);
create index collections_collector_date_idx
  on ceedo_collections.collections (collector_id, business_date);
create index collections_row_version_idx on ceedo_collections.collections (row_version);

create table ceedo_collections.collection_allocations (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references ceedo_collections.collections (id),
  charge_id     uuid not null references ceedo_collections.charges (id),
  amount        numeric(14,2) not null check (amount > 0),
  row_version   bigint not null default 0,
  unique (collection_id, charge_id)
);

create index collection_allocations_charge_idx
  on ceedo_collections.collection_allocations (charge_id);

create table ceedo_collections.collection_lines (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references ceedo_collections.collections (id),
  fee_type_id   uuid not null references ceedo_collections.fee_types (id),
  rate_class    text not null default '',
  quantity      integer not null check (quantity > 0),
  unit_rate     numeric(14,2) not null check (unit_rate >= 0),
  -- Generated, not stored independently. Quantity times rate cannot be recorded
  -- inconsistently with quantity and rate, because it is not recorded at all.
  amount        numeric(14,2) generated always as (quantity * unit_rate) stored,
  row_version   bigint not null default 0
);

create index collection_lines_collection_idx
  on ceedo_collections.collection_lines (collection_id);

create table ceedo_collections.collection_cancellations (
  id            uuid primary key default gen_random_uuid(),
  -- Unique: a receipt is cancelled once. A second cancellation is not a correction, it is
  -- a sign that something is being retried that should not be.
  collection_id uuid not null unique references ceedo_collections.collections (id),
  reason        text not null check (length(trim(reason)) > 0),
  cancelled_by  uuid not null references ceedo_collections.app_users (id),
  cancelled_at  timestamptz not null default now(),
  row_version   bigint not null default 0
);

select ceedo_collections.apply_ledger_policies('collections');
select ceedo_collections.apply_ledger_policies('collection_allocations');
select ceedo_collections.apply_ledger_policies('collection_lines');
select ceedo_collections.apply_ledger_policies('collection_cancellations');

-- Voiding a receipt is a decision someone makes, unlike the receipt itself which is
-- already immutable and actor-stamped. §11.4 wants the decision on the record.
select ceedo_collections.attach_audit('collection_cancellations');

-- Invariant #9: a collection's allocations and lines together sum to its gross_amount.
--
-- A DEFERRED constraint trigger, checked at commit rather than per statement. The parts
-- are inserted after the parent row inside one transaction, so a per-statement check
-- would fire against a collection that legitimately has no allocations yet and refuse
-- every valid post.
create or replace function ceedo_collections.assert_collection_balances()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_gross numeric(14,2);
  v_parts numeric(14,2);
begin
  select gross_amount into v_gross
  from ceedo_collections.collections where id = new.id;

  -- The row may have been removed by a rollback between the insert and this check.
  if not found then
    return null;
  end if;

  select coalesce((select sum(amount) from ceedo_collections.collection_allocations
                    where collection_id = new.id), 0)
       + coalesce((select sum(amount) from ceedo_collections.collection_lines
                    where collection_id = new.id), 0)
    into v_parts;

  if v_parts <> v_gross then
    raise exception
      'Collection % does not balance: allocations plus lines total %, gross_amount is %',
      new.id, v_parts, v_gross
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger collections_balance
  after insert on ceedo_collections.collections
  deferrable initially deferred
  for each row execute function ceedo_collections.assert_collection_balances();
```

- [ ] **Step 2: Extend the privilege test**

Modify `tests/db/ledger-privileges.test.ts` — change the `LEDGER_TABLES` array to:

```ts
const LEDGER_TABLES = [
  "charges",
  "collections",
  "collection_allocations",
  "collection_lines",
  "collection_cancellations",
] as const;
```

The array is the checklist. A ledger table missing from it is a table whose guarantee nobody proved.

- [ ] **Step 3: Write the constraint test**

Create `tests/db/collections.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture, createCollectionFixture } from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

/** Inserts a collection and its parts in one transaction, as the table owner. */
async function postRaw(opts: {
  id?: string; orNo: number; gross: string;
  allocations?: { chargeId: string; amount: string }[];
  lines?: { quantity: number; unitRate: string }[];
}) {
  const id = opts.id ?? randomUUID();
  await db.query("begin");
  try {
    await db.query(
      `insert into ceedo_collections.collections
         (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
          fee_type_id, lease_id, gross_amount)
       values ($1, $2, $3, $4, $5, now(), current_date, $6, $7, $8)`,
      [id, opts.orNo, fx.bookletId, fx.collectorId, fx.deviceId, fx.feeTypeId,
       fx.leaseId, opts.gross],
    );
    for (const a of opts.allocations ?? []) {
      await db.query(
        `insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
         values ($1, $2, $3)`,
        [id, a.chargeId, a.amount],
      );
    }
    for (const l of opts.lines ?? []) {
      await db.query(
        `insert into ceedo_collections.collection_lines
           (collection_id, fee_type_id, quantity, unit_rate)
         values ($1, $2, $3, $4)`,
        [id, fx.feeTypeId, l.quantity, l.unitRate],
      );
    }
    await db.query("commit");
    return id;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createCollectionFixture(db);
});

afterAll(async () => { await db.end(); });

describe("collections constraints", () => {
  it("refuses the same serial twice in the same booklet", async () => {
    await postRaw({ orNo: 1001, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] });
    await expect(
      postRaw({ orNo: 1001, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/collections_serial_spent_once/);
  });

  it("refuses a duplicate client-generated id", async () => {
    const id = randomUUID();
    await postRaw({ id, orNo: 1002, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] });
    await expect(
      postRaw({ id, orNo: 1003, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/collections_pkey/);
  });

  it("computes a line's amount from quantity and rate", async () => {
    const id = await postRaw({
      orNo: 1004, gross: "150.00", lines: [{ quantity: 3, unitRate: "50.00" }],
    });
    const { rows } = await db.query(
      "select amount from ceedo_collections.collection_lines where collection_id = $1", [id],
    );
    expect(Number(rows[0].amount)).toBe(150);
  });

  it("refuses a collection whose parts do not sum to gross_amount", async () => {
    await expect(
      postRaw({ orNo: 1005, gross: "100.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/does not balance/);
  });

  it("refuses a collection with no parts at all", async () => {
    await expect(postRaw({ orNo: 1006, gross: "100.00" })).rejects.toThrow(/does not balance/);
  });

  it("accepts a collection balanced by allocations", async () => {
    await db.query("select ceedo_collections.run_accrual(current_date)");
    const { rows } = await db.query(
      `select id from ceedo_collections.charges where lease_id = $1 limit 1`, [fx.leaseId],
    );
    const id = await postRaw({
      orNo: 1007, gross: "50.00",
      allocations: [{ chargeId: rows[0].id, amount: "50.00" }],
    });
    expect(id).toBeTruthy();
  });

  it("refuses a second cancellation of the same collection", async () => {
    const id = await postRaw({
      orNo: 1008, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }],
    });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
       values ($1, 'first', $2)`, [id, fx.collectorId],
    );
    await expect(
      db.query(
        `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
         values ($1, 'second', $2)`, [id, fx.collectorId],
      ),
    ).rejects.toThrow(/collection_cancellations_collection_id_key/);
  });

  it("refuses a cancellation with a blank reason", async () => {
    const id = await postRaw({
      orNo: 1009, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }],
    });
    await expect(
      db.query(
        `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
         values ($1, '   ', $2)`, [id, fx.collectorId],
      ),
    ).rejects.toThrow(/reason/);
  });
});
```

Add `createCollectionFixture(db)` to `tests/helpers/supabase.ts`. It extends `createLeaseFixture` with a collector `app_users` row, a `devices` row, a `booklets` row with a serial range covering 1000–1999, and a `booklet_assignments` row linking booklet to collector with `assigned_at` in the past and `returned_at` null. Return `{ leaseId, feeTypeId, collectorId, deviceId, bookletId, stallId, tenantId }`.

- [ ] **Step 4: Run to verify it fails, apply, re-run**

Run: `pnpm --filter tests test collections` → FAIL
Run: `supabase db reset && pnpm --filter tests test collections` → PASS, 8 tests
Run: `pnpm --filter tests test ledger-privileges` → PASS, 35 tests (5 tables × 7)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000017_ledger_collections.sql \
        tests/db/collections.test.ts tests/db/ledger-privileges.test.ts \
        tests/helpers/supabase.ts
git commit -m "feat(db): collections, allocations, lines and cancellations

collections.id has no default: the client generates it, and that is what
makes a retry after a dropped connection a duplicate rather than a second
receipt.

unique (booklet_id, or_no) is the only thing in the system that catches the
same serial recorded on two different devices -- neither tablet can see the
other's outbox.

Invariant #9 is a deferred constraint trigger, checked at commit, because
the parts are inserted after the parent inside one transaction."
```

---

### Task 7: The `charge_condonations` table

The table only. `condone_charge()` needs `charge_balances` to check what is outstanding, and `charge_balances` needs this table to subtract from — so the table lands first, the view second (Task 8), the function third (Task 9). Splitting the dependency this way is what keeps each migration applicable in order.

**Files:**
- Create: `supabase/migrations/20260918000018_charge_condonations.sql`
- Modify: `tests/db/ledger-privileges.test.ts` — add `charge_condonations` to `LEDGER_TABLES`

**Interfaces:**
- Consumes: `charges` (Task 1), `apply_ledger_policies()`, `attach_audit()`
- Produces: table `ceedo_collections.charge_condonations`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000018_charge_condonations.sql`:

```sql
create table ceedo_collections.charge_condonations (
  id            uuid primary key default gen_random_uuid(),
  charge_id     uuid not null references ceedo_collections.charges (id),
  amount        numeric(14,2) not null check (amount > 0),
  -- The ordinance. A write-off with no authority behind it is a missing record rather
  -- than a decision, so this is not nullable and not blankable.
  authority_ref text not null check (length(trim(authority_ref)) > 0),
  reason        text not null check (length(trim(reason)) > 0),
  condoned_by   uuid not null references ceedo_collections.app_users (id),
  condoned_at   timestamptz not null default now(),
  row_version   bigint not null default 0
);

create index charge_condonations_charge_idx
  on ceedo_collections.charge_condonations (charge_id);

select ceedo_collections.apply_ledger_policies('charge_condonations');

-- §11.4 names condoning a charge explicitly. Unlike the ledger proper -- already
-- immutable and actor-stamped -- this is a discretionary act, and who authorised it is
-- the question asked afterwards.
select ceedo_collections.attach_audit('charge_condonations');
```

- [ ] **Step 2: Add it to the privilege checklist**

Modify `tests/db/ledger-privileges.test.ts` — append `"charge_condonations"` to `LEDGER_TABLES`.

- [ ] **Step 3: Apply and run**

Run: `supabase db reset && pnpm --filter tests test ledger-privileges`
Expected: PASS, 42 tests (6 tables × 7).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000018_charge_condonations.sql \
        tests/db/ledger-privileges.test.ts
git commit -m "feat(db): charge_condonations table

Append-only like the rest of the ledger, but audited, because writing off a
debt is a decision someone makes rather than a fact the system records."
```

---

### Task 8: `charge_balances` and `unpaid_period_groups()`

The view that decides what is owed. FIFO, aging, delinquency, the subsidiary ledger and Phase 3's sync pull all read it, which is precisely why they cannot disagree with each other.

**Files:**
- Create: `supabase/migrations/20260918000019_charge_balances.sql`
- Create: `tests/db/charge-balances.test.ts`

**Interfaces:**
- Consumes: `charges`, `collection_allocations`, `collections`, `collection_cancellations` (Task 6), `charge_condonations` (Task 7), `business_date()` (Task 5)
- Produces: view `ceedo_collections.charge_balances`; function `ceedo_collections.unpaid_period_groups(p_lease_id uuid)` returning `(group_rank integer, due_date date, period_start date, period_end date, charge_ids uuid[], outstanding numeric(14,2))`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000019_charge_balances.sql`:

```sql
-- What is actually owed on each charge.
--
-- There is no status column on charges, by design: a charge is a fact, and whether it is
-- settled is a conclusion drawn from the rows pointing at it. This view is that
-- conclusion, and it is the ONLY place the conclusion is drawn.
--
-- security_invoker = true so RLS on the underlying tables applies to whoever queries the
-- view, not to its owner. Without it this view is a hole straight through the app_users
-- membership gate -- and auth.users is shared with unrelated systems on this project.
create view ceedo_collections.charge_balances
with (security_invoker = true)
as
select
  c.id,
  c.lease_id,
  c.fee_type_id,
  c.charge_type,
  c.parent_charge_id,
  c.period_start,
  c.period_end,
  c.due_date,
  c.amount,
  c.surcharge_bps,
  c.created_at,
  coalesce(alloc.allocated, 0)::numeric(14,2) as allocated,
  coalesce(cond.condoned, 0)::numeric(14,2)  as condoned,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0))::numeric(14,2)
    as outstanding,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0)) <= 0
    as is_settled,
  greatest(0, (ceedo_collections.business_date() - c.due_date))::integer as days_overdue
from ceedo_collections.charges c
left join lateral (
  select sum(a.amount) as allocated
  from ceedo_collections.collection_allocations a
  join ceedo_collections.collections col on col.id = a.collection_id
  where a.charge_id = c.id
    -- A cancelled collection's allocations stop counting. Omitting this is the easiest
    -- mistake in the phase to make and the hardest to notice: the ledger would report
    -- voided money as received, and every downstream report would agree with it.
    and not exists (
      select 1 from ceedo_collections.collection_cancellations x
      where x.collection_id = col.id
    )
) alloc on true
left join lateral (
  select sum(k.amount) as condoned
  from ceedo_collections.charge_condonations k
  where k.charge_id = c.id
) cond on true;

grant select on ceedo_collections.charge_balances to authenticated;

comment on view ceedo_collections.charge_balances is
  'The single definition of what is owed. Aging, delinquency, the subsidiary ledger and '
  'FIFO all read this view so they cannot drift apart.';

-- The FIFO-ordered groups of what a lease still owes. A group is one period's rental
-- charge together with its surcharge, or a standalone opening balance.
--
-- Ordering is (due_date, period_start) ascending. An opening balance carries the real
-- oldest-unpaid date from the paper record, which places it before every accrued period
-- with no special case. Ordering by created_at would put it LAST, and a tenant would
-- settle this month's rent while two years of arrears sat untouched.
create or replace function ceedo_collections.unpaid_period_groups(p_lease_id uuid)
returns table (
  group_rank   integer,
  due_date     date,
  period_start date,
  period_end   date,
  charge_ids   uuid[],
  outstanding  numeric(14,2)
)
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  with groups as (
    select
      b.due_date      as g_due,
      b.period_start  as g_start,
      b.period_end    as g_end,
      array_agg(b.id order by b.charge_type) as ids,
      sum(b.outstanding)::numeric(14,2)      as amt
    from ceedo_collections.charge_balances b
    where b.lease_id = p_lease_id
      and not b.is_settled
    group by b.due_date, b.period_start, b.period_end
  )
  select
    (row_number() over (order by g_due, g_start))::integer,
    g_due, g_start, g_end, ids, amt
  from groups
  order by g_due, g_start;
$$;

revoke execute on function ceedo_collections.unpaid_period_groups(uuid) from public;
grant execute on function ceedo_collections.unpaid_period_groups(uuid)
  to authenticated, service_role;
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/charge-balances.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture } from "../helpers/supabase";

let db: Client;

/**
 * Inserts a collection settling one charge, as the table owner.
 *
 * No client role holds INSERT on the ledger (migration 0011), and post_collection does
 * not exist until Task 12, so balance behaviour is exercised through the owner connection
 * here. Task 12 replaces these with real engine calls.
 */
async function settle(fx: any, chargeId: string, amount: string, orNo: number) {
  const id = randomUUID();
  await db.query("begin");
  await db.query(
    `insert into ceedo_collections.collections
       (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
        fee_type_id, lease_id, gross_amount)
     values ($1, $2, $3, $4, $5, now(), current_date, $6, $7, $8)`,
    [id, orNo, fx.bookletId, fx.collectorId, fx.deviceId, fx.feeTypeId, fx.leaseId, amount],
  );
  await db.query(
    `insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
     values ($1, $2, $3)`,
    [id, chargeId, amount],
  );
  await db.query("commit");
  return id;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
});

afterAll(async () => { await db.end(); });

describe("charge_balances", () => {
  it("reports the full amount outstanding on an untouched charge", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where lease_id = $1", [fx.leaseId],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("marks a charge settled once allocations cover it", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1", [fx.leaseId],
    );
    await settle(fx, ch[0].id, "50.00", 2001);

    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where id = $1", [ch[0].id],
    );
    expect(rows[0].is_settled).toBe(true);
    expect(Number(rows[0].outstanding)).toBe(0);
  });

  it("stops counting a cancelled collection's allocations", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1", [fx.leaseId],
    );
    const collectionId = await settle(fx, ch[0].id, "50.00", 2002);

    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by) values ($1, 'wrong tenant', $2)`,
      [collectionId, fx.collectorId],
    );

    const { rows } = await db.query(
      "select * from ceedo_collections.charge_balances where id = $1", [ch[0].id],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("subtracts a condonation", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1", [fx.leaseId],
    );
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by)
       values ($1, 30.00, 'Ordinance 2026-114', 'amnesty', $2)`,
      [ch[0].id, fx.collectorId],
    );
    const { rows } = await db.query(
      "select outstanding from ceedo_collections.charge_balances where id = $1", [ch[0].id],
    );
    expect(Number(rows[0].outstanding)).toBe(70);
  });

  it("computes days overdue from the Manila business date", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const { rows } = await db.query(
      `select days_overdue,
              (ceedo_collections.business_date() - due_date) as expected
         from ceedo_collections.charge_balances where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows[0].days_overdue).toBe(Math.max(0, rows[0].expected));
  });
});

describe("unpaid_period_groups", () => {
  it("returns groups oldest first", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const { rows } = await db.query(
      "select * from ceedo_collections.unpaid_period_groups($1)", [fx.leaseId],
    );
    expect(rows.map((r: any) => r.due_date.toISOString().slice(0, 10))).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
    expect(rows[0].group_rank).toBe(1);
  });

  it("puts an opening balance ahead of every accrued period", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source)
       select $1, id, 'opening_balance', '2024-03-01', '2026-09-30', '2024-03-01',
              9000.00, 0, 'opening_balance'
         from ceedo_collections.fee_types where code = 'market_rental'`,
      [fx.leaseId],
    );
    const { rows } = await db.query(
      "select * from ceedo_collections.unpaid_period_groups($1)", [fx.leaseId],
    );
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect(Number(rows[0].outstanding)).toBe(9000);
    expect(rows[0].group_rank).toBe(1);
  });

  it("omits settled groups", async () => {
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1 order by due_date",
      [fx.leaseId],
    );
    await settle(fx, ch[0].id, "50.00", 2003);
    const { rows } = await db.query(
      "select * from ceedo_collections.unpaid_period_groups($1)", [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2026-10-02");
  });
});
```

Extend `createCollectionFixture` to accept the same lease options `createLeaseFixture` takes.

- [ ] **Step 3: Run, apply, re-run**

Run: `pnpm --filter tests test charge-balances` → FAIL (view missing)
Run: `supabase db reset && pnpm --filter tests test charge-balances` → PASS, 8 tests

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000019_charge_balances.sql \
        tests/db/charge-balances.test.ts tests/helpers/supabase.ts
git commit -m "feat(db): charge_balances view and FIFO period groups

The only place the system concludes whether a charge is settled, so aging,
delinquency, the subsidiary ledger and FIFO cannot drift apart.
security_invoker keeps RLS applying to the querying staff member rather
than the view owner.

Allocations belonging to a cancelled collection are excluded: omitting that
would report voided money as received and every report would agree.

unpaid_period_groups orders by (due_date, period_start), placing an opening
balance ahead of accrued periods with no special case."
```

---

### Task 9: `condone_charge()`

**Files:**
- Create: `supabase/migrations/20260918000020_condone_charge.sql`
- Create: `tests/db/condonation.test.ts`

**Interfaces:**
- Consumes: `charge_condonations` (Task 7), `charge_balances` (Task 8), `is_admin()`
- Produces: `ceedo_collections.condone_charge(p_charge_id uuid, p_amount numeric, p_authority_ref text, p_reason text) returns uuid`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000020_condone_charge.sql`:

```sql
-- Writes off part or all of a charge against an authorising ordinance (§8.4).
--
-- Admin only. The over-condonation check spans rows and so cannot be a table constraint;
-- it lives here, which is also the only way in, since no client role holds INSERT on
-- charge_condonations.
create or replace function ceedo_collections.condone_charge(
  p_charge_id     uuid,
  p_amount        numeric,
  p_authority_ref text,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_outstanding numeric(14,2);
  v_id          uuid;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may condone a charge'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Condoned amount must be positive';
  end if;

  -- SECURITY DEFINER means charge_balances is read as this function's owner, bypassing
  -- the view's security_invoker RLS. That is intended here: the admin check above is the
  -- gate, and the function must see the true outstanding figure to validate against it.
  select outstanding into v_outstanding
  from ceedo_collections.charge_balances
  where id = p_charge_id;

  if not found then
    raise exception 'No such charge: %', p_charge_id;
  end if;

  -- Condoning more than is owed drives the balance negative and makes the lease look
  -- like it is in credit, which it is not.
  if p_amount > v_outstanding then
    raise exception 'Cannot condone % against a charge with % outstanding',
      p_amount, v_outstanding
      using errcode = 'check_violation';
  end if;

  insert into ceedo_collections.charge_condonations
    (charge_id, amount, authority_ref, reason, condoned_by)
  values (p_charge_id, p_amount, p_authority_ref, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.condone_charge(uuid, numeric, text, text) from public;
grant execute on function ceedo_collections.condone_charge(uuid, numeric, text, text)
  to authenticated;
```

- [ ] **Step 2: Write the test**

Create `tests/db/condonation.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, createLeaseFixture, signIn } from "../helpers/supabase";

let db: Client;
let admin: Awaited<ReturnType<typeof signIn>>;

async function chargeFor(leaseId: string): Promise<string> {
  const { rows } = await db.query(
    "select id from ceedo_collections.charges where lease_id = $1 order by due_date limit 1",
    [leaseId],
  );
  return rows[0].id;
}

async function accruedLease(rate = "100.00") {
  const { leaseId } = await createLeaseFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: rate,
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-01')");
  return { leaseId, chargeId: await chargeFor(leaseId) };
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  admin = await signIn(await createAppUser("admin"));
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
});

afterAll(async () => { await db.end(); });

describe("condone_charge", () => {
  it("reduces the outstanding balance", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 40.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "Fire amnesty",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      "select outstanding, is_settled from ceedo_collections.charge_balances where id = $1",
      [chargeId],
    );
    expect(Number(rows[0].outstanding)).toBe(60);
    expect(rows[0].is_settled).toBe(false);
  });

  it("settles the charge when it condones the whole amount", async () => {
    const { chargeId } = await accruedLease();
    await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 100.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "Full amnesty",
    });
    const { rows } = await db.query(
      "select is_settled from ceedo_collections.charge_balances where id = $1", [chargeId],
    );
    expect(rows[0].is_settled).toBe(true);
  });

  it("refuses to condone more than is outstanding", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 150.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "too much",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Cannot condone/);
  });

  it("refuses a second condonation that would overshoot", async () => {
    const { chargeId } = await accruedLease();
    await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 60.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "partial",
    });
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 60.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "again",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a supervisor", async () => {
    const { chargeId } = await accruedLease();
    const supervisor = await signIn(await createAppUser("supervisor"));
    const { error } = await supervisor.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/);
  });

  it("refuses an accounting user", async () => {
    const { chargeId } = await accruedLease();
    const accounting = await signIn(await createAppUser("accounting"));
    const { error } = await accounting.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-114", p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a blank authority reference", async () => {
    const { chargeId } = await accruedLease();
    const { error } = await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0, p_authority_ref: "  ", p_reason: "no ordinance",
    });
    expect(error).not.toBeNull();
  });

  it("records the condonation in the audit log", async () => {
    const { chargeId } = await accruedLease();
    await admin.rpc("condone_charge", {
      p_charge_id: chargeId, p_amount: 10.0,
      p_authority_ref: "Ordinance 2026-115", p_reason: "audited",
    });
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'charge_condonations' and action = 'insert'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run, apply, re-run**

Run: `supabase db reset && pnpm --filter tests test condonation`
Expected: PASS, 8 tests.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000020_condone_charge.sql tests/db/condonation.test.ts
git commit -m "feat(db): condone_charge, admin only, append-only

A charge is never updated to write it off. The condonation row records the
amount, the ordinance and the administrator, and charge_balances subtracts
it. Over-condonation spans rows, so the check lives in the function -- which
is also the only way in."
```

---

### Task 10: `run_surcharge()`

One 3% surcharge per rental charge that passes a calendar month unpaid. Never compounding, never twice, never on an opening balance, never on something already settled or condoned.

**Files:**
- Create: `supabase/migrations/20260918000021_surcharge.sql`
- Create: `tests/db/surcharge.test.ts`

**Interfaces:**
- Consumes: `charge_balances` (Task 8), `fee_types.surcharge_bps`, `accrual_runs`, `business_date()`
- Produces: `ceedo_collections.run_surcharge(p_business_date date default null, p_run_id uuid default null) returns integer`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000021_surcharge.sql`:

```sql
-- Raises one 3% surcharge against each rental charge that has passed a calendar month
-- past due while still unpaid.
--
-- "Unpaid" means what charge_balances says it means, which includes condonations: a debt
-- written off under an amnesty ordinance must not then grow a penalty.
create or replace function ceedo_collections.run_surcharge(
  p_business_date date default null,
  p_run_id        uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_date   date;
  v_raised integer := 0;
begin
  v_date := coalesce(p_business_date, ceedo_collections.business_date());

  insert into ceedo_collections.charges (
    lease_id, fee_type_id, charge_type, parent_charge_id,
    period_start, period_end, due_date, amount, surcharge_bps, source
  )
  select
    b.lease_id, b.fee_type_id, 'surcharge', b.id,
    -- The surcharge shares its parent's period and due date, so the pair behaves as one
    -- period group in FIFO and buckets together in aging. A penalty is never owed on a
    -- different date than the rent it penalises.
    b.period_start, b.period_end, b.due_date,
    -- Integer basis points on centavos, then back to pesos. A float rate misrounds exact
    -- half-centavo results: 0.03 * 8350 is 250.49999999999997 in IEEE 754 and floors to
    -- 250 where half-up gives 251.
    floor((round(b.amount * 100) * f.surcharge_bps + 5000) / 10000) / 100,
    -- Stamped, not looked up later. A future ordinance changing the rate must not alter a
    -- receipt already issued (invariant #6).
    f.surcharge_bps,
    'accrual'
  from ceedo_collections.charge_balances b
  join ceedo_collections.fee_types f on f.id = b.fee_type_id
  where b.charge_type = 'rental'
    and f.surcharge_bps > 0
    -- Calendar-month arithmetic, not 30 days: a 31 January charge becomes delinquent on
    -- 28 February, which is what the parent spec §8.2 requires and what the office
    -- reckons. Strictly greater than, so the anniversary day itself is not yet late.
    and v_date > (b.due_date + interval '1 month')::date
    and not b.is_settled
    and not exists (
      select 1 from ceedo_collections.charges s
      where s.parent_charge_id = b.id and s.charge_type = 'surcharge'
    )
  on conflict do nothing;

  get diagnostics v_raised = row_count;

  if p_run_id is not null then
    update ceedo_collections.accrual_runs
       set surcharges_raised = surcharges_raised + v_raised
     where id = p_run_id;
  end if;

  return v_raised;
end;
$$;

revoke execute on function ceedo_collections.run_surcharge(date, uuid) from public;
grant execute on function ceedo_collections.run_surcharge(date, uuid) to service_role;
```

The surcharge base is `b.amount`, the charge's full amount, not its outstanding balance. A partly-condoned charge still penalises on what was originally owed; a fully condoned one is `is_settled` and skipped entirely.

- [ ] **Step 2: Write the failing test**

Create `tests/db/surcharge.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture } from "../helpers/supabase";

let db: Client;

async function surchargesFor(leaseId: string) {
  const { rows } = await db.query(
    `select amount, surcharge_bps, due_date, period_start, parent_charge_id
       from ceedo_collections.charges
      where lease_id = $1 and charge_type = 'surcharge' order by due_date`,
    [leaseId],
  );
  return rows;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2027-01-01')");
  await db.query(
    "update ceedo_collections.fee_types set surcharge_bps = 300 where code = 'market_rental'",
  );
});

afterAll(async () => { await db.end(); });

describe("run_surcharge", () => {
  it("computes 3% exactly on the case floats get wrong", async () => {
    // 83.50 at 3% is 2.505, half-up 2.51. A float gives 250.49999999999997 centavos.
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-31", rateAmount: "83.50",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-31')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");

    const rows = await surchargesFor(leaseId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(2.51);
    expect(rows[0].surcharge_bps).toBe(300);
  });

  it("uses calendar months: a 31 January charge is delinquent on 1 March, not before", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-31", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-31')");

    // 31 Jan + 1 month is 28 Feb. On 28 Feb it is exactly a month, not yet past one.
    await db.query("select ceedo_collections.run_surcharge('2027-02-28')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);

    await db.query("select ceedo_collections.run_surcharge('2027-03-01')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("raises at most one surcharge per rental charge however often it runs", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-05", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-06')");
    await db.query("select ceedo_collections.run_surcharge('2027-04-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("never surcharges a surcharge — it does not compound", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-05", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-06-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(1);
  });

  it("never surcharges an opening balance", async () => {
    const { leaseId } = await createLeaseFixture(db);
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source)
       select $1, id, 'opening_balance', '2024-01-01', '2026-12-31', '2024-01-01',
              5000.00, 0, 'opening_balance'
         from ceedo_collections.fee_types where code = 'market_rental'`,
      [leaseId],
    );
    await db.query("select ceedo_collections.run_surcharge('2027-06-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("does not surcharge a charge that was condoned", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-05", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    const { rows: ch } = await db.query(
      "select id from ceedo_collections.charges where lease_id = $1", [leaseId],
    );
    const { rows: u } = await db.query(
      "select id from ceedo_collections.app_users limit 1",
    );
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by)
       values ($1, 100.00, 'Ordinance 2027-001', 'amnesty', $2)`,
      [ch[0].id, u[0].id],
    );
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("gives the surcharge its parent's due date and period", async () => {
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-10", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-10')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    const rows = await surchargesFor(leaseId);
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2027-01-10");
    expect(rows[0].period_start.toISOString().slice(0, 10)).toBe("2027-01-10");
  });

  it("raises nothing for a fee type with a zero surcharge rate", async () => {
    await db.query(
      "update ceedo_collections.fee_types set surcharge_bps = 0 where code = 'market_rental'",
    );
    const { leaseId } = await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-05", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05')");
    expect(await surchargesFor(leaseId)).toHaveLength(0);
  });

  it("records the count on the accrual run when given one", async () => {
    const { rows } = await db.query(
      "insert into ceedo_collections.accrual_runs (business_date) values ('2027-03-05') returning id",
    );
    await createLeaseFixture(db, {
      accrualPeriod: "daily", startDate: "2027-01-05", rateAmount: "100.00",
    });
    await db.query("select ceedo_collections.run_accrual('2027-01-05')");
    await db.query("select ceedo_collections.run_surcharge('2027-03-05', $1)", [rows[0].id]);
    const { rows: run } = await db.query(
      "select surcharges_raised from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].surcharges_raised).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2b: Verify the TypeScript agrees**

Run the Task 3 suite too — `computeSurcharge(8350, 300)` must equal `251`, matching the SQL's `2.51`. Task 16 makes this a standing assertion rather than a manual check.

Run: `pnpm --filter @ceedo/shared test charges`

- [ ] **Step 3: Run, apply, re-run**

Run: `supabase db reset && pnpm --filter tests test surcharge`
Expected: PASS, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000021_surcharge.sql tests/db/surcharge.test.ts
git commit -m "feat(db): one-time 3% surcharge in integer basis points

The rate is stamped onto the row rather than looked up later, so a future
ordinance cannot alter a receipt already issued. 83.50 at 3% is 2.51, where
a float gives 250.49999999999997 centavos and floors to 2.50.

Unpaid means what charge_balances says, condonations included: a debt
written off under an amnesty must not then grow a penalty."
```

---

### Task 11: FIFO rules and reason codes in `packages/shared`

Pure TypeScript. Phase 3's device renders these rules offline; Task 12's SQL enforces them authoritatively. Task 16 asserts the two agree.

**Files:**
- Create: `packages/shared/src/fifo.ts`
- Create: `packages/shared/src/fifo.test.ts`
- Create: `packages/shared/src/reason-codes.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Centavos`, `sum` from `./money`
- Produces:
  - `interface PeriodGroup { groupRank: number; dueDate: string; periodStart: string; chargeIds: string[]; outstanding: Centavos }`
  - `function isContiguousPrefix(groups: readonly PeriodGroup[], selectedRanks: readonly number[]): boolean`
  - `function selectByAmount(groups: readonly PeriodGroup[], tendered: Centavos): { selected: PeriodGroup[]; applied: Centavos; change: Centavos }`
  - `type RejectReason` and `const REJECT_REASONS`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/fifo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import { isContiguousPrefix, selectByAmount, type PeriodGroup } from "./fifo";

const groups: PeriodGroup[] = [
  { groupRank: 1, dueDate: "2026-10-01", periodStart: "2026-10-01", chargeIds: ["a"], outstanding: fromCentavos(5000) },
  { groupRank: 2, dueDate: "2026-10-02", periodStart: "2026-10-02", chargeIds: ["b"], outstanding: fromCentavos(5000) },
  { groupRank: 3, dueDate: "2026-10-03", periodStart: "2026-10-03", chargeIds: ["c"], outstanding: fromCentavos(5000) },
];

describe("isContiguousPrefix", () => {
  it("accepts the oldest group alone", () => {
    expect(isContiguousPrefix(groups, [1])).toBe(true);
  });

  it("accepts an oldest-first run", () => {
    expect(isContiguousPrefix(groups, [1, 2])).toBe(true);
  });

  it("accepts every group", () => {
    expect(isContiguousPrefix(groups, [1, 2, 3])).toBe(true);
  });

  it("rejects skipping the oldest", () => {
    expect(isContiguousPrefix(groups, [2, 3])).toBe(false);
  });

  it("rejects a gap in the middle", () => {
    expect(isContiguousPrefix(groups, [1, 3])).toBe(false);
  });

  it("rejects an empty selection", () => {
    expect(isContiguousPrefix(groups, [])).toBe(false);
  });

  it("rejects a rank that is not on offer", () => {
    expect(isContiguousPrefix(groups, [1, 2, 9])).toBe(false);
  });

  it("ignores the order the ranks arrive in", () => {
    expect(isContiguousPrefix(groups, [2, 1])).toBe(true);
  });

  it("rejects a duplicated rank", () => {
    expect(isContiguousPrefix(groups, [1, 1, 2])).toBe(false);
  });
});

describe("selectByAmount", () => {
  it("takes whole periods only and returns the remainder as change", () => {
    const result = selectByAmount(groups, fromCentavos(12000));
    expect(result.selected.map((g) => g.groupRank)).toEqual([1, 2]);
    expect(result.applied).toBe(10000);
    expect(result.change).toBe(2000);
  });

  it("takes nothing when the amount does not cover the oldest period", () => {
    const result = selectByAmount(groups, fromCentavos(3000));
    expect(result.selected).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.change).toBe(3000);
  });

  it("takes everything when the amount covers the lot", () => {
    const result = selectByAmount(groups, fromCentavos(20000));
    expect(result.selected).toHaveLength(3);
    expect(result.change).toBe(5000);
  });

  it("leaves no change on an exact payment", () => {
    const result = selectByAmount(groups, fromCentavos(10000));
    expect(result.selected).toHaveLength(2);
    expect(result.change).toBe(0);
  });

  it("returns the whole amount as change when nothing is owed", () => {
    const result = selectByAmount([], fromCentavos(5000));
    expect(result.selected).toEqual([]);
    expect(result.change).toBe(5000);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @ceedo/shared test fifo`
Expected: FAIL — cannot resolve `./fifo`.

- [ ] **Step 3: Write the implementations**

Create `packages/shared/src/reason-codes.ts`:

```ts
/**
 * The vocabulary post_collection() answers with, shared so the collector app can render a
 * rejection the collector can act on rather than a Postgres error string.
 *
 * A rejected entry is never discarded (parent spec §6.3): by the time the server sees a
 * problem the collector has handed over a paper receipt and taken the money, so the code
 * tells a supervisor what to resolve, not the device what to throw away.
 */
export const REJECT_REASONS = [
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
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type PostResult =
  | { status: "accepted"; collectionId: string }
  | { status: "duplicate"; collectionId: string }
  | { status: "rejected"; reason: RejectReason; detail: string };
```

Create `packages/shared/src/fifo.ts`:

```ts
import { type Centavos } from "./money";

export interface PeriodGroup {
  /** 1-based position in oldest-first order. */
  groupRank: number;
  dueDate: string;
  periodStart: string;
  /** The rental charge and its surcharge, or a standalone opening balance. */
  chargeIds: string[];
  outstanding: Centavos;
}

/**
 * Whether a selection is a contiguous oldest-first prefix (invariant #5).
 *
 * Groups are assumed already ordered oldest-first by the caller -- the database orders
 * them by (due_date, period_start) in unpaid_period_groups(). This function checks the
 * SHAPE of the selection, not the ordering of the input.
 *
 * FIFO is what stops arrears being kept alive indefinitely: without it a tenant pays this
 * month, stays technically current, and the oldest debt never moves.
 */
export function isContiguousPrefix(
  groups: readonly PeriodGroup[],
  selectedRanks: readonly number[],
): boolean {
  if (selectedRanks.length === 0) return false;

  const unique = new Set(selectedRanks);
  // A duplicated rank would let a caller allocate twice against one period while still
  // looking like a prefix by length.
  if (unique.size !== selectedRanks.length) return false;

  const available = new Set(groups.map((g) => g.groupRank));
  for (const rank of unique) {
    if (!available.has(rank)) return false;
  }

  // A prefix of length n is exactly the ranks 1..n. Nothing else qualifies.
  for (let rank = 1; rank <= unique.size; rank += 1) {
    if (!unique.has(rank)) return false;
  }
  return true;
}

/**
 * Amount-driven selection: given what the tenant is handing over, take the longest
 * oldest-first run of WHOLE periods it covers and return the rest as change.
 *
 * Whole periods only (parent spec §8.3, §14). A partial period would leave a charge
 * neither settled nor untouched, and the next collector would have to work out what the
 * remainder means at a stall with a queue behind them.
 */
export function selectByAmount(
  groups: readonly PeriodGroup[],
  tendered: Centavos,
): { selected: PeriodGroup[]; applied: Centavos; change: Centavos } {
  const selected: PeriodGroup[] = [];
  let remaining: number = tendered;

  for (const group of groups) {
    if (group.outstanding > remaining) break;
    selected.push(group);
    remaining -= group.outstanding;
  }

  return {
    selected,
    applied: (tendered - remaining) as Centavos,
    change: remaining as Centavos,
  };
}
```

- [ ] **Step 4: Export from the index**

Modify `packages/shared/src/index.ts` — add `export * from "./fifo";` and `export * from "./reason-codes";`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @ceedo/shared test fifo` → PASS, 14 tests
Run: `pnpm typecheck` → clean

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fifo.ts packages/shared/src/fifo.test.ts \
        packages/shared/src/reason-codes.ts packages/shared/src/index.ts
git commit -m "feat(shared): FIFO prefix rules, amount-driven selection, reason codes

A prefix of length n is exactly the ranks 1..n; a duplicated rank is
refused, because it would allocate twice against one period while still
looking like a prefix by length.

Reason codes are shared so the collector app can render a rejection a
collector can act on. A rejected entry is never discarded -- the receipt is
already in the tenant's hand."
```

---

### Task 12: `post_collection()` — the settlement engine

The only way money enters the ledger. Phase 3's `sync-push` calls this same function, which is why the device and the server cannot disagree about what was owed.

**Files:**
- Create: `supabase/migrations/20260918000022_post_collection.sql`
- Create: `tests/db/post-collection.test.ts`

**Interfaces:**
- Consumes: `collections`, `collection_allocations`, `collection_lines` (Task 6), `charge_balances`, `unpaid_period_groups()` (Task 8), `booklets`, `booklet_assignments`, `spoiled_forms`, `rates` (Phase 1)
- Produces: `ceedo_collections.post_collection(p_payload jsonb) returns jsonb`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000022_post_collection.sql`:

```sql
-- The settlement engine. Parent spec §6.2, steps 1-6, in order.
--
-- One function, called by Phase 2's tests and by Phase 3's sync-push. Two
-- implementations of this would be two things to keep correct, and a tenant would get a
-- different balance depending on which door they paid at.
--
-- Payload shape:
--   {
--     "id": uuid,                  -- CLIENT-GENERATED. Idempotency key.
--     "or_no": integer,
--     "booklet_id": uuid,
--     "collector_id": uuid,
--     "device_id": uuid,
--     "collected_at": timestamptz,
--     "fee_type_id": uuid,
--     "lease_id": uuid | null,
--     "payer_ref": text | null,
--     "notes": text | null,
--     "allocations": [{ "group_rank": integer }],        -- settles charges
--     "lines": [{ "fee_type_id": uuid, "rate_class": text, "quantity": integer }]
--   }
--
-- Note what the payload does NOT carry: amounts. The device proposes WHICH periods and
-- HOW MANY units; the server decides what that costs. Invariant #3 -- the device's figure
-- is a claim to be checked, never truth -- is enforced by never accepting the figure at
-- all.
create or replace function ceedo_collections.post_collection(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id           uuid := (p_payload ->> 'id')::uuid;
  v_or_no        integer := (p_payload ->> 'or_no')::integer;
  v_booklet_id   uuid := (p_payload ->> 'booklet_id')::uuid;
  v_collector_id uuid := (p_payload ->> 'collector_id')::uuid;
  v_device_id    uuid := (p_payload ->> 'device_id')::uuid;
  v_collected_at timestamptz := (p_payload ->> 'collected_at')::timestamptz;
  v_fee_type_id  uuid := (p_payload ->> 'fee_type_id')::uuid;
  v_lease_id     uuid := nullif(p_payload ->> 'lease_id', '')::uuid;
  v_business     date;
  v_booklet      ceedo_collections.booklets%rowtype;
  v_ranks        integer[];
  v_max_rank     integer;
  v_group        record;
  v_line         jsonb;
  v_rate         ceedo_collections.rates%rowtype;
  v_gross        numeric(14,2) := 0;
  v_existing     uuid;
  v_allocations  jsonb := '[]'::jsonb;
  v_alloc_rows   jsonb;
  v_lines        jsonb := '[]'::jsonb;
  v_matched      integer := 0;
begin
  -- STEP 1: IDEMPOTENCY. Before anything else, and by primary key.
  -- A retry after a dropped connection carries the same client-generated id and must
  -- return duplicate, not issue a second receipt (invariant #2).
  select id into v_existing from ceedo_collections.collections where id = v_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'collection_id', v_existing);
  end if;

  v_business := (v_collected_at at time zone 'Asia/Manila')::date;

  -- STEP 2: AUTHORIZE against the booklet. The booklet, not the PIN, is the security
  -- boundary (parent spec §11.5): a person who knows another collector's PIN still cannot
  -- post against a booklet they are not holding.
  select * into v_booklet from ceedo_collections.booklets where id = v_booklet_id;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'booklet_not_assigned',
                              'detail', 'No such booklet');
  end if;

  if not exists (
    select 1 from ceedo_collections.booklet_assignments a
    where a.booklet_id = v_booklet_id
      and a.collector_id = v_collector_id
      and a.assigned_at <= v_business
      and (a.returned_at is null or a.returned_at >= v_business)
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'booklet_not_assigned',
      'detail', format('Booklet %s was not assigned to collector %s on %s',
                       v_booklet_id, v_collector_id, v_business));
  end if;

  if v_or_no < v_booklet.start_no or v_or_no > v_booklet.end_no then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_out_of_range',
      'detail', format('OR %s is outside booklet range %s-%s',
                       v_or_no, v_booklet.start_no, v_booklet.end_no));
  end if;

  -- The same serial recorded on a second device reaches here, and this is the only place
  -- it can be caught -- neither tablet can see the other's outbox.
  if exists (
    select 1 from ceedo_collections.collections
    where booklet_id = v_booklet_id and or_no = v_or_no
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_already_used',
      'detail', format('OR %s in this booklet is already recorded', v_or_no));
  end if;

  if exists (
    select 1 from ceedo_collections.spoiled_forms
    where booklet_id = v_booklet_id and or_no = v_or_no
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_spoiled',
      'detail', format('OR %s was recorded spoiled', v_or_no));
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_payload -> 'lines', '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'no_parts',
      'detail', 'A collection must carry allocations or lines');
  end if;

  -- STEP 4: FIFO. Validated before any write, so a rejection leaves nothing behind.
  if jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) > 0 then
    if v_lease_id is null then
      return jsonb_build_object('status', 'rejected', 'reason', 'lease_not_found',
        'detail', 'Allocations need a lease');
    end if;

    select array_agg((a ->> 'group_rank')::integer)
      into v_ranks
      from jsonb_array_elements(p_payload -> 'allocations') a;

    select max(r) into v_max_rank from unnest(v_ranks) r;

    -- A contiguous oldest-first prefix is exactly the ranks 1..n, so checking the set
    -- against its own maximum is the whole rule. Distinct guards against a duplicated
    -- rank allocating twice against one period while still passing a length check.
    if array_length(v_ranks, 1) <> v_max_rank
       or array_length(array(select distinct unnest(v_ranks)), 1) <> v_max_rank then
      return jsonb_build_object('status', 'rejected', 'reason', 'allocation_not_prefix',
        'detail', 'Allocations must be a contiguous oldest-first prefix of unpaid periods');
    end if;
  end if;

  -- STEP 3: RECOMPUTE, into local structures. Nothing is written until the total is
  -- known, so the parent row is inserted once, correct, and never corrected -- which is
  -- the only shape compatible with having no UPDATE privilege on the table.
  if v_ranks is not null then
    for v_group in
      select * from ceedo_collections.unpaid_period_groups(v_lease_id)
      where group_rank = any(v_ranks)
      order by group_rank
    loop
      v_matched := v_matched + 1;

      -- A whole period group settles in full, never partially (§8.3). The amount comes
      -- from what is actually outstanding, not from anything the caller sent.
      select coalesce(jsonb_agg(jsonb_build_object('charge_id', b.id, 'amount', b.outstanding)), '[]'::jsonb)
        into v_alloc_rows
        from ceedo_collections.charge_balances b
       where b.id = any(v_group.charge_ids) and b.outstanding > 0;

      v_allocations := v_allocations || v_alloc_rows;
      v_gross := v_gross + v_group.outstanding;
    end loop;

    -- Fewer groups came back than were asked for: a rank pointed at a period that is
    -- already settled, or the lease has fewer unpaid periods than the caller believed.
    -- Either way the caller's view of this lease is stale and the post must not proceed.
    if v_matched <> v_max_rank then
      return jsonb_build_object('status', 'rejected', 'reason', 'allocation_not_prefix',
        'detail', format('Requested %s period groups but only %s are unpaid',
                         v_max_rank, v_matched));
    end if;
  end if;

  -- Lines: the quantity comes from the caller, the unit rate from the rate table as of
  -- the collection date. A modified client can claim twelve hogs; it cannot claim a price.
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    select * into v_rate
    from ceedo_collections.rates r
    where r.fee_type_id = (v_line ->> 'fee_type_id')::uuid
      and r.rate_class = coalesce(v_line ->> 'rate_class', '')
      and r.effective_from <= v_business
      and (r.effective_to is null or r.effective_to >= v_business);

    if not found then
      return jsonb_build_object('status', 'rejected', 'reason', 'rate_not_found',
        'detail', format('No rate for fee type %s class %s on %s',
                         v_line ->> 'fee_type_id', coalesce(v_line ->> 'rate_class', ''),
                         v_business));
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'fee_type_id', v_line ->> 'fee_type_id',
      'rate_class', coalesce(v_line ->> 'rate_class', ''),
      'quantity', (v_line ->> 'quantity')::integer,
      'unit_rate', v_rate.amount));

    v_gross := v_gross + ((v_line ->> 'quantity')::integer * v_rate.amount);
  end loop;

  -- STEP 5: WRITE. One transaction, parent first for the foreign keys, gross already
  -- final. The deferred balance trigger re-checks the total at commit regardless.
  begin
    insert into ceedo_collections.collections (
      id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
      fee_type_id, lease_id, payer_ref, notes, gross_amount, synced_at, posted_by
    )
    values (
      v_id, v_or_no, v_booklet_id, v_collector_id, v_device_id, v_collected_at, v_business,
      v_fee_type_id, v_lease_id, p_payload ->> 'payer_ref', p_payload ->> 'notes',
      v_gross, now(), auth.uid()
    );
  exception
    -- Two concurrent posts of the same client id both pass the STEP 1 lookup and race
    -- here. The primary key settles it, and the loser reports duplicate rather than
    -- failing -- which is what a retrying device needs to hear.
    when unique_violation then
      return jsonb_build_object('status', 'duplicate', 'collection_id', v_id);
  end;

  insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
  select v_id, (a ->> 'charge_id')::uuid, (a ->> 'amount')::numeric
  from jsonb_array_elements(v_allocations) a;

  insert into ceedo_collections.collection_lines
    (collection_id, fee_type_id, rate_class, quantity, unit_rate)
  select v_id, (l ->> 'fee_type_id')::uuid, l ->> 'rate_class',
         (l ->> 'quantity')::integer, (l ->> 'unit_rate')::numeric
  from jsonb_array_elements(v_lines) l;

  -- STEP 6: respond.
  return jsonb_build_object('status', 'accepted', 'collection_id', v_id,
                            'gross_amount', v_gross);
end;
$$;

revoke execute on function ceedo_collections.post_collection(jsonb) from public;
-- No web role. Phase 2 grants only service_role, so the integration tests can reach it
-- through PostgREST; the function validates identically whoever calls it, so this widens
-- the break-glass key only to "post a receipt that passes every check". Phase 3 grants
-- ceedo_app and revokes service_role.
grant execute on function ceedo_collections.post_collection(jsonb) to service_role;
```

**Why it prices everything before it writes anything:** `collections` has no `UPDATE` privilege and never will, so `gross_amount` has to be right in the first and only insert. Computing the allocations and lines into local `jsonb` first, then writing parent-then-children, is what makes that possible. Any refactor must preserve three things: the total is final before the parent row is inserted, everything stays in one transaction, and no `UPDATE` privilege appears on any ledger table.

**Rejections return, they do not raise.** A `raise` would roll the transaction back, which is the same outcome here, but the caller gets a Postgres error string instead of a reason code — and Phase 3 needs the code to build the `sync_exceptions` row a supervisor will resolve. The one exception is the `unique_violation` handler, which converts a lost race into the `duplicate` a retrying device expects.

- [ ] **Step 2: Write the failing tests**

Create `tests/db/post-collection.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture } from "../helpers/supabase";

let db: Client;
let fx: any;
let orNo = 3000;

async function post(overrides: Record<string, unknown> = {}) {
  const payload = {
    id: randomUUID(),
    or_no: ++orNo,
    booklet_id: fx.bookletId,
    collector_id: fx.collectorId,
    device_id: fx.deviceId,
    collected_at: "2026-10-05T02:00:00Z",
    fee_type_id: fx.feeTypeId,
    lease_id: fx.leaseId,
    allocations: [{ group_rank: 1 }],
    lines: [],
    ...overrides,
  };
  const { rows } = await db.query(
    "select ceedo_collections.post_collection($1::jsonb) as result",
    [JSON.stringify(payload)],
  );
  return rows[0].result;
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-03')");
});

afterAll(async () => { await db.end(); });

describe("post_collection — the happy path", () => {
  it("accepts a payment settling the oldest period", async () => {
    const result = await post();
    expect(result.status).toBe("accepted");
    expect(Number(result.gross_amount)).toBe(50);
  });

  it("settles the charge it allocated against", async () => {
    await post();
    const { rows } = await db.query(
      `select is_settled from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date limit 1`, [fx.leaseId],
    );
    expect(rows[0].is_settled).toBe(true);
  });

  it("recomputes the amount rather than trusting the caller", async () => {
    // The payload carries no amount at all. This is the enforcement of invariant #3.
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 2 }] });
    expect(Number(result.gross_amount)).toBe(100);
  });

  it("prices lines from the rate table", async () => {
    const result = await post({
      allocations: [],
      lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 12 }],
    });
    expect(result.status).toBe("accepted");
    // 12 hogs at the seeded per-head rate.
    expect(Number(result.gross_amount)).toBe(12 * Number(fx.perHeadRate));
  });
});

describe("post_collection — idempotency", () => {
  it("returns duplicate for a repeated id, and issues no second receipt", async () => {
    const id = randomUUID();
    const first = await post({ id });
    const second = await post({ id, or_no: orNo + 50 });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(second.collection_id).toBe(id);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collections where id = $1", [id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("post_collection — rejections", () => {
  it("rejects an OR outside the booklet range", async () => {
    const result = await post({ or_no: 999999 });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_out_of_range");
  });

  it("rejects a serial already recorded", async () => {
    const used = ++orNo;
    await post({ or_no: used });
    const result = await post({ or_no: used });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_already_used");
  });

  it("rejects a serial recorded spoiled", async () => {
    const spoiled = ++orNo;
    await db.query(
      `insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
       values ($1, $2, 'torn', $3)`,
      [fx.bookletId, spoiled, fx.collectorId],
    );
    const result = await post({ or_no: spoiled });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_spoiled");
  });

  it("rejects a booklet not assigned to this collector", async () => {
    const other = await createCollectionFixture(db);
    const result = await post({ collector_id: other.collectorId });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("booklet_not_assigned");
  });

  it("rejects allocations that skip the oldest period", async () => {
    const result = await post({ allocations: [{ group_rank: 2 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects allocations with a gap", async () => {
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 3 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a duplicated rank", async () => {
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 1 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a collection with neither allocations nor lines", async () => {
    const result = await post({ allocations: [], lines: [] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("no_parts");
  });

  it("rejects allocations with no lease", async () => {
    const result = await post({ lease_id: null });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("lease_not_found");
  });

  it("rejects when a requested rank is already settled", async () => {
    await post({ allocations: [{ group_rank: 1 }] });
    // Rank 1 is now settled, so the caller's ranks are stale: what it thinks is rank 2
    // has become rank 1, and asking for two groups finds only one.
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 2 }, { group_rank: 3 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a line whose fee type has no rate on the collection date", async () => {
    const result = await post({
      allocations: [], lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "unicorn", quantity: 1 }],
    });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("rate_not_found");
  });

  it("leaves nothing behind when it rejects", async () => {
    const id = randomUUID();
    await post({ id, allocations: [{ group_rank: 2 }] });
    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collections where id = $1", [id],
    );
    expect(rows[0].n).toBe(0);
  });
});
```

Extend `createCollectionFixture` to also seed a per-head fee type with a `hog` rate class and return `perHeadFeeTypeId` and `perHeadRate`.

- [ ] **Step 3: Add the owner-connection helper**

Add `postCollectionAsOwner(db, fixture, opts)` to `tests/helpers/supabase.ts`, wrapping the RPC call above and returning the collection id. Task 8's tests and Task 20's scenario both use it.

- [ ] **Step 4: Run, apply, re-run**

Run: `supabase db reset && pnpm --filter tests test post-collection`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000022_post_collection.sql \
        tests/db/post-collection.test.ts tests/helpers/supabase.ts
git commit -m "feat(db): post_collection, the one settlement engine

The payload carries no amounts. The caller proposes which periods and how
many units; the server prices both from charge_balances and the rate table.
Invariant #3 is enforced by never accepting a figure at all.

Idempotency is checked first and by primary key, so a retry after a dropped
connection returns duplicate rather than issuing a second receipt. FIFO is
validated before any write, so a rejection leaves nothing behind.

Phase 3's sync-push calls this same function rather than reimplementing
§6.2."
```

---

### Task 13: `cancel_collection()`

Voiding a receipt without touching it. The cancellation row is what stops the allocations counting.

**Files:**
- Create: `supabase/migrations/20260918000023_cancel_collection.sql`
- Create: `tests/db/cancellation.test.ts`

**Interfaces:**
- Consumes: `collection_cancellations` (Task 6), `has_role()` (Phase 1)
- Produces: `ceedo_collections.cancel_collection(p_collection_id uuid, p_reason text) returns uuid`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000023_cancel_collection.sql`:

```sql
-- Voids a posted receipt (§11.3). Supervisor or admin.
--
-- Nothing on the collection changes -- it cannot, there is no UPDATE privilege. The
-- cancellation row is the correction, both rows stay visible, and charge_balances stops
-- counting the allocations. This is how the paper system works and what COA expects.
create or replace function ceedo_collections.cancel_collection(
  p_collection_id uuid,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may cancel a collection'
      using errcode = 'insufficient_privilege';
  end if;

  -- A written reason is mandatory on every resolution (§11.3). Enforced here as well as
  -- by the table constraint so the error names the rule rather than the constraint.
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A cancellation needs a written reason';
  end if;

  if not exists (select 1 from ceedo_collections.collections where id = p_collection_id) then
    raise exception 'No such collection: %', p_collection_id;
  end if;

  insert into ceedo_collections.collection_cancellations
    (collection_id, reason, cancelled_by)
  values (p_collection_id, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Collection % is already cancelled', p_collection_id
      using errcode = 'unique_violation';
end;
$$;

revoke execute on function ceedo_collections.cancel_collection(uuid, text) from public;
grant execute on function ceedo_collections.cancel_collection(uuid, text) to authenticated;
```

- [ ] **Step 2: Write the test**

Create `tests/db/cancellation.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createCollectionFixture, postCollectionAsOwner, signIn,
} from "../helpers/supabase";

let db: Client;
let fx: any;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-02')");
});

afterAll(async () => { await db.end(); });

describe("cancel_collection", () => {
  it("restores the outstanding balance", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const supervisor = await signIn(await createAppUser("supervisor"));

    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "Recorded against the wrong stall",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select outstanding, is_settled from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date limit 1`, [fx.leaseId],
    );
    expect(Number(rows[0].outstanding)).toBe(50);
    expect(rows[0].is_settled).toBe(false);
  });

  it("leaves the collection row untouched", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows: before } = await db.query(
      "select * from ceedo_collections.collections where id = $1", [collectionId],
    );
    const supervisor = await signIn(await createAppUser("supervisor"));
    await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    const { rows: after } = await db.query(
      "select * from ceedo_collections.collections where id = $1", [collectionId],
    );
    expect(after[0]).toEqual(before[0]);
  });

  it("puts the period back at the front of the FIFO queue", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const supervisor = await signIn(await createAppUser("supervisor"));
    await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });
    const { rows } = await db.query(
      "select * from ceedo_collections.unpaid_period_groups($1)", [fx.leaseId],
    );
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(rows[0].group_rank).toBe(1);
  });

  it("refuses a second cancellation", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const supervisor = await signIn(await createAppUser("supervisor"));
    await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "first",
    });
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "second",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already cancelled/);
  });

  it("refuses a blank reason", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const supervisor = await signIn(await createAppUser("supervisor"));
    const { error } = await supervisor.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/written reason/);
  });

  it("refuses an accounting user", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const accounting = await signIn(await createAppUser("accounting"));
    const { error } = await accounting.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/);
  });

  it("records the cancellation in the audit log", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const admin = await signIn(await createAppUser("admin"));
    await admin.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "audited",
    });
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'collection_cancellations' and action = 'insert'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("frees the serial for nothing — a cancelled OR is still spent", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1], orNo: 4100 });
    const admin = await signIn(await createAppUser("admin"));
    await admin.rpc("cancel_collection", { p_collection_id: collectionId, p_reason: "void" });

    // The paper receipt is void but the serial is consumed: it must still be accounted
    // for in the booklet reconciliation, not reissued.
    await expect(
      postCollectionAsOwner(db, fx, { groupRanks: [1], orNo: 4100 }),
    ).rejects.toThrow();
  });
});
```

`postCollectionAsOwner(db, fx, { groupRanks, orNo })` builds the payload and calls the RPC over the owner connection, throwing on a non-accepted result.

- [ ] **Step 3: Run, apply, re-run**

Run: `supabase db reset && pnpm --filter tests test cancellation`
Expected: PASS, 8 tests.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000023_cancel_collection.sql \
        tests/db/cancellation.test.ts tests/helpers/supabase.ts
git commit -m "feat(db): cancel_collection, a correction that changes nothing

The collection row is untouched -- it cannot be touched. The cancellation
row is the correction, both stay visible, and charge_balances stops
counting the allocations, putting the period back at the front of the FIFO
queue.

A cancelled serial stays spent: the paper receipt is void but the number
must still reconcile in the booklet."
```

---

### Task 14: Reporting views

Aging, delinquency and the subsidiary ledger. All read `charge_balances`, so none of them can disagree with the others or with FIFO.

**Files:**
- Create: `supabase/migrations/20260918000024_reporting_views.sql`
- Create: `tests/db/reporting-views.test.ts`

**Interfaces:**
- Consumes: `charge_balances` (Task 8), `collections`, `collection_cancellations` (Task 6)
- Produces: views `lease_balances`, `aging_of_receivables`, `delinquency_list`, `subsidiary_ledger`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000024_reporting_views.sql`:

```sql
-- Every view here is security_invoker: RLS applies to the staff member running the
-- query, not to the view's owner. On a Supabase project shared with unrelated systems,
-- a definer-rights view over the ledger is a hole through the membership gate.

create view ceedo_collections.lease_balances
with (security_invoker = true)
as
select
  b.lease_id,
  sum(b.outstanding)::numeric(14,2)              as outstanding,
  min(b.due_date) filter (where not b.is_settled) as oldest_due_date,
  max(b.days_overdue) filter (where not b.is_settled) as days_overdue,
  count(*) filter (where not b.is_settled)::integer   as unpaid_charges
from ceedo_collections.charge_balances b
where not b.is_settled
group by b.lease_id;

grant select on ceedo_collections.lease_balances to authenticated;

-- Buckets by how long each charge has been overdue, not by how long the lease has been
-- in arrears. A tenant paying sporadically has charges in several buckets at once, and
-- collapsing that to one number per tenant is what makes an aging report useless.
create view ceedo_collections.aging_of_receivables
with (security_invoker = true)
as
select
  b.lease_id,
  l.stall_id,
  s.stall_no,
  t.full_name as tenant_name,
  sum(b.outstanding) filter (where b.days_overdue between 1 and 30)::numeric(14,2)  as bucket_1_30,
  sum(b.outstanding) filter (where b.days_overdue between 31 and 60)::numeric(14,2) as bucket_31_60,
  sum(b.outstanding) filter (where b.days_overdue between 61 and 90)::numeric(14,2) as bucket_61_90,
  sum(b.outstanding) filter (where b.days_overdue > 90)::numeric(14,2)              as bucket_over_90,
  sum(b.outstanding) filter (where b.days_overdue = 0)::numeric(14,2)               as not_yet_due,
  sum(b.outstanding)::numeric(14,2)                                                 as total
from ceedo_collections.charge_balances b
join ceedo_collections.leases  l on l.id = b.lease_id
join ceedo_collections.stalls  s on s.id = l.stall_id
join ceedo_collections.tenants t on t.id = l.tenant_id
where not b.is_settled
group by b.lease_id, l.stall_id, s.stall_no, t.full_name;

grant select on ceedo_collections.aging_of_receivables to authenticated;

-- Drives demand letters, so it carries the contact details that go on one.
create view ceedo_collections.delinquency_list
with (security_invoker = true)
as
select
  a.lease_id,
  a.stall_no,
  a.tenant_name,
  t.address,
  t.contact_no,
  lb.outstanding,
  lb.oldest_due_date,
  lb.days_overdue,
  lb.unpaid_charges
from ceedo_collections.aging_of_receivables a
join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
join ceedo_collections.leases  l on l.id = a.lease_id
join ceedo_collections.tenants t on t.id = l.tenant_id
where lb.days_overdue > 30
order by lb.days_overdue desc, lb.outstanding desc;

grant select on ceedo_collections.delinquency_list to authenticated;

-- Charges and payments interleaved for one lease. The running balance is computed here
-- rather than in report code so every consumer gets the same number.
--
-- A cancelled collection appears with a zero amount and its cancellation noted, rather
-- than vanishing: the paper trail shows the receipt was issued and then voided, which is
-- what an auditor is looking for.
create view ceedo_collections.subsidiary_ledger
with (security_invoker = true)
as
with entries as (
  select
    b.lease_id,
    b.due_date                              as entry_date,
    'charge'::text                          as entry_type,
    b.charge_type::text                     as detail,
    b.period_start,
    b.period_end,
    b.amount                                as debit,
    0::numeric(14,2)                        as credit,
    null::integer                           as or_no,
    b.id                                    as source_id,
    false                                   as cancelled
  from ceedo_collections.charge_balances b

  union all

  select
    c.lease_id,
    c.business_date,
    'collection'::text,
    case when x.id is null then 'payment' else 'payment (cancelled)' end,
    null::date,
    null::date,
    0::numeric(14,2),
    case when x.id is null then c.gross_amount else 0::numeric(14,2) end,
    c.or_no,
    c.id,
    x.id is not null
  from ceedo_collections.collections c
  left join ceedo_collections.collection_cancellations x on x.collection_id = c.id
  where c.lease_id is not null
)
select
  lease_id, entry_date, entry_type, detail, period_start, period_end,
  debit, credit, or_no, source_id, cancelled,
  sum(debit - credit) over (
    partition by lease_id order by entry_date, entry_type, source_id
    rows between unbounded preceding and current row
  )::numeric(14,2) as running_balance
from entries;

grant select on ceedo_collections.subsidiary_ledger to authenticated;
```

- [ ] **Step 2: Write the test**

Create `tests/db/reporting-views.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createCollectionFixture, postCollectionAsOwner, signIn,
} from "../helpers/supabase";

let db: Client;
let fx: any;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
  });
});

afterAll(async () => { await db.end(); });

describe("lease_balances", () => {
  it("totals what a lease owes and names the oldest due date", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const { rows } = await db.query(
      "select * from ceedo_collections.lease_balances where lease_id = $1", [fx.leaseId],
    );
    expect(Number(rows[0].outstanding)).toBe(150);
    expect(rows[0].oldest_due_date.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(rows[0].unpaid_charges).toBe(3);
  });

  it("drops a lease once everything is settled", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows } = await db.query(
      "select * from ceedo_collections.lease_balances where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("aging_of_receivables", () => {
  it("buckets each charge by how long it has been overdue", async () => {
    // Charges dated far enough back to land in the over-90 bucket.
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const { rows } = await db.query(
      "select * from ceedo_collections.aging_of_receivables where lease_id = $1",
      [fx.leaseId],
    );
    const total = Number(rows[0].total);
    const buckets =
      Number(rows[0].bucket_1_30 ?? 0) + Number(rows[0].bucket_31_60 ?? 0) +
      Number(rows[0].bucket_61_90 ?? 0) + Number(rows[0].bucket_over_90 ?? 0) +
      Number(rows[0].not_yet_due ?? 0);
    expect(buckets).toBe(total);
  });

  it("agrees with lease_balances on the total", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const { rows } = await db.query(
      `select a.total, lb.outstanding
         from ceedo_collections.aging_of_receivables a
         join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
        where a.lease_id = $1`, [fx.leaseId],
    );
    expect(Number(rows[0].total)).toBe(Number(rows[0].outstanding));
  });
});

describe("subsidiary_ledger", () => {
  it("interleaves charges and payments with a running balance", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-02')");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });

    const { rows } = await db.query(
      `select * from ceedo_collections.subsidiary_ledger
        where lease_id = $1 order by entry_date, entry_type, source_id`, [fx.leaseId],
    );
    expect(rows.filter((r: any) => r.entry_type === "charge")).toHaveLength(2);
    expect(rows.filter((r: any) => r.entry_type === "collection")).toHaveLength(1);
    expect(Number(rows[rows.length - 1].running_balance)).toBe(50);
  });

  it("shows a cancelled receipt as issued and voided, not as absent", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-01')");
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const admin = await signIn(await createAppUser("admin"));
    await admin.rpc("cancel_collection", {
      p_collection_id: collectionId, p_reason: "wrong stall",
    });

    const { rows } = await db.query(
      `select * from ceedo_collections.subsidiary_ledger
        where lease_id = $1 and entry_type = 'collection'`, [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cancelled).toBe(true);
    expect(Number(rows[0].credit)).toBe(0);
    expect(rows[0].detail).toMatch(/cancelled/);
  });
});

describe("delinquency_list", () => {
  it("omits a lease inside 30 days", async () => {
    await db.query("select ceedo_collections.run_accrual(current_date)");
    const { rows } = await db.query(
      "select * from ceedo_collections.delinquency_list where lease_id = $1", [fx.leaseId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("reporting views respect RLS", () => {
  it("shows nothing to an authenticated user with no app_users row", async () => {
    await db.query("select ceedo_collections.run_accrual('2026-10-03')");
    const outsider = await signIn(await createAppUser("none"));
    const { data } = await outsider.from("aging_of_receivables").select("*");
    expect(data ?? []).toEqual([]);
  });
});
```

`createAppUser("none")` must create a Google-authenticated `auth.users` row with **no** `app_users` row, mirroring a person who signed up for an unrelated system on the same Supabase project. If the Phase 1 helper cannot express that, add a separate `createOutsider()` helper.

- [ ] **Step 3: Run, apply, re-run**

Run: `supabase db reset && pnpm --filter tests test reporting-views`
Expected: PASS, 8 tests.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000024_reporting_views.sql \
        tests/db/reporting-views.test.ts tests/helpers/supabase.ts
git commit -m "feat(db): aging, delinquency, lease balances and subsidiary ledger

All read charge_balances, so no two of them can report different figures.
Aging buckets each charge by its own days overdue rather than collapsing a
lease to one age -- a tenant paying sporadically legitimately has charges
in several buckets at once.

A cancelled receipt appears in the subsidiary ledger as issued and voided
rather than vanishing, which is what an auditor looks for."
```

---

### Task 15: Schedule the nightly run under `pg_cron`

**Files:**
- Create: `supabase/migrations/20260918000025_accrual_schedule.sql`
- Create: `tests/db/accrual-schedule.test.ts`

**Interfaces:**
- Consumes: `run_accrual()` (Task 5), `run_surcharge()` (Task 10)
- Produces: `ceedo_collections.run_nightly() returns uuid`; a `cron.job` entry named `ceedo_nightly_accrual`; view `ceedo_collections.accrual_health`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260918000025_accrual_schedule.sql`:

```sql
-- Fails loudly if pg_cron is not available, rather than skipping the schedule.
--
-- A silently unscheduled accrual is invisible: no error, no log line, no missing table --
-- just charges that quietly never appear, discovered a month later when arrears are
-- wrong. Refusing to apply is far cheaper than that.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise exception
      'pg_cron is not available on this instance. Enable it in the Supabase dashboard '
      '(Database -> Extensions) before applying this migration. The nightly accrual '
      'cannot be scheduled without it, and an unscheduled accrual fails silently.';
  end if;
end;
$$;

create extension if not exists pg_cron;

-- One entry point for the nightly work, so the cron entry stays a single call and the
-- ordering (accrual, then surcharge on what it raised) lives in SQL rather than in a
-- schedule string.
create or replace function ceedo_collections.run_nightly()
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_run_id uuid;
  v_date   date;
begin
  v_date := ceedo_collections.business_date();
  v_run_id := ceedo_collections.run_accrual(v_date);

  -- Only surcharge if the accrual succeeded. Surcharging against a half-built day would
  -- penalise charges that were never raised.
  if exists (
    select 1 from ceedo_collections.accrual_runs
    where id = v_run_id and status = 'succeeded'
  ) then
    perform ceedo_collections.run_surcharge(v_date, v_run_id);
  end if;

  return v_run_id;
end;
$$;

revoke execute on function ceedo_collections.run_nightly() from public;
grant execute on function ceedo_collections.run_nightly() to service_role;

-- 18:00 UTC is 02:00 Manila: after the business day has closed, before a 5am market
-- round. pg_cron schedules in UTC, so this is written in UTC deliberately -- the
-- function itself derives the business date in Asia/Manila.
select cron.schedule(
  'ceedo_nightly_accrual',
  '0 18 * * *',
  $cron$select ceedo_collections.run_nightly()$cron$
);

-- The monitoring surface. run_accrual logs a failure and returns rather than raising, so
-- a failed night is a row with status 'failed'; a night that never ran at all is no row,
-- which this view reports as 'missing'. Both are alerts.
create view ceedo_collections.accrual_health
with (security_invoker = true)
as
select
  d::date as business_date,
  coalesce(r.status, 'missing') as status,
  r.charges_raised,
  r.surcharges_raised,
  r.finished_at,
  r.error
from generate_series(
       ceedo_collections.business_date() - 14,
       ceedo_collections.business_date(),
       interval '1 day') d
left join lateral (
  select * from ceedo_collections.accrual_runs a
  where a.business_date = d::date
  order by a.started_at desc limit 1
) r on true
order by d desc;

grant select on ceedo_collections.accrual_health to authenticated;
```

- [ ] **Step 2: Write the test**

Create `tests/db/accrual-schedule.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => { await db.end(); });

describe("the nightly schedule", () => {
  it("is registered with pg_cron", async () => {
    const { rows } = await db.query(
      "select schedule, command, active from cron.job where jobname = 'ceedo_nightly_accrual'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toBe("0 18 * * *");
    expect(rows[0].active).toBe(true);
  });

  it("runs at 02:00 Manila", async () => {
    // 18:00 UTC. Asserting the conversion rather than trusting the comment.
    const { rows } = await db.query(
      "select (timestamptz '2026-10-01 18:00:00+00' at time zone 'Asia/Manila') as local",
    );
    expect(rows[0].local.getHours()).toBe(2);
  });
});

describe("run_nightly", () => {
  it("accrues and surcharges in one call", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query(
      "insert into ceedo_collections.settings (cutover_date) values (current_date - 400)",
    );
    await db.query(
      "update ceedo_collections.fee_types set surcharge_bps = 300 where code = 'market_rental'",
    );
    await createLeaseFixture(db, {
      accrualPeriod: "monthly", startDate: "2025-08-01", dueDay: 5, rateAmount: "1500.00",
    });

    const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("succeeded");
    expect(run[0].charges_raised).toBeGreaterThan(0);
    expect(run[0].surcharges_raised).toBeGreaterThan(0);
  });

  it("does not surcharge when the accrual failed", async () => {
    await db.query("delete from ceedo_collections.settings");
    const { rows } = await db.query("select ceedo_collections.run_nightly() as id");
    const { rows: run } = await db.query(
      "select * from ceedo_collections.accrual_runs where id = $1", [rows[0].id],
    );
    expect(run[0].status).toBe("failed");
    expect(run[0].surcharges_raised).toBe(0);
  });
});

describe("accrual_health", () => {
  it("reports a night that never ran as missing", async () => {
    await db.query("delete from ceedo_collections.accrual_runs");
    const { rows } = await db.query(
      "select * from ceedo_collections.accrual_health where status = 'missing'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("reports a failed night as failed", async () => {
    await db.query("delete from ceedo_collections.accrual_runs");
    await db.query("delete from ceedo_collections.settings");
    await db.query("select ceedo_collections.run_nightly()");
    const { rows } = await db.query(
      `select * from ceedo_collections.accrual_health
        where business_date = ceedo_collections.business_date()`,
    );
    expect(rows[0].status).toBe("failed");
  });
});
```

- [ ] **Step 3: Verify `pg_cron` is available locally first**

Run: `supabase db reset`

If it fails on the `pg_cron` guard, the local Supabase image does not carry it. Check `supabase/config.toml` for a `[db.extensions]` section or upgrade the CLI. **Do not remove the guard to make the migration apply** — that is precisely the failure mode it exists to prevent.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter tests test accrual-schedule`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000025_accrual_schedule.sql \
        tests/db/accrual-schedule.test.ts
git commit -m "feat(db): schedule the nightly accrual at 02:00 Manila

The migration refuses to apply if pg_cron is absent rather than skipping
the schedule. An unscheduled accrual produces no error and no missing
table -- just charges that quietly never appear, found a month later when
arrears are wrong.

accrual_health reports both a failed night and a night that never ran,
because run_accrual logs failures rather than raising them."
```

---

### Task 16: TypeScript–SQL parity

The device will compute period boundaries, surcharges and FIFO prefixes offline in TypeScript; the server enforces the same rules in SQL. Advisory is not the same as free to diverge — a device that computes a different prefix than the server accepts produces a rejection the collector cannot understand while holding a spent receipt.

**Files:**
- Create: `tests/db/parity.test.ts`

**Interfaces:**
- Consumes: `generatePeriods`, `computeSurcharge`, `isContiguousPrefix` (`@ceedo/shared`); `lease_periods()`, `run_surcharge()`, `post_collection()` (SQL)

- [ ] **Step 1: Write the test**

Create `tests/db/parity.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { computeSurcharge, fromCentavos, generatePeriods } from "@ceedo/shared";
import { POSTGRES_URL } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => { await db.end(); });

/** Fixtures chosen to hit the boundaries, not the middle. */
const PERIOD_CASES = [
  { accrualPeriod: "daily" as const,   leaseStart: "2026-10-01", leaseEnd: null,         cutover: "2026-10-01", through: "2026-10-05", dueDay: null },
  { accrualPeriod: "daily" as const,   leaseStart: "2024-01-01", leaseEnd: null,         cutover: "2026-10-01", through: "2026-10-03", dueDay: null },
  { accrualPeriod: "daily" as const,   leaseStart: "2026-10-01", leaseEnd: "2026-10-02", cutover: "2026-10-01", through: "2026-10-09", dueDay: null },
  { accrualPeriod: "weekly" as const,  leaseStart: "2026-10-01", leaseEnd: null,         cutover: "2026-10-01", through: "2026-10-15", dueDay: null },
  { accrualPeriod: "weekly" as const,  leaseStart: "2026-10-01", leaseEnd: null,         cutover: "2026-10-01", through: "2026-10-10", dueDay: null },
  { accrualPeriod: "monthly" as const, leaseStart: "2026-10-01", leaseEnd: null,         cutover: "2026-10-01", through: "2026-12-15", dueDay: 5 },
  { accrualPeriod: "monthly" as const, leaseStart: "2027-02-01", leaseEnd: null,         cutover: "2026-10-01", through: "2027-03-05", dueDay: 28 },
  { accrualPeriod: "monthly" as const, leaseStart: "2028-01-01", leaseEnd: null,         cutover: "2026-10-01", through: "2028-04-01", dueDay: 1 },
  { accrualPeriod: "monthly" as const, leaseStart: "2026-11-15", leaseEnd: null,         cutover: "2026-10-01", through: "2027-01-31", dueDay: 10 },
];

describe("period generation agrees between TypeScript and SQL", () => {
  for (const [i, c] of PERIOD_CASES.entries()) {
    it(`case ${i + 1}: ${c.accrualPeriod} from ${c.leaseStart} through ${c.through}`, async () => {
      const ts = generatePeriods(c);

      const { rows } = await db.query(
        `select period_start, period_end, due_date
           from ceedo_collections.lease_periods($1, $2, $3, $4, $5, $6)`,
        [c.accrualPeriod, c.leaseStart, c.leaseEnd, c.cutover, c.through, c.dueDay],
      );
      const sql = rows.map((r: any) => ({
        periodStart: r.period_start.toISOString().slice(0, 10),
        periodEnd: r.period_end.toISOString().slice(0, 10),
        dueDate: r.due_date.toISOString().slice(0, 10),
      }));

      expect(sql).toEqual(ts);
    });
  }
});

describe("surcharge arithmetic agrees between TypeScript and SQL", () => {
  const AMOUNTS = ["83.50", "50.00", "1500.00", "0.01", "1.67", "33.33", "99999.99", "7.15"];

  for (const pesos of AMOUNTS) {
    it(`${pesos} at 3%`, async () => {
      const ts = computeSurcharge(fromCentavos(Math.round(Number(pesos) * 100)), 300);

      const { rows } = await db.query(
        "select floor((round($1::numeric * 100) * 300 + 5000) / 10000) as centavos",
        [pesos],
      );
      expect(Number(rows[0].centavos)).toBe(ts);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter tests test parity`
Expected: PASS, 17 tests.

**If a case disagrees, the SQL is authoritative and the TypeScript is wrong** — the server is what actually decides what a tenant owes. Fix `packages/shared`, not the migration, unless the SQL is demonstrably wrong against the spec.

- [ ] **Step 3: Commit**

```bash
git add tests/db/parity.test.ts
git commit -m "test: assert the TypeScript and SQL rules agree

The device computes period boundaries, surcharges and FIFO prefixes
offline; the server enforces the same rules authoritatively. Advisory is
not the same as free to diverge -- a device computing a different prefix
than the server accepts produces a rejection the collector cannot act on
while holding a spent receipt."
```

---

### Task 17: Web — ledger reads

Three read-only screens over the views. No writes, no RPCs.

**Files:**
- Create: `apps/web/lib/ledger/queries.ts`
- Create: `apps/web/components/ledger/money.tsx`
- Create: `apps/web/components/ledger/ledger-table.tsx`
- Create: `apps/web/app/(admin)/ledger/aging/page.tsx`
- Create: `apps/web/app/(admin)/ledger/delinquency/page.tsx`
- Create: `apps/web/app/(admin)/ledger/leases/[id]/page.tsx`
- Modify: `apps/web/app/(admin)/layout.tsx` — add the navigation entries

**Interfaces:**
- Consumes: `createServerClient()` from `apps/web/lib/supabase/server.ts`; the views from Task 14; `format`, `fromPesos` from `@ceedo/shared`
- Produces: `getAging()`, `getDelinquency()`, `getSubsidiaryLedger(leaseId)`, `getLeaseBalance(leaseId)`

- [ ] **Step 1: Read the existing patterns first**

Read `apps/web/app/(admin)/[resource]/page.tsx`, `apps/web/lib/admin/resource.ts` and `apps/web/components/resource-table.tsx`. Match their conventions for server components, auth gating and table markup. The ledger screens are read-plus-RPC rather than CRUD, so they do **not** go through the registry — but they should look like they belong to the same application.

- [ ] **Step 2: Write the queries module**

Create `apps/web/lib/ledger/queries.ts`. Every function returns rows with **money as `Centavos`**, converted once at this boundary:

```ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { createClient } from "../supabase/server";

/**
 * Postgres numeric arrives as a string through PostgREST. Converting here, once, is what
 * keeps 2-decimal floats out of the ledger UI -- the shortcut the Phase 1 handover flagged
 * and this phase deliberately does not extend.
 */
function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

export interface AgingRow {
  leaseId: string;
  stallNo: string;
  tenantName: string;
  bucket1to30: Centavos;
  bucket31to60: Centavos;
  bucket61to90: Centavos;
  bucketOver90: Centavos;
  notYetDue: Centavos;
  total: Centavos;
}

export async function getAging(): Promise<AgingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("aging_of_receivables")
    .select("*")
    .order("bucket_over_90", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    leaseId: r.lease_id,
    stallNo: r.stall_no,
    tenantName: r.tenant_name,
    bucket1to30: centavos(r.bucket_1_30),
    bucket31to60: centavos(r.bucket_31_60),
    bucket61to90: centavos(r.bucket_61_90),
    bucketOver90: centavos(r.bucket_over_90),
    notYetDue: centavos(r.not_yet_due),
    total: centavos(r.total),
  }));
}
```

Write `getDelinquency()`, `getSubsidiaryLedger(leaseId)` and `getLeaseBalance(leaseId)` in the same shape, each mapping its view's columns and converting every money column through `centavos()`.

- [ ] **Step 3: Write the money component**

Create `apps/web/components/ledger/money.tsx`:

```tsx
import { format, type Centavos } from "@ceedo/shared";

/**
 * Right-aligned and tabular-nums so columns of figures line up on the decimal point.
 * A zero renders as a dash: in an aging table, an empty bucket and a bucket holding zero
 * pesos mean the same thing, and a column of "₱0.00" hides the figures that matter.
 */
export function Money({ amount, muted }: { amount: Centavos; muted?: boolean }) {
  if (amount === 0) {
    return <span className="tabular-nums text-right text-muted-foreground">—</span>;
  }
  return (
    <span className={`tabular-nums text-right ${muted ? "text-muted-foreground" : ""}`}>
      {format(amount)}
    </span>
  );
}
```

- [ ] **Step 4: Write the three pages**

Each is a server component that gates on role, fetches, and renders. Gate with the existing helper in `apps/web/lib/auth/gate.ts` — read it first and use it rather than re-deriving the role check.

- Aging (`ledger/aging/page.tsx`): one row per lease, five bucket columns plus total, stall number linking to the subsidiary ledger.
- Delinquency (`ledger/delinquency/page.tsx`): stall, tenant, contact, outstanding, oldest due date, days overdue.
- Subsidiary ledger (`ledger/leases/[id]/page.tsx`): header with tenant, stall and current balance; then the interleaved entries with a running balance. Cancelled receipts render struck through with the reason.

- [ ] **Step 5: Add navigation**

Modify `apps/web/app/(admin)/layout.tsx` to add an "Ledger" group with Aging and Delinquency. The subsidiary ledger is reached by drilling in, not from the nav.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm --filter web build`
Then: `pnpm --filter web dev`, sign in, and confirm each screen renders with seeded data.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/ledger/queries.ts apps/web/components/ledger/ \
        apps/web/app/\(admin\)/ledger/ apps/web/app/\(admin\)/layout.tsx
git commit -m "feat(web): aging, delinquency and subsidiary ledger screens

Read-only over the Phase 2 views. Money is converted to Centavos once at
the PostgREST boundary rather than carried as 2-decimal floats into the UI.

These are read-plus-RPC screens, so they sit outside the registry engine
built for master-data CRUD."
```

---

### Task 18: Web — collection browser, cancellation, condonation and opening balances

The three write paths the web legitimately has. Each calls an RPC; none inserts directly, because none can.

**Files:**
- Create: `apps/web/lib/ledger/actions.ts`
- Create: `apps/web/app/(admin)/ledger/collections/page.tsx`
- Create: `apps/web/components/ledger/cancel-dialog.tsx`
- Create: `apps/web/components/ledger/condone-dialog.tsx`
- Create: `apps/web/app/(admin)/ledger/opening-balances/page.tsx`
- Modify: `apps/web/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `cancel_collection()` (Task 13), `condone_charge()` (Task 9), `record_opening_balance()` (Task 4)
- Produces: server actions `cancelCollection(formData)`, `condoneCharge(formData)`, `recordOpeningBalance(formData)`

- [ ] **Step 1: Read the existing server-action pattern**

Read `apps/web/lib/admin/actions.ts` and `apps/web/lib/admin/save-result.ts`. Reuse the existing `SaveResult` shape for these actions rather than introducing a second convention for reporting success and failure to a form.

- [ ] **Step 2: Write the actions**

Create `apps/web/lib/ledger/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "../supabase/server";
import { type SaveResult } from "../admin/save-result";

const cancelSchema = z.object({
  collectionId: z.string().uuid(),
  // The database refuses a blank reason too; checking here as well means the cashier
  // sees the rule in the form rather than as a Postgres error.
  reason: z.string().trim().min(1, "A written reason is required"),
});

export async function cancelCollection(formData: FormData): Promise<SaveResult> {
  const parsed = cancelSchema.safeParse({
    collectionId: formData.get("collectionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_collection", {
    p_collection_id: parsed.data.collectionId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/ledger/collections");
  return { ok: true };
}
```

Write `condoneCharge` and `recordOpeningBalance` the same way, validating with zod and surfacing the RPC's message on failure. The database is the authority on every rule here; the client-side schema exists to give a usable form, never to replace the check.

- [ ] **Step 3: Write the collection browser**

`ledger/collections/page.tsx`: OR number, collected date, collector, stall or payer, gross amount, status. Filter by business date and collector. A cancelled row renders struck through with its reason. The cancel action appears for supervisor and admin only.

**This screen is empty until Phase 3.** That is expected and correct — it is built now so that the morning the first tablet syncs, supervisors already have it, and so it was written against a tested engine rather than bolted on mid-Phase-3.

- [ ] **Step 4: Write the condonation dialog**

Reached from a charge row in the subsidiary ledger, admin only. Fields: amount (defaulting to the outstanding figure), ordinance reference, reason. All three are mandatory.

- [ ] **Step 5: Write the opening balances screen**

Admin only. Lists active leases with no opening balance yet, alongside those that have one. The form takes the reconciled amount, the oldest unpaid date and who reconciled it. Show the cutover date prominently and refuse a date on or after it in the form as well as in the database — this screen is used once, under time pressure, at go-live.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm --filter web build`

Manually: sign in as an accounting user and confirm the condone and cancel actions are absent; as an admin, confirm both work and the balances change.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/ledger/actions.ts apps/web/components/ledger/ \
        apps/web/app/\(admin\)/ledger/ apps/web/app/\(admin\)/layout.tsx
git commit -m "feat(web): collection browser, cancellation, condonation, opening balances

Every write goes through an RPC; none of these screens can insert into a
ledger table, because no web role holds INSERT on one. Client-side zod
validation exists to give a usable form, never to replace the database
check.

The collection browser is empty until Phase 3 by design: supervisors need
it the morning the first tablet syncs."
```

---

### Task 19: Regenerate types and run the whole suite

**Files:**
- Modify: `packages/shared/src/db.types.ts` (generated — do not hand-edit)

- [ ] **Step 1: Regenerate**

Run: `supabase gen types typescript --local --schema ceedo_collections > packages/shared/src/db.types.ts`

- [ ] **Step 2: Confirm the header survives**

Phase 1 put an AUTO-GENERATED header on this file. Check whether the generator stripped it; if so, restore it, and check the Phase 1 test that guards it still passes.

- [ ] **Step 3: Typecheck against the real types**

Run: `pnpm typecheck`

Any `as unknown as` casts needed in `apps/web/lib/ledger/queries.ts` are a signal the view's generated type is wrong, not a licence to cast. The handover already lists two such casts as deferred minors; do not add a third without a comment saying why.

- [ ] **Step 4: Run everything**

Run: `supabase db reset && pnpm test && pnpm typecheck && pnpm --filter web build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/db.types.ts
git commit -m "chore: regenerate database types for the Phase 2 ledger"
```

---

### Task 20: The scenario test and the handover

The test that stands in for the UI Phase 2 does not have. It has to pass before Phase 3 starts.

**Files:**
- Create: `tests/db/ledger-scenario.test.ts`
- Create: `docs/superpowers/phase-2-handover.md`

- [ ] **Step 1: Write the scenario test**

Create `tests/db/ledger-scenario.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL, createAppUser, createCollectionFixture, postCollectionAsOwner, signIn,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => { await db.end(); });

/**
 * A market month, driven end to end through the engine.
 *
 * Phase 2 ships no screen that posts a payment, so this test is what demonstrates the
 * ledger is correct. Every assertion at the end cross-checks two surfaces that compute
 * the same figure by different routes -- if the aging total and the lease balance ever
 * disagree, one of them is lying and this is where that becomes visible.
 */
describe("a market month", () => {
  it("keeps every surface agreeing on the same figures", async () => {
    await db.query("delete from ceedo_collections.settings");
    await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
    await db.query(
      "update ceedo_collections.fee_types set surcharge_bps = 300 where code = 'market_rental'",
    );

    const daily = await createCollectionFixture(db, {
      accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00",
    });
    const monthly = await createCollectionFixture(db, {
      accrualPeriod: "monthly", startDate: "2026-10-01", dueDay: 5, rateAmount: "1500.00",
    });

    // An opening balance on the daily stall: two years of paper arrears.
    const admin = await signIn(await createAppUser("admin"));
    await admin.rpc("record_opening_balance", {
      p_lease_id: daily.leaseId, p_amount: 9000.0,
      p_oldest_unpaid_date: "2024-09-01",
      p_authority_ref: "Reconciled paper ledger 2026-09-30",
    });

    // Accrue a month, then let it fall far enough past due to surcharge.
    await db.query("select ceedo_collections.run_accrual('2026-10-31')");
    await db.query("select ceedo_collections.run_surcharge('2026-12-15')");

    // FIFO must offer the opening balance first, ahead of every accrued day.
    const { rows: groups } = await db.query(
      "select * from ceedo_collections.unpaid_period_groups($1)", [daily.leaseId],
    );
    expect(groups[0].due_date.toISOString().slice(0, 10)).toBe("2024-09-01");
    expect(Number(groups[0].outstanding)).toBe(9000);

    // Settle the opening balance, then two days.
    await postCollectionAsOwner(db, daily, { groupRanks: [1], orNo: 5001 });
    await postCollectionAsOwner(db, daily, { groupRanks: [1, 2], orNo: 5002 });

    // One receipt is cancelled.
    const voided = await postCollectionAsOwner(db, daily, { groupRanks: [1], orNo: 5003 });
    await admin.rpc("cancel_collection", {
      p_collection_id: voided, p_reason: "Recorded against the wrong stall",
    });

    // One charge on the monthly lease is condoned under an ordinance.
    const { rows: monthlyCharges } = await db.query(
      `select id, amount from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'rental' limit 1`, [monthly.leaseId],
    );
    await admin.rpc("condone_charge", {
      p_charge_id: monthlyCharges[0].id, p_amount: Number(monthlyCharges[0].amount),
      p_authority_ref: "Ordinance 2026-114", p_reason: "Typhoon amnesty",
    });

    // --- Now every surface must agree. ---

    for (const leaseId of [daily.leaseId, monthly.leaseId]) {
      const { rows: agreement } = await db.query(
        `select
           (select coalesce(sum(outstanding), 0) from ceedo_collections.charge_balances
             where lease_id = $1 and not is_settled)          as from_charges,
           (select coalesce(outstanding, 0) from ceedo_collections.lease_balances
             where lease_id = $1)                             as from_lease_balances,
           (select coalesce(total, 0) from ceedo_collections.aging_of_receivables
             where lease_id = $1)                             as from_aging,
           (select coalesce(sum(outstanding), 0)
              from ceedo_collections.unpaid_period_groups($1)) as from_fifo`,
        [leaseId],
      );
      const a = agreement[0];
      expect(Number(a.from_lease_balances)).toBe(Number(a.from_charges));
      expect(Number(a.from_aging)).toBe(Number(a.from_charges));
      expect(Number(a.from_fifo)).toBe(Number(a.from_charges));
    }

    // The subsidiary ledger's closing running balance must equal the outstanding figure.
    const { rows: ledger } = await db.query(
      `select running_balance from ceedo_collections.subsidiary_ledger
        where lease_id = $1 order by entry_date, entry_type, source_id`, [daily.leaseId],
    );
    const { rows: balance } = await db.query(
      "select outstanding from ceedo_collections.lease_balances where lease_id = $1",
      [daily.leaseId],
    );
    expect(Number(ledger[ledger.length - 1].running_balance))
      .toBe(Number(balance[0].outstanding));

    // The condoned charge is settled without a single peso having been collected for it.
    const { rows: condoned } = await db.query(
      "select is_settled, allocated, condoned from ceedo_collections.charge_balances where id = $1",
      [monthlyCharges[0].id],
    );
    expect(condoned[0].is_settled).toBe(true);
    expect(Number(condoned[0].allocated)).toBe(0);

    // The cancelled receipt exists, is visibly void, and settled nothing.
    const { rows: void_ } = await db.query(
      `select cancelled, credit from ceedo_collections.subsidiary_ledger
        where source_id = $1`, [voided],
    );
    expect(void_[0].cancelled).toBe(true);
    expect(Number(void_[0].credit)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `supabase db reset && pnpm test`
Expected: everything green, including the scenario.

- [ ] **Step 3: Write the handover**

Create `docs/superpowers/phase-2-handover.md` covering, at minimum:

- What exists: table and function inventory, migration range `0011`–`0025`.
- **Before go-live:** enable `pg_cron` in the dashboard; set the real `cutover_date`; record an opening balance per lease from the reconciled paper ledger; confirm `accrual_health` shows no `missing` nights after the first week.
- **Mandatory for Phase 3:**
  - `sync-push` calls `post_collection()`. Do not reimplement §6.2.
  - Grant `EXECUTE` on `post_collection` to `ceedo_app` and **revoke it from `service_role`**.
  - A charge row does not change when it is paid — there is no `status` and no `UPDATE`. Sync pull must send *collections* on the `row_version` cursor and let the device recompute.
  - Ledger tables have no `INSERT` for any client role. Edge Functions write through the functions.
  - `run_accrual` logs failures and returns rather than raising; `accrual_health` is the alert surface.
- **Deferred:** materialised `charge_balances` if the views slow at volume; Excel and PDF export (Phase 6); amount-driven entry UI (Phase 4).

- [ ] **Step 4: Commit and open the PR**

```bash
git add tests/db/ledger-scenario.test.ts docs/superpowers/phase-2-handover.md
git commit -m "test: the market-month scenario, and the Phase 2 handover

Phase 2 ships no screen that posts a payment, so this scenario is what
demonstrates the ledger is correct. Every assertion cross-checks two
surfaces that reach the same figure by different routes: if aging and the
lease balance ever disagree, one is lying, and this is where it shows."
```

---

## Self-Review

Checked after writing, against `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md`.

**Spec coverage.** Every section maps to a task: §3.1 → Task 1; §3.2 → Task 7; §3.3–3.4 → Task 6; §3.5 → Task 2; §3.6 audit attachment → Tasks 6, 7 and 2; §3.7 privileges → Task 1's installer, proved by the checklist test extended in Tasks 6 and 7; §4 engine → Task 12; §4.1 → Task 8; §4.2 → Tasks 8 and 13; §5 accrual and surcharge → Tasks 5, 10, 15; §6 shared → Tasks 3, 11, 16; §7 web → Tasks 17, 18; §8 testing → distributed, with the scenario in Task 20; §9 risks → Task 15's `pg_cron` guard and Task 20's handover; §10 invariants → #15 Task 1, #16 Task 6, #17 Task 6, #18 Tasks 3 and 5, #19 Tasks 1 and 4, #20 Task 1.

**Placeholders.** None. Every code step carries the code. Tasks 17 and 18 describe three page components in prose rather than full TSX, which is a deliberate exception: they must follow the existing registry and gate conventions, and those files have to be read first — a made-up component here would be copied instead of the real pattern. Each of those steps names the exact files to read.

**Type consistency.** `charge_balances` exposes `outstanding`, `is_settled`, `allocated`, `condoned`, `days_overdue` and is referenced under those names in Tasks 9, 10, 12, 14 and 20. `unpaid_period_groups` returns `group_rank`, `due_date`, `period_start`, `period_end`, `charge_ids`, `outstanding`, used consistently in Tasks 8, 12 and 20. `generatePeriods` / `lease_periods` take the same six parameters in the same order in Tasks 3, 5 and 16. `post_collection` returns `{status, collection_id, gross_amount}` or `{status, reason, detail}`, matching `PostResult` in Task 11.

**Fixture helpers** accumulate in `tests/helpers/supabase.ts` across tasks: `createLeaseFixture` (Task 1, extended Task 5), `createCollectionFixture` (Task 6, extended Tasks 8 and 12), `postCollectionAsOwner` (Task 12), `createOutsider` (Task 14). Each task that extends one says so.

**Two deliberate orderings** that a reviewer should not "fix":
1. `charge_condonations` (Task 7) → `charge_balances` (Task 8) → `condone_charge` (Task 9). The table, the view that reads it, then the function that reads the view. Merging any two breaks the migration apply order.
2. `run_surcharge` (Task 10) comes after `charge_balances` so it can ask the view what "unpaid" means, rather than checking allocations by hand and getting condonations wrong.
