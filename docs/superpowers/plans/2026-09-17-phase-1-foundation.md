# CEEDO Collections — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the `ceedo_collections` Postgres schema with its security model, and a web admin where the office can register facilities, stalls, tenants, leases, rates, OR booklets and collector tablets.

**Architecture:** A pnpm monorepo with a Next.js web app and a pure-TypeScript `shared` package holding money arithmetic, rate resolution and OR validation. Postgres schema lives in plain SQL migrations under the Supabase CLI. Every table's access is gated by an `app_users` membership lookup rather than by Supabase's `authenticated` role, because `auth.users` is shared with unrelated projects on the same Supabase instance.

**Tech Stack:** pnpm 10 workspaces, Turborepo, TypeScript 5.7+, Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Supabase (Postgres 15 + Auth), Vitest 3, zod 4, Node 22 LTS.

**Spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Schema name is `ceedo_collections`.** Never `public`. Every object is schema-qualified.
- **Money is integer centavos in TypeScript and `numeric(14,2)` in Postgres.** Floats never touch a peso.
- **Rounding is half-up to the centavo**, never banker's rounding.
- **Percentage rates are stored as integer basis points**, never floats. 3% is `300`.
- **No RLS policy may rest on `auth.uid() IS NOT NULL`.** Every policy joins through `ceedo_collections.app_users`. `auth.users` is shared across the Supabase project, so any Google account signed in to an unrelated system is `authenticated` here too.
- **Every function and trigger sets `search_path = ceedo_collections, pg_temp`.**
- **Every synced table carries `row_version bigint`** fed by `ceedo_collections.row_version_seq` via trigger. The sync cursor is this sequence, never a timestamp.
- **`UPDATE` and `DELETE` are never granted on ledger tables** (`charges`, `collections`, `collection_allocations`, `collection_lines`). Phase 1 creates no ledger tables; Phase 2 must create them with these grants withheld from the start.
- **Edge Functions must not use `service_role`.** Phase 1 creates no Edge Functions; the restricted role `ceedo_app` is created here for Phase 3 to use.
- **Devices carry no `collector_id`.** Tablets are shared.
- **Node >= 22**, pnpm 10. Package manager is pinned via `packageManager` in the root `package.json`. (Ruled at pre-flight: the target machine runs Node v22.23.1 LTS; the stack supports it.)

## File Structure

```
ceedo-collections/
├── package.json                   root workspace + turbo scripts
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── .github/workflows/ci.yml
├── packages/shared/
│   ├── src/money.ts               centavo arithmetic, half-up rounding, basis points
│   ├── src/rates.ts               rate resolution by fee type, date, class
│   ├── src/booklets.ts            OR serial validation
│   ├── src/roles.ts               role union + permission predicates
│   ├── src/db.types.ts            generated from Postgres (do not hand-edit)
│   └── src/index.ts               public exports
├── apps/web/
│   ├── app/                       Next.js App Router
│   ├── lib/supabase/              browser + server clients, session helpers
│   ├── lib/admin/                 generic resource CRUD engine
│   └── middleware.ts              session refresh + invite-only gate
├── supabase/
│   ├── config.toml
│   └── migrations/                plain SQL, timestamp-prefixed
└── tests/
    ├── helpers/supabase.ts        role-scoped test clients
    └── db/                        RLS and constraint integration tests
```

`packages/shared` must never import from React Native, Next.js, or `@supabase/supabase-js`. It is pure TypeScript, runnable in Node, so the collector app can be rebuilt natively later without rewriting the rules.

---

### Task 1: Monorepo scaffold, tooling and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm test`, `pnpm typecheck`, `pnpm build` run across all workspaces. `@ceedo/shared` resolves as a workspace package.

- [ ] **Step 1: Create the workspace manifest files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json`:

```json
{
  "name": "ceedo-collections",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:start": "supabase start",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local --schema ceedo_collections > packages/shared/src/db.types.ts"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^24.0.0"
  }
}
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

`vitest.workspace.ts`:

```ts
export default ["packages/*"];
```

Only list directories that exist. Vitest exits non-zero on a workspace glob that
matches nothing, so `tests` is added by Task 3 and `apps/web` by Task 11, each when
it creates that directory.

`.gitignore`:

```
node_modules/
.next/
dist/
.turbo/
.env
.env.local
*.log
supabase/.branches/
supabase/.temp/
```

- [ ] **Step 2: Create the shared package**

`packages/shared/package.json`:

```json
{
  "name": "@ceedo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc --emitDeclarationOnly --outDir dist"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" },
  "dependencies": { "zod": "^4.0.0" }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

`packages/shared/src/index.ts`:

```ts
export const PACKAGE_NAME = "@ceedo/shared";
```

- [ ] **Step 3: Install and verify the workspace resolves**

Run: `pnpm install && pnpm typecheck`
Expected: install succeeds, typecheck passes with no errors.

- [ ] **Step 4: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start
      # Exports API_URL, ANON_KEY and SERVICE_ROLE_KEY, which the test helpers read.
      - run: supabase status -o env >> "$GITHUB_ENV"
      - run: pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with turbo, vitest and CI"
```

---

### Task 2: Money arithmetic in `@ceedo/shared`

Integer centavos with half-up rounding. This is Global Constraint 2, 3 and 4, and every amount in the system flows through it.

**Files:**
- Create: `packages/shared/src/money.ts`
- Create: `packages/shared/src/money.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Centavos = number & { readonly __brand: "Centavos" }`
  - `fromPesos(pesos: number): Centavos`
  - `fromCentavos(n: number): Centavos`
  - `multiply(amount: Centavos, quantity: number): Centavos`
  - `applyBasisPoints(amount: Centavos, bps: number): Centavos`
  - `sum(amounts: readonly Centavos[]): Centavos`
  - `format(amount: Centavos): string`
  - `parsePesoInput(input: string): Centavos`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  format,
  fromCentavos,
  fromPesos,
  multiply,
  parsePesoInput,
  sum,
} from "./money.js";

describe("fromPesos", () => {
  it("converts whole pesos to centavos", () => {
    expect(fromPesos(120)).toBe(12000);
  });

  it("converts two-decimal pesos exactly", () => {
    expect(fromPesos(123.45)).toBe(12345);
  });

  it("rounds a third decimal half-up", () => {
    expect(fromPesos(1.005)).toBe(101);
  });

  it("rejects a non-finite amount", () => {
    expect(() => fromPesos(Number.NaN)).toThrow(/finite/);
  });
});

describe("multiply", () => {
  it("multiplies by an integer quantity exactly", () => {
    expect(multiply(fromPesos(85), 12)).toBe(102000);
  });

  it("rejects a fractional quantity", () => {
    expect(() => multiply(fromPesos(85), 1.5)).toThrow(/integer/);
  });

  it("rejects a negative quantity", () => {
    expect(() => multiply(fromPesos(85), -1)).toThrow(/negative/);
  });
});

describe("applyBasisPoints", () => {
  it("computes 3% of a round amount", () => {
    expect(applyBasisPoints(fromPesos(120), 300)).toBe(360);
  });

  it("rounds a half-centavo result up rather than down", () => {
    // 8350 centavos x 3% = 250.5 centavos exactly. Half-up gives 251.
    // Floating point (0.03 * 8350) yields 250.49999999999997 and would give 250.
    expect(applyBasisPoints(fromCentavos(8350), 300)).toBe(251);
  });

  it("computes 3% of an odd amount", () => {
    expect(applyBasisPoints(fromCentavos(12345), 300)).toBe(370);
  });

  it("returns zero for a zero rate", () => {
    expect(applyBasisPoints(fromPesos(120), 0)).toBe(0);
  });

  it("rejects a fractional basis-point rate", () => {
    expect(() => applyBasisPoints(fromPesos(120), 300.5)).toThrow(/integer/);
  });
});

describe("sum", () => {
  it("adds a list of amounts", () => {
    expect(sum([fromPesos(120), fromPesos(85), fromCentavos(50)])).toBe(20550);
  });

  it("returns zero for an empty list", () => {
    expect(sum([])).toBe(0);
  });
});

describe("format", () => {
  it("formats with a peso sign, thousands separators and two decimals", () => {
    expect(format(fromCentavos(123456))).toBe("₱1,234.56");
  });

  it("formats zero", () => {
    expect(format(fromCentavos(0))).toBe("₱0.00");
  });
});

describe("parsePesoInput", () => {
  it("parses a plain decimal", () => {
    expect(parsePesoInput("123.45")).toBe(12345);
  });

  it("parses input with a peso sign and separators", () => {
    expect(parsePesoInput("₱1,234.56")).toBe(123456);
  });

  it("rejects unparseable input", () => {
    expect(() => parsePesoInput("abc")).toThrow(/amount/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/shared/src/money.test.ts`
Expected: FAIL — cannot resolve `./money.js`.

- [ ] **Step 3: Implement the money module**

`packages/shared/src/money.ts`:

```ts
/**
 * Money is integer centavos everywhere in this codebase. Floats never touch a peso.
 * Rounding is half-up to the centavo, never banker's rounding, so figures match
 * manual computation.
 */
export type Centavos = number & { readonly __brand: "Centavos" };

/**
 * Rounds half away from zero. All amounts here are non-negative in practice.
 *
 * The `toFixed(9)` is not cosmetic. A value that is mathematically x.5 may be
 * stored as x.49999999999999 — `1.005 * 100` is `100.49999999999999` — and
 * `floor(x + 0.5)` would then round it DOWN, silently breaking half-up on
 * exactly the inputs the rule exists for. Normalising to 9 decimal places first
 * restores the intended decimal value; 9 is far below the precision at which a
 * genuine sub-half value could be promoted, and far above any peso amount's
 * significant digits.
 */
function roundHalfUp(value: number): number {
  const normalised = Number(value.toFixed(9));
  return Math.sign(normalised) * Math.floor(Math.abs(normalised) + 0.5);
}

export function fromCentavos(n: number): Centavos {
  if (!Number.isFinite(n)) throw new Error("Centavo amount must be finite");
  if (!Number.isInteger(n)) throw new Error("Centavo amount must be an integer");
  return n as Centavos;
}

export function fromPesos(pesos: number): Centavos {
  if (!Number.isFinite(pesos)) throw new Error("Peso amount must be finite");
  return roundHalfUp(pesos * 100) as Centavos;
}

export function multiply(amount: Centavos, quantity: number): Centavos {
  if (!Number.isInteger(quantity)) throw new Error("Quantity must be an integer");
  if (quantity < 0) throw new Error("Quantity must not be negative");
  return (amount * quantity) as Centavos;
}

/**
 * Applies a rate expressed in integer basis points (3% is 300).
 *
 * Integer arithmetic throughout: `(amount * bps + 5000) / 10000` floored. Using a
 * float rate would misround exact half-centavo results, because 0.03 * 8350 is
 * 250.49999999999997 in IEEE 754 and floors to 250 rather than the correct 251.
 */
export function applyBasisPoints(amount: Centavos, bps: number): Centavos {
  if (!Number.isInteger(bps)) throw new Error("Basis points must be an integer");
  if (bps < 0) throw new Error("Basis points must not be negative");
  return Math.floor((amount * bps + 5000) / 10000) as Centavos;
}

export function sum(amounts: readonly Centavos[]): Centavos {
  return amounts.reduce<number>((total, amount) => total + amount, 0) as Centavos;
}

const PESO_FORMAT = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function format(amount: Centavos): string {
  return `₱${PESO_FORMAT.format(amount / 100)}`;
}

export function parsePesoInput(input: string): Centavos {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) {
    throw new Error(`Not a valid peso amount: ${input}`);
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Not a valid peso amount: ${input}`);
  return fromPesos(parsed);
}
```

- [ ] **Step 4: Export from the package index**

`packages/shared/src/index.ts`:

```ts
export * from "./money.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/shared/src/money.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): centavo money arithmetic with half-up basis-point rounding"
```

---

### Task 3: Supabase schema bootstrap

Creates the `ceedo_collections` schema, the row-version sequence and trigger, and the restricted `ceedo_app` role that Phase 3's Edge Functions will connect as instead of `service_role`.

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `supabase/migrations/20260917000001_schema_bootstrap.sql`
- Create: `tests/helpers/supabase.ts`
- Create: `tests/db/bootstrap.test.ts`
- Create: `tests/package.json`, `tests/tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - Schema `ceedo_collections`, exposed via PostgREST
  - `ceedo_collections.row_version_seq`
  - `ceedo_collections.bump_row_version()` trigger function
  - `ceedo_collections.touch_updated_at()` trigger function
  - Role `ceedo_app`
  - `serviceClient()` and `anonClient()` test helpers

- [ ] **Step 1: Initialise Supabase locally**

```bash
supabase init
supabase start
```

Then edit `supabase/config.toml` so PostgREST exposes the schema — without this every request returns a 404 that looks nothing like a configuration problem:

```toml
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public", "ceedo_collections"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
```

- [ ] **Step 2: Write the bootstrap migration**

`supabase/migrations/20260917000001_schema_bootstrap.sql`:

```sql
-- Schema, shared row-version sequence, common triggers, restricted app role.
-- Global constraint: every function sets search_path explicitly. Unqualified names
-- on a multi-schema instance are a search-path injection vector.

create schema if not exists ceedo_collections;

create extension if not exists btree_gist with schema extensions;

-- The sync cursor. A single sequence across every synced table, never a timestamp:
-- timestamps break on clock skew and same-millisecond writes, and the failure mode
-- is a silently skipped row.
create sequence if not exists ceedo_collections.row_version_seq as bigint;

create or replace function ceedo_collections.bump_row_version()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  new.row_version := nextval('ceedo_collections.row_version_seq');
  return new;
end;
$$;

create or replace function ceedo_collections.touch_updated_at()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Restricted role for Phase 3 Edge Functions. service_role bypasses RLS across
-- EVERY schema on this shared instance, so a bug in the sync function could reach
-- another project's tables. This role can only see ours.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ceedo_app') then
    create role ceedo_app nologin;
  end if;
end;
$$;

grant usage on schema ceedo_collections to ceedo_app, anon, authenticated, service_role;

alter default privileges in schema ceedo_collections
  grant select on tables to anon, authenticated;
alter default privileges in schema ceedo_collections
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema ceedo_collections
  grant usage, select on sequences to anon, authenticated, service_role, ceedo_app;

-- ALTER DEFAULT PRIVILEGES applies only to objects created AFTER it runs. row_version_seq
-- was created above, so it needs an explicit grant or next_row_version() fails with
-- "42501 permission denied for sequence row_version_seq".
grant usage, select on sequence ceedo_collections.row_version_seq
  to anon, authenticated, service_role, ceedo_app;
```

- [ ] **Step 3: Create the test workspace and Supabase helpers**

First register the `tests` directory in both workspace files. Task 1 scoped each to
what existed at the time.

`vitest.workspace.ts`:

```ts
export default ["packages/*", "tests"];
```

`pnpm-workspace.yaml` — without this, `"@ceedo/shared": "workspace:*"` in
`tests/package.json` cannot resolve:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tests"
```

`tests/package.json`:

```json
{
  "name": "@ceedo/tests",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "@supabase/supabase-js": "^2.48.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "dependencies": { "@ceedo/shared": "workspace:*" }
}
```

`tests/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["vitest/globals", "node"] },
  "include": ["**/*.ts"]
}
```

`pnpm typecheck` runs across every workspace package, so `tests` must typecheck
cleanly. If `@supabase/supabase-js` options or client generics collide with
`exactOptionalPropertyTypes`, prefer dropping explicit return-type annotations and
letting inference work over loosening the compiler flag — the flag is a global
constraint and the helpers are the only place it bites.

`tests/helpers/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE_KEY, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** An unauthenticated client. */
export function anonClient(): SupabaseClient {
  return createClient(URL, ANON_KEY, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Write the failing bootstrap test**

`tests/db/bootstrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

describe("schema bootstrap", () => {
  it("exposes the ceedo_collections schema through PostgREST", async () => {
    // A query against a schema PostgREST does not expose fails with a schema error
    // rather than a missing-table error.
    const { error } = await serviceClient().from("app_users").select("id").limit(1);
    expect(error?.message ?? "").not.toMatch(/schema must be one of/i);
  });

  it("issues strictly increasing row versions", async () => {
    const client = serviceClient();
    const first = await client.rpc("next_row_version");
    const second = await client.rpc("next_row_version");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(Number(second.data)).toBeGreaterThan(Number(first.data));
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `eval $(supabase status -o env) && pnpm vitest run tests/db/bootstrap.test.ts`
Expected: FAIL — `next_row_version` does not exist.

- [ ] **Step 6: Add the sequence accessor to the migration**

Append to `supabase/migrations/20260917000001_schema_bootstrap.sql`:

```sql
-- Exposed so tests and Phase 3 sync can read the cursor without direct sequence access.
create or replace function ceedo_collections.next_row_version()
returns bigint
language sql
volatile
set search_path = ceedo_collections, pg_temp
as $$
  select nextval('ceedo_collections.row_version_seq');
$$;

grant execute on function ceedo_collections.next_row_version() to service_role;
```

- [ ] **Step 7: Reset the database and re-run**

Run: `supabase db reset && pnpm vitest run tests/db/bootstrap.test.ts`
Expected: PASS — 2 tests. The first test passes because the schema is exposed even though `app_users` does not exist yet; it asserts on the schema error, not on the table.

- [ ] **Step 8: Commit**

```bash
git add supabase tests
git commit -m "feat(db): bootstrap ceedo_collections schema, row-version sequence and restricted role"
```

---

### Task 4: `app_users`, roles, and the membership gate

The security foundation. `auth.users` is shared across the Supabase project, so a Google account signed in to an unrelated system is `authenticated` here. Authentication establishes *who*; the `app_users` row establishes *whether*.

**Files:**
- Create: `supabase/migrations/20260917000002_app_users.sql`
- Create: `packages/shared/src/roles.ts`, `packages/shared/src/roles.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `tests/helpers/supabase.ts`
- Create: `tests/db/membership-gate.test.ts`

**Interfaces:**
- Consumes: Task 3's schema and trigger functions
- Produces:
  - Table `ceedo_collections.app_users`
  - Enum `ceedo_collections.app_role` = `collector | supervisor | accounting | admin`
  - `ceedo_collections.active_role()` returning `app_role` or null
  - `ceedo_collections.is_admin()`, `ceedo_collections.has_role(variadic app_role[])`
  - Test helper `createAppUser({ email, role, employeeNo?, fullName? })` returning `{ client, userId }`
  - Test helper `createOutsiderClient()` — authenticated with no `app_users` row
  - `Role` union and `can()` predicates in `@ceedo/shared`

- [ ] **Step 1: Write the failing membership-gate tests**

`tests/db/membership-gate.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAppUser,
  createOutsiderClient,
  resetFixtures,
  serviceClient,
} from "../helpers/supabase.js";

describe("membership gate", () => {
  beforeAll(async () => {
    await resetFixtures();
  });

  it("denies a signed-in user who has no app_users row", async () => {
    // This is the whole point: auth.users is shared with unrelated projects.
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.from("app_users").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns null from active_role() for an outsider", async () => {
    const outsider = await createOutsiderClient();
    const { data } = await outsider.rpc("active_role");
    expect(data).toBeNull();
  });

  it("lets a registered user read their own row", async () => {
    const { client, userId } = await createAppUser({
      email: "collector1@example.com",
      role: "collector",
    });
    const { data } = await client.from("app_users").select("id, role");
    expect(data).toEqual([{ id: userId, role: "collector" }]);
  });

  it("returns the caller's role from active_role()", async () => {
    const { client } = await createAppUser({
      email: "supervisor1@example.com",
      role: "supervisor",
    });
    const { data } = await client.rpc("active_role");
    expect(data).toBe("supervisor");
  });

  it("hides other users' rows from a collector", async () => {
    await createAppUser({ email: "collector2@example.com", role: "collector" });
    const { client } = await createAppUser({
      email: "collector3@example.com",
      role: "collector",
    });
    const { data } = await client.from("app_users").select("id");
    expect(data).toHaveLength(1);
  });

  it("lets an admin read every user", async () => {
    const { client } = await createAppUser({ email: "admin1@example.com", role: "admin" });
    const { data } = await client.from("app_users").select("id");
    expect((data ?? []).length).toBeGreaterThan(1);
  });

  it("treats a suspended user as having no role", async () => {
    const { client, userId } = await createAppUser({
      email: "suspended1@example.com",
      role: "accounting",
    });
    await serviceClient().from("app_users").update({ status: "suspended" }).eq("id", userId);
    const { data } = await client.rpc("active_role");
    expect(data).toBeNull();
  });

  it("refuses a collector attempting to promote themselves", async () => {
    const { client, userId } = await createAppUser({
      email: "collector4@example.com",
      role: "collector",
    });

    await client.from("app_users").update({ role: "admin" }).eq("id", userId);

    // Assert the stored role, not an error. An UPDATE filtered out by a policy's
    // USING clause affects zero rows and returns no error at all — only a WITH CHECK
    // violation raises 42501. Asserting on the error would fail while the security
    // property it is meant to protect holds perfectly well.
    const { data } = await serviceClient()
      .from("app_users")
      .select("role")
      .eq("id", userId)
      .single();
    expect(data!.role).toBe("collector");
  });
});
```

- [ ] **Step 2: Extend the test helpers**

Add `import { randomUUID } from "node:crypto";` to the **top** of
`tests/helpers/supabase.ts` alongside the existing imports, then append the rest:

```ts

export type Role = "collector" | "supervisor" | "accounting" | "admin";

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
  const userId = await createAuthUser(opts.email);
  const { error } = await serviceClient().from("app_users").insert({
    id: userId,
    employee_no: opts.employeeNo ?? `E-${randomUUID().slice(0, 8)}`,
    full_name: opts.fullName ?? opts.email,
    role: opts.role,
    status: "active",
  });
  if (error) throw new Error(`Could not create app_user: ${error.message}`);
  return { client: await signIn(opts.email), userId };
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/db/membership-gate.test.ts`
Expected: FAIL — relation `app_users` does not exist.

- [ ] **Step 4: Write the migration**

`supabase/migrations/20260917000002_app_users.sql`:

```sql
create type ceedo_collections.app_role as enum
  ('collector', 'supervisor', 'accounting', 'admin');

create type ceedo_collections.user_status as enum ('active', 'suspended');

create table ceedo_collections.app_users (
  id          uuid primary key references auth.users (id) on delete restrict,
  employee_no text not null unique,
  full_name   text not null,
  role        ceedo_collections.app_role not null,
  pin_hash    text,
  status      ceedo_collections.user_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create index app_users_role_idx on ceedo_collections.app_users (role) where status = 'active';

create trigger app_users_row_version
  before insert or update on ceedo_collections.app_users
  for each row execute function ceedo_collections.bump_row_version();

create trigger app_users_updated_at
  before update on ceedo_collections.app_users
  for each row execute function ceedo_collections.touch_updated_at();

-- THE GATE. Every policy in this schema routes through here. Note it never asks
-- whether the caller is authenticated — auth.users is shared with unrelated systems
-- on this Supabase project, so being signed in proves nothing about access here.
--
-- security definer because the function reads app_users while app_users' own policies
-- are being evaluated.
create or replace function ceedo_collections.active_role()
returns ceedo_collections.app_role
language sql
stable
security definer
set search_path = ceedo_collections, pg_temp
as $$
  select role
  from ceedo_collections.app_users
  where id = auth.uid() and status = 'active';
$$;

create or replace function ceedo_collections.has_role(variadic roles ceedo_collections.app_role[])
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select ceedo_collections.active_role() = any(roles);
$$;

create or replace function ceedo_collections.is_admin()
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select ceedo_collections.active_role() = 'admin';
$$;

alter table ceedo_collections.app_users enable row level security;

create policy app_users_read_self on ceedo_collections.app_users
  for select to authenticated
  using (id = auth.uid() and status = 'active');

create policy app_users_read_all on ceedo_collections.app_users
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

create policy app_users_admin_write on ceedo_collections.app_users
  for all to authenticated
  using (ceedo_collections.is_admin())
  with check (ceedo_collections.is_admin());

grant select on ceedo_collections.app_users to authenticated;
grant insert, update, delete on ceedo_collections.app_users to authenticated;
grant execute on function ceedo_collections.active_role() to authenticated, anon;
grant execute on function ceedo_collections.has_role(variadic ceedo_collections.app_role[]) to authenticated;
grant execute on function ceedo_collections.is_admin() to authenticated;
```

- [ ] **Step 5: Reset and run the tests**

Run: `supabase db reset && pnpm vitest run tests/db/membership-gate.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Add the role predicates to `@ceedo/shared`**

`packages/shared/src/roles.ts`:

```ts
export const ROLES = ["collector", "supervisor", "accounting", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Roles permitted to sign in to the web application. Collectors use the tablet only. */
export const WEB_ROLES: readonly Role[] = ["supervisor", "accounting", "admin"];

export function canUseWeb(role: Role): boolean {
  return WEB_ROLES.includes(role);
}

export function canManageMasterData(role: Role): boolean {
  return role === "admin";
}

export function canResolveExceptions(role: Role): boolean {
  return role === "supervisor" || role === "admin";
}

export function canVerifyRemittance(role: Role): boolean {
  return role === "accounting" || role === "admin";
}

export function canViewReports(role: Role): boolean {
  return role !== "collector";
}
```

`packages/shared/src/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canManageMasterData,
  canResolveExceptions,
  canUseWeb,
  canViewReports,
  ROLES,
} from "./roles.js";

describe("role predicates", () => {
  it("keeps collectors out of the web application", () => {
    expect(canUseWeb("collector")).toBe(false);
  });

  it("admits supervisors, accounting and admins to the web application", () => {
    expect(canUseWeb("supervisor")).toBe(true);
    expect(canUseWeb("accounting")).toBe(true);
    expect(canUseWeb("admin")).toBe(true);
  });

  it("restricts master data to admins", () => {
    expect(ROLES.filter(canManageMasterData)).toEqual(["admin"]);
  });

  it("allows supervisors and admins to resolve exceptions", () => {
    expect(ROLES.filter(canResolveExceptions)).toEqual(["supervisor", "admin"]);
  });

  it("hides reports from collectors only", () => {
    expect(ROLES.filter((role) => !canViewReports(role))).toEqual(["collector"]);
  });
});
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./money.js";
export * from "./roles.js";
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`
Expected: PASS — money, roles and database tests.

- [ ] **Step 8: Commit**

```bash
git add supabase packages tests
git commit -m "feat(db): app_users membership gate with role predicates and RLS tests"
```

---

### Task 5: Facilities, sections and stalls

**Files:**
- Create: `supabase/migrations/20260917000003_facilities.sql`
- Create: `tests/db/facilities.test.ts`

**Interfaces:**
- Consumes: `active_role()`, `is_admin()`, `has_role()`, `bump_row_version()` from Tasks 3–4
- Produces:
  - `ceedo_collections.apply_master_data_policies(table_name text)` — reusable policy installer, used by Tasks 6–9
  - Enum `facility_type` = `market | terminal | parking | slaughterhouse`
  - Enum `accrual_period` = `daily | weekly | monthly`
  - Tables `facilities`, `sections`, `stalls`

- [ ] **Step 1: Write the failing tests**

`tests/db/facilities.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

describe("facilities, sections and stalls", () => {
  let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];
  let collectorClient: Awaited<ReturnType<typeof createAppUser>>["client"];

  beforeAll(async () => {
    adminClient = (await createAppUser({ email: "fac-admin@example.com", role: "admin" })).client;
    collectorClient = (await createAppUser({ email: "fac-col@example.com", role: "collector" }))
      .client;
  });

  it("lets an admin create a facility", async () => {
    const { error } = await adminClient
      .from("facilities")
      .insert({ name: "Central Public Market", code: "CPM", type: "market" });
    expect(error).toBeNull();
  });

  it("refuses a collector creating a facility", async () => {
    const { error } = await collectorClient
      .from("facilities")
      .insert({ name: "Rogue Market", code: "RGM", type: "market" });
    expect(error).not.toBeNull();
  });

  it("lets a collector read facilities", async () => {
    const { data, error } = await collectorClient.from("facilities").select("code");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("rejects a section on a non-market facility", async () => {
    const service = serviceClient();
    const { data: terminal } = await service
      .from("facilities")
      .insert({ name: "IBJT", code: "IBJT", type: "terminal" })
      .select("id")
      .single();
    const { error } = await service
      .from("sections")
      .insert({ facility_id: terminal!.id, name: "Bay 1", default_accrual_period: "daily" });
    expect(error?.message ?? "").toMatch(/market/i);
  });

  it("bumps row_version on every update", async () => {
    const service = serviceClient();
    const { data: created } = await service
      .from("facilities")
      .insert({ name: "Satellite Market", code: "SAT", type: "market" })
      .select("id, row_version")
      .single();
    const { data: updated } = await service
      .from("facilities")
      .update({ name: "Satellite Market Annex" })
      .eq("id", created!.id)
      .select("row_version")
      .single();
    expect(Number(updated!.row_version)).toBeGreaterThan(Number(created!.row_version));
  });

  it("enforces unique stall numbers within a section", async () => {
    const service = serviceClient();
    const { data: facility } = await service
      .from("facilities")
      .insert({ name: "Dup Market", code: "DUP", type: "market" })
      .select("id")
      .single();
    const { data: section } = await service
      .from("sections")
      .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
      .select("id")
      .single();
    await service.from("stalls").insert({ section_id: section!.id, stall_no: "F-01" });
    const { error } = await service
      .from("stalls")
      .insert({ section_id: section!.id, stall_no: "F-01" });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/db/facilities.test.ts`
Expected: FAIL — relation `facilities` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260917000003_facilities.sql`:

```sql
-- Reusable policy installer. Master data reads to any registered staff member,
-- writes to admins only. Used by every master-data table in Phase 1 so the gate
-- is applied identically rather than retyped and subtly varied.
create or replace function ceedo_collections.apply_master_data_policies(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format('alter table ceedo_collections.%I enable row level security', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for select to authenticated
       using (ceedo_collections.active_role() is not null)',
    table_name || '_read', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for all to authenticated
       using (ceedo_collections.is_admin())
       with check (ceedo_collections.is_admin())',
    table_name || '_admin_write', table_name);

  execute format(
    'grant select, insert, update, delete on ceedo_collections.%I to authenticated',
    table_name);

  execute format(
    'create trigger %I before insert or update on ceedo_collections.%I
       for each row execute function ceedo_collections.bump_row_version()',
    table_name || '_row_version', table_name);
end;
$$;

create type ceedo_collections.facility_type as enum
  ('market', 'terminal', 'parking', 'slaughterhouse');

create type ceedo_collections.accrual_period as enum ('daily', 'weekly', 'monthly');

create table ceedo_collections.facilities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  type        ceedo_collections.facility_type not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

-- Only market facilities have sections and stalls. The terminal, parking areas and
-- the slaughterhouse are collection points with no tenancies.
create table ceedo_collections.sections (
  id                     uuid primary key default gen_random_uuid(),
  facility_id            uuid not null references ceedo_collections.facilities (id),
  name                   text not null,
  default_accrual_period ceedo_collections.accrual_period not null,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  row_version            bigint not null default 0,
  unique (facility_id, name)
);

create or replace function ceedo_collections.assert_market_facility()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  facility_kind ceedo_collections.facility_type;
begin
  select type into facility_kind
  from ceedo_collections.facilities where id = new.facility_id;

  if facility_kind is distinct from 'market' then
    raise exception 'Sections may only belong to a market facility, not %', facility_kind
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sections_market_only
  before insert or update on ceedo_collections.sections
  for each row execute function ceedo_collections.assert_market_facility();

create table ceedo_collections.stalls (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references ceedo_collections.sections (id),
  stall_no    text not null,
  area_sqm    numeric(8,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (section_id, stall_no)
);

create index sections_facility_idx on ceedo_collections.sections (facility_id);
create index stalls_section_idx on ceedo_collections.stalls (section_id);

select ceedo_collections.apply_master_data_policies('facilities');
select ceedo_collections.apply_master_data_policies('sections');
select ceedo_collections.apply_master_data_policies('stalls');
```

- [ ] **Step 4: Reset and run**

Run: `supabase db reset && pnpm vitest run tests/db/facilities.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase tests
git commit -m "feat(db): facilities, sections and stalls with reusable master-data policies"
```

---

### Task 6: Tenants and leases

Leases, not stalls, are the billing unit. A stall may be re-let many times and each tenant's history must survive that, so an exclusion constraint prevents two active leases overlapping on one stall.

**Files:**
- Create: `supabase/migrations/20260917000004_tenants_leases.sql`
- Create: `tests/db/leases.test.ts`

**Interfaces:**
- Consumes: `apply_master_data_policies()` from Task 5; `stalls`
- Produces: Tables `tenants`, `leases`; enum `lease_status` = `active | ended | terminated`

- [ ] **Step 1: Write the failing tests**

`tests/db/leases.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

async function makeStall(code: string): Promise<string> {
  const { data: facility } = await service
    .from("facilities")
    .insert({ name: `Market ${code}`, code, type: "market" })
    .select("id")
    .single();
  const { data: section } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
    .select("id")
    .single();
  const { data: stall } = await service
    .from("stalls")
    .insert({ section_id: section!.id, stall_no: "F-01" })
    .select("id")
    .single();
  return stall!.id as string;
}

async function makeTenant(name: string): Promise<string> {
  const { data } = await service.from("tenants").insert({ full_name: name }).select("id").single();
  return data!.id as string;
}

describe("leases", () => {
  let stallId: string;

  beforeAll(async () => {
    stallId = await makeStall("LEA");
  });

  it("accepts an active lease on a vacant stall", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Aling Nena"),
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      rate_amount: 120.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("refuses a second active lease overlapping the same stall", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Mang Tonyo"),
      start_date: "2026-06-01",
      end_date: "2026-12-31",
      rate_amount: 130.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).not.toBeNull();
  });

  it("allows a later lease that starts after the previous one ends", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Aling Rosa"),
      start_date: "2026-07-01",
      end_date: "2026-12-31",
      rate_amount: 130.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("ignores ended leases when checking overlap", async () => {
    const endedStall = await makeStall("END");
    await service.from("leases").insert({
      stall_id: endedStall,
      tenant_id: await makeTenant("Former Tenant"),
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      rate_amount: 100.0,
      accrual_period: "daily",
      status: "ended",
    });
    const { error } = await service.from("leases").insert({
      stall_id: endedStall,
      tenant_id: await makeTenant("New Tenant"),
      start_date: "2026-03-01",
      end_date: "2026-12-31",
      rate_amount: 110.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("rejects an end date before the start date", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: await makeStall("BAD"),
      tenant_id: await makeTenant("Backwards"),
      start_date: "2026-12-31",
      end_date: "2026-01-01",
      rate_amount: 100.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).not.toBeNull();
  });

  it("requires a due_day for a monthly lease", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: await makeStall("MON"),
      tenant_id: await makeTenant("Monthly Tenant"),
      start_date: "2026-01-01",
      end_date: null,
      rate_amount: 3000.0,
      accrual_period: "monthly",
      due_day: null,
      status: "active",
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/db/leases.test.ts`
Expected: FAIL — relation `tenants` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260917000004_tenants_leases.sql`:

```sql
create type ceedo_collections.lease_status as enum ('active', 'ended', 'terminated');

create table ceedo_collections.tenants (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  address     text,
  contact_no  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.leases (
  id             uuid primary key default gen_random_uuid(),
  stall_id       uuid not null references ceedo_collections.stalls (id),
  tenant_id      uuid not null references ceedo_collections.tenants (id),
  start_date     date not null,
  end_date       date,
  rate_amount    numeric(14,2) not null check (rate_amount >= 0),
  accrual_period ceedo_collections.accrual_period not null,
  -- Day of month a monthly charge falls due. Meaningless for daily and weekly
  -- accrual; required for monthly, because the surcharge clock starts from it.
  due_day        smallint check (due_day between 1 and 28),
  status         ceedo_collections.lease_status not null default 'active',
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0,

  constraint leases_dates_ordered
    check (end_date is null or end_date >= start_date),

  constraint leases_monthly_needs_due_day
    check (accrual_period <> 'monthly' or due_day is not null),

  -- One active tenancy per stall at a time. 'infinity' models an open-ended lease.
  constraint leases_no_active_overlap
    exclude using gist (
      stall_id with =,
      daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
    ) where (status = 'active')
);

create index leases_tenant_idx on ceedo_collections.leases (tenant_id);
create index leases_stall_active_idx on ceedo_collections.leases (stall_id) where status = 'active';

select ceedo_collections.apply_master_data_policies('tenants');
select ceedo_collections.apply_master_data_policies('leases');
```

- [ ] **Step 4: Reset and run**

Run: `supabase db reset && pnpm vitest run tests/db/leases.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase tests
git commit -m "feat(db): tenants and leases with active-overlap exclusion constraint"
```

---

### Task 7: Fee types, rates and rate resolution

Rate rows are never updated in place — a new ordinance inserts a new row with an effectivity date, so historical receipts still recompute correctly. Resolution is a pure function in `@ceedo/shared` so the collector app and the server agree by construction.

**Files:**
- Create: `supabase/migrations/20260917000005_rates.sql`
- Create: `packages/shared/src/rates.ts`, `packages/shared/src/rates.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `tests/db/rates.test.ts`

**Interfaces:**
- Consumes: `apply_master_data_policies()` from Task 5; `Centavos`, `fromPesos` from Task 2
- Produces:
  - Tables `fee_types`, `rates`; enum `rate_basis`
  - `type RateBasis = "per_day" | "per_week" | "per_month" | "per_entry" | "per_head" | "per_sqm"`
  - `interface RateRow { id: string; feeTypeId: string; rateClass: string; effectiveFrom: string; effectiveTo: string | null; amount: Centavos; basis: RateBasis }`
  - `resolveRate(rates: readonly RateRow[], feeTypeId: string, on: string, rateClass?: string): RateRow`
  - `RateNotFoundError`

- [ ] **Step 1: Write the failing unit tests**

`packages/shared/src/rates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "./money.js";
import { RateNotFoundError, resolveRate, type RateRow } from "./rates.js";

const rate = (over: Partial<RateRow> & Pick<RateRow, "id" | "effectiveFrom">): RateRow => ({
  feeTypeId: "market-daily",
  rateClass: "",
  effectiveTo: null,
  amount: fromPesos(120),
  basis: "per_day",
  ...over,
});

describe("resolveRate", () => {
  it("returns the rate in force on the given date", () => {
    const rates = [
      rate({ id: "old", effectiveFrom: "2024-01-01", effectiveTo: "2025-12-31", amount: fromPesos(100) }),
      rate({ id: "new", effectiveFrom: "2026-01-01", amount: fromPesos(120) }),
    ];
    expect(resolveRate(rates, "market-daily", "2026-05-01").id).toBe("new");
  });

  it("returns the historical rate for a past date", () => {
    const rates = [
      rate({ id: "old", effectiveFrom: "2024-01-01", effectiveTo: "2025-12-31", amount: fromPesos(100) }),
      rate({ id: "new", effectiveFrom: "2026-01-01", amount: fromPesos(120) }),
    ];
    expect(resolveRate(rates, "market-daily", "2025-06-01").amount).toBe(10000);
  });

  it("treats effective_from as inclusive", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(resolveRate(rates, "market-daily", "2026-01-01").id).toBe("r");
  });

  it("treats effective_to as inclusive", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" })];
    expect(resolveRate(rates, "market-daily", "2026-01-31").id).toBe("r");
  });

  it("distinguishes rate classes", () => {
    const rates = [
      rate({ id: "hog", feeTypeId: "slaughter", rateClass: "hog", effectiveFrom: "2026-01-01", amount: fromPesos(85), basis: "per_head" }),
      rate({ id: "goat", feeTypeId: "slaughter", rateClass: "goat", effectiveFrom: "2026-01-01", amount: fromPesos(45), basis: "per_head" }),
    ];
    expect(resolveRate(rates, "slaughter", "2026-05-01", "goat").amount).toBe(4500);
  });

  it("throws when no rate covers the date", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(() => resolveRate(rates, "market-daily", "2025-01-01")).toThrow(RateNotFoundError);
  });

  it("throws when the fee type is unknown", () => {
    const rates = [rate({ id: "r", effectiveFrom: "2026-01-01" })];
    expect(() => resolveRate(rates, "parking", "2026-05-01")).toThrow(RateNotFoundError);
  });

  it("throws rather than guessing when two rates overlap", () => {
    const rates = [
      rate({ id: "a", effectiveFrom: "2026-01-01" }),
      rate({ id: "b", effectiveFrom: "2026-02-01" }),
    ];
    expect(() => resolveRate(rates, "market-daily", "2026-05-01")).toThrow(/ambiguous/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/shared/src/rates.test.ts`
Expected: FAIL — cannot resolve `./rates.js`.

- [ ] **Step 3: Implement rate resolution**

`packages/shared/src/rates.ts`:

```ts
import type { Centavos } from "./money.js";

export type RateBasis =
  | "per_day"
  | "per_week"
  | "per_month"
  | "per_entry"
  | "per_head"
  | "per_sqm";

export interface RateRow {
  id: string;
  feeTypeId: string;
  /** Vehicle class at the terminal, animal class at the slaughterhouse. "" when unclassified. */
  rateClass: string;
  /** ISO date, inclusive. */
  effectiveFrom: string;
  /** ISO date, inclusive. null means open-ended. */
  effectiveTo: string | null;
  amount: Centavos;
  basis: RateBasis;
}

export class RateNotFoundError extends Error {
  constructor(feeTypeId: string, on: string, rateClass: string) {
    super(
      `No rate for fee type "${feeTypeId}"${rateClass ? ` class "${rateClass}"` : ""} on ${on}`,
    );
    this.name = "RateNotFoundError";
  }
}

function covers(row: RateRow, on: string): boolean {
  if (on < row.effectiveFrom) return false;
  return row.effectiveTo === null || on <= row.effectiveTo;
}

/**
 * The rate in force for a fee type and class on a given date.
 *
 * Throws rather than picking one when two rates overlap. A database exclusion
 * constraint prevents that, so reaching this branch means the constraint was
 * dropped or the caller assembled rows by hand — either way, silently choosing
 * would produce a wrong amount on a receipt.
 */
export function resolveRate(
  rates: readonly RateRow[],
  feeTypeId: string,
  on: string,
  rateClass = "",
): RateRow {
  const matches = rates.filter(
    (row) => row.feeTypeId === feeTypeId && row.rateClass === rateClass && covers(row, on),
  );
  if (matches.length === 0) throw new RateNotFoundError(feeTypeId, on, rateClass);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous rates for "${feeTypeId}" on ${on}: ${matches.map((m) => m.id).join(", ")}`,
    );
  }
  return matches[0]!;
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./money.js";
export * from "./rates.js";
export * from "./roles.js";
```

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `pnpm vitest run packages/shared/src/rates.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Write the failing database test**

`tests/db/rates.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

describe("fee types and rates", () => {
  let feeTypeId: string;

  beforeAll(async () => {
    const { data } = await service
      .from("fee_types")
      .insert({ code: "MKT_DAILY", name: "Market daily rental", accrues: true, surcharge_bps: 300 })
      .select("id")
      .single();
    feeTypeId = data!.id as string;
  });

  it("stores the surcharge rate as integer basis points", async () => {
    const { data } = await service
      .from("fee_types")
      .select("surcharge_bps")
      .eq("id", feeTypeId)
      .single();
    expect(data!.surcharge_bps).toBe(300);
  });

  it("rejects a surcharge rate above 100 percent", async () => {
    const { error } = await service
      .from("fee_types")
      .insert({ code: "BAD", name: "Bad", accrues: true, surcharge_bps: 10001 });
    expect(error).not.toBeNull();
  });

  it("accepts a rate row", async () => {
    const { error } = await service.from("rates").insert({
      fee_type_id: feeTypeId,
      effective_from: "2026-01-01",
      amount: 120.0,
      basis: "per_day",
    });
    expect(error).toBeNull();
  });

  it("refuses an overlapping rate for the same fee type and class", async () => {
    const { error } = await service.from("rates").insert({
      fee_type_id: feeTypeId,
      effective_from: "2026-06-01",
      amount: 130.0,
      basis: "per_day",
    });
    expect(error).not.toBeNull();
  });

  it("allows the same period for a different rate class", async () => {
    const { data: slaughter } = await service
      .from("fee_types")
      .insert({ code: "SLAUGHTER", name: "Slaughter fee", accrues: false, surcharge_bps: 0 })
      .select("id")
      .single();
    await service.from("rates").insert({
      fee_type_id: slaughter!.id,
      rate_class: "hog",
      effective_from: "2026-01-01",
      amount: 85.0,
      basis: "per_head",
    });
    const { error } = await service.from("rates").insert({
      fee_type_id: slaughter!.id,
      rate_class: "goat",
      effective_from: "2026-01-01",
      amount: 45.0,
      basis: "per_head",
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 6: Write the migration**

`supabase/migrations/20260917000005_rates.sql`:

```sql
create type ceedo_collections.rate_basis as enum
  ('per_day', 'per_week', 'per_month', 'per_entry', 'per_head', 'per_sqm');

create table ceedo_collections.fee_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  -- Whether this fee raises a receivable. Market rentals do; parking, terminal
  -- and slaughter fees are cash on the spot and create no charges.
  accrues       boolean not null default false,
  -- Surcharge as INTEGER BASIS POINTS. 3% is 300. Never a float: 0.03 * 8350
  -- is 250.49999999999997 in IEEE 754 and misrounds an exact half-centavo result.
  surcharge_bps integer not null default 0 check (surcharge_bps between 0 and 10000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0
);

create table ceedo_collections.rates (
  id             uuid primary key default gen_random_uuid(),
  fee_type_id    uuid not null references ceedo_collections.fee_types (id),
  -- Vehicle class at the terminal, animal class at the slaughterhouse.
  -- NOT NULL with an empty default so the exclusion constraint compares it
  -- with '=' — NULL would never equal NULL and overlaps would slip through.
  rate_class     text not null default '',
  effective_from date not null,
  effective_to   date,
  amount         numeric(14,2) not null check (amount >= 0),
  basis          ceedo_collections.rate_basis not null,
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0,

  constraint rates_dates_ordered
    check (effective_to is null or effective_to >= effective_from),

  -- Rate rows are never updated in place; a new ordinance inserts a new row.
  -- Two rows covering the same day for the same fee and class would make the
  -- amount on a receipt ambiguous.
  constraint rates_no_overlap
    exclude using gist (
      fee_type_id with =,
      rate_class with =,
      daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
    )
);

create index rates_lookup_idx on ceedo_collections.rates (fee_type_id, rate_class);

select ceedo_collections.apply_master_data_policies('fee_types');
select ceedo_collections.apply_master_data_policies('rates');
```

- [ ] **Step 7: Reset and run everything**

Run: `supabase db reset && pnpm test`
Expected: PASS — all suites.

- [ ] **Step 8: Commit**

```bash
git add supabase packages tests
git commit -m "feat: fee types and effective-dated rates with pure resolution in shared"
```

---

### Task 8: OR booklets and serial validation

The booklet is the accountability boundary — not the login. Validation is a pure function so the tablet and the server apply identical rules.

**Files:**
- Create: `supabase/migrations/20260917000006_booklets.sql`
- Create: `packages/shared/src/booklets.ts`, `packages/shared/src/booklets.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `tests/db/booklets.test.ts`

**Interfaces:**
- Consumes: `apply_master_data_policies()`; `app_users`
- Produces:
  - Tables `form_types`, `booklets`, `booklet_assignments`, `spoiled_forms`
  - `interface BookletRange { id: string; serialPrefix: string; startNo: number; endNo: number }`
  - `interface OrEntryContext { booklets: readonly BookletRange[]; consumed: ReadonlySet<number>; spoiled: ReadonlySet<number> }`
  - `type OrEntryResult = { ok: true; bookletId: string; warning?: "sequence_skipped" } | { ok: false; reason: OrRejectReason }`
  - `type OrRejectReason = "not_in_assigned_booklet" | "already_consumed" | "marked_spoiled"`
  - `validateOrEntry(context: OrEntryContext, orNo: number): OrEntryResult`

- [ ] **Step 1: Write the failing unit tests**

`packages/shared/src/booklets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateOrEntry, type OrEntryContext } from "./booklets.js";

const context = (over: Partial<OrEntryContext> = {}): OrEntryContext => ({
  booklets: [{ id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 }],
  consumed: new Set<number>(),
  spoiled: new Set<number>(),
  ...over,
});

describe("validateOrEntry", () => {
  it("accepts the first serial in an assigned booklet", () => {
    expect(validateOrEntry(context(), 1001)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("rejects a serial outside every assigned booklet", () => {
    expect(validateOrEntry(context(), 2001)).toEqual({
      ok: false,
      reason: "not_in_assigned_booklet",
    });
  });

  it("rejects a serial already consumed on this device", () => {
    const ctx = context({ consumed: new Set([1001]) });
    expect(validateOrEntry(ctx, 1001)).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("rejects a serial marked spoiled", () => {
    const ctx = context({ spoiled: new Set([1002]) });
    expect(validateOrEntry(ctx, 1002)).toEqual({ ok: false, reason: "marked_spoiled" });
  });

  it("warns but accepts when serials are skipped", () => {
    // Booklets legitimately get skipped, so this is a soft warning, never a block.
    const ctx = context({ consumed: new Set([1001]) });
    expect(validateOrEntry(ctx, 1005)).toEqual({
      ok: true,
      bookletId: "b1",
      warning: "sequence_skipped",
    });
  });

  it("does not warn when the serial follows the last consumed one", () => {
    const ctx = context({ consumed: new Set([1001, 1002]) });
    expect(validateOrEntry(ctx, 1003)).toEqual({ ok: true, bookletId: "b1" });
  });

  it("picks the correct booklet when several are assigned", () => {
    const ctx = context({
      booklets: [
        { id: "b1", serialPrefix: "OR", startNo: 1001, endNo: 1050 },
        { id: "b2", serialPrefix: "OR", startNo: 2001, endNo: 2050 },
      ],
    });
    expect(validateOrEntry(ctx, 2010)).toMatchObject({ ok: true, bookletId: "b2" });
  });

  it("rejects when no booklet is assigned at all", () => {
    expect(validateOrEntry(context({ booklets: [] }), 1001)).toEqual({
      ok: false,
      reason: "not_in_assigned_booklet",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/shared/src/booklets.test.ts`
Expected: FAIL — cannot resolve `./booklets.js`.

- [ ] **Step 3: Implement**

`packages/shared/src/booklets.ts`:

```ts
export interface BookletRange {
  id: string;
  serialPrefix: string;
  startNo: number;
  endNo: number;
}

export interface OrEntryContext {
  /** Booklets currently assigned to this collector. */
  booklets: readonly BookletRange[];
  /** Serials already used, as known to this device. */
  consumed: ReadonlySet<number>;
  /** Serials marked spoiled or cancelled. */
  spoiled: ReadonlySet<number>;
}

export type OrRejectReason =
  | "not_in_assigned_booklet"
  | "already_consumed"
  | "marked_spoiled";

export type OrEntryResult =
  | { ok: true; bookletId: string; warning?: "sequence_skipped" }
  | { ok: false; reason: OrRejectReason };

export function formatSerial(prefix: string, orNo: number): string {
  return `${prefix}-${String(orNo).padStart(7, "0")}`;
}

/**
 * Validates an OR number at the point of sale.
 *
 * These checks exist to catch honest mistakes while the vendor is still standing
 * there; the server re-validates authoritatively on sync and is the only
 * authority. A skipped serial is a warning rather than a rejection because
 * booklets legitimately get skipped.
 */
export function validateOrEntry(context: OrEntryContext, orNo: number): OrEntryResult {
  const booklet = context.booklets.find(
    (candidate) => orNo >= candidate.startNo && orNo <= candidate.endNo,
  );
  if (!booklet) return { ok: false, reason: "not_in_assigned_booklet" };
  if (context.spoiled.has(orNo)) return { ok: false, reason: "marked_spoiled" };
  if (context.consumed.has(orNo)) return { ok: false, reason: "already_consumed" };

  const usedInBooklet = [...context.consumed].filter(
    (serial) => serial >= booklet.startNo && serial <= booklet.endNo,
  );
  const highestUsed = usedInBooklet.length > 0 ? Math.max(...usedInBooklet) : booklet.startNo - 1;

  return orNo > highestUsed + 1
    ? { ok: true, bookletId: booklet.id, warning: "sequence_skipped" }
    : { ok: true, bookletId: booklet.id };
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./booklets.js";
export * from "./money.js";
export * from "./rates.js";
export * from "./roles.js";
```

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `pnpm vitest run packages/shared/src/booklets.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Write the failing database test**

`tests/db/booklets.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

describe("booklets", () => {
  let formTypeId: string;
  let collectorId: string;

  beforeAll(async () => {
    const { data } = await service
      .from("form_types")
      .insert({ code: "OR51", name: "Official Receipt (Accountable Form 51)" })
      .select("id")
      .single();
    formTypeId = data!.id as string;
    collectorId = (await createAppUser({ email: "bk-col@example.com", role: "collector" })).userId;
  });

  it("accepts a booklet with an ordered serial range", async () => {
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 1001,
      end_no: 1050,
      received_date: "2026-09-01",
    });
    expect(error).toBeNull();
  });

  it("rejects a booklet whose end precedes its start", async () => {
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 2050,
      end_no: 2001,
      received_date: "2026-09-01",
    });
    expect(error).not.toBeNull();
  });

  it("refuses two booklets with overlapping serial ranges", async () => {
    await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 3001,
      end_no: 3050,
      received_date: "2026-09-01",
    });
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 3040,
      end_no: 3090,
      received_date: "2026-09-01",
    });
    expect(error).not.toBeNull();
  });

  it("refuses assigning one booklet to two collectors at once", async () => {
    const { data: booklet } = await service
      .from("booklets")
      .insert({
        form_type_id: formTypeId,
        serial_prefix: "OR",
        start_no: 4001,
        end_no: 4050,
        received_date: "2026-09-01",
      })
      .select("id")
      .single();
    const other = (await createAppUser({ email: "bk-col2@example.com", role: "collector" })).userId;

    await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: collectorId, assigned_at: "2026-09-01" });
    const { error } = await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: other, assigned_at: "2026-09-02" });
    expect(error).not.toBeNull();
  });

  it("refuses assigning a booklet to a non-collector", async () => {
    const accountant = (await createAppUser({ email: "bk-acct@example.com", role: "accounting" }))
      .userId;
    const { data: booklet } = await service
      .from("booklets")
      .insert({
        form_type_id: formTypeId,
        serial_prefix: "OR",
        start_no: 5001,
        end_no: 5050,
        received_date: "2026-09-01",
      })
      .select("id")
      .single();
    const { error } = await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: accountant, assigned_at: "2026-09-01" });
    expect(error?.message ?? "").toMatch(/collector/i);
  });
});
```

- [ ] **Step 6: Write the migration**

`supabase/migrations/20260917000006_booklets.sql`:

```sql
create type ceedo_collections.booklet_status as enum
  ('received', 'assigned', 'in_use', 'returned', 'exhausted');

create table ceedo_collections.form_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.booklets (
  id            uuid primary key default gen_random_uuid(),
  form_type_id  uuid not null references ceedo_collections.form_types (id),
  serial_prefix text not null,
  start_no      integer not null check (start_no > 0),
  end_no        integer not null,
  received_date date not null,
  status        ceedo_collections.booklet_status not null default 'received',
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0,

  constraint booklets_range_ordered check (end_no >= start_no),

  -- Two booklets covering the same serial would make an OR number ambiguous,
  -- and the whole accountability chain rests on a serial identifying one receipt.
  constraint booklets_no_serial_overlap
    exclude using gist (
      form_type_id with =,
      serial_prefix with =,
      int4range(start_no, end_no, '[]') with &&
    )
);

create table ceedo_collections.booklet_assignments (
  id           uuid primary key default gen_random_uuid(),
  booklet_id   uuid not null references ceedo_collections.booklets (id),
  collector_id uuid not null references ceedo_collections.app_users (id),
  assigned_at  date not null,
  returned_at  date,
  created_at   timestamptz not null default now(),
  row_version  bigint not null default 0,

  constraint booklet_assignment_dates check (returned_at is null or returned_at >= assigned_at),

  -- A booklet is in exactly one collector's hands at a time.
  constraint booklet_one_holder
    exclude using gist (
      booklet_id with =,
      daterange(assigned_at, coalesce(returned_at, 'infinity'::date), '[]') with &&
    )
);

create table ceedo_collections.spoiled_forms (
  id          uuid primary key default gen_random_uuid(),
  booklet_id  uuid not null references ceedo_collections.booklets (id),
  or_no       integer not null,
  reason      text not null check (length(trim(reason)) > 0),
  recorded_by uuid not null references ceedo_collections.app_users (id),
  recorded_at timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (booklet_id, or_no)
);

create or replace function ceedo_collections.assert_assignee_is_collector()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  assignee_role ceedo_collections.app_role;
begin
  select role into assignee_role
  from ceedo_collections.app_users where id = new.collector_id;

  if assignee_role is distinct from 'collector' then
    raise exception 'Booklets may only be assigned to a collector, not %', assignee_role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger booklet_assignments_collector_only
  before insert or update on ceedo_collections.booklet_assignments
  for each row execute function ceedo_collections.assert_assignee_is_collector();

create index booklet_assignments_collector_idx
  on ceedo_collections.booklet_assignments (collector_id) where returned_at is null;

select ceedo_collections.apply_master_data_policies('form_types');
select ceedo_collections.apply_master_data_policies('booklets');
select ceedo_collections.apply_master_data_policies('booklet_assignments');
select ceedo_collections.apply_master_data_policies('spoiled_forms');
```

- [ ] **Step 7: Reset and run**

Run: `supabase db reset && pnpm test`
Expected: PASS — all suites.

- [ ] **Step 8: Commit**

```bash
git add supabase packages tests
git commit -m "feat: OR booklets, assignments and pure serial validation"
```

---

### Task 9: Devices and assignments

Tablets are shared, so `devices` carries no `collector_id`. A device's assignment decides **what data syncs to it**; a collector's assignment decides **where that person may collect**. Sign-in is permitted where the two overlap.

**Files:**
- Create: `supabase/migrations/20260917000007_devices.sql`
- Create: `tests/db/devices.test.ts`

**Interfaces:**
- Consumes: `apply_master_data_policies()`; `facilities`, `sections`, `app_users`
- Produces:
  - Tables `devices`, `device_assignments`, `collector_assignments`
  - `ceedo_collections.can_collector_use_device(collector uuid, device uuid) returns boolean`

- [ ] **Step 1: Write the failing tests**

`tests/db/devices.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

async function marketWithSections(code: string) {
  const { data: facility } = await service
    .from("facilities")
    .insert({ name: `Market ${code}`, code, type: "market" })
    .select("id")
    .single();
  const { data: fish } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
    .select("id")
    .single();
  const { data: meat } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Meat", default_accrual_period: "daily" })
    .select("id")
    .single();
  return { facilityId: facility!.id as string, fishId: fish!.id as string, meatId: meat!.id as string };
}

describe("devices and assignments", () => {
  let facilityId: string;
  let fishId: string;
  let meatId: string;
  let deviceId: string;

  beforeAll(async () => {
    ({ facilityId, fishId, meatId } = await marketWithSections("DEV"));
    const { data: device } = await service
      .from("devices")
      .insert({ label: "Tablet 01" })
      .select("id")
      .single();
    deviceId = device!.id as string;
    await service
      .from("device_assignments")
      .insert({ device_id: deviceId, facility_id: facilityId, section_id: fishId });
  });

  it("has no collector column — tablets are shared", async () => {
    const { error } = await service.from("devices").select("collector_id").limit(1);
    expect(error).not.toBeNull();
  });

  it("permits a collector assigned to the same section", async () => {
    const { userId } = await createAppUser({ email: "dev-fish@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  it("refuses a collector assigned to a different section of the same market", async () => {
    const { userId } = await createAppUser({ email: "dev-meat@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: meatId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  it("permits a facility-wide collector on any section device of that facility", async () => {
    const { userId } = await createAppUser({ email: "dev-wide@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: null });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  it("refuses a collector with no assignment at all", async () => {
    const { userId } = await createAppUser({ email: "dev-none@example.com", role: "collector" });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  it("refuses a deactivated device to an otherwise eligible collector", async () => {
    const { userId } = await createAppUser({ email: "dev-dead@example.com", role: "collector" });
    const { data: device } = await service
      .from("devices")
      .insert({ label: "Tablet 99", active: false })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facilityId, section_id: fishId });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(false);
  });

  it("refuses a device to a non-collector role", async () => {
    const { userId } = await createAppUser({ email: "dev-sup@example.com", role: "supervisor" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId })
      .select();
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/db/devices.test.ts`
Expected: FAIL — relation `devices` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260917000007_devices.sql`:

```sql
-- Tablets are shared between collectors on different days, so there is deliberately
-- NO collector_id here. Accountability is anchored to the booklet, not the device.
create table ceedo_collections.devices (
  id            uuid primary key default gen_random_uuid(),
  label         text not null unique,
  -- Opaque identifier for the long-lived credential issued at registration.
  -- The secret itself is never stored here.
  credential_id text unique,
  registered_at timestamptz,
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0
);

-- Determines WHAT SYNCS to the tablet. Scoping to the device rather than the
-- collector keeps the payload stable as collectors rotate through it.
create table ceedo_collections.device_assignments (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references ceedo_collections.devices (id),
  facility_id uuid not null references ceedo_collections.facilities (id),
  section_id  uuid references ceedo_collections.sections (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create unique index device_assignments_one_active
  on ceedo_collections.device_assignments (device_id) where active;

-- Determines WHERE A PERSON MAY COLLECT. A null section means the whole facility.
create table ceedo_collections.collector_assignments (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid not null references ceedo_collections.app_users (id),
  facility_id  uuid not null references ceedo_collections.facilities (id),
  section_id   uuid references ceedo_collections.sections (id),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  row_version  bigint not null default 0
);

create index collector_assignments_collector_idx
  on ceedo_collections.collector_assignments (collector_id) where active;

/**
 * Whether a collector may sign in to a device: the two assignments must overlap,
 * the device must be active, and the person must actually be a collector.
 *
 * A collector assigned facility-wide (section_id null) may use any device at that
 * facility. A collector assigned to one section may only use a device scoped to
 * that same section, or to the facility as a whole.
 */
create or replace function ceedo_collections.can_collector_use_device(
  collector uuid,
  device uuid
)
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select exists (
    select 1
    from ceedo_collections.device_assignments da
    join ceedo_collections.devices d on d.id = da.device_id
    join ceedo_collections.collector_assignments ca
      on ca.facility_id = da.facility_id
    join ceedo_collections.app_users u on u.id = ca.collector_id
    where da.device_id = device
      and da.active
      and d.active
      and ca.collector_id = collector
      and ca.active
      and u.role = 'collector'
      and u.status = 'active'
      and (ca.section_id is null or da.section_id is null or ca.section_id = da.section_id)
  );
$$;

grant execute on function ceedo_collections.can_collector_use_device(uuid, uuid)
  to authenticated, service_role;

select ceedo_collections.apply_master_data_policies('devices');
select ceedo_collections.apply_master_data_policies('device_assignments');
select ceedo_collections.apply_master_data_policies('collector_assignments');
```

- [ ] **Step 4: Reset and run**

Run: `supabase db reset && pnpm vitest run tests/db/devices.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase tests
git commit -m "feat(db): shared devices with device and collector assignment overlap rule"
```

---

### Task 10: Generated database types

**Files:**
- Create: `packages/shared/src/db.types.ts` (generated — never hand-edited)
- Modify: `packages/shared/src/index.ts`
- Create: `scripts/check-types-current.sh`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every migration from Tasks 3–9
- Produces: `Database` type exported from `@ceedo/shared`; a CI check that the checked-in types match the migrations

- [ ] **Step 1: Generate the types**

Run: `supabase db reset && pnpm db:types`
Expected: `packages/shared/src/db.types.ts` is written with a `Database` interface containing `ceedo_collections` tables.

- [ ] **Step 2: Export the generated types**

Modify `packages/shared/src/index.ts`:

```ts
export * from "./booklets.js";
export * from "./money.js";
export * from "./rates.js";
export * from "./roles.js";
export type { Database } from "./db.types.js";
```

- [ ] **Step 3: Add a drift check**

`scripts/check-types-current.sh`:

```bash
#!/usr/bin/env bash
# Fails when db.types.ts is out of step with the migrations. Stale types are how a
# renamed column becomes a runtime error rather than a compile error.
set -euo pipefail

generated=$(mktemp)
trap 'rm -f "$generated"' EXIT

supabase gen types typescript --local --schema ceedo_collections > "$generated"

if ! diff -q "$generated" packages/shared/src/db.types.ts > /dev/null; then
  echo "db.types.ts is stale. Run: pnpm db:types" >&2
  diff "$generated" packages/shared/src/db.types.ts || true
  exit 1
fi

echo "db.types.ts is current."
```

Run: `chmod +x scripts/check-types-current.sh && ./scripts/check-types-current.sh`
Expected: prints "db.types.ts is current."

- [ ] **Step 4: Wire the check into CI**

In `.github/workflows/ci.yml`, insert after the `supabase start` step and before `pnpm test`:

```yaml
      - run: supabase db reset
      - run: ./scripts/check-types-current.sh
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/db.types.ts packages/shared/src/index.ts scripts .github
git commit -m "chore: generate database types and fail CI when they drift"
```

---

### Task 11: Web app with Google Sign-In and the invite-only gate

Staff use personal Gmail accounts, so there is no domain to restrict on and access is by invitation. Signing in establishes *who*; the `app_users` row establishes *whether*.

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`
- Create: `apps/web/app/sign-in/page.tsx`, `apps/web/app/auth/callback/route.ts`, `apps/web/app/no-access/page.tsx`
- Create: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/session.ts`
- Create: `apps/web/lib/auth/gate.ts`, `apps/web/lib/auth/gate.test.ts`
- Create: `apps/web/middleware.ts`, `apps/web/.env.example`
- Modify: `supabase/config.toml`, `vitest.workspace.ts`

**Interfaces:**
- Consumes: `Database`, `Role`, `canUseWeb` from `@ceedo/shared`
- Produces:
  - `getServerClient()` — request-scoped Supabase client with cookie session
  - `interface AccessDecision { allowed: boolean; reason: "ok" | "not_signed_in" | "not_registered" | "role_not_permitted" }`
  - `decideAccess(session: { userId: string } | null, member: { role: Role; status: string } | null): AccessDecision`
  - `requireStaff()` — server helper returning `{ userId, role }` or redirecting

- [ ] **Step 1: Scaffold the Next.js app**

`create-next-app` refuses a non-empty directory, so this must run before any file
is written under `apps/web`.

```bash
pnpm create next-app@latest apps/web --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --use-pnpm --yes
```

Then edit `apps/web/package.json`:

```json
{
  "name": "@ceedo/web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ceedo/shared": "workspace:*",
    "@supabase/ssr": "^0.6.0",
    "@supabase/supabase-js": "^2.48.0",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.0.0"
  }
}
```

Add `apps/web` to `vitest.workspace.ts`:

```ts
export default ["packages/*", "apps/web", "tests"];
```

`apps/web/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 2: Write the failing gate tests**

`apps/web/lib/auth/gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideAccess } from "./gate.js";

describe("decideAccess", () => {
  it("refuses a visitor who is not signed in", () => {
    expect(decideAccess(null, null)).toEqual({ allowed: false, reason: "not_signed_in" });
  });

  it("refuses a valid Google account with no app_users row", () => {
    // auth.users is shared across the Supabase project: someone signed in to an
    // unrelated system on the same instance reaches us as a real session.
    expect(decideAccess({ userId: "u1" }, null)).toEqual({
      allowed: false,
      reason: "not_registered",
    });
  });

  it("refuses a suspended member", () => {
    expect(decideAccess({ userId: "u1" }, { role: "admin", status: "suspended" })).toEqual({
      allowed: false,
      reason: "not_registered",
    });
  });

  it("refuses a collector, who belongs on the tablet", () => {
    expect(decideAccess({ userId: "u1" }, { role: "collector", status: "active" })).toEqual({
      allowed: false,
      reason: "role_not_permitted",
    });
  });

  it("admits an active supervisor", () => {
    expect(decideAccess({ userId: "u1" }, { role: "supervisor", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("admits an active admin", () => {
    expect(decideAccess({ userId: "u1" }, { role: "admin", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("admits an active accounting user", () => {
    expect(decideAccess({ userId: "u1" }, { role: "accounting", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });
});
```

- [ ] **Step 3: Run the gate tests to verify they fail**

Run: `pnpm vitest run apps/web/lib/auth/gate.test.ts`
Expected: FAIL — cannot resolve `./gate.js`.

- [ ] **Step 4: Implement the gate**

`apps/web/lib/auth/gate.ts`:

```ts
import { canUseWeb, type Role } from "@ceedo/shared";

export interface AccessDecision {
  allowed: boolean;
  reason: "ok" | "not_signed_in" | "not_registered" | "role_not_permitted";
}

export interface Membership {
  role: Role;
  status: string;
}

/**
 * Authentication establishes identity; membership establishes access.
 *
 * `auth.users` is shared with unrelated systems on this Supabase project, so a
 * valid session proves only that someone signed in somewhere — never that they
 * belong here. Access is granted by an administrator creating the `app_users`
 * row in advance.
 */
export function decideAccess(
  session: { userId: string } | null,
  member: Membership | null,
): AccessDecision {
  if (!session) return { allowed: false, reason: "not_signed_in" };
  if (!member || member.status !== "active") {
    return { allowed: false, reason: "not_registered" };
  }
  if (!canUseWeb(member.role)) return { allowed: false, reason: "role_not_permitted" };
  return { allowed: true, reason: "ok" };
}
```

- [ ] **Step 5: Run the gate tests to verify they pass**

Run: `pnpm vitest run apps/web/lib/auth/gate.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Add the Supabase clients**

`apps/web/lib/supabase/server.ts`:

```ts
import type { Database } from "@ceedo/shared";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getServerClient() {
  const store = await cookies();
  return createServerClient<Database, "ceedo_collections">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "ceedo_collections" },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
```

`apps/web/lib/supabase/client.ts`:

```ts
"use client";

import type { Database } from "@ceedo/shared";
import { createBrowserClient } from "@supabase/ssr";

export function getBrowserClient() {
  return createBrowserClient<Database, "ceedo_collections">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "ceedo_collections" } },
  );
}
```

`apps/web/lib/supabase/session.ts`:

```ts
import type { Role } from "@ceedo/shared";
import { redirect } from "next/navigation";
import { decideAccess } from "../auth/gate";
import { getServerClient } from "./server";

export interface StaffSession {
  userId: string;
  role: Role;
  fullName: string;
}

/** Resolves the caller, or redirects. Every authenticated page calls this first. */
export async function requireStaff(): Promise<StaffSession> {
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;

  const { data: member } = userId
    ? await supabase
        .from("app_users")
        .select("role, status, full_name")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };

  const decision = decideAccess(
    userId ? { userId } : null,
    member ? { role: member.role as Role, status: member.status } : null,
  );

  if (!decision.allowed) {
    redirect(decision.reason === "not_signed_in" ? "/sign-in" : "/no-access");
  }

  return {
    userId: userId!,
    role: member!.role as Role,
    fullName: member!.full_name,
  };
}
```

- [ ] **Step 7: Add the sign-in flow**

Enable Google in `supabase/config.toml`:

```toml
[auth]
site_url = "env(NEXT_PUBLIC_SITE_URL)"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]

[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_SECRET)"
skip_nonce_check = false
```

`apps/web/app/sign-in/page.tsx`:

```tsx
"use client";

import { getBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  async function signIn() {
    await getBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">CEEDO Collections</h1>
        <p className="mt-1 text-sm text-neutral-600">City Economic Enterprise Office</p>
      </div>
      <button
        type="button"
        onClick={signIn}
        className="rounded-md border border-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50"
      >
        Sign in with Google
      </button>
      <p className="text-xs text-neutral-500">
        Access is by invitation. Ask an administrator to register your email address first.
      </p>
    </main>
  );
}
```

`apps/web/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/sign-in`);

  const supabase = await getServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/sign-in`);

  return NextResponse.redirect(`${origin}/`);
}
```

`apps/web/app/no-access/page.tsx`:

```tsx
export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">No access to this system</h1>
      <p className="text-sm text-neutral-600">
        Your Google account signed in successfully, but it is not registered with CEEDO
        Collections. Ask an administrator to add your email address, then sign in again.
      </p>
      <p className="text-sm text-neutral-600">
        Collectors do not use this site — collections are recorded on the tablet.
      </p>
      <a href="/sign-in" className="text-sm underline">
        Back to sign in
      </a>
    </main>
  );
}
```

- [ ] **Step 8: Add session-refreshing middleware**

`apps/web/middleware.ts`:

```ts
import type { Database } from "@ceedo/shared";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/no-access", "/auth/callback"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database, "ceedo_collections">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "ceedo_collections" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session cookie. Page-level authorization is decided by
  // requireStaff(), which checks app_users membership — never by this middleware.
  const { data } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!data.user && !PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
```

- [ ] **Step 9: Add the landing page**

`apps/web/app/page.tsx`:

```tsx
import { requireStaff } from "@/lib/supabase/session";

export default async function HomePage() {
  const staff = await requireStaff();
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">CEEDO Collections</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Signed in as {staff.fullName} ({staff.role}).
      </p>
    </main>
  );
}
```

- [ ] **Step 10: Verify the build and full suite**

Run: `pnpm install && pnpm typecheck && pnpm build && pnpm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps supabase vitest.workspace.ts
git commit -m "feat(web): Google Sign-In with invite-only app_users access gate"
```

---

### Task 12: Admin shell and the generic resource engine

Phase 1 needs eleven CRUD screens. Writing eleven bespoke ones invites eleven slightly different validation behaviours, so one engine drives them from a config object and Task 13 supplies the configs.

**Files:**
- Create: `apps/web/lib/admin/resource.ts`
- Create: `apps/web/lib/admin/save-result.ts`, `apps/web/lib/admin/save-result.test.ts`
- Create: `apps/web/lib/admin/actions.ts`
- Create: `apps/web/lib/admin/registry.ts` (empty stub; Task 13 fills it)
- Create: `apps/web/components/resource-table.tsx`, `apps/web/components/resource-form.tsx`, `apps/web/components/field.tsx`
- Create: `apps/web/app/(admin)/layout.tsx`, `apps/web/app/(admin)/[resource]/page.tsx`

**Interfaces:**
- Consumes: `requireStaff()`, `getServerClient()`, `Database`, `Role`, `canManageMasterData`
- Produces:
  - `interface FieldConfig { name: string; label: string; type: "text" | "number" | "money" | "date" | "select" | "boolean"; options?: { value: string; label: string }[]; optional?: boolean; help?: string }`
  - `interface ResourceConfig<S extends ZodObject> { key: string; table: string; title: string; singular: string; schema: S; fields: FieldConfig[]; columns: { key: string; label: string }[]; select: string; orderBy: string; writeRoles: readonly Role[] }`
  - `type SaveResult = { ok: true; id: string } | { ok: false; fieldErrors: Record<string, string>; formError?: string }` (in `save-result.ts`)
  - `toSaveResult(parsed, dbError, id?): SaveResult` — pure, synchronous, unit-tested (in `save-result.ts`)
  - `saveResource(config, formData, id?): Promise<SaveResult>` (in `actions.ts`, `"use server"`)
  - `RESOURCES: Record<string, ResourceConfig<ZodObject>>` (populated in Task 13)

- [ ] **Step 1: Write the failing tests for the pure error mapper**

`apps/web/lib/admin/save-result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toSaveResult } from "./save-result.js";

const schema = z.object({ code: z.string().min(1), name: z.string().min(1) });

describe("toSaveResult", () => {
  it("returns field errors from a failed parse", () => {
    const parsed = schema.safeParse({ code: "", name: "Market" });
    expect(toSaveResult(parsed, null)).toEqual({
      ok: false,
      fieldErrors: { code: expect.any(String) },
    });
  });

  it("maps a unique-violation to a readable form error", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "23505", message: "duplicate key" });
    expect(result).toMatchObject({ ok: false });
    expect((result as { formError: string }).formError).toMatch(/already exists/i);
  });

  it("maps a check-constraint violation to its database message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, {
      code: "23514",
      message: "Sections may only belong to a market facility, not terminal",
    });
    expect((result as { formError: string }).formError).toMatch(/market facility/);
  });

  it("maps an exclusion-constraint violation to an overlap message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "23P01", message: "conflicting key value" });
    expect((result as { formError: string }).formError).toMatch(/overlaps/i);
  });

  it("maps a permission denial to an access message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "42501", message: "permission denied" });
    expect((result as { formError: string }).formError).toMatch(/permission/i);
  });

  it("returns ok when the parse succeeds and there is no database error", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    expect(toSaveResult(parsed, null, "new-id")).toEqual({ ok: true, id: "new-id" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/web/lib/admin/save-result.test.ts`
Expected: FAIL — cannot resolve `./save-result.js`.

- [ ] **Step 3: Define the resource config type**

`apps/web/lib/admin/resource.ts`:

```ts
import type { Role } from "@ceedo/shared";
import type { ZodObject, ZodRawShape } from "zod";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: "text" | "number" | "money" | "date" | "select" | "boolean";
  /** Static choices. Dynamic ones are loaded by the page and merged in. */
  options?: SelectOption[];
  /** Names a resource whose rows become the choices, e.g. "facilities". */
  optionsFrom?: string;
  optional?: boolean;
  help?: string;
}

export interface ColumnConfig {
  key: string;
  label: string;
}

export interface ResourceConfig<S extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>> {
  /** URL segment, e.g. "facilities". */
  key: string;
  /** Table name inside ceedo_collections. */
  table: string;
  title: string;
  singular: string;
  schema: S;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  /** PostgREST select expression, including any joined labels. */
  select: string;
  orderBy: string;
  writeRoles: readonly Role[];
}

export const RESOURCES: Record<string, ResourceConfig> = {};

export function registerResource(config: ResourceConfig): void {
  RESOURCES[config.key] = config;
}
```

- [ ] **Step 4: Implement the save action and its pure error mapper**

Two files, because **every export from a `"use server"` module must be an async
function**. `toSaveResult` is synchronous, so it lives outside the action file —
which is also what makes it unit-testable without a request.

`apps/web/lib/admin/save-result.ts`:

```ts
import type { SafeParseReturnType } from "zod";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

export interface DbError {
  code: string;
  message: string;
}

/**
 * Turns a validation result and an optional database error into something a form
 * can render. Kept pure and separate from the action so the mapping of Postgres
 * error codes to human sentences is unit-tested rather than discovered in the UI.
 */
export function toSaveResult(
  parsed: SafeParseReturnType<unknown, unknown>,
  dbError: DbError | null,
  id = "",
): SaveResult {
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  if (dbError) {
    const formError = ((): string => {
      switch (dbError.code) {
        case "23505":
          return "A record with these details already exists.";
        case "23503":
          return "A referenced record does not exist.";
        case "23514":
          // Trigger and check-constraint messages are written for people.
          return dbError.message;
        case "23P01":
          return "This overlaps an existing record for the same period or range.";
        case "42501":
          return "You do not have permission to change this.";
        default:
          return dbError.message;
      }
    })();
    return { ok: false, fieldErrors: {}, formError };
  }

  return { ok: true, id };
}
```

`apps/web/lib/admin/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import type { ResourceConfig } from "./resource";
import { toSaveResult, type SaveResult } from "./save-result";

function coerce(config: ResourceConfig, formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const field of config.fields) {
    const value = formData.get(field.name);
    if (field.type === "boolean") {
      raw[field.name] = value === "on" || value === "true";
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "") {
      raw[field.name] = field.optional ? null : "";
      continue;
    }
    raw[field.name] = field.type === "number" || field.type === "money" ? Number(text) : text;
  }
  return raw;
}

export async function saveResource(
  config: ResourceConfig,
  formData: FormData,
  id?: string,
): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!config.writeRoles.includes(staff.role)) {
    return { ok: false, fieldErrors: {}, formError: "You do not have permission to change this." };
  }

  const parsed = config.schema.safeParse(coerce(config, formData));
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const query = id
    ? supabase.from(config.table).update(parsed.data as never).eq("id", id).select("id").single()
    : supabase.from(config.table).insert(parsed.data as never).select("id").single();

  const { data, error } = await query;
  const result = toSaveResult(
    parsed,
    error ? { code: error.code ?? "", message: error.message } : null,
    (data as { id?: string } | null)?.id ?? id ?? "",
  );

  if (result.ok) revalidatePath(`/${config.key}`);
  return result;
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `pnpm vitest run apps/web/lib/admin/save-result.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Build the shared form field**

`apps/web/components/field.tsx`:

```tsx
import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

export function Field({
  config,
  value,
  error,
  options,
}: {
  config: FieldConfig;
  value?: string | number | boolean | null;
  error?: string;
  options?: SelectOption[];
}) {
  const id = `field-${config.name}`;
  const base =
    "mt-1 w-full rounded-md border px-3 py-2 text-sm " +
    (error ? "border-red-500" : "border-neutral-300");

  return (
    <div className="mb-4">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {config.label}
        {config.optional ? <span className="text-neutral-400"> (optional)</span> : null}
      </label>

      {config.type === "select" ? (
        <select id={id} name={config.name} defaultValue={String(value ?? "")} className={base}>
          <option value="">Select…</option>
          {(options ?? config.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : config.type === "boolean" ? (
        <input
          id={id}
          name={config.name}
          type="checkbox"
          defaultChecked={Boolean(value)}
          className="mt-2 block h-4 w-4"
        />
      ) : (
        <input
          id={id}
          name={config.name}
          type={config.type === "date" ? "date" : config.type === "text" ? "text" : "number"}
          step={config.type === "money" ? "0.01" : undefined}
          defaultValue={value === null || value === undefined ? "" : String(value)}
          className={base}
        />
      )}

      {config.help ? <p className="mt-1 text-xs text-neutral-500">{config.help}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 7: Build the table and form components**

`apps/web/components/resource-table.tsx`:

```tsx
import type { ColumnConfig } from "@/lib/admin/resource";

export function ResourceTable({
  columns,
  rows,
}: {
  columns: ColumnConfig[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-sm text-neutral-500">Nothing here yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left">
          {columns.map((column) => (
            <th key={column.key} className="py-2 pr-4 font-medium text-neutral-600">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={String(row.id ?? index)} className="border-b border-neutral-100">
            {columns.map((column) => (
              <td key={column.key} className="py-2 pr-4">
                {formatCell(row[column.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>;
    return String(nested.name ?? nested.code ?? nested.full_name ?? "—");
  }
  return String(value);
}
```

`apps/web/components/resource-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Field } from "@/components/field";
import { saveResource } from "@/lib/admin/actions";
import type { SaveResult } from "@/lib/admin/save-result";
import type { ResourceConfig, SelectOption } from "@/lib/admin/resource";

export function ResourceForm({
  config,
  dynamicOptions,
}: {
  config: ResourceConfig;
  dynamicOptions: Record<string, SelectOption[]>;
}) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setResult(await saveResource(config, formData));
    setPending(false);
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};

  return (
    <form action={onSubmit} className="max-w-md rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-4 text-sm font-semibold">New {config.singular}</h2>

      {config.fields.map((field) => (
        <Field
          key={field.name}
          config={field}
          error={fieldErrors[field.name]}
          options={field.optionsFrom ? dynamicOptions[field.optionsFrom] : undefined}
        />
      ))}

      {result && !result.ok && result.formError ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.formError}
        </p>
      ) : null}
      {result?.ok ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">Saved.</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : `Save ${config.singular}`}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Build the admin shell and the resource page**

`apps/web/app/(admin)/layout.tsx`:

```tsx
import Link from "next/link";
import { RESOURCES } from "@/lib/admin/resource";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="flex min-h-dvh">
      <nav className="w-56 shrink-0 border-r border-neutral-200 px-4 py-6">
        <p className="mb-6 text-sm font-semibold">CEEDO Collections</p>
        <ul className="space-y-1">
          {Object.values(RESOURCES).map((resource) => (
            <li key={resource.key}>
              <Link
                href={`/${resource.key}`}
                className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                {resource.title}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-neutral-500">
          {staff.fullName}
          <br />
          {staff.role}
        </p>
      </nav>
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
```

`apps/web/app/(admin)/[resource]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/resource-form";
import { ResourceTable } from "@/components/resource-table";
import { RESOURCES, type SelectOption } from "@/lib/admin/resource";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function ResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource: key } = await params;
  const config = RESOURCES[key];
  if (!config) notFound();

  const staff = await requireStaff();
  const supabase = await getServerClient();

  const { data: rows } = await supabase
    .from(config.table)
    .select(config.select)
    .order(config.orderBy);

  // Load choices for any select field that draws them from another table.
  const dynamicOptions: Record<string, SelectOption[]> = {};
  for (const field of config.fields) {
    if (!field.optionsFrom || dynamicOptions[field.optionsFrom]) continue;
    const source = RESOURCES[field.optionsFrom];
    if (!source) continue;
    const { data } = await supabase.from(source.table).select("id, name:name, code:code");
    dynamicOptions[field.optionsFrom] = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        value: String(record.id),
        label: String(record.name ?? record.code ?? record.id),
      };
    });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{config.title}</h1>
      {config.writeRoles.includes(staff.role) ? (
        <ResourceForm config={config} dynamicOptions={dynamicOptions} />
      ) : null}
      <ResourceTable columns={config.columns} rows={(rows ?? []) as Record<string, unknown>[]} />
    </div>
  );
}
```

- [ ] **Step 9: Create the registry stub**

`lib/admin/registry.ts` is imported for its side effects by the layout and the
resource page, so it must exist before anything typechecks. Task 13 fills it.

`apps/web/lib/admin/registry.ts`:

```ts
// Resource configurations are registered here for their side effects.
// Populated in Task 13.
export {};
```

- [ ] **Step 10: Verify build and suite**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: PASS. Every resource route renders "not found" until Task 13 registers the configs.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): config-driven admin resource engine with tested error mapping"
```

---

### Task 13: Resource registry and seed data

Supplies the eleven configs the engine renders, and a seed file so the app can be exercised end to end without hand-typing a market.

**Files:**
- Create: `apps/web/lib/admin/registry.ts`
- Create: `supabase/seed.sql`
- Create: `tests/db/registry-parity.test.ts`

**Interfaces:**
- Consumes: `registerResource`, `ResourceConfig` from Task 12
- Produces: registered resources `facilities`, `sections`, `stalls`, `tenants`, `leases`, `fee-types`, `rates`, `form-types`, `booklets`, `devices`, `users`

- [ ] **Step 1: Write the failing parity test**

`tests/db/registry-parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

// Every table the admin engine writes to must exist. A renamed table would
// otherwise surface as a runtime 404 the first time someone opens that screen.
const TABLES = [
  "facilities",
  "sections",
  "stalls",
  "tenants",
  "leases",
  "fee_types",
  "rates",
  "form_types",
  "booklets",
  "devices",
  "app_users",
];

describe("admin registry parity", () => {
  it.each(TABLES)("table %s exists and is readable", async (table) => {
    const { error } = await serviceClient().from(table).select("id").limit(1);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it passes against the migrations**

Run: `pnpm vitest run tests/db/registry-parity.test.ts`
Expected: PASS — 11 tests. This test guards Task 13's configs against future renames.

- [ ] **Step 3: Write the registry**

`apps/web/lib/admin/registry.ts`:

```ts
import { z } from "zod";
import { registerResource, type ResourceConfig } from "./resource";

const ADMIN_ONLY = ["admin"] as const;
const SUPERVISOR_UP = ["supervisor", "admin"] as const;

const uuid = z.string().uuid();
const name = z.string().min(1, "Required");
const optionalText = z.string().min(1).nullable();
const money = z.number().min(0, "Must not be negative");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const configs: ResourceConfig[] = [
  {
    key: "facilities",
    table: "facilities",
    title: "Facilities",
    singular: "facility",
    schema: z.object({
      code: name,
      name,
      type: z.enum(["market", "terminal", "parking", "slaughterhouse"]),
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "Short identifier, e.g. CPM" },
      { name: "name", label: "Name", type: "text" },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "market", label: "Public market" },
          { value: "terminal", label: "Terminal (IBJT)" },
          { value: "parking", label: "Parking" },
          { value: "slaughterhouse", label: "Slaughterhouse" },
        ],
        help: "Only markets have sections and stalls.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "active", label: "Active" },
    ],
    select: "id, code, name, type, active",
    orderBy: "code",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "sections",
    table: "sections",
    title: "Sections",
    singular: "section",
    schema: z.object({
      facility_id: uuid,
      name,
      default_accrual_period: z.enum(["daily", "weekly", "monthly"]),
      active: z.boolean(),
    }),
    fields: [
      { name: "facility_id", label: "Market", type: "select", optionsFrom: "facilities" },
      { name: "name", label: "Section", type: "text", help: "Fish, Meat, Vegetable, Dry goods" },
      {
        name: "default_accrual_period",
        label: "Default billing period",
        type: "select",
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
        help: "Leases inherit this and may override it.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "name", label: "Section" },
      { key: "facilities", label: "Market" },
      { key: "default_accrual_period", label: "Billing period" },
    ],
    select: "id, name, default_accrual_period, active, facilities(name)",
    orderBy: "name",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "stalls",
    table: "stalls",
    title: "Stalls",
    singular: "stall",
    schema: z.object({
      section_id: uuid,
      stall_no: name,
      area_sqm: z.number().min(0).nullable(),
      active: z.boolean(),
    }),
    fields: [
      { name: "section_id", label: "Section", type: "select", optionsFrom: "sections" },
      { name: "stall_no", label: "Stall number", type: "text" },
      { name: "area_sqm", label: "Area (sqm)", type: "number", optional: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "stall_no", label: "Stall" },
      { key: "sections", label: "Section" },
      { key: "area_sqm", label: "Area (sqm)" },
      { key: "active", label: "Active" },
    ],
    select: "id, stall_no, area_sqm, active, sections(name)",
    orderBy: "stall_no",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "tenants",
    table: "tenants",
    title: "Tenants",
    singular: "tenant",
    schema: z.object({
      full_name: name,
      address: optionalText,
      contact_no: optionalText,
      active: z.boolean(),
    }),
    fields: [
      { name: "full_name", label: "Full name", type: "text" },
      { name: "address", label: "Address", type: "text", optional: true },
      { name: "contact_no", label: "Contact number", type: "text", optional: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "full_name", label: "Name" },
      { key: "contact_no", label: "Contact" },
      { key: "active", label: "Active" },
    ],
    select: "id, full_name, address, contact_no, active",
    orderBy: "full_name",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "leases",
    table: "leases",
    title: "Leases",
    singular: "lease",
    schema: z.object({
      stall_id: uuid,
      tenant_id: uuid,
      start_date: isoDate,
      end_date: isoDate.nullable(),
      rate_amount: money,
      accrual_period: z.enum(["daily", "weekly", "monthly"]),
      due_day: z.number().int().min(1).max(28).nullable(),
      status: z.enum(["active", "ended", "terminated"]),
    }),
    fields: [
      { name: "stall_id", label: "Stall", type: "select", optionsFrom: "stalls" },
      { name: "tenant_id", label: "Tenant", type: "select", optionsFrom: "tenants" },
      { name: "start_date", label: "Start date", type: "date" },
      { name: "end_date", label: "End date", type: "date", optional: true, help: "Leave blank for open-ended." },
      { name: "rate_amount", label: "Rate", type: "money", help: "Amount per billing period." },
      {
        name: "accrual_period",
        label: "Billing period",
        type: "select",
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      },
      { name: "due_day", label: "Due day of month", type: "number", optional: true, help: "Required for monthly leases. 1–28." },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "ended", label: "Ended" },
          { value: "terminated", label: "Terminated" },
        ],
      },
    ],
    columns: [
      { key: "stalls", label: "Stall" },
      { key: "tenants", label: "Tenant" },
      { key: "start_date", label: "From" },
      { key: "end_date", label: "To" },
      { key: "rate_amount", label: "Rate" },
      { key: "accrual_period", label: "Period" },
      { key: "status", label: "Status" },
    ],
    select:
      "id, start_date, end_date, rate_amount, accrual_period, due_day, status, stalls(stall_no), tenants(full_name)",
    orderBy: "start_date",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "fee-types",
    table: "fee_types",
    title: "Fee types",
    singular: "fee type",
    schema: z.object({
      code: name,
      name,
      accrues: z.boolean(),
      surcharge_bps: z.number().int().min(0).max(10000),
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. MKT_DAILY, SLAUGHTER" },
      { name: "name", label: "Name", type: "text" },
      { name: "accrues", label: "Creates a receivable", type: "boolean", help: "Market rentals do. Parking, terminal and slaughter fees do not." },
      { name: "surcharge_bps", label: "Surcharge (basis points)", type: "number", help: "3% is 300. Integer only." },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "accrues", label: "Accrues" },
      { key: "surcharge_bps", label: "Surcharge (bps)" },
    ],
    select: "id, code, name, accrues, surcharge_bps, active",
    orderBy: "code",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "rates",
    table: "rates",
    title: "Rates",
    singular: "rate",
    schema: z.object({
      fee_type_id: uuid,
      rate_class: z.string(),
      effective_from: isoDate,
      effective_to: isoDate.nullable(),
      amount: money,
      basis: z.enum(["per_day", "per_week", "per_month", "per_entry", "per_head", "per_sqm"]),
    }),
    fields: [
      { name: "fee_type_id", label: "Fee type", type: "select", optionsFrom: "fee-types" },
      { name: "rate_class", label: "Class", type: "text", optional: true, help: "Vehicle class at the terminal, animal class at the slaughterhouse. Leave blank if unclassified." },
      { name: "effective_from", label: "Effective from", type: "date" },
      { name: "effective_to", label: "Effective to", type: "date", optional: true, help: "Leave blank while this rate is current." },
      { name: "amount", label: "Amount", type: "money" },
      {
        name: "basis",
        label: "Basis",
        type: "select",
        options: [
          { value: "per_day", label: "Per day" },
          { value: "per_week", label: "Per week" },
          { value: "per_month", label: "Per month" },
          { value: "per_entry", label: "Per entry" },
          { value: "per_head", label: "Per head" },
          { value: "per_sqm", label: "Per square metre" },
        ],
      },
    ],
    columns: [
      { key: "fee_types", label: "Fee type" },
      { key: "rate_class", label: "Class" },
      { key: "effective_from", label: "From" },
      { key: "effective_to", label: "To" },
      { key: "amount", label: "Amount" },
      { key: "basis", label: "Basis" },
    ],
    select: "id, rate_class, effective_from, effective_to, amount, basis, fee_types(name)",
    orderBy: "effective_from",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "form-types",
    table: "form_types",
    title: "Accountable form types",
    singular: "form type",
    schema: z.object({ code: name, name, active: z.boolean() }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. OR51" },
      { name: "name", label: "Name", type: "text" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
    ],
    select: "id, code, name, active",
    orderBy: "code",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "booklets",
    table: "booklets",
    title: "OR booklets",
    singular: "booklet",
    schema: z.object({
      form_type_id: uuid,
      serial_prefix: name,
      start_no: z.number().int().positive(),
      end_no: z.number().int().positive(),
      received_date: isoDate,
      status: z.enum(["received", "assigned", "in_use", "returned", "exhausted"]),
    }),
    fields: [
      { name: "form_type_id", label: "Form type", type: "select", optionsFrom: "form-types" },
      { name: "serial_prefix", label: "Serial prefix", type: "text" },
      { name: "start_no", label: "First serial", type: "number" },
      { name: "end_no", label: "Last serial", type: "number" },
      { name: "received_date", label: "Received", type: "date" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "received", label: "Received" },
          { value: "assigned", label: "Assigned" },
          { value: "in_use", label: "In use" },
          { value: "returned", label: "Returned" },
          { value: "exhausted", label: "Exhausted" },
        ],
      },
    ],
    columns: [
      { key: "serial_prefix", label: "Prefix" },
      { key: "start_no", label: "From" },
      { key: "end_no", label: "To" },
      { key: "received_date", label: "Received" },
      { key: "status", label: "Status" },
    ],
    select: "id, serial_prefix, start_no, end_no, received_date, status, form_types(code)",
    orderBy: "start_no",
    writeRoles: SUPERVISOR_UP,
  },
  {
    key: "devices",
    table: "devices",
    title: "Tablets",
    singular: "tablet",
    schema: z.object({ label: name, active: z.boolean() }),
    fields: [
      { name: "label", label: "Label", type: "text", help: "e.g. Tablet 01. Tablets are shared between collectors." },
      { name: "active", label: "Active", type: "boolean", help: "Deactivating refuses this tablet's uploads." },
    ],
    columns: [
      { key: "label", label: "Tablet" },
      { key: "registered_at", label: "Registered" },
      { key: "last_seen_at", label: "Last seen" },
      { key: "active", label: "Active" },
    ],
    select: "id, label, registered_at, last_seen_at, active",
    orderBy: "label",
    writeRoles: SUPERVISOR_UP,
  },
  {
    key: "users",
    table: "app_users",
    title: "Staff",
    singular: "staff member",
    schema: z.object({
      employee_no: name,
      full_name: name,
      role: z.enum(["collector", "supervisor", "accounting", "admin"]),
      status: z.enum(["active", "suspended"]),
    }),
    fields: [
      { name: "employee_no", label: "Employee number", type: "text" },
      { name: "full_name", label: "Full name", type: "text" },
      {
        name: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "collector", label: "Collector (tablet only)" },
          { value: "supervisor", label: "Supervisor" },
          { value: "accounting", label: "Accounting" },
          { value: "admin", label: "Administrator" },
        ],
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "suspended", label: "Suspended" },
        ],
      },
    ],
    columns: [
      { key: "employee_no", label: "Employee no." },
      { key: "full_name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "status", label: "Status" },
    ],
    select: "id, employee_no, full_name, role, status",
    orderBy: "full_name",
    writeRoles: ADMIN_ONLY,
  },
];

for (const config of configs) registerResource(config);
```

- [ ] **Step 4: Write the seed**

`supabase/seed.sql`:

```sql
-- Local development seed. Never applied to production.
insert into ceedo_collections.facilities (code, name, type) values
  ('CPM',  'Central Public Market',          'market'),
  ('IBJT', 'Integrated Bus & Jeepney Terminal', 'terminal'),
  ('SLH',  'City Slaughterhouse',            'slaughterhouse'),
  ('PRK',  'City Hall Parking',              'parking');

insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
select id, section_name, 'daily'::ceedo_collections.accrual_period
from ceedo_collections.facilities,
     (values ('Fish'), ('Meat'), ('Vegetable')) as s(section_name)
where code = 'CPM';

insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
select id, 'Dry Goods', 'monthly' from ceedo_collections.facilities where code = 'CPM';

insert into ceedo_collections.stalls (section_id, stall_no)
select s.id, s.name || '-' || lpad(n::text, 2, '0')
from ceedo_collections.sections s, generate_series(1, 20) n
where s.facility_id = (select id from ceedo_collections.facilities where code = 'CPM');

insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps) values
  ('MKT_DAILY',  'Market stall rental (daily)',   true,  300),
  ('MKT_MONTHLY','Market stall rental (monthly)', true,  300),
  ('AMBULANT',   'Ambulant vendor fee',           false, 0),
  ('PARKING',    'Parking fee',                   false, 0),
  ('TERMINAL',   'Terminal fee',                  false, 0),
  ('SLAUGHTER',  'Slaughter fee',                 false, 0);

insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
select id, '', '2026-01-01', 120.00, 'per_day' from ceedo_collections.fee_types where code = 'MKT_DAILY'
union all
select id, '', '2026-01-01', 3000.00, 'per_month' from ceedo_collections.fee_types where code = 'MKT_MONTHLY'
union all
select id, '', '2026-01-01', 20.00, 'per_day' from ceedo_collections.fee_types where code = 'AMBULANT'
union all
select id, '', '2026-01-01', 20.00, 'per_entry' from ceedo_collections.fee_types where code = 'PARKING'
union all
select id, 'bus', '2026-01-01', 30.00, 'per_entry' from ceedo_collections.fee_types where code = 'TERMINAL'
union all
select id, 'jeepney', '2026-01-01', 15.00, 'per_entry' from ceedo_collections.fee_types where code = 'TERMINAL'
union all
select id, 'hog', '2026-01-01', 85.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER'
union all
select id, 'cattle', '2026-01-01', 250.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER'
union all
select id, 'goat', '2026-01-01', 45.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER';

insert into ceedo_collections.form_types (code, name) values
  ('OR51', 'Official Receipt (Accountable Form 51)');
```

- [ ] **Step 5: Reset, seed and run everything**

Run: `supabase db reset && pnpm db:types && pnpm typecheck && pnpm build && pnpm test`
Expected: all pass. `supabase db reset` applies `seed.sql` automatically.

- [ ] **Step 6: Smoke-test the app by hand**

Run: `pnpm --filter @ceedo/web dev`

Then, with a Google OAuth client configured in `.env`:
1. Visit `http://localhost:3000` — redirected to `/sign-in`.
2. Sign in with a Google account that has **no** `app_users` row — expect `/no-access`.
3. Insert an `app_users` row for that account with role `admin` via `supabase studio`.
4. Sign in again — expect the admin shell listing Facilities through Staff.
5. Open **Sections**, try adding a section to `IBJT` — expect the message "Sections may only belong to a market facility, not terminal".

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/admin/registry.ts supabase/seed.sql tests
git commit -m "feat(web): register Phase 1 admin resources and add development seed"
```

---

---

### Task 14: Audit log

Spec §11.4: every consequential action is logged with actor, timestamp, entity and before/after. Each action it names — changing a rate, assigning or returning a booklet, creating or deactivating a user — happens in Phase 1, so the log belongs here rather than later.

**Files:**
- Create: `supabase/migrations/20260917000008_audit_log.sql`
- Create: `tests/db/audit-log.test.ts`
- Modify: `apps/web/lib/admin/registry.ts`

**Interfaces:**
- Consumes: `app_users`, `active_role()`, and every master-data table from Tasks 5–9
- Produces:
  - Table `ceedo_collections.audit_log`
  - `ceedo_collections.write_audit()` trigger function
  - `ceedo_collections.attach_audit(table_name text)` installer
  - Read-only registry entry `audit-log`

- [ ] **Step 1: Write the failing tests**

`tests/db/audit-log.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

describe("audit log", () => {
  let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];
  let adminId: string;

  beforeAll(async () => {
    const created = await createAppUser({ email: "audit-admin@example.com", role: "admin" });
    adminClient = created.client;
    adminId = created.userId;
  });

  it("records an insert with the acting user", async () => {
    const { data: facility } = await adminClient
      .from("facilities")
      .insert({ name: "Audited Market", code: "AUD", type: "market" })
      .select("id")
      .single();

    const { data: entries } = await service
      .from("audit_log")
      .select("action, entity, entity_id, actor_id, before, after")
      .eq("entity_id", facility!.id);

    expect(entries).toHaveLength(1);
    expect(entries![0]).toMatchObject({
      action: "insert",
      entity: "facilities",
      actor_id: adminId,
      before: null,
    });
    expect((entries![0]!.after as Record<string, unknown>).code).toBe("AUD");
  });

  it("records an update with both before and after", async () => {
    const { data: facility } = await adminClient
      .from("facilities")
      .insert({ name: "Before Name", code: "UPD", type: "market" })
      .select("id")
      .single();

    await adminClient.from("facilities").update({ name: "After Name" }).eq("id", facility!.id);

    const { data: entries } = await service
      .from("audit_log")
      .select("action, before, after")
      .eq("entity_id", facility!.id)
      .eq("action", "update");

    expect(entries).toHaveLength(1);
    expect((entries![0]!.before as Record<string, unknown>).name).toBe("Before Name");
    expect((entries![0]!.after as Record<string, unknown>).name).toBe("After Name");
  });

  it("logs rate changes", async () => {
    const { data: feeType } = await service
      .from("fee_types")
      .insert({ code: "AUDIT_FEE", name: "Audited fee", accrues: false, surcharge_bps: 0 })
      .select("id")
      .single();

    const { data: rate } = await adminClient
      .from("rates")
      .insert({
        fee_type_id: feeType!.id,
        effective_from: "2026-01-01",
        amount: 50.0,
        basis: "per_entry",
      })
      .select("id")
      .single();

    const { data: entries } = await service
      .from("audit_log")
      .select("entity")
      .eq("entity_id", rate!.id);

    expect(entries).toEqual([{ entity: "rates" }]);
  });

  it("refuses an update to an audit entry, even from an admin", async () => {
    const { data: entry } = await service.from("audit_log").select("id").limit(1).single();
    const { error } = await adminClient
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("id", entry!.id);
    expect(error).not.toBeNull();
  });

  it("refuses a delete of an audit entry, even from an admin", async () => {
    const { data: entry } = await service.from("audit_log").select("id").limit(1).single();
    const { error } = await adminClient.from("audit_log").delete().eq("id", entry!.id);
    expect(error).not.toBeNull();
  });

  it("hides the audit log from collectors", async () => {
    const { client } = await createAppUser({ email: "audit-col@example.com", role: "collector" });
    const { data } = await client.from("audit_log").select("id");
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/db/audit-log.test.ts`
Expected: FAIL — relation `audit_log` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260917000008_audit_log.sql`:

```sql
create table ceedo_collections.audit_log (
  id        bigint primary key generated always as identity,
  actor_id  uuid references ceedo_collections.app_users (id),
  action    text not null,
  entity    text not null,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);

create index audit_log_entity_idx on ceedo_collections.audit_log (entity, entity_id);
create index audit_log_actor_idx on ceedo_collections.audit_log (actor_id, at desc);

-- security definer so the trigger can write the log while the caller's own policies
-- deny them any write to it. An audit trail the actor can edit is not an audit trail.
create or replace function ceedo_collections.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  row_id uuid;
begin
  row_id := case tg_op when 'DELETE' then (to_jsonb(old) ->> 'id')::uuid
                       else (to_jsonb(new) ->> 'id')::uuid end;

  insert into ceedo_collections.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    row_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create or replace function ceedo_collections.attach_audit(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format(
    'create trigger %I after insert or update or delete on ceedo_collections.%I
       for each row execute function ceedo_collections.write_audit()',
    table_name || '_audit', table_name);
end;
$$;

select ceedo_collections.attach_audit(t) from unnest(array[
  'app_users', 'facilities', 'sections', 'stalls', 'tenants', 'leases',
  'fee_types', 'rates', 'form_types', 'booklets', 'booklet_assignments',
  'spoiled_forms', 'devices', 'device_assignments', 'collector_assignments'
]) as t;

alter table ceedo_collections.audit_log enable row level security;

create policy audit_log_read on ceedo_collections.audit_log
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Append-only, enforced by withheld privilege rather than by policy. The same
-- principle the ledger will use in Phase 2: nobody can grant themselves what was
-- never granted.
grant select on ceedo_collections.audit_log to authenticated;
revoke insert, update, delete on ceedo_collections.audit_log from authenticated, anon;
```

- [ ] **Step 4: Reset and run**

Run: `supabase db reset && pnpm vitest run tests/db/audit-log.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Add a read-only registry entry**

Append to the `configs` array in `apps/web/lib/admin/registry.ts`, before the closing `];`:

```ts
  {
    key: "audit-log",
    table: "audit_log",
    title: "Audit log",
    singular: "entry",
    schema: z.object({}),
    // No writeRoles, so the engine renders no form. The table is append-only at
    // the database and nothing in the UI may write to it.
    fields: [],
    columns: [
      { key: "at", label: "When" },
      { key: "app_users", label: "Who" },
      { key: "action", label: "Action" },
      { key: "entity", label: "Record type" },
      { key: "entity_id", label: "Record" },
    ],
    select: "id, at, action, entity, entity_id, app_users(full_name)",
    orderBy: "at",
    writeRoles: [],
  },
```

- [ ] **Step 6: Run the full suite and build**

Run: `supabase db reset && pnpm db:types && pnpm typecheck && pnpm build && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add supabase apps/web/lib/admin/registry.ts tests
git commit -m "feat(db): append-only audit log across every master-data table"
```


## Phase 1 exit criteria

Phase 1 is done when all of the following hold:

- [ ] `pnpm typecheck && pnpm build && pnpm test` pass from a clean checkout.
- [ ] `supabase db reset` applies every migration and the seed without error.
- [ ] A Google account with no `app_users` row is refused at `/no-access`.
- [ ] A collector-role account is refused from the web app.
- [ ] An admin can create a facility, section, stall, tenant, lease, fee type, rate, form type, booklet, tablet and staff member through the UI.
- [ ] Attempting a second active lease overlapping a stall is refused with a readable message.
- [ ] Attempting an overlapping rate for the same fee type and class is refused.
- [ ] `./scripts/check-types-current.sh` passes in CI.
- [ ] Changing a rate writes an audit entry naming the actor, and no role can edit or delete it.

## What Phase 1 deliberately does not build

Deferred to later phases, and not to be absorbed into this one:

| Not in Phase 1 | Phase |
| --- | --- |
| `charges`, `collections`, allocations, lines — the ledger | 2 |
| Nightly accrual job and the 3% surcharge | 2 |
| Edge Functions `sync-pull` / `sync-push` | 3 |
| The Expo collector app, PIN sign-in, outbox | 3 |
| Tenant QR cards and the scan flow | 4 |
| Parking, terminal and slaughterhouse collection entry | 5 |
| RCD, RAAF, aging and the report suite | 6 |

Phase 2 must create the ledger tables with `UPDATE` and `DELETE` withheld from every role from the very first migration — retrofitting that guarantee after rows exist is far harder than starting with it.
