# Phase 3b-ii — The Collection Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the collector app from a shift containing zero receipts to a shift containing real ones — money collected against market leases in FIFO order, ambulant fees priced from the rate table, OR serials recorded against physical booklets, and a closeout that balances.

**Architecture:** Almost all server work already exists (`post_collection`, `unpaid_period_groups`, `charge_balances`, `CollectionPayload`). This phase adds three device-authored tables that an epoch reset must never wipe, a pure-TypeScript mirror of the SQL ledger in `packages/shared` pinned against Postgres by an executing parity test, an overlay in `packages/sync-engine` that subtracts the device's own unsynced allocations, and six screens. It also corrects a defect in already-merged 3b-i code: `deviceTotals` reads a pulled table and reports `0.00` for offline receipts.

**Tech Stack:** TypeScript, Drizzle (`packages/db-local`), Expo / React Native (`apps/collector`), Next.js (`apps/web`), Supabase Postgres, Vitest, better-sqlite3 (Node test driver), expo-sqlite (device).

**Spec:** `docs/superpowers/specs/2026-09-21-phase-3b-ii-collection-round-design.md`

**Branch:** `phase-3b-ii-collection-round`, off `main` at `Merge Phase 3b-i: the device spine`.

## Global Constraints

- **Money is integer centavos in TypeScript, `numeric(14,2)` in Postgres, `text` in SQLite.** Rounding is half-up. **A float never touches a peso.** Always go through `packages/shared/src/money.ts` (`parsePesoInput`, `toDecimalString`, `fromCentavos`, `sum`, `multiply`). Never `sum()` a text column in SQL.
- **`packages/sync-engine` and `packages/db-local` may not import React Native or Expo.** Anything needing `expo-crypto` takes the value as a required argument — never a default. This is spec 3b-i E1, and the bug it exists to catch (`crypto.randomUUID()` defaulted inside `openShift`) passed every test and would have crashed at a stall.
- **The `SqliteDriver` interface is async-shaped because `expo-sqlite` is.** Never reshape it around `better-sqlite3`.
- **The device's amount is a claim, never truth.** `CollectionPayload` forbids `gross_amount` and `device_id`. Never add an amount to a payload.
- **A rejection never means discard** (parent §6.3). Rejected rows are kept and still count at closeout.
- **No message may name a cause the screen has not checked.** 3b-i bug 3: a screen that says "not synced" when the real problem is a missing rate sends someone to the wrong place.
- **Supabase env is passed inline**, not via `eval $(supabase status -o env)`.
  **This machine runs three Supabase stacks, and ceedo-collections does NOT own the
  default ports.** `school-management` holds 54321/54322 and `ccb-sms` holds 55321/55322;
  ours is on **56321/56322**. Using the documented defaults runs the suite against an
  unrelated project's database. Confirm with `docker ps --format '{{.Names}}\t{{.Ports}}'`
  before trusting any port, because `supabase status` reports the config file's values,
  not the running containers'.
  The complete set — **every one of these is needed**, because three separate helpers
  resolve their own variable and each falls back to a default port this project does not own:
  ```
  API_URL=http://127.0.0.1:56321 \
  SUPABASE_URL=http://127.0.0.1:56321 \
  ANON_KEY=<anon> \
  SERVICE_ROLE_KEY=<service> \
  DB_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres \
  SUPABASE_AUTHENTICATOR_URL=postgresql://authenticator:postgres@127.0.0.1:56322/postgres \
  pnpm test
  ```
  `SUPABASE_URL` is needed as well as `API_URL` because two cases in
  `tests/http/functions.test.ts` read only `SUPABASE_URL` before falling back — unlike
  their sibling helpers, which chain `SUPABASE_URL ?? API_URL ?? default`. Task 2 repairs
  that chain. `SUPABASE_AUTHENTICATOR_URL` is needed because `tests/helpers/authenticator.ts`
  reads nothing else, and 3b-i E5 makes that harness mandatory — silently pointing it at
  another project would connect as `authenticator` to a database that has no such role.
- **After every `supabase db reset`:** `psql "$DB_URL" -v label="'llejo android'" -v pin="'123456'" -f scripts/dev-wire-tablet.sql`, and re-issue the device credential on `/devices` and re-enrol by QR.
- **Rebuild vs reload:** if it lands in the JS bundle, reload; if it lands in the APK, rebuild. `modules/ceedo-bcrypt` fails silently on a stale build.
- **Run the full suite with `pnpm test`, never `npx vitest run` with no file argument.**
  `pnpm test` is `vitest run --no-file-parallelism`, and `tests/vitest.config.ts` sets
  `fileParallelism: false` for a stated reason: the suite shares one Postgres database and
  one single-row `settings` table, so file-level concurrency over that shared mutable state
  is flake, not signal. A parallel full run reports 13–21 failures that vary between runs
  and are caused by the invocation, not the code. `npx vitest run <specific files>` is fine
  — parallelism is moot with one file.
- **Run `supabase db reset` before any full-suite run whose result you intend to report.**
  The suite never cleans up between files, so fixtures accumulate in the long-lived local
  database and the slowest teardowns start exceeding their timeouts. Measured three times
  on this branch: an accumulated database gives 4–21 failures that look alarming and are
  not real; immediately after a reset the same commit is **809/809 across 76 files**.
  `tests/db/first-sync-budget.test.ts` is the canary — 12.2s and a hook timeout when dirty,
  767ms when fresh. A reset costs about a minute and removes a whole class of false alarm.
  Note it destroys the device row, its credential and its assignments, so the tablet needs
  re-enrolling afterwards (see Operational notes).
- **Prefer fixtures scoped to your own lease over the global jobs.** `run_accrual()` and
  `run_surcharge()` scan *every* active lease in the database, and this suite never cleans
  up between files, so calling them corrupts unrelated files' expectations. Build the
  charges you need with direct INSERTs against your own fixture's lease.
- **`apps/collector` is NOT in the vitest workspace** (`vitest.workspace.ts` is `["packages/*", "apps/web", "tests"]`). Any logic that needs a test goes in `packages/sync-engine` or `packages/shared`. Screens are verified by `pnpm typecheck`, a clean `npx expo export`, and the device session in Task 12.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/outstanding.ts` | Pure mirror of `charge_balances` + `unpaid_period_groups`. No I/O. |
| `packages/shared/src/outstanding.test.ts` | Unit tests for the above. |
| `packages/sync-engine/src/ledger.ts` | Reads local tables through `SqliteDriver`, applies the unsynced-allocation overlay. |
| `packages/sync-engine/src/ledger.test.ts` | Overlay behaviour, including rejected entries. |
| `packages/sync-engine/src/collect.ts` | `orEntryContext` + `commitReceipt` — the one-transaction write. |
| `packages/sync-engine/src/collect.test.ts` | Atomicity, OR validation, payload shape. |
| `apps/collector/src/collect/draft.ts` | Module-level store for the receipt in progress. |
| `apps/collector/src/app/leases.tsx` | Search by stall number or tenant name. |
| `apps/collector/src/app/lease/[leaseId].tsx` | Period groups, both entry modes, staleness disclosure. |
| `apps/collector/src/app/receipt.tsx` | OR entry and confirm. |
| `apps/collector/src/app/ambulant.tsx` | Lines receipt, no lease. |
| `apps/collector/src/app/spoil.tsx` | Mark a serial spoiled. |
| `docs/superpowers/measurements/phase-3b-ii-device-smoke.md` | Task 12's checklist. |

**Modified:**

| Path | Change |
| --- | --- |
| `apps/web/lib/admin/registry.ts` | Two new resources (Task 1). |
| `tests/db/registry-parity.test.ts` | Two new table names (Task 1). |
| `packages/db-local/src/schema.ts` | Three device-authored tables (Task 2). |
| `packages/db-local/drizzle/` | Generated migration (Task 2). |
| `packages/shared/src/index.ts` | Export `./outstanding` (Task 3). |
| `tests/db/parity.test.ts` | Ledger parity block (Task 3). |
| `packages/sync-engine/src/index.ts` | Export `./ledger`, `./collect` (Tasks 4, 6). |
| `packages/sync-engine/src/shift.ts:~118` | `deviceTotals` reads `local_collections` (Task 5). |
| `packages/sync-engine/src/shift.test.ts` | Offline-total test (Task 5). |
| `apps/collector/src/app/shift.tsx` | Three new buttons, receipt count, `purgeAcked` caller (Tasks 7, 11). |
| `apps/collector/app.json` | Android package identifier (Task 11). |

---

## Task 1: Admin screens for device and collector assignments

Spec F9. This is first because no tablet can be commissioned through the UI without it, and that absence is what made two of 3b-i's four device-found bugs reachable.

**Files:**
- Modify: `apps/web/lib/admin/registry.ts`
- Modify: `tests/db/registry-parity.test.ts:6-19`

**Interfaces:**
- Consumes: `registerResource`, `ResourceConfig` from `./resource`; the `uuid`, `name` helpers already defined at the top of `registry.ts`.
- Produces: resource keys `"device-assignments"` and `"collector-assignments"`, usable as `optionsFrom` targets by later resources.

**Roles mirror RLS exactly, and they are not the same for the two tables.** Migration `0008` adds supervisors to `device_assignments` but **not** to `collector_assignments`, which stays admin-only under `apply_master_data_policies`. `resource.ts` states that a role listed here but denied by policy gets an empty screen.

- [ ] **Step 1: Add the two table names to the parity test**

In `tests/db/registry-parity.test.ts`, extend the `TABLES` array:

```ts
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
  "staff_invites",
  "device_assignments",
  "collector_assignments",
];
```

- [ ] **Step 2: Run it and watch it pass for the wrong reason**

```bash
API_URL=http://127.0.0.1:54321 ANON_KEY=<anon> SERVICE_ROLE_KEY=<service> \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
npx vitest run tests/db/registry-parity.test.ts
```

Expected: **PASS**. The tables already exist; this test only proves they are readable. Note this in your commit — it is coverage, not a red test. The real verification of this task is Step 5.

- [ ] **Step 3: Add both resources to the registry**

Insert into the `configs` array in `apps/web/lib/admin/registry.ts`, after the `devices` entry:

```ts
  {
    // Determines WHAT DATA SYNCS TO A TABLET. Supervisors may write this (migration 0008
    // lists device_assignments among the five supervisor-writable tables); the roles here
    // mirror that policy rather than restating a preference.
    //
    // device_assignments_one_active is a unique index on (device_id) where active, so a
    // device can hold exactly one active assignment. Re-assigning a tablet means clearing
    // `active` on the current row first; a second active row is refused by the database
    // with 23505 and the form surfaces that error rather than swallowing it.
    key: "device-assignments",
    table: "device_assignments",
    title: "Tablet assignments",
    singular: "tablet assignment",
    schema: z.object({
      device_id: uuid,
      facility_id: uuid,
      section_id: uuid.nullable(),
      active: z.boolean(),
    }),
    fields: [
      { name: "device_id", label: "Tablet", type: "select", optionsFrom: "devices" },
      { name: "facility_id", label: "Facility", type: "select", optionsFrom: "facilities" },
      {
        name: "section_id",
        label: "Section",
        type: "select",
        optionsFrom: "sections",
        optional: true,
        help: "Leave blank to assign the whole facility. A terminal or slaughterhouse has no sections.",
      },
      {
        name: "active",
        label: "Active",
        type: "boolean",
        help: "A tablet may hold only one active assignment. Deactivate the current one before adding another.",
      },
    ],
    columns: [
      { key: "devices", label: "Tablet" },
      { key: "facilities", label: "Facility" },
      { key: "sections", label: "Section" },
      { key: "active", label: "Active" },
    ],
    select: "id, active, devices(label), facilities(name), sections(name)",
    orderBy: "created_at",
    optionLabel: "id",
    readRoles: BACK_OFFICE,
    writeRoles: SUPERVISOR_UP,
  },
  {
    // Determines WHERE A PERSON MAY COLLECT. Admin-only: migration 0008 does NOT list
    // collector_assignments, so apply_master_data_policies' admin-only rule stands.
    //
    // A trigger refuses any assignee whose app_users role is not 'collector'. The picker
    // cannot filter by role (optionsFrom takes a resource, not a predicate), so a wrong
    // choice is refused by the database with 23514 and its message is shown as-is.
    key: "collector-assignments",
    table: "collector_assignments",
    title: "Collection areas",
    singular: "collection area",
    schema: z.object({
      collector_id: uuid,
      facility_id: uuid,
      section_id: uuid.nullable(),
      active: z.boolean(),
    }),
    fields: [
      {
        name: "collector_id",
        label: "Collector",
        type: "select",
        optionsFrom: "users",
        help: "Collectors only. Another role is refused by the database.",
      },
      { name: "facility_id", label: "Facility", type: "select", optionsFrom: "facilities" },
      {
        name: "section_id",
        label: "Section",
        type: "select",
        optionsFrom: "sections",
        optional: true,
        help: "Leave blank to assign the whole facility.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "app_users", label: "Collector" },
      { key: "facilities", label: "Facility" },
      { key: "sections", label: "Section" },
      { key: "active", label: "Active" },
    ],
    select: "id, active, app_users(full_name), facilities(name), sections(name)",
    orderBy: "created_at",
    optionLabel: "id",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. `table:` is typed as `keyof Database["ceedo_collections"]["Tables"]`, so a misspelling fails here.

- [ ] **Step 5: Commission a tablet through the UI only, and prove the SQL script is no longer needed**

```bash
pnpm db:reset
pnpm --filter @ceedo/web dev
```

Without running `scripts/dev-wire-tablet.sql`, sign in as an admin and: create a device on `/devices`, add a tablet assignment on `/device-assignments`, add a collection area on `/collector-assignments`. Then confirm the negative paths:

1. Adding a **second active** assignment for the same tablet is refused, and the screen shows the error rather than appearing to succeed.
2. Choosing a **supervisor** as the collector on a collection area is refused with the trigger's message.

Record both outcomes in the commit message. A screen that silently swallows a constraint violation is the failure mode this task exists to remove.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/admin/registry.ts tests/db/registry-parity.test.ts
git commit -m "feat(web): screens for tablet assignments and collection areas

A tablet could not be taken from enrolled to working through the UI alone;
the rows had to be written by hand with scripts/dev-wire-tablet.sql. That
state was unreachable from the admin screens, which is why two of Phase
3b-i's four device-found bugs had never been seen by anyone.

Roles mirror RLS rather than preference: supervisors may write tablet
assignments (migration 0008 lists that table), collection areas stay
admin-only. Verified by commissioning a tablet from a clean db reset with
the SQL script untouched, including the two refusal paths."
```

---

## Task 2: Three device-authored tables

Spec F1. A receipt the device wrote cannot live in a pulled table, because an epoch reset empties those and would destroy unsynced cash silently.

**Files:**
- Modify: `packages/db-local/src/schema.ts`
- Modify: `packages/db-local/src/schema.test.ts`
- Create: `packages/db-local/drizzle/<generated>.sql` (by `drizzle-kit`)

**Interfaces:**
- Produces: `localCollections`, `localAllocations`, `localLines` table objects; `DEVICE_AUTHORED_TABLES` extended to seven entries. Later tasks query these by their SQL names `local_collections`, `local_allocations`, `local_lines`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db-local/src/schema.test.ts`:

```ts
import { DEVICE_AUTHORED_TABLES, PULLED_TABLES } from "./schema";

describe("device-authored receipts", () => {
  // Spec F1. The reset (3b-i E8) empties every PULLED table. A receipt sitting in the
  // outbox with its only local record in `collections` would be destroyed by a supervisor
  // changing a device assignment -- silently, because the outbox entry carries no amount
  // to notice its absence by.
  it.each(["local_collections", "local_allocations", "local_lines"])(
    "%s is device-authored and never pulled",
    (table) => {
      expect(DEVICE_AUTHORED_TABLES).toContain(table);
      expect(PULLED_TABLES).not.toContain(table);
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/db-local
```

Expected: FAIL, three times — `expected [ 'sync_state', 'outbox', 'local_shifts', 'pin_attempts' ] to include 'local_collections'`.

- [ ] **Step 3: Add the three tables**

In `packages/db-local/src/schema.ts`, after the `pinAttempts` table and **before** the `DEVICE_AUTHORED_TABLES` array:

```ts
/**
 * Receipts this device authored, before the server has them. Spec F1.
 *
 * NOT the mirrored `collections` table, and the distinction is load-bearing: `collections`
 * is in PULLED_TABLES, which an epoch reset empties. A receipt taken offline whose only
 * local record lived there would be destroyed by a supervisor changing a device
 * assignment, and destroyed without trace -- the outbox entry carries no amount, so
 * nothing downstream could notice the loss.
 *
 * `id` is the same client-generated UUID the outbox row uses. One receipt, one id, in both
 * places, which is what makes the push idempotent and the join trivial.
 *
 * `grossAmount` is what THIS DEVICE computed. It is a claim, not truth -- the payload
 * carries no amount at all and the server recomputes from the rate table (invariant #3).
 * It is stored because parent §6.5's closeout comparison needs two sides; without it there
 * is one figure, and a single figure agrees with itself.
 */
export const localCollections = sqliteTable("local_collections", {
  id: text("id").primaryKey(),
  orNo: integer("or_no").notNull(),
  bookletId: text("booklet_id").notNull(),
  collectorId: text("collector_id").notNull(),
  shiftId: text("shift_id").notNull(),
  collectedAt: text("collected_at").notNull(),
  feeTypeId: text("fee_type_id").notNull(),
  leaseId: text("lease_id"),
  // money: text, 2dp, via toDecimalString. Never a float.
  grossAmount: text("gross_amount").notNull(),
  payerRef: text("payer_ref"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/**
 * Which charges this device believes it settled.
 *
 * RESOLVED CHARGE IDS, not the group ranks the payload carries. A rank is meaningless the
 * moment the list it indexes changes, and the whole purpose of these rows is to let the
 * local ledger subtract what this device has already collected (spec F4).
 */
export const localAllocations = sqliteTable(
  "local_allocations",
  {
    collectionId: text("collection_id").notNull(),
    chargeId: text("charge_id").notNull(),
    amount: text("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.chargeId] })],
);

/** On-the-spot items: quantity x rate. The ambulant receipt, and Phase 5's shape. */
export const localLines = sqliteTable("local_lines", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull(),
  feeTypeId: text("fee_type_id").notNull(),
  rateClass: text("rate_class"),
  quantity: integer("quantity").notNull(),
  unitRate: text("unit_rate").notNull(),
  amount: text("amount").notNull(),
});
```

Then extend the array:

```ts
export const DEVICE_AUTHORED_TABLES = [
  "sync_state",
  "outbox",
  "local_shifts",
  "pin_attempts",
  "local_collections",
  "local_allocations",
  "local_lines",
] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/db-local
```

Expected: PASS, including the pre-existing test that forbids a table appearing in both halves.

- [ ] **Step 5: Generate and inspect the migration**

```bash
pnpm --filter @ceedo/db-local generate
git status --short packages/db-local/drizzle
```

Expected: one new `.sql` file plus an updated journal. **Read the generated SQL** and confirm it contains three `CREATE TABLE` statements and **no `DROP`**. A drop in a generated migration means the schema was edited in a way drizzle read as a rename; stop and fix the schema rather than shipping the migration.

- [ ] **Step 6: Falsification check — prove the reset test can see this**

Temporarily add `"local_collections"` to the wipe loop in `packages/sync-engine/src/reset.ts`, add a `local_collections` table and one row to `reset.test.ts`'s `SCHEMA` fixture, and run:

```bash
npx vitest run packages/sync-engine/src/reset.test.ts
```

Expected: the E8 test **FAILS**, showing unsynced cash destroyed. Revert both edits and re-run to confirm green. Record the observed failure message in the commit.

- [ ] **Step 7: Commit**

```bash
git add packages/db-local/src/schema.ts packages/db-local/src/schema.test.ts packages/db-local/drizzle
git commit -m "feat(db-local): device-authored receipt tables the reset must never touch

local_collections, local_allocations and local_lines. Not the mirrored
collections table: that one is in PULLED_TABLES, which an epoch reset
empties, so a receipt taken offline would be destroyed by a supervisor
changing a device assignment -- and destroyed silently, because the outbox
entry carries no amount to notice its absence by.

Falsification: adding local_collections to the reset's wipe loop makes the
E8 test fail, so the guarantee is tested rather than asserted."
```

---

## Task 3: `outstanding.ts` — the ledger mirror, pinned to the SQL

Spec F3. One rule, two languages, checked by executing both.

**Files:**
- Create: `packages/shared/src/outstanding.ts`
- Create: `packages/shared/src/outstanding.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `tests/db/parity.test.ts`

**Interfaces:**
- Consumes: `Centavos`, `fromCentavos`, `sum` from `./money`; `PeriodGroup` from `./fifo`.
- Produces:
  ```ts
  export interface LedgerCharge {
    id: string; leaseId: string; chargeType: string;
    dueDate: string; periodStart: string; periodEnd: string; amount: Centavos;
  }
  export interface LedgerAllocation { collectionId: string; chargeId: string; amount: Centavos }
  export interface LedgerCondonation { chargeId: string; amount: Centavos }
  export interface LedgerInput {
    charges: readonly LedgerCharge[];
    allocations: readonly LedgerAllocation[];
    condonations: readonly LedgerCondonation[];
    cancelledCollectionIds: ReadonlySet<string>;
  }
  export function chargeBalance(charge: LedgerCharge, input: LedgerInput): Centavos
  export function unpaidPeriodGroups(input: LedgerInput, leaseId: string): PeriodGroup[]
  ```

- [ ] **Step 1: Write the failing unit tests**

Create `packages/shared/src/outstanding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import {
  chargeBalance,
  unpaidPeriodGroups,
  type LedgerCharge,
  type LedgerInput,
} from "./outstanding";

const charge = (over: Partial<LedgerCharge> & { id: string }): LedgerCharge => ({
  leaseId: "L1",
  chargeType: "rental",
  dueDate: "2026-03-01",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  amount: fromCentavos(10_000),
  ...over,
});

const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  charges: [],
  allocations: [],
  condonations: [],
  cancelledCollectionIds: new Set(),
  ...over,
});

describe("chargeBalance", () => {
  it("is the full amount when nothing points at it", () => {
    const c = charge({ id: "c1" });
    expect(chargeBalance(c, input({ charges: [c] }))).toBe(10_000);
  });

  it("subtracts allocations and condonations", () => {
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [{ collectionId: "k1", chargeId: "c1", amount: fromCentavos(3_000) }],
          condonations: [{ chargeId: "c1", amount: fromCentavos(2_000) }],
        }),
      ),
    ).toBe(5_000);
  });

  it("sums two allocations against one charge rather than collapsing them", () => {
    // charge_balances SUMS. Two collections against one charge is the double payment
    // migration 0032's row lock exists to prevent; a ledger that collapsed them would
    // report that failure as correctly settled and hide the condition the lock makes
    // visible.
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [
            { collectionId: "k1", chargeId: "c1", amount: fromCentavos(4_000) },
            { collectionId: "k2", chargeId: "c1", amount: fromCentavos(4_000) },
          ],
        }),
      ),
    ).toBe(2_000);
  });

  it("ignores allocations belonging to a cancelled collection", () => {
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [{ collectionId: "k1", chargeId: "c1", amount: fromCentavos(10_000) }],
          cancelledCollectionIds: new Set(["k1"]),
        }),
      ),
    ).toBe(10_000);
  });
});

describe("unpaidPeriodGroups", () => {
  it("groups a rental with its surcharge and ranks oldest first", () => {
    const rentalMar = charge({ id: "r-mar" });
    const surchMar = charge({
      id: "s-mar",
      chargeType: "surcharge",
      amount: fromCentavos(300),
    });
    const rentalApr = charge({
      id: "r-apr",
      dueDate: "2026-04-01",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });

    const groups = unpaidPeriodGroups(
      input({ charges: [rentalApr, surchMar, rentalMar] }),
      "L1",
    );

    expect(groups).toEqual([
      {
        groupRank: 1,
        dueDate: "2026-03-01",
        periodStart: "2026-03-01",
        chargeIds: ["r-mar", "s-mar"],
        outstanding: 10_300,
      },
      {
        groupRank: 2,
        dueDate: "2026-04-01",
        periodStart: "2026-04-01",
        chargeIds: ["r-apr"],
        outstanding: 10_000,
      },
    ]);
  });

  it("places an opening balance before every accrued period", () => {
    // The SQL orders by (due_date, period_start). An opening balance carries the real
    // oldest-unpaid date from the paper record. Ordering by created_at would put it LAST
    // and a tenant would settle this month's rent while two years of arrears sat
    // untouched.
    const current = charge({ id: "now", dueDate: "2026-09-01", periodStart: "2026-09-01" });
    const opening = charge({ id: "ob", dueDate: "2024-01-01", periodStart: "2024-01-01" });

    const groups = unpaidPeriodGroups(input({ charges: [current, opening] }), "L1");
    expect(groups.map((g) => g.chargeIds[0])).toEqual(["ob", "now"]);
  });

  it("omits a fully settled group and closes the rank gap", () => {
    const paid = charge({ id: "p", dueDate: "2026-03-01", periodStart: "2026-03-01" });
    const owing = charge({ id: "o", dueDate: "2026-04-01", periodStart: "2026-04-01" });

    const groups = unpaidPeriodGroups(
      input({
        charges: [paid, owing],
        allocations: [{ collectionId: "k1", chargeId: "p", amount: fromCentavos(10_000) }],
      }),
      "L1",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupRank).toBe(1);
    expect(groups[0]!.chargeIds).toEqual(["o"]);
  });

  it("excludes charges belonging to another lease", () => {
    const mine = charge({ id: "m" });
    const theirs = charge({ id: "t", leaseId: "L2" });
    const groups = unpaidPeriodGroups(input({ charges: [mine, theirs] }), "L1");
    expect(groups.flatMap((g) => g.chargeIds)).toEqual(["m"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/shared/src/outstanding.test.ts
```

Expected: FAIL — `Failed to resolve import "./outstanding"`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/outstanding.ts`:

```ts
import { fromCentavos, type Centavos } from "./money";
import { type PeriodGroup } from "./fifo";

/**
 * The device's copy of what is owed. Spec F3.
 *
 * This is a TypeScript mirror of two things in migration 20260918000019: the
 * `charge_balances` view and the `unpaid_period_groups(uuid)` function. It exists because
 * parent §5.2 says outstanding is computed and never stored, and the device must compute
 * it offline from rows it already holds.
 *
 * TWO DEFINITIONS OF ONE RULE IS A DRIFT RISK, so tests/db/parity.test.ts EXECUTES both
 * against one fixture rather than comparing them by reading. A matching comment is not a
 * test.
 *
 * Pure: no I/O, no driver, no clock. packages/sync-engine/src/ledger.ts does the reading.
 */

export interface LedgerCharge {
  id: string;
  leaseId: string;
  /** 'rental' | 'surcharge' | 'opening_balance'. Kept as a string: the device is a cache. */
  chargeType: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: Centavos;
}

export interface LedgerAllocation {
  collectionId: string;
  chargeId: string;
  amount: Centavos;
}

export interface LedgerCondonation {
  chargeId: string;
  amount: Centavos;
}

export interface LedgerInput {
  charges: readonly LedgerCharge[];
  allocations: readonly LedgerAllocation[];
  condonations: readonly LedgerCondonation[];
  /** Collections with a cancellation row. Their allocations stop counting. */
  cancelledCollectionIds: ReadonlySet<string>;
}

/**
 * amount - allocated - condoned, exactly as the view computes it.
 *
 * The cancelled-collection exclusion is not optional. The SQL calls omitting it "the
 * easiest mistake in the phase to make and the hardest to notice": the ledger would report
 * voided money as received and every downstream figure would agree with it.
 */
export function chargeBalance(charge: LedgerCharge, input: LedgerInput): Centavos {
  let allocated = 0;
  for (const a of input.allocations) {
    if (a.chargeId !== charge.id) continue;
    if (input.cancelledCollectionIds.has(a.collectionId)) continue;
    allocated += a.amount;
  }

  let condoned = 0;
  for (const k of input.condonations) {
    if (k.chargeId === charge.id) condoned += k.amount;
  }

  return fromCentavos(charge.amount - allocated - condoned);
}

/**
 * The FIFO-ordered groups of what a lease still owes.
 *
 * Grouped by (due_date, period_start, period_end) and ordered by (due_date, period_start),
 * which is the SQL's ordering verbatim. `chargeIds` is ordered by charge_type to match
 * `array_agg(b.id order by b.charge_type)` -- so a rental sorts before its surcharge, and
 * the parity test can compare the arrays element by element.
 *
 * `is_settled` in SQL is `outstanding <= 0`, not `= 0`. An over-allocation must not
 * resurrect a period, so the comparison here is `<= 0` too.
 */
export function unpaidPeriodGroups(input: LedgerInput, leaseId: string): PeriodGroup[] {
  const buckets = new Map<
    string,
    { dueDate: string; periodStart: string; entries: { id: string; chargeType: string }[]; outstanding: number }
  >();

  for (const charge of input.charges) {
    if (charge.leaseId !== leaseId) continue;
    const outstanding = chargeBalance(charge, input);
    if (outstanding <= 0) continue;

    const key = `${charge.dueDate}|${charge.periodStart}|${charge.periodEnd}`;
    const bucket = buckets.get(key) ?? {
      dueDate: charge.dueDate,
      periodStart: charge.periodStart,
      entries: [],
      outstanding: 0,
    };
    bucket.entries.push({ id: charge.id, chargeType: charge.chargeType });
    bucket.outstanding += outstanding;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.periodStart.localeCompare(b.periodStart)
        : a.dueDate.localeCompare(b.dueDate),
    )
    .map((bucket, index) => ({
      groupRank: index + 1,
      dueDate: bucket.dueDate,
      periodStart: bucket.periodStart,
      chargeIds: [...bucket.entries]
        .sort((a, b) => a.chargeType.localeCompare(b.chargeType))
        .map((e) => e.id),
      outstanding: fromCentavos(bucket.outstanding),
    }));
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add the line in alphabetical position (after `./money`):

```ts
export * from "./outstanding";
```

- [ ] **Step 5: Run the unit tests**

```bash
npx vitest run packages/shared/src/outstanding.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Write the parity test — the one that matters**

Append to `tests/db/parity.test.ts`. **The fixture must contain a surcharge, a condonation and a cancelled collection**, because a fixture with none of them passes whatever the TypeScript does (spec §4.2, vacuous shape 1).

```ts
describe("ledger parity: unpaid_period_groups", () => {
  it("SQL and TypeScript agree on a lease carrying all four inputs", async () => {
    // A lease with several overdue monthly periods, so the surcharge job has something to
    // act on, and enough periods that a prefix is meaningful.
    const fx = await createCollectionFixture(db, {
      accrualPeriod: "monthly",
      startDate: "2026-01-01",
      dueDay: 5,
      rateAmount: "1500.00",
    });

    await db.query("select ceedo_collections.run_accrual()");
    await db.query("select ceedo_collections.run_surcharge()");

    // A condonation on one charge, and a collection that is then cancelled. Without these
    // the fixture exercises neither subtraction and the comparison is vacuous.
    const { rows: chargeRows } = await db.query<{ id: string }>(
      `select id from ceedo_collections.charges
        where lease_id = $1 and charge_type = 'rental'
        order by due_date limit 2`,
      [fx.leaseId],
    );
    expect(chargeRows.length).toBe(2);

    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, reason, authority_ref, condoned_by)
       values ($1, '100.00', 'parity fixture', 'ORD-PARITY', $2)`,
      [chargeRows[1]!.id, fx.collectorId],
    );

    const cancelledId = randomUUID();
    await db.query("select ceedo_collections.post_collection($1::jsonb)", [
      JSON.stringify({
        id: cancelledId,
        or_no: 900001,
        booklet_id: fx.bookletId,
        collector_id: fx.collectorId,
        device_id: fx.deviceId,
        collected_at: new Date().toISOString(),
        fee_type_id: fx.feeTypeId,
        lease_id: fx.leaseId,
        allocations: [{ group_rank: 1 }],
        lines: [],
      }),
    ]);
    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by) values ($1, 'parity fixture', $2)`,
      [cancelledId, fx.collectorId],
    );

    // --- the SQL side ---
    const { rows: sqlGroups } = await db.query<{
      group_rank: number;
      due_date: string;
      period_start: string;
      charge_ids: string[];
      outstanding: string;
    }>(
      `select group_rank, due_date::text, period_start::text, charge_ids, outstanding::text
         from ceedo_collections.unpaid_period_groups($1) order by group_rank`,
      [fx.leaseId],
    );

    // --- the TypeScript side, fed the same rows the device would hold ---
    const { rows: charges } = await db.query(
      `select id, lease_id, charge_type, due_date::text as due_date,
              period_start::text as period_start, period_end::text as period_end,
              amount::text as amount
         from ceedo_collections.charges where lease_id = $1`,
      [fx.leaseId],
    );
    const { rows: allocations } = await db.query(
      `select collection_id, charge_id, amount::text as amount
         from ceedo_collections.collection_allocations`,
    );
    const { rows: condonations } = await db.query(
      `select charge_id, amount::text as amount from ceedo_collections.charge_condonations`,
    );
    const { rows: cancelled } = await db.query(
      `select collection_id from ceedo_collections.collection_cancellations`,
    );

    const tsGroups = unpaidPeriodGroups(
      {
        charges: charges.map((r) => ({
          id: r.id,
          leaseId: r.lease_id,
          chargeType: r.charge_type,
          dueDate: r.due_date,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          amount: parsePesoInput(r.amount),
        })),
        allocations: allocations.map((r) => ({
          collectionId: r.collection_id,
          chargeId: r.charge_id,
          amount: parsePesoInput(r.amount),
        })),
        condonations: condonations.map((r) => ({
          chargeId: r.charge_id,
          amount: parsePesoInput(r.amount),
        })),
        cancelledCollectionIds: new Set(cancelled.map((r) => r.collection_id)),
      },
      fx.leaseId,
    );

    // The fixture is only meaningful if it produced several groups AND exercised all four
    // inputs. Asserting that here stops a future change quietly emptying it.
    expect(sqlGroups.length).toBeGreaterThan(2);
    expect(condonations.length).toBeGreaterThan(0);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(
      charges.some((r: { charge_type: string }) => r.charge_type === "surcharge"),
    ).toBe(true);

    expect(tsGroups).toEqual(
      sqlGroups.map((g) => ({
        groupRank: g.group_rank,
        dueDate: g.due_date,
        periodStart: g.period_start,
        chargeIds: g.charge_ids,
        outstanding: parsePesoInput(g.outstanding),
      })),
    );
  });
});
```

Add to that file's imports: `unpaidPeriodGroups`, `parsePesoInput` from `@ceedo/shared`, and `createCollectionFixture` (already imported).

- [ ] **Step 7: Run the parity test**

```bash
API_URL=http://127.0.0.1:54321 ANON_KEY=<anon> SERVICE_ROLE_KEY=<service> \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
npx vitest run tests/db/parity.test.ts
```

Expected: PASS.

- [ ] **Step 8: Two falsification checks**

**8a.** In `outstanding.ts`, change the sort to `a.periodStart.localeCompare(b.periodStart)` keyed on nothing but insertion order — specifically, replace the `.sort(...)` comparator body with `return 0`. Re-run the parity test.
Expected: **FAIL**, with the group order differing. This proves the parity test sees ordering.

**8b.** In `chargeBalance`, delete the `if (input.cancelledCollectionIds.has(a.collectionId)) continue;` line. Re-run the parity test *and* the unit tests.
Expected: **FAIL** in both — the TypeScript reports the cancelled collection's money as received while the SQL does not.

**8c.** Spec §4.1's whole-periods check, against the existing `selectByAmount`. In `packages/shared/src/fifo.ts`, change the loop's guard from `if (group.outstanding > remaining) break;` to `if (remaining <= 0) break;` and push a partial amount:

```ts
    selected.push(group);
    remaining -= Math.min(group.outstanding, remaining);
```

Re-run `npx vitest run packages/shared/src/fifo.test.ts`.
Expected: **FAIL** — a group is selected that the cash does not cover, leaving a charge neither settled nor untouched. Parent §14 settled that a remainder is handed back as change, never part-applied. Revert.

Revert all three. Re-run to confirm green. Record the observed failures in the commit message.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/outstanding.ts packages/shared/src/outstanding.test.ts \
        packages/shared/src/index.ts tests/db/parity.test.ts
git commit -m "feat(shared): the device's copy of what is owed, pinned to the SQL

A TypeScript mirror of charge_balances and unpaid_period_groups, because
parent §5.2 computes outstanding rather than storing it and the device must
compute it offline from rows it already holds.

Pinned by execution, not by reading: parity.test.ts runs both against one
fixture that deliberately carries a surcharge, a condonation and a cancelled
collection -- a fixture with none of them passes whatever the TypeScript does.

Falsification: flattening the sort comparator and dropping the
cancelled-collection exclusion each make parity fail."
```

---

## Task 4: `ledger.ts` — reading local rows, and the overlay

Spec F4. Without the overlay a collector who settles periods offline is shown them as still unpaid and takes the money twice.

**Files:**
- Create: `packages/sync-engine/src/ledger.ts`
- Create: `packages/sync-engine/src/ledger.test.ts`
- Modify: `packages/sync-engine/src/index.ts`
- Modify: `packages/shared/src/outstanding.ts` (adds `chargeOutstanding` — ruling R3)

**Interfaces:**
- Consumes: `SqliteDriver` from `./driver`; `unpaidPeriodGroups`, `LedgerInput`, `parsePesoInput`, `PeriodGroup` from `@ceedo/shared`.
- Produces:
  ```ts
  export async function leaseLedger(driver: SqliteDriver, leaseId: string): Promise<PeriodGroup[]>
  export async function leaseLedgerDetail(
    driver: SqliteDriver, leaseId: string,
  ): Promise<{ groups: PeriodGroup[]; perCharge: Map<string, Centavos> }>
  export async function ledgerStaleness(driver: SqliteDriver): Promise<{ lastFullSyncDate: string | null; pendingCount: number }>
  ```
  and, added to `packages/shared/src/outstanding.ts`:
  ```ts
  export function chargeOutstanding(
    input: LedgerInput, leaseId: string,
  ): { chargeId: string; outstanding: Centavos }[]
  ```
  **Ruling R3 moved these here from Task 7.** They are engine code, and `apps/collector` is
  outside the vitest workspace, so defining them in a screens task would leave them untested
  and would have shipped a knowingly-wrong `fromCentavos(0)` placeholder in one step to
  repair it in the next.

- [ ] **Step 1: Write the failing test**

Create `packages/sync-engine/src/ledger.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { leaseLedger, leaseLedgerDetail } from "./ledger";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table charges (
    id text primary key, lease_id text, charge_type text, due_date text,
    period_start text, period_end text, amount text
  );
  create table collection_allocations (
    id text primary key, collection_id text, charge_id text, amount text
  );
  create table collection_cancellations (
    id text primary key, collection_id text
  );
  create table charge_condonations (id text primary key, charge_id text, amount text);
  create table local_collections (
    id text primary key, or_no integer, booklet_id text, collector_id text,
    shift_id text, collected_at text, fee_type_id text, lease_id text,
    gross_amount text, payer_ref text, notes text, created_at text
  );
  create table local_allocations (
    collection_id text, charge_id text, amount text,
    primary key (collection_id, charge_id)
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
  create table sync_state (
    id integer primary key, cursor integer, epoch integer, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 10, 0);
`;

describe("leaseLedger", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    db.exec(`
      insert into charges (id, lease_id, charge_type, due_date, period_start, period_end, amount)
      values
        ('r1','L1','rental','2026-03-05','2026-03-01','2026-03-31','1500.00'),
        ('s1','L1','surcharge','2026-03-05','2026-03-01','2026-03-31','45.00'),
        ('r2','L1','rental','2026-04-05','2026-04-01','2026-04-30','1500.00'),
        ('r3','L1','rental','2026-05-05','2026-05-01','2026-05-31','1500.00');
    `);
  });

  it("ranks unpaid groups oldest first, rental before its surcharge", async () => {
    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.groupRank)).toEqual([1, 2, 3]);
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
    expect(groups[0]!.outstanding).toBe(154_500);
  });

  it("subtracts THIS DEVICE's unsynced allocations", async () => {
    // Without this the collector settles March offline, walks back an hour later, is shown
    // March as unpaid, and takes the money a second time -- after the paper receipt is
    // already written and the serial already spent.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','pending',0,1);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
    expect(groups[0]!.groupRank).toBe(1);
  });

  it("keeps subtracting when the entry was REJECTED", async () => {
    // Parent §6.3: a rejection never means discard. The collector has handed over a paper
    // receipt and taken the money; that serial is spent. A rejected receipt is an
    // exception for a supervisor, not a period that became payable again.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq, reason_code)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','rejected',1,1,'serial_spent');
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
  });

  it("does not subtract twice once the server's own row arrives", async () => {
    // Same (collection_id, charge_id) pair from both sides. Deduplicated on the PAIR, not
    // on charge_id alone: charge_balances deliberately SUMS two different collections
    // against one charge, because that is the double payment migration 0032's row lock
    // exists to make visible.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
              '1545.00', '2026-09-21T01:00:00.000Z');
      insert into local_allocations (collection_id, charge_id, amount)
      values ('k1','r1','1500.00'), ('k1','s1','45.00');
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k1','r1','1500.00'), ('a2','k1','s1','45.00');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
      values ('k1','collection','{}','c1','2026-09-21T01:00:00.000Z','acked',1,1);
    `);

    const groups = await leaseLedger(driver, "L1");
    expect(groups.map((g) => g.chargeIds)).toEqual([["r2"], ["r3"]]);
  });

  it("reports each unpaid charge's own outstanding", async () => {
    // The lease screen settles a GROUP, but local_allocations stores one row per CHARGE
    // (spec F1), so the device needs the split the group hides. One reader produces both.
    const { groups, perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
    expect(perCharge.get("r1")).toBe(150_000);
    expect(perCharge.get("s1")).toBe(4_500);
  });

  it("omits settled charges from the per-charge map", async () => {
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1500.00');
    `);
    const { perCharge } = await leaseLedgerDetail(driver, "L1");
    expect(perCharge.has("r1")).toBe(false);
    expect(perCharge.get("s1")).toBe(4_500);
  });

  it("stops counting a cancelled collection's allocations", async () => {
    db.exec(`
      insert into collection_allocations (id, collection_id, charge_id, amount)
      values ('a1','k9','r1','1500.00');
      insert into collection_cancellations (id, collection_id) values ('x1','k9');
    `);
    const groups = await leaseLedger(driver, "L1");
    expect(groups[0]!.chargeIds).toEqual(["r1", "s1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/sync-engine/src/ledger.test.ts
```

Expected: FAIL — `Failed to resolve import "./ledger"`.

- [ ] **Step 3: Implement**

First add `chargeOutstanding` to `packages/shared/src/outstanding.ts` — `ledger.ts` imports it, and it is the per-charge view the group-level `unpaidPeriodGroups` deliberately hides:

```ts
/**
 * Per-charge outstanding within one lease, for callers that must settle charge by charge.
 *
 * `unpaidPeriodGroups` answers "what does this tenant owe, in the order it must be paid";
 * this answers "and how does one group's total divide across its rows". The device needs
 * both: it SELECTS a group and it RECORDS per charge, because `local_allocations` is keyed
 * (collection_id, charge_id) so the overlay can subtract exactly what was settled.
 */
export function chargeOutstanding(
  input: LedgerInput,
  leaseId: string,
): { chargeId: string; outstanding: Centavos }[] {
  return input.charges
    .filter((c) => c.leaseId === leaseId)
    .map((c) => ({ chargeId: c.id, outstanding: chargeBalance(c, input) }))
    .filter((r) => r.outstanding > 0);
}
```

Then create `packages/sync-engine/src/ledger.ts`:

```ts
import {
  chargeOutstanding,
  parsePesoInput,
  unpaidPeriodGroups,
  type Centavos,
  type LedgerAllocation,
  type LedgerInput,
  type PeriodGroup,
} from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

/**
 * What a lease still owes, as this device can know it. Spec F4.
 *
 * Reads the pulled ledger tables AND this device's own unsynced allocations, because a
 * receipt sitting in the outbox has settled periods the server has not heard about yet.
 * Without that overlay the collector settles March offline, walks back an hour later, is
 * shown March as unpaid, and takes the money twice -- after the paper receipt is written
 * and the serial spent.
 */
async function readLedgerInput(
  driver: SqliteDriver,
  leaseId: string,
): Promise<LedgerInput> {
  const charges = await driver.select<{
    id: string;
    lease_id: string;
    charge_type: string;
    due_date: string;
    period_start: string;
    period_end: string;
    amount: string;
  }>(
    `select id, lease_id, charge_type, due_date, period_start, period_end, amount
       from charges where lease_id = ?`,
    [leaseId],
  );

  const pulled = await driver.select<{
    collection_id: string;
    charge_id: string;
    amount: string;
  }>("select collection_id, charge_id, amount from collection_allocations");

  /*
   * The overlay. Every local allocation whose outbox entry has NOT been superseded by a
   * pulled row of the same (collection_id, charge_id) pair.
   *
   * `rejected` entries stay in. Parent §6.3 is explicit that a rejection never means
   * discard: by the time the server sees a problem the collector has handed a vendor a
   * paper official receipt and taken their money, and that serial is spent.
   *
   * DEDUPLICATED ON THE PAIR, NOT ON charge_id. charge_balances SUMS every allocation
   * against a charge, because two collections allocating to one charge is the double
   * payment migration 0032's row lock exists to prevent -- a ledger that collapsed them
   * would report that failure as correctly settled.
   */
  const local = await driver.select<{
    collection_id: string;
    charge_id: string;
    amount: string;
  }>(
    `select la.collection_id, la.charge_id, la.amount
       from local_allocations la
       join local_collections lc on lc.id = la.collection_id
      where lc.lease_id = ?`,
    [leaseId],
  );

  const seen = new Set(pulled.map((r) => `${r.collection_id}|${r.charge_id}`));
  const allocations: LedgerAllocation[] = pulled.map((r) => ({
    collectionId: r.collection_id,
    chargeId: r.charge_id,
    amount: parsePesoInput(r.amount),
  }));
  for (const r of local) {
    if (seen.has(`${r.collection_id}|${r.charge_id}`)) continue;
    allocations.push({
      collectionId: r.collection_id,
      chargeId: r.charge_id,
      amount: parsePesoInput(r.amount),
    });
  }

  const condonations = await driver.select<{ charge_id: string; amount: string }>(
    "select charge_id, amount from charge_condonations",
  );
  const cancelled = await driver.select<{ collection_id: string }>(
    "select collection_id from collection_cancellations",
  );

  return {
    charges: charges.map((r) => ({
      id: r.id,
      leaseId: r.lease_id,
      chargeType: r.charge_type,
      dueDate: r.due_date,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      amount: parsePesoInput(r.amount),
    })),
    allocations,
    condonations: condonations.map((r) => ({
      chargeId: r.charge_id,
      amount: parsePesoInput(r.amount),
    })),
    cancelledCollectionIds: new Set(cancelled.map((r) => r.collection_id)),
  };
}

/** The FIFO groups the lease screen lists and the picker selects from. */
export async function leaseLedger(
  driver: SqliteDriver,
  leaseId: string,
): Promise<PeriodGroup[]> {
  return unpaidPeriodGroups(await readLedgerInput(driver, leaseId), leaseId);
}

/**
 * The groups AND each unpaid charge's own outstanding, from ONE read.
 *
 * The screen settles a whole period group, but `local_allocations` stores one row per
 * charge (spec F1), because the overlay in this same file subtracts per charge. So the
 * caller needs the split the group hides, and getting it from a second read would let the
 * two views disagree about the same lease.
 */
export async function leaseLedgerDetail(
  driver: SqliteDriver,
  leaseId: string,
): Promise<{ groups: PeriodGroup[]; perCharge: Map<string, Centavos> }> {
  const input = await readLedgerInput(driver, leaseId);
  return {
    groups: unpaidPeriodGroups(input, leaseId),
    perCharge: new Map(
      chargeOutstanding(input, leaseId).map((r) => [r.chargeId, r.outstanding]),
    ),
  };
}

/**
 * How stale this ledger is, for the disclosure spec F7 requires.
 *
 * The device cannot detect the case where another tablet settled a group and the accrual
 * raised a new one, because the count still matches and the ranks silently name different
 * periods. The collector writes the paper receipt from the DEVICE's figure, so that is a
 * paper-versus-ledger divergence, caught at closeout rather than prevented. What the screen
 * owes is not prevention but an honest statement of how old its numbers are.
 */
export async function ledgerStaleness(
  driver: SqliteDriver,
): Promise<{ lastFullSyncDate: string | null; pendingCount: number }> {
  const state = await driver.select<{ last_full_sync_date: string | null }>(
    "select last_full_sync_date from sync_state where id = 1",
  );
  const pending = await driver.select<{ n: number }>(
    "select count(*) as n from outbox where state in ('pending','in_flight')",
  );
  return {
    lastFullSyncDate: state[0]?.last_full_sync_date ?? null,
    pendingCount: pending[0]?.n ?? 0,
  };
}
```

- [ ] **Step 4: Export it**

In `packages/sync-engine/src/index.ts`, add:

```ts
export { leaseLedger, leaseLedgerDetail, ledgerStaleness } from "./ledger";
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run packages/sync-engine/src/ledger.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Falsification check**

Delete the `for (const r of local) { ... }` overlay loop from `leaseLedger`. Re-run.
Expected: **FAIL** on "subtracts THIS DEVICE's unsynced allocations" and "keeps subtracting when the entry was REJECTED" — `expected [["r2"],["r3"]] to deeply equal [["r1","s1"],["r2"],["r3"]]`, i.e. a lease paid offline still reads as owing. Revert and confirm green. Record it.

- [ ] **Step 7: Commit**

```bash
git add packages/sync-engine/src/ledger.ts packages/sync-engine/src/ledger.test.ts \
        packages/sync-engine/src/index.ts packages/shared/src/outstanding.ts
git commit -m "feat(sync-engine): the local ledger, and the overlay that keeps it honest

leaseLedger reads the pulled ledger tables plus this device's own unsynced
allocations. Without the overlay a collector settles March offline, returns
an hour later, is shown March as unpaid and takes the money twice -- after
the paper receipt is written and the serial spent.

Rejected entries stay in the overlay (parent §6.3). Deduplication is on
(collection_id, charge_id), never charge_id alone: charge_balances sums two
collections against one charge on purpose, because that is the double
payment migration 0032's row lock makes visible.

Falsification: removing the overlay loop makes two tests fail."
```

---

## Task 5: `deviceTotals` reads what the device authored

Spec F2. A defect in already-merged 3b-i code, invisible within that phase's zero-receipt exit criterion.

**Files:**
- Modify: `packages/sync-engine/src/shift.ts` (the `deviceTotals` function, ~line 118)
- Modify: `packages/sync-engine/src/shift.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `deviceTotals` unchanged in signature — `(driver, shiftId) => Promise<{count, total}>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/sync-engine/src/shift.test.ts`. Its `SCHEMA` fixture needs a `local_collections` table; add one matching Task 2's columns.

```ts
it("counts receipts the device authored but has not yet synced", async () => {
  // Parent §6.5 step 2: the device sends its own count and sum. Reading the PULLED
  // `collections` table reports 0.00 for a receipt taken offline, so the closeout would
  // compare nothing against nothing and balance. This was correct for Phase 3b-i only
  // because a zero-receipt shift sums to zero whichever table is read.
  db.exec(`
    insert into local_collections
      (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
       lease_id, gross_amount, created_at)
    values
      ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
       '1545.00', '2026-09-21T01:00:00.000Z'),
      ('k2', 2, 'b1', 'c1', 'sh1', '2026-09-21T02:00:00.000Z', 'f1', null,
       '250.50', '2026-09-21T02:00:00.000Z');
  `);

  expect(await deviceTotals(driver, "sh1")).toEqual({ count: 2, total: "1795.50" });
});

it("counts only this shift", async () => {
  db.exec(`
    insert into local_collections
      (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
       lease_id, gross_amount, created_at)
    values
      ('k1', 1, 'b1', 'c1', 'sh1', '2026-09-21T01:00:00.000Z', 'f1', 'L1',
       '1500.00', '2026-09-21T01:00:00.000Z'),
      ('k2', 2, 'b1', 'c1', 'sh2', '2026-09-21T02:00:00.000Z', 'f1', 'L1',
       '9999.00', '2026-09-21T02:00:00.000Z');
  `);

  expect(await deviceTotals(driver, "sh1")).toEqual({ count: 1, total: "1500.00" });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/sync-engine/src/shift.test.ts
```

Expected: FAIL — `expected { count: 0, total: '0.00' } to deeply equal { count: 2, total: '1795.50' }`. That failure **is** the defect.

- [ ] **Step 3: Fix the query and its comment**

In `packages/sync-engine/src/shift.ts`, replace the body of `deviceTotals`'s select and extend the doc comment:

```ts
/**
 * What THIS DEVICE believes it collected during THIS shift.
 *
 * READS local_collections, NOT the mirrored `collections` table -- spec F2. A receipt
 * taken offline exists only here and in the outbox; reading the pulled table reported
 * 0.00 for it, so an offline closeout compared nothing against nothing and balanced. That
 * query was correct throughout Phase 3b-i only because a zero-receipt shift sums to zero
 * whichever table is read.
 *
 * `where shift_id = ?`, and the predicate is the whole point: migration 20260919000043 put
 * shift_id on collections precisely so a closeout counts one shift rather than a
 * collector's whole day. A sum without it would ask a collector to match money that was
 * never in their drawer.
 *
 * A shift belongs to one collector on one device, so this set is complete for the shift
 * and cannot double-count the pulled row that arrives later under the same id.
 *
 * Summed as INTEGER CENTAVOS through packages/shared/src/money.ts, never as SQL `sum()`
 * over a text column or a JS float over pesos. This is the figure a collector's cash is
 * checked against; a rounding artefact in it is a collector accused of being a centavo
 * short.
 */
export async function deviceTotals(
  driver: SqliteDriver,
  shiftId: string,
): Promise<DeviceTotals> {
  const rows = await driver.select<{ gross_amount: string | null }>(
    "select gross_amount from local_collections where shift_id = ?",
    [shiftId],
  );
  const total = rows.reduce<Centavos>(
    (acc, row) => fromCentavos(acc + parsePesoInput(row.gross_amount ?? "0")),
    fromCentavos(0),
  );
  return { count: rows.length, total: toDecimalString(total) };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run packages/sync-engine
```

Expected: PASS, including every pre-existing shift and closeout test.

- [ ] **Step 5: Falsification check**

Point the query back at `collections`. Re-run.
Expected: **FAIL** with `{ count: 0, total: '0.00' }` on both new tests. Revert, confirm green, record it.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-engine/src/shift.ts packages/sync-engine/src/shift.test.ts
git commit -m "fix(sync-engine): the closeout had nothing to compare against

deviceTotals read the pulled collections table, so a receipt taken offline
-- which lives only in the outbox and local_collections -- counted as 0.00.
An offline closeout would have compared nothing against nothing and
balanced, which is the exact silent loss parent §6.5 exists to prevent.

Correct throughout Phase 3b-i only because a zero-receipt shift sums to zero
whichever table is read: the predicate was right for the data that phase
happened to have. Third instance of that shape in this project.

Falsification: pointing the query back at collections returns 0.00."
```

---

## Task 6: `collect.ts` — OR validation and the one-transaction commit

Spec F5 and §3.3. Lives in `packages/sync-engine` because `apps/collector` is not in the vitest workspace and this logic must be tested.

**Files:**
- Create: `packages/sync-engine/src/collect.ts`
- Create: `packages/sync-engine/src/collect.test.ts`
- Modify: `packages/sync-engine/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDriver`; `enqueue` from `./outbox`; `validateOrEntry`, `OrEntryContext`, `toDecimalString`, `Centavos` from `@ceedo/shared`.
- Produces:
  ```ts
  export interface DraftAllocation { chargeId: string; amount: Centavos }
  export interface DraftLine {
    feeTypeId: string; rateClass: string | null; quantity: number;
    unitRate: Centavos; amount: Centavos;
  }
  export interface DraftReceipt {
    id: string; orNo: number; bookletId: string; collectorId: string; shiftId: string;
    collectedAt: string; feeTypeId: string; leaseId: string | null;
    grossAmount: Centavos; ranks: readonly number[];
    allocations: readonly DraftAllocation[]; lines: readonly DraftLine[];
    payerRef: string | null; notes: string | null;
  }
  export async function orEntryContext(driver: SqliteDriver, collectorId: string): Promise<OrEntryContext>
  export async function commitReceipt(driver: SqliteDriver, draft: DraftReceipt, lineIds: readonly string[]): Promise<void>
  ```
  `lineIds` is a required argument for the same reason `openShift`'s `id` is: the engine may not import `expo-crypto`, and a `crypto.randomUUID()` default is a Node global that Hermes does not provide.

- [ ] **Step 1: Write the failing tests**

Create `packages/sync-engine/src/collect.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { fromCentavos } from "@ceedo/shared";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { commitReceipt, orEntryContext, type DraftReceipt } from "./collect";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table booklets (
    id text primary key, form_type_id text, serial_prefix text,
    start_no integer, end_no integer, status text
  );
  create table booklet_assignments (
    id text primary key, booklet_id text, collector_id text, returned_at text
  );
  create table consumed_serials (booklet_id text, or_no integer, primary key (booklet_id, or_no));
  create table spoiled_forms (id text primary key, booklet_id text, or_no integer, reason text);
  create table local_collections (
    id text primary key, or_no integer, booklet_id text, collector_id text,
    shift_id text, collected_at text, fee_type_id text, lease_id text,
    gross_amount text, payer_ref text, notes text, created_at text
  );
  create table local_allocations (
    collection_id text, charge_id text, amount text,
    primary key (collection_id, charge_id)
  );
  create table local_lines (
    id text primary key, collection_id text, fee_type_id text, rate_class text,
    quantity integer, unit_rate text, amount text
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
`;

const draft = (over: Partial<DraftReceipt> = {}): DraftReceipt => ({
  id: "k1",
  orNo: 1005,
  bookletId: "b1",
  collectorId: "c1",
  shiftId: "sh1",
  collectedAt: "2026-09-21T01:00:00.000Z",
  feeTypeId: "f1",
  leaseId: "L1",
  grossAmount: fromCentavos(154_500),
  ranks: [1],
  allocations: [
    { chargeId: "r1", amount: fromCentavos(150_000) },
    { chargeId: "s1", amount: fromCentavos(4_500) },
  ],
  lines: [],
  payerRef: null,
  notes: null,
  ...over,
});

describe("orEntryContext", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    db.exec(`
      insert into booklets (id, serial_prefix, start_no, end_no, status)
      values ('b1','OR51',1001,1050,'in_use'), ('b2','OR51',2001,2050,'in_use');
      insert into booklet_assignments (id, booklet_id, collector_id, returned_at)
      values ('ba1','b1','c1',null), ('ba2','b2','c2',null);
      insert into consumed_serials (booklet_id, or_no) values ('b1',1001);
    `);
  });

  it("carries only booklets still assigned to this collector", async () => {
    const ctx = await orEntryContext(driver, "c1");
    expect(ctx.booklets.map((b) => b.id)).toEqual(["b1"]);
  });

  it("treats a serial spent offline as spent", async () => {
    // The union of pulled consumed_serials and this device's own unsynced receipts. A
    // receipt written an hour ago has not round-tripped, and reissuing its serial would
    // put two receipts on one number.
    db.exec(`
      insert into local_collections
        (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
         lease_id, gross_amount, created_at)
      values ('k0', 1002, 'b1', 'c1', 'sh1', '2026-09-21T00:00:00.000Z', 'f1', 'L1',
              '100.00', '2026-09-21T00:00:00.000Z');
    `);
    const ctx = await orEntryContext(driver, "c1");
    expect([...ctx.consumed].sort()).toEqual([1001, 1002]);
  });

  it("carries spoiled serials", async () => {
    db.exec(`insert into spoiled_forms (id, booklet_id, or_no, reason) values ('sp1','b1',1003,'torn');`);
    const ctx = await orEntryContext(driver, "c1");
    expect([...ctx.spoiled]).toEqual([1003]);
  });
});

describe("commitReceipt", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("writes the local rows and the outbox entry together", async () => {
    await commitReceipt(driver, draft(), []);

    expect(db.prepare("select count(*) as n from local_collections").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from local_allocations").get()).toEqual({ n: 2 });
    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
  });

  it("stores the device's gross as a 2dp string", async () => {
    await commitReceipt(driver, draft(), []);
    expect(
      db.prepare("select gross_amount from local_collections where id = 'k1'").get(),
    ).toEqual({ gross_amount: "1545.00" });
  });

  it("sends group ranks and NEVER an amount", async () => {
    // CollectionPayload forbids gross_amount outright. The device proposes WHICH periods;
    // the server decides what that costs (invariant #3).
    await commitReceipt(driver, draft(), []);
    const row = db.prepare("select payload from outbox where id = 'k1'").get() as {
      payload: string;
    };
    const payload = JSON.parse(row.payload);

    expect(payload.allocations).toEqual([{ group_rank: 1 }]);
    expect(payload).not.toHaveProperty("gross_amount");
    expect(payload).not.toHaveProperty("device_id");
    expect(payload.shift_id).toBe("sh1");
  });

  it("writes lines with their ids and sends quantities only", async () => {
    const lines = [
      {
        feeTypeId: "f-ambulant",
        rateClass: "vegetable",
        quantity: 3,
        unitRate: fromCentavos(2_000),
        amount: fromCentavos(6_000),
      },
    ];
    await commitReceipt(
      driver,
      draft({ leaseId: null, ranks: [], allocations: [], lines, grossAmount: fromCentavos(6_000) }),
      ["line-1"],
    );

    expect(db.prepare("select count(*) as n from local_lines").get()).toEqual({ n: 1 });
    const row = db.prepare("select payload from outbox where id = 'k1'").get() as {
      payload: string;
    };
    expect(JSON.parse(row.payload).lines).toEqual([
      { fee_type_id: "f-ambulant", rate_class: "vegetable", quantity: 3 },
    ]);
  });

  it("writes NOTHING when any part of the write fails", async () => {
    // Spec F5. The two halves are not separable. An outbox entry without local rows makes
    // the closeout short by that receipt; local rows without an entry mean cash recorded
    // and never pushed. Both are silent.
    await commitReceipt(driver, draft(), []);

    // A second commit under the same id: local_collections' primary key refuses it.
    await expect(
      commitReceipt(driver, draft({ orNo: 1006 }), []),
    ).rejects.toThrow();

    expect(db.prepare("select or_no from local_collections where id = 'k1'").get()).toEqual({
      or_no: 1005,
    });
    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
  });

  it("requires an id per line", async () => {
    const lines = [
      {
        feeTypeId: "f1",
        rateClass: null,
        quantity: 1,
        unitRate: fromCentavos(100),
        amount: fromCentavos(100),
      },
    ];
    await expect(
      commitReceipt(driver, draft({ lines }), []),
    ).rejects.toThrow(/one id per line/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/sync-engine/src/collect.test.ts
```

Expected: FAIL — `Failed to resolve import "./collect"`.

- [ ] **Step 3: Implement**

Create `packages/sync-engine/src/collect.ts`:

```ts
import { toDecimalString, type Centavos, type OrEntryContext } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";
import { enqueue } from "./outbox";

export interface DraftAllocation {
  chargeId: string;
  amount: Centavos;
}

export interface DraftLine {
  feeTypeId: string;
  rateClass: string | null;
  quantity: number;
  unitRate: Centavos;
  amount: Centavos;
}

/**
 * A receipt the collector has decided on but not yet recorded.
 *
 * `ranks` and `allocations` describe the same settlement twice, deliberately. The PAYLOAD
 * carries ranks, because post_collection resolves them positionally and recomputes the
 * amount itself. The LOCAL ROWS carry resolved charge ids, because the device's own ledger
 * has to know which charges it has optimistically settled (spec F4) and a rank is
 * meaningless the moment the list it indexes changes.
 */
export interface DraftReceipt {
  id: string;
  orNo: number;
  bookletId: string;
  collectorId: string;
  shiftId: string;
  collectedAt: string;
  feeTypeId: string;
  leaseId: string | null;
  /** What THIS DEVICE computed. A claim; the server recomputes. Never sent. */
  grossAmount: Centavos;
  ranks: readonly number[];
  allocations: readonly DraftAllocation[];
  lines: readonly DraftLine[];
  payerRef: string | null;
  notes: string | null;
}

/**
 * Everything §7.1's point-of-sale check needs, read from local state.
 *
 * `consumed` is the UNION of the pulled consumed_serials and this device's own unsynced
 * receipts. A receipt written an hour ago has not round-tripped, and offering its serial
 * again would put two receipts on one number -- which the server would catch, but only
 * after both vendors had walked away with paper.
 */
export async function orEntryContext(
  driver: SqliteDriver,
  collectorId: string,
): Promise<OrEntryContext> {
  const booklets = await driver.select<{
    id: string;
    serial_prefix: string;
    start_no: number;
    end_no: number;
  }>(
    `select b.id, b.serial_prefix, b.start_no, b.end_no
       from booklets b
       join booklet_assignments ba on ba.booklet_id = b.id
      where ba.collector_id = ? and ba.returned_at is null`,
    [collectorId],
  );

  const pulled = await driver.select<{ or_no: number }>(
    "select or_no from consumed_serials",
  );
  const mine = await driver.select<{ or_no: number }>(
    "select or_no from local_collections",
  );
  const spoiled = await driver.select<{ or_no: number }>(
    "select or_no from spoiled_forms",
  );

  return {
    booklets: booklets.map((b) => ({
      id: b.id,
      serialPrefix: b.serial_prefix,
      startNo: b.start_no,
      endNo: b.end_no,
    })),
    consumed: new Set([...pulled, ...mine].map((r) => r.or_no)),
    spoiled: new Set(spoiled.map((r) => r.or_no)),
  };
}

/**
 * Records a receipt: local rows and outbox entry, in ONE transaction. Spec F5.
 *
 * This is 3b-i E7's rule ("apply and the cursor commit together") in a second place, and
 * the failure modes are symmetrical and both silent:
 *
 *   - an outbox entry without local rows leaves the closeout short by that receipt, and
 *     tells the collector their drawer is over by an amount that IS in fact recorded;
 *   - local rows without an outbox entry mean cash recorded on the device, never pushed,
 *     and a closeout that balances against a server that never heard of it.
 *
 * `lineIds` is REQUIRED rather than generated here, for the reason openShift's `id` is:
 * this package may not import expo-crypto, and `crypto.randomUUID()` is a Node global that
 * neither Hermes nor React Native provides. A missing id is a type error at the call site
 * instead of a crash in a market.
 */
export async function commitReceipt(
  driver: SqliteDriver,
  draft: DraftReceipt,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length !== draft.lines.length) {
    throw new Error(
      `commitReceipt needs one id per line: ${draft.lines.length} lines, ${lineIds.length} ids`,
    );
  }

  await driver.transaction(async (tx) => {
    await tx.execute(
      `insert into local_collections
         (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
          lease_id, gross_amount, payer_ref, notes, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draft.id,
        draft.orNo,
        draft.bookletId,
        draft.collectorId,
        draft.shiftId,
        draft.collectedAt,
        draft.feeTypeId,
        draft.leaseId,
        toDecimalString(draft.grossAmount),
        draft.payerRef,
        draft.notes,
        new Date().toISOString(),
      ],
    );

    for (const allocation of draft.allocations) {
      await tx.execute(
        "insert into local_allocations (collection_id, charge_id, amount) values (?, ?, ?)",
        [draft.id, allocation.chargeId, toDecimalString(allocation.amount)],
      );
    }

    for (const [index, line] of draft.lines.entries()) {
      await tx.execute(
        `insert into local_lines
           (id, collection_id, fee_type_id, rate_class, quantity, unit_rate, amount)
         values (?, ?, ?, ?, ?, ?, ?)`,
        [
          lineIds[index]!,
          draft.id,
          line.feeTypeId,
          line.rateClass,
          line.quantity,
          toDecimalString(line.unitRate),
          toDecimalString(line.amount),
        ],
      );
    }

    // The payload carries no amount at all. Invariant #3 is enforced by never accepting
    // the figure, and CollectionPayload declares gross_amount and device_id as `never`.
    await enqueue(tx, {
      id: draft.id,
      type: "collection",
      payload: {
        id: draft.id,
        or_no: draft.orNo,
        booklet_id: draft.bookletId,
        collector_id: draft.collectorId,
        collected_at: draft.collectedAt,
        fee_type_id: draft.feeTypeId,
        lease_id: draft.leaseId,
        shift_id: draft.shiftId,
        payer_ref: draft.payerRef,
        notes: draft.notes,
        allocations: draft.ranks.map((group_rank) => ({ group_rank })),
        lines: draft.lines.map((line) => ({
          fee_type_id: line.feeTypeId,
          ...(line.rateClass === null ? {} : { rate_class: line.rateClass }),
          quantity: line.quantity,
        })),
      },
      collectorId: draft.collectorId,
    });
  });
}
```

- [ ] **Step 4: Export it**

In `packages/sync-engine/src/index.ts`:

```ts
export {
  orEntryContext,
  commitReceipt,
  type DraftReceipt,
  type DraftAllocation,
  type DraftLine,
} from "./collect";
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run packages/sync-engine
```

Expected: PASS.

- [ ] **Step 6: Falsification check — prove the atomicity test can see a split**

Replace `driver.transaction(async (tx) => { ... })` with a direct sequence on `driver` (no transaction), and reorder so `enqueue` runs **before** the `local_collections` insert. Re-run.
Expected: **FAIL** on "writes NOTHING when any part of the write fails" — the outbox holds 2 entries while `local_collections` holds 1, which is exactly the shift-total shortfall the rule exists to prevent. Revert, confirm green, record the observed counts.

- [ ] **Step 6b: Falsification check — a sequence skip must not block**

Spec §4.1's seventh check, against the existing `validateOrEntry`. In `packages/shared/src/booklets.ts`, change the final return from the warning form to a refusal:

```ts
  return orNo > highestUsed + 1
    ? { ok: false, reason: "not_in_assigned_booklet" }
    : { ok: true, bookletId: booklet.id };
```

Run `npx vitest run packages/shared/src/booklets.test.ts`.
Expected: **FAIL** on the sequence-skip test — a legitimately skipped booklet refuses a receipt. Parent §7.1: booklets get skipped, and a warning that fires on correct behaviour is one that gets ignored on the day it is right. Revert, confirm green, record it.

- [ ] **Step 7: Verify the payload against the real contract**

Add a check that the payload parses, so a drift in `CollectionPayload` fails here rather than at a stall:

```ts
it("produces a payload the shared contract accepts", async () => {
  await commitReceipt(driver, draft({ id: "550e8400-e29b-41d4-a716-446655440000" }), []);
  const row = db.prepare("select payload from outbox").get() as { payload: string };
  expect(() => CollectionPayload.parse(JSON.parse(row.payload))).not.toThrow();
});
```

Import `CollectionPayload` from `@ceedo/shared`. Note the uuid-shaped ids: the contract's `uuid` refuses the short fixtures used elsewhere in this file, and that refusal is the contract doing its job.

Run `npx vitest run packages/sync-engine/src/collect.test.ts`. Expected: PASS. If it fails on `booklet_id`, `collector_id`, `fee_type_id` or `lease_id`, give those fixture values real UUIDs too.

- [ ] **Step 8: Commit**

```bash
git add packages/sync-engine/src/collect.ts packages/sync-engine/src/collect.test.ts \
        packages/sync-engine/src/index.ts
git commit -m "feat(sync-engine): record a receipt, local rows and outbox in one transaction

The two halves are not separable. An outbox entry without local rows leaves
the closeout short and tells the collector their drawer is over by an amount
that is in fact recorded; local rows without an entry mean cash recorded and
never pushed. Both are silent, which is 3b-i E7's rule in a second place.

orEntryContext unions the pulled consumed serials with this device's own
unsynced receipts, so a serial spent offline is spent.

lineIds is a required argument, not generated here: this package may not
import expo-crypto, and crypto.randomUUID() is the Node global that made
openShift pass every test and crash on the tablet.

Falsification: splitting the transaction leaves 2 outbox entries against 1
local receipt."
```

---

## Task 7: Lease browse and the lease screen

Spec F6, F7, §3.2. No unit tests — `apps/collector` is outside the vitest workspace. Verification is typecheck, a clean `expo export`, and Task 12.

**Files:**
- Create: `apps/collector/src/collect/draft.ts`
- Create: `apps/collector/src/app/leases.tsx`
- Create: `apps/collector/src/app/lease/[leaseId].tsx`
- Modify: `apps/collector/src/app/shift.tsx`

**Interfaces:**
- Consumes: `leaseLedger`, `ledgerStaleness` (Task 4); `selectByAmount`, `isContiguousPrefix`, `format`, `parsePesoInput`, `type PeriodGroup` from `@ceedo/shared`; `openDeviceDb`, `expoSqliteDriver`, `signedIn`, `syncNow` (existing).
- Produces:
  ```ts
  // draft.ts
  export interface LeaseDraft {
    kind: "lease"; leaseId: string; feeTypeId: string; stallNo: string; tenantName: string;
    groups: PeriodGroup[]; ranks: number[];
    allocations: { chargeId: string; amount: Centavos }[];
    grossAmount: Centavos; change: Centavos;
  }
  export interface LinesDraft {
    kind: "lines"; feeTypeId: string; label: string;
    lines: DraftLine[]; grossAmount: Centavos;
  }
  export type Draft = LeaseDraft | LinesDraft
  export function setDraft(next: Draft): void
  export function draft(): Draft | null
  export function clearDraft(): void
  ```

- [ ] **Step 1: Write the draft store**

Create `apps/collector/src/collect/draft.ts`:

```ts
import type { Centavos, PeriodGroup } from "@ceedo/shared";
import type { DraftLine } from "@ceedo/sync-engine";

/**
 * The receipt in progress, held in memory between screens.
 *
 * NOT router params. A money figure and a group selection serialized through a URL is a
 * class of bug nobody needs to invent twice -- and centavos surviving a round trip through
 * a query string as a float is precisely the thing parent §5 forbids.
 *
 * Shaped like src/auth/session.ts: module-level, cleared explicitly, never persisted. An
 * abandoned draft dies with the screen, which is correct -- nothing has been collected.
 */

export interface LeaseDraft {
  kind: "lease";
  leaseId: string;
  feeTypeId: string;
  stallNo: string;
  tenantName: string;
  groups: PeriodGroup[];
  ranks: number[];
  allocations: { chargeId: string; amount: Centavos }[];
  grossAmount: Centavos;
  change: Centavos;
}

export interface LinesDraft {
  kind: "lines";
  feeTypeId: string;
  label: string;
  lines: DraftLine[];
  grossAmount: Centavos;
}

export type Draft = LeaseDraft | LinesDraft;

let current: Draft | null = null;

export function setDraft(next: Draft): void {
  current = next;
}

export function draft(): Draft | null {
  return current;
}

/** Called after a successful commit, and when a screen is abandoned. */
export function clearDraft(): void {
  current = null;
}
```

- [ ] **Step 2: Write the lease browse screen**

Create `apps/collector/src/app/leases.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { signedIn } from "../auth/session";

interface LeaseHit {
  lease_id: string;
  stall_no: string;
  tenant_name: string;
  section_name: string | null;
}

/**
 * Search by stall number or tenant name.
 *
 * NOT a fallback. Parent §9.4 makes manual search mandatory in its own right: cards get
 * soaked, torn, peeled off and stolen, and a collection system that stalls on an
 * unreadable card fails on its first morning. Phase 4's QR scan is an accelerator laid
 * over this screen, which must already work.
 *
 * Scoped by construction rather than by a predicate: sync_pull only ever sent this device
 * the leases inside its own assignment, so there is nothing here to filter out.
 */
export default function Leases() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeaseHit[]>([]);

  const search = useCallback(
    async (text: string) => {
      const term = `%${text.trim().toLowerCase()}%`;
      const rows = await driver.select<LeaseHit>(
        `select l.id as lease_id, s.stall_no, t.full_name as tenant_name,
                sec.name as section_name
           from leases l
           join stalls s on s.id = l.stall_id
           join tenants t on t.id = l.tenant_id
           left join sections sec on sec.id = s.section_id
          where l.status = 'active'
            and (lower(s.stall_no) like ? or lower(t.full_name) like ?)
          order by s.stall_no
          limit 50`,
        [term, term],
      );
      setHits(rows);
    },
    [driver],
  );

  useFocusEffect(
    useCallback(() => {
      void search("");
    }, [search]),
  );

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.input}
        placeholder="Stall number or tenant name"
        autoCorrect={false}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          void search(text);
        }}
      />
      <ScrollView>
        {hits.length === 0 ? (
          <Text style={styles.note}>
            {query.trim() === ""
              ? "No leases on this tablet yet. Sync from the shift screen."
              : `Nothing matches "${query.trim()}".`}
          </Text>
        ) : (
          hits.map((hit) => (
            <Pressable
              key={hit.lease_id}
              style={styles.row}
              onPress={() => router.push(`/lease/${hit.lease_id}`)}
            >
              <Text style={styles.stall}>{hit.stall_no}</Text>
              <Text style={styles.tenant}>{hit.tenant_name}</Text>
              {hit.section_name ? (
                <Text style={styles.section}>{hit.section_name}</Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 18 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  stall: { fontSize: 22, fontWeight: "700" },
  tenant: { fontSize: 16 },
  section: { fontSize: 13, color: "#666" },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
```

**Check the column names before running.** `tenants` may be `full_name` or `name` in `db.types.ts` — the registry's tenants resource writes `full_name`. If `expo export` or typecheck disagrees, correct the SQL rather than the schema.

- [ ] **Step 3: Write the lease screen with both entry modes**

Create `apps/collector/src/app/lease/[leaseId].tsx`:

```tsx
import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  format,
  fromCentavos,
  parsePesoInput,
  selectByAmount,
  sum,
  type Centavos,
  type PeriodGroup,
} from "@ceedo/shared";
import { leaseLedgerDetail, ledgerStaleness } from "@ceedo/sync-engine";
import { openDeviceDb } from "../../db/client";
import { expoSqliteDriver } from "../../db/driver";
import { setDraft } from "../../collect/draft";
import { businessDate, syncNow } from "../../sync/device-sync";

interface Header {
  stall_no: string;
  tenant_name: string;
  fee_type_id: string;
}

/**
 * What this tenant owes, oldest first, and the two ways to choose how much of it is being
 * paid. Spec F6.
 *
 * BOTH MODES PRODUCE ONE ARTEFACT: a set of ranks 1..n. Tapping the fifth row selects one
 * through five; typing a peso figure runs selectByAmount. The payload, the validation and
 * the server path are then identical, so the second mode is a second way in rather than a
 * second code path to the wire.
 *
 * THE STALENESS LINE IS NOT DECORATION (spec F7). The collector writes the paper OR by
 * hand from the figure on this screen, and the paper is what the tenant walks away
 * holding. If another tablet settled a group since this device last pulled, the ranks name
 * different periods than were quoted and the amount recorded will differ from the cash
 * taken. The device cannot detect that -- it is caught at closeout, which blocks -- so what
 * this screen owes is an honest statement of how old its numbers are.
 */
export default function Lease() {
  const { leaseId } = useLocalSearchParams<{ leaseId: string }>();
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());

  const [header, setHeader] = useState<Header | null>(null);
  const [groups, setGroups] = useState<PeriodGroup[]>([]);
  const [perCharge, setPerCharge] = useState<Map<string, Centavos>>(new Map());
  const [ranks, setRanks] = useState<number[]>([]);
  const [tendered, setTendered] = useState("");
  const [stale, setStale] = useState<{ lastFullSyncDate: string | null; pendingCount: number }>({
    lastFullSyncDate: null,
    pendingCount: 0,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await driver.select<Header>(
      `select s.stall_no, t.full_name as tenant_name, l.fee_type_id
         from leases l
         join stalls s on s.id = l.stall_id
         join tenants t on t.id = l.tenant_id
        where l.id = ?`,
      [leaseId],
    );
    setHeader(rows[0] ?? null);
    const detail = await leaseLedgerDetail(driver, leaseId);
    setGroups(detail.groups);
    setPerCharge(detail.perCharge);
    setStale(await ledgerStaleness(driver));
  }, [driver, leaseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selected = groups.filter((g) => ranks.includes(g.groupRank));
  const gross = sum(selected.map((g) => g.outstanding));
  const balance = sum(groups.map((g) => g.outstanding));

  /** Tapping row n selects rows 1..n. FIFO is enforced by construction (parent §8.3). */
  const tapRow = (rank: number) => {
    setTendered("");
    setRanks(ranks.length === rank ? [] : Array.from({ length: rank }, (_, i) => i + 1));
  };

  const applyAmount = (text: string) => {
    setTendered(text);
    if (text.trim() === "") return setRanks([]);
    let cash: Centavos;
    try {
      cash = parsePesoInput(text);
    } catch {
      return setRanks([]);
    }
    setRanks(selectByAmount(groups, cash).selected.map((g) => g.groupRank));
  };

  const change = (() => {
    if (tendered.trim() === "") return fromCentavos(0);
    try {
      return fromCentavos(parsePesoInput(tendered) - gross);
    } catch {
      return fromCentavos(0);
    }
  })();

  const shortOfOldest =
    tendered.trim() !== "" && ranks.length === 0 && groups.length > 0;

  if (!header) return <Text style={styles.note}>This lease is not on this tablet.</Text>;

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.stall}>{header.stall_no}</Text>
      <Text style={styles.tenant}>{header.tenant_name}</Text>
      <Text style={styles.balance}>Balance {format(balance)}</Text>

      <View style={styles.stale}>
        <Text style={styles.staleText}>
          {stale.lastFullSyncDate === null
            ? "This tablet has never completed a full sync. These figures may be wrong."
            : stale.lastFullSyncDate === businessDate()
              ? "Synced today."
              : `Last full sync ${stale.lastFullSyncDate}. Another tablet may have collected since.`}
          {stale.pendingCount > 0 ? ` ${stale.pendingCount} receipt(s) still queued.` : ""}
        </Text>
        <Button
          title="Sync now"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await syncNow();
              await load();
              setRanks([]);
              setTendered("");
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>

      {groups.length === 0 ? (
        <Text style={styles.note}>Nothing outstanding.</Text>
      ) : (
        groups.map((group) => (
          <Pressable
            key={group.groupRank}
            style={[styles.period, ranks.includes(group.groupRank) && styles.periodOn]}
            onPress={() => tapRow(group.groupRank)}
          >
            <Text style={styles.periodText}>
              {group.periodStart} · due {group.dueDate}
            </Text>
            <Text style={styles.periodAmount}>{format(group.outstanding)}</Text>
          </Pressable>
        ))
      )}

      <Text style={styles.label}>Or enter what the tenant is handing over</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="0.00"
        value={tendered}
        onChangeText={applyAmount}
      />

      {shortOfOldest ? (
        <Text style={styles.warn}>
          {format(parsePesoInput(tendered || "0"))} does not cover the oldest period
          ({format(groups[0]!.outstanding)}). Whole periods only — there is no part payment.
        </Text>
      ) : null}

      <Text style={styles.total}>Receipt total {format(gross)}</Text>
      {change > 0 ? <Text style={styles.change}>Change {format(change)}</Text> : null}

      <Button
        title="Proceed to payment"
        disabled={ranks.length === 0}
        onPress={() => {
          setDraft({
            kind: "lease",
            leaseId,
            feeTypeId: header.fee_type_id,
            stallNo: header.stall_no,
            tenantName: header.tenant_name,
            groups,
            ranks,
            // Per CHARGE, not per group: local_allocations is keyed
            // (collection_id, charge_id) so Task 4's overlay subtracts exactly what was
            // settled. perCharge comes from leaseLedgerDetail, the same read that
            // produced these groups, so the two cannot disagree.
            allocations: selected.flatMap((g) =>
              g.chargeIds.map((chargeId) => ({
                chargeId,
                amount: perCharge.get(chargeId) ?? fromCentavos(0),
              })),
            ),
            grossAmount: gross,
            change,
          });
          router.push("/receipt");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  stall: { fontSize: 30, fontWeight: "800" },
  tenant: { fontSize: 18 },
  balance: { fontSize: 18, marginTop: 6, marginBottom: 12 },
  stale: { backgroundColor: "#fff8e1", padding: 10, borderRadius: 6, marginBottom: 12, gap: 6 },
  staleText: { fontSize: 13 },
  period: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  periodOn: { backgroundColor: "#e3f2fd" },
  periodText: { fontSize: 15 },
  periodAmount: { fontSize: 15, fontWeight: "600" },
  label: { marginTop: 16, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 22 },
  warn: { marginTop: 8, color: "#b71c1c", fontSize: 14 },
  total: { marginTop: 16, fontSize: 22, fontWeight: "700" },
  change: { fontSize: 18, color: "#1b5e20" },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
```

- [ ] **Step 4: Add the entry points to the shift screen**

In `apps/collector/src/app/shift.tsx`, inside the open-shift branch, add three buttons and show this shift's receipt figures (which `deviceTotals` already returns):

```tsx
<Button title="Collect" onPress={() => router.push("/leases")} />
<Button title="Ambulant fee" onPress={() => router.push("/ambulant")} />
<Button title="Spoil a form" onPress={() => router.push("/spoil")} />
<Text style={styles.totals}>
  {totals.count} receipt{totals.count === 1 ? "" : "s"} · {totals.total}
</Text>
```

- [ ] **Step 5: Typecheck and bundle**

```bash
pnpm typecheck
cd apps/collector && npx expo export --platform android
```

Expected: both clean. The export is what catches an unresolvable import under pnpm's isolated layout — the same class of failure that ruled out `disableHierarchicalLookup` in 3b-i.

- [ ] **Step 6: Commit**

```bash
git add apps/collector/src/collect/draft.ts apps/collector/src/app/leases.tsx \
        apps/collector/src/app/lease apps/collector/src/app/shift.tsx
git commit -m "feat(collector): lease browse, and both ways to choose what is being paid

Manual search is not a fallback: parent §9.4 makes it mandatory, because
cards get soaked, torn and stolen and Phase 4's QR is an accelerator over a
screen that must already work.

Both entry modes produce one artefact -- a set of ranks 1..n -- so the
payload and the server path are identical and the second mode is a second
way in, not a second code path to the wire.

The staleness line is not decoration. The collector hand-writes the paper OR
from the figure on this screen, so a rank set that has shifted since the last
pull is a paper-versus-ledger divergence. The device cannot detect it; what
the screen owes is an honest statement of how old its numbers are."
```

---

## Task 8: `receipt.tsx` — OR entry and confirm

**Files:**
- Create: `apps/collector/src/app/receipt.tsx`

**Interfaces:**
- Consumes: `draft`, `clearDraft` (Task 7); `orEntryContext`, `commitReceipt` (Task 6); `validateOrEntry`, `formatSerial`, `format` from `@ceedo/shared`; `randomUUID` from `expo-crypto`.

- [ ] **Step 1: Write the screen**

Create `apps/collector/src/app/receipt.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  format,
  formatSerial,
  validateOrEntry,
  type OrEntryContext,
  type OrEntryResult,
} from "@ceedo/shared";
import { commitReceipt, orEntryContext } from "@ceedo/sync-engine";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { clearDraft, draft } from "../collect/draft";

/**
 * The OR number goes in AFTER the money is counted and the paper receipt is written.
 *
 * There is no printer. The receipts are pre-printed accountable forms the collector
 * carries; the app records a number that already exists on paper in the tenant's hand
 * (spec §1.2). So this screen's job is to validate a serial, not to issue one.
 *
 * A SEQUENCE SKIP IS A WARNING THE COLLECTOR CAN ACCEPT, never a block: parent §7.1 says
 * booklets legitimately get skipped, and a warning that fires on correct behaviour is one
 * that gets ignored on the day it is right. `ambiguous_booklet` IS a hard stop, because a
 * silently wrong booklet id on a real receipt is unrecoverable once the vendor walks away.
 */
export default function Receipt() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();
  const pending = draft();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [orText, setOrText] = useState("");
  const [check, setCheck] = useState<OrEntryResult | null>(null);
  const [acceptedSkip, setAcceptedSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collector) return;
    void orEntryContext(driver, collector.id).then(setContext);
  }, [collector, driver]);

  const validate = useCallback(
    (text: string) => {
      setOrText(text);
      setAcceptedSkip(false);
      const orNo = Number.parseInt(text, 10);
      if (!context || !Number.isInteger(orNo) || orNo <= 0) return setCheck(null);
      setCheck(validateOrEntry(context, orNo));
    },
    [context],
  );

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;
  if (!pending) return <Text style={styles.note}>Nothing to record. Start from the shift screen.</Text>;

  const reason = (result: OrEntryResult): string => {
    if (result.ok) return "";
    switch (result.reason) {
      case "not_in_assigned_booklet":
        return "That number is not inside any booklet assigned to you.";
      case "already_consumed":
        return "That number has already been used.";
      case "marked_spoiled":
        return "That number is marked spoiled.";
      case "ambiguous_booklet":
        return "That number falls inside two of your booklets. Check the form type before writing it.";
    }
  };

  const blocked =
    check === null ||
    !check.ok ||
    (check.warning === "sequence_skipped" && !acceptedSkip);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>
        {pending.kind === "lease" ? `${pending.stallNo} · ${pending.tenantName}` : pending.label}
      </Text>
      <Text style={styles.amount}>{format(pending.grossAmount)}</Text>
      {pending.kind === "lease" && pending.change > 0 ? (
        <Text style={styles.change}>Change {format(pending.change)}</Text>
      ) : null}

      <Text style={styles.label}>Write the receipt, then enter its number</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={validate}
      />

      {check && !check.ok ? <Text style={styles.error}>{reason(check)}</Text> : null}
      {check?.ok ? (
        <Text style={styles.ok}>
          {formatSerial(
            context!.booklets.find((b) => b.id === check.bookletId)!.serialPrefix,
            Number.parseInt(orText, 10),
          )}
        </Text>
      ) : null}
      {check?.ok && check.warning === "sequence_skipped" && !acceptedSkip ? (
        <View style={styles.warnBox}>
          <Text style={styles.warn}>
            This skips one or more numbers in the booklet. That is allowed — confirm it is
            what the paper shows.
          </Text>
          <Button title="Yes, that is the number written" onPress={() => setAcceptedSkip(true)} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Record this receipt"
        disabled={blocked || busy}
        onPress={async () => {
          if (!check?.ok) return;
          setBusy(true);
          setError(null);
          try {
            const shifts = await driver.select<{ id: string }>(
              "select id from local_shifts where collector_id = ? and status = 'open' order by opened_at desc",
              [collector.id],
            );
            const shiftId = shifts[0]?.id;
            if (!shiftId) {
              setError("This shift is no longer open. Open one from the shift screen.");
              return;
            }

            await commitReceipt(
              driver,
              {
                id: randomUUID(),
                orNo: Number.parseInt(orText, 10),
                bookletId: check.bookletId,
                collectorId: collector.id,
                shiftId,
                collectedAt: new Date().toISOString(),
                feeTypeId: pending.feeTypeId,
                leaseId: pending.kind === "lease" ? pending.leaseId : null,
                grossAmount: pending.grossAmount,
                ranks: pending.kind === "lease" ? pending.ranks : [],
                allocations: pending.kind === "lease" ? pending.allocations : [],
                lines: pending.kind === "lines" ? pending.lines : [],
                payerRef: null,
                notes: null,
              },
              pending.kind === "lines" ? pending.lines.map(() => randomUUID()) : [],
            );

            clearDraft();
            router.replace("/shift");
          } catch (caught) {
            // Nothing was written -- commitReceipt is one transaction. Saying so matters:
            // the collector needs to know whether to write another paper receipt.
            setError(`Not recorded, and nothing was saved: ${String(caught)}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 10 },
  heading: { fontSize: 20, fontWeight: "700" },
  amount: { fontSize: 34, fontWeight: "800" },
  change: { fontSize: 18, color: "#1b5e20" },
  label: { marginTop: 12, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 24 },
  ok: { fontSize: 18, color: "#1b5e20", fontWeight: "600" },
  error: { color: "#b71c1c", fontSize: 15 },
  warnBox: { backgroundColor: "#fff8e1", padding: 10, borderRadius: 6, gap: 8 },
  warn: { fontSize: 14 },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
```

- [ ] **Step 2: Typecheck and bundle**

```bash
pnpm typecheck
cd apps/collector && npx expo export --platform android
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/collector/src/app/receipt.tsx
git commit -m "feat(collector): OR entry against the booklet in the collector's hand

There is no printer. The receipt is a pre-printed accountable form already
written and already in the tenant's hand; this screen records its number.

A sequence skip is a warning the collector confirms, never a block -- parent
§7.1, and a warning that fires on correct behaviour gets ignored on the day
it is right. An ambiguous booklet IS a hard stop: a wrong booklet id on a
real receipt is unrecoverable once the vendor walks away.

A failed commit says nothing was saved, because the collector's next decision
is whether to write another paper receipt."
```

---

## Task 9: `ambulant.tsx` — the lines receipt

Spec F8, §3.4.

**Files:**
- Create: `apps/collector/src/app/ambulant.tsx`

**Interfaces:**
- Consumes: `resolveRate`, `RateNotFoundError`, `multiply`, `sum`, `format`, `type RateRow` from `@ceedo/shared`; `setDraft` (Task 7); `businessDate`, `syncNow` (existing).

- [ ] **Step 1: Write the screen**

Create `apps/collector/src/app/ambulant.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  format,
  fromCentavos,
  multiply,
  parsePesoInput,
  resolveRate,
  RateNotFoundError,
  sum,
  type RateRow,
} from "@ceedo/shared";
import type { DraftLine } from "@ceedo/sync-engine";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { setDraft } from "../collect/draft";
import { businessDate, syncNow } from "../sync/device-sync";

interface FeeChoice {
  fee_type_id: string;
  fee_name: string;
  rate_class: string | null;
}

/**
 * On-the-spot fees: quantity x rate, no lease and no receivable. Parent §2's ambulant /
 * daily vendor fee, and the same shape Phase 5's terminal and slaughterhouse receipts need
 * -- which is why it is built here rather than deferred with them.
 *
 * Leaving it out would not defer the work. It would move half the round onto paper, and
 * the device's consumed-serial set would then diverge from the booklet it validates
 * against, so honest receipts would start raising sequence-skip warnings.
 *
 * resolveRate THROWS rather than choosing when two rates overlap. Here that becomes a
 * refusal the collector can read and a supervisor can act on -- never a crash at a stall.
 * The rates are stale-able local data, and a tablet that has not pulled a new ordinance's
 * rate row must say so rather than price the receipt itself.
 */
export default function Ambulant() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());

  const [choices, setChoices] = useState<FeeChoice[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState<FeeChoice | null>(null);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Non-accruing fee types only: an accruing one raises charges and belongs on a lease.
    setChoices(
      await driver.select<FeeChoice>(
        `select distinct f.id as fee_type_id, f.name as fee_name, r.rate_class
           from fee_types f
           join rates r on r.fee_type_id = f.id
          where f.accrues = 0 and f.active = 1
          order by f.name, r.rate_class`,
      ),
    );
    setRates(
      (
        await driver.select<{
          id: string;
          fee_type_id: string;
          rate_class: string | null;
          effective_from: string;
          effective_to: string | null;
          amount: string;
          basis: RateRow["basis"];
        }>(
          "select id, fee_type_id, rate_class, effective_from, effective_to, amount, basis from rates",
        )
      ).map((r) => ({
        id: r.id,
        feeTypeId: r.fee_type_id,
        rateClass: r.rate_class,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        amount: parsePesoInput(r.amount),
        basis: r.basis,
      })),
    );
  }, [driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const gross = sum(lines.map((l) => l.amount));

  const addLine = () => {
    if (!pick) return;
    const quantity = Number.parseInt(qty, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return setError("Quantity must be a whole number greater than zero.");
    }
    try {
      const rate = resolveRate(rates, {
        feeTypeId: pick.fee_type_id,
        rateClass: pick.rate_class,
        on: businessDate(),
      });
      setLines([
        ...lines,
        {
          feeTypeId: pick.fee_type_id,
          rateClass: pick.rate_class,
          quantity,
          unitRate: rate.amount,
          amount: multiply(rate.amount, quantity),
        },
      ]);
      setError(null);
      setQty("1");
    } catch (caught) {
      // Named precisely. "Not synced" would be a guess, and 3b-i bug 3 is what happens
      // when a screen names a cause it has not checked.
      setError(
        caught instanceof RateNotFoundError
          ? `This tablet has no rate for ${pick.fee_name}${pick.rate_class ? ` (${pick.rate_class})` : ""} as of ${businessDate()}. Sync, or ask the office whether the rate has been entered.`
          : `Cannot price this line: ${String(caught)}`,
      );
    }
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>On-the-spot fee</Text>

      {choices.map((choice) => (
        <Pressable
          key={`${choice.fee_type_id}|${choice.rate_class ?? ""}`}
          style={[styles.choice, pick === choice && styles.choiceOn]}
          onPress={() => setPick(choice)}
        >
          <Text style={styles.choiceText}>
            {choice.fee_name}
            {choice.rate_class ? ` · ${choice.rate_class}` : ""}
          </Text>
        </Pressable>
      ))}

      <Text style={styles.label}>Quantity</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={qty}
        onChangeText={setQty}
      />
      <Button title="Add to receipt" disabled={pick === null} onPress={addLine} />
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Button title="Sync now" onPress={async () => { await syncNow(); await load(); }} />
        </View>
      ) : null}

      {lines.map((line, index) => (
        <View key={index} style={styles.line}>
          <Text style={styles.lineText}>
            {line.quantity} × {format(line.unitRate)}
            {line.rateClass ? ` · ${line.rateClass}` : ""}
          </Text>
          <Text style={styles.lineAmount}>{format(line.amount)}</Text>
        </View>
      ))}

      <Text style={styles.total}>Receipt total {format(gross)}</Text>

      <Button
        title="Proceed to payment"
        disabled={lines.length === 0}
        onPress={() => {
          setDraft({
            kind: "lines",
            // Every line on one receipt shares the receipt's fee type; the per-line type
            // is what post_collection prices from.
            feeTypeId: lines[0]!.feeTypeId,
            label: "On-the-spot fee",
            lines,
            grossAmount: gross,
          });
          router.push("/receipt");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  choice: { padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 6, marginBottom: 6 },
  choiceOn: { backgroundColor: "#e3f2fd", borderColor: "#1976d2" },
  choiceText: { fontSize: 16 },
  label: { marginTop: 12, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 22 },
  errorBox: { backgroundColor: "#ffebee", padding: 10, borderRadius: 6, marginTop: 10, gap: 8 },
  error: { color: "#b71c1c", fontSize: 14 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  lineText: { fontSize: 15 },
  lineAmount: { fontSize: 15, fontWeight: "600" },
  total: { marginTop: 16, fontSize: 24, fontWeight: "700", marginBottom: 12 },
});
```

**Check `resolveRate`'s actual parameter shape** in `packages/shared/src/rates.ts:46` before running — it may take positional arguments rather than the object shown. Match the real signature; do not change `rates.ts`.

- [ ] **Step 2: Typecheck and bundle**

```bash
pnpm typecheck
cd apps/collector && npx expo export --platform android
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/collector/src/app/ambulant.tsx
git commit -m "feat(collector): the on-the-spot fee receipt, quantity times rate

Parent §2's ambulant fee, built here rather than deferred to Phase 5 because
it is the same collector on the same round tearing from the same booklet.
Leaving it out would not defer the work: it would move half the round onto
paper, and the device's consumed-serial set would then diverge from the
booklet it validates against, so honest receipts would raise sequence-skip
warnings.

resolveRate throws on overlapping rates rather than choosing; here that
becomes a refusal naming the fee type and the date, never a crash at a stall
and never a guess like 'not synced'."
```

---

## Task 10: `spoil.tsx` — marking a form spoiled

**Files:**
- Create: `apps/collector/src/app/spoil.tsx`

**Interfaces:**
- Consumes: `orEntryContext` (Task 6); `enqueue` from `@ceedo/sync-engine`; `SpoiledFormPayload` shape from the contract; `randomUUID` from `expo-crypto`.

- [ ] **Step 1: Write the screen**

Create `apps/collector/src/app/spoil.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { validateOrEntry, type OrEntryContext } from "@ceedo/shared";
import { enqueue, orEntryContext } from "@ceedo/sync-engine";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { signedIn } from "../auth/session";

/**
 * A form written wrong is spoiled and a new one issued. Spec D4 (3b-i), unchanged.
 *
 * There is deliberately no way to cancel a POSTED collection from the tablet: a collector
 * who can cancel their own receipts can make a shortfall disappear. Cancelling stays a
 * supervisor act on the web. This screen is the collector's whole remedy, and it is the
 * same one the paper process already gives them.
 *
 * The serial must be one of theirs and not already used -- but a spoiled form is NOT a
 * consumed one, so validateOrEntry's `already_consumed` is a genuine refusal here: a
 * number that carries a real receipt cannot also be spoiled.
 */
export default function Spoil() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [orText, setOrText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!collector) return;
    void orEntryContext(driver, collector.id).then(setContext);
  }, [collector, driver]);

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;

  const orNo = Number.parseInt(orText, 10);
  const check =
    context && Number.isInteger(orNo) && orNo > 0 ? validateOrEntry(context, orNo) : null;

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Spoil a form</Text>
      <Text style={styles.body}>
        The form stays in the booklet and is accounted for on return: used + spoiled +
        unused must equal the total serials.
      </Text>

      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={(text) => {
          setOrText(text);
          setError(null);
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="Why (torn, misprinted, wrong amount…)"
        value={reason}
        onChangeText={setReason}
      />

      {check && !check.ok ? (
        <Text style={styles.error}>
          {check.reason === "already_consumed"
            ? "That number carries a receipt already. It cannot be spoiled."
            : check.reason === "marked_spoiled"
              ? "That number is already marked spoiled."
              : check.reason === "ambiguous_booklet"
                ? "That number falls inside two of your booklets."
                : "That number is not inside any booklet assigned to you."}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Mark spoiled"
        disabled={busy || !check?.ok || reason.trim() === ""}
        onPress={async () => {
          if (!check?.ok) return;
          setBusy(true);
          try {
            await enqueue(driver, {
              id: randomUUID(),
              type: "spoiled_form",
              payload: {
                booklet_id: check.bookletId,
                or_no: orNo,
                collector_id: collector.id,
                reason: reason.trim(),
              },
              collectorId: collector.id,
            });
            router.replace("/shift");
          } catch (caught) {
            setError(`Not recorded: ${String(caught)}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 10 },
  heading: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 18 },
  error: { color: "#b71c1c", fontSize: 15 },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
```

- [ ] **Step 2: Typecheck and bundle**

```bash
pnpm typecheck
cd apps/collector && npx expo export --platform android
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/collector/src/app/spoil.tsx
git commit -m "feat(collector): mark a form spoiled

A form written wrong is spoiled and a new one issued -- spec D4, and what the
paper process already requires. There is deliberately no way to cancel a
posted collection from the tablet: a collector who can cancel their own
receipts can make a shortfall disappear, so that stays a supervisor act on
the web.

A number that already carries a receipt cannot be spoiled, which is why
validateOrEntry's already_consumed is a genuine refusal on this screen."
```

---

## Task 11: The two carryovers

Both are named in the 3b-i handover, and both need the rebuild this phase forces anyway.

**Files:**
- Modify: `apps/collector/app.json`
- Modify: `apps/collector/src/app/shift.tsx`

- [ ] **Step 1: Change the Android package identifier**

In `apps/collector/app.json`, replace `"package": "com.anonymous.collector"` with:

```json
      "package": "ph.gov.ceedo.collector"
```

**Confirm the identifier with the office before the first signed build.** A package name cannot be changed after an app is installed from a store or an MDM without a reinstall, and `com.anonymous.collector` must not ship under any circumstances.

- [ ] **Step 2: Give `purgeAcked` a caller**

`packages/sync-engine/src/outbox.ts` implements and tests the §6.4 retention rule — acked entries purged after 30 days, rejected ones kept until resolved — and nothing invokes it. In `shift.tsx`'s sync handler, after `syncNow()` resolves:

```ts
// §6.4's retention rule had no caller until now; the outbox simply grew. Rejected entries
// are NOT purged -- they are kept until resolved, because a rejection never means discard.
await purgeAcked(driver, 30);
```

Import `purgeAcked` from `@ceedo/sync-engine`. **Check its real signature** in `outbox.ts` — if it takes a cutoff date rather than a day count, compute the date and pass that.

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
npx vitest run packages/sync-engine
cd apps/collector && npx expo export --platform android
```

Expected: all clean. The package change needs a **full rebuild**, not a reload — it lands in the APK.

- [ ] **Step 4: Commit**

```bash
git add apps/collector/app.json apps/collector/src/app/shift.tsx
git commit -m "chore(collector): real package identifier, and a caller for purgeAcked

com.anonymous.collector was Expo's placeholder and must not ship. It needs a
full rebuild, which this phase forces anyway.

§6.4's retention rule was implemented and tested with nothing invoking it, so
the outbox grew without bound. Acked entries are purged after 30 days on the
shift screen's sync; rejected ones are kept until resolved, because a
rejection never means discard."
```

---

## Task 12: The device session

Spec §1.3. This is the task the phase exists for. 3b-i found four bugs on the tablet that no amount of Node testing would have caught, and two of them were not wrong code at all.

**Files:**
- Create: `docs/superpowers/measurements/phase-3b-ii-device-smoke.md`
- Create: `docs/superpowers/phase-3b-ii-handover.md`

- [ ] **Step 1: Prepare the tablet**

```bash
pnpm db:reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v label="'llejo android'" -v pin="'123456'" -f scripts/dev-wire-tablet.sql
```

Then, **through the web UI only** (Task 1 is what makes this possible): confirm the device assignment and collection area exist, issue a device credential on `/devices`, and enrol the tablet by QR. Confirm `apps/collector/.env` carries the machine's LAN address, not `127.0.0.1`, and restart Metro — `.env` values are inlined at bundle time and never reach an already-installed app.

Seed a lease with several months of arrears so the FIFO list is more than one row:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "select ceedo_collections.run_accrual(); select ceedo_collections.run_surcharge();"
```

- [ ] **Step 2: Write the checklist with the rows blank**

Create `docs/superpowers/measurements/phase-3b-ii-device-smoke.md`:

```markdown
# Phase 3b-ii — Device smoke checklist

**Tablet:** <model, Android version>
**Build:** <release / dev client, commit sha>
**Date:** <YYYY-MM-DD>

Rows are left BLANK until observed. A handover that recorded outcomes nobody
transcribed would be worth less than an empty one.

| # | Step | Expected | Observed |
| --- | --- | --- | --- |
| 1 | Sign in, open a shift | Shift screen shows 0 receipts · 0.00 | |
| 2 | Collect → search a stall number | The lease appears | |
| 3 | Search the tenant's name instead | The same lease appears | |
| 4 | Open the lease | Periods oldest first; balance matches the web | |
| 5 | Tap the third period | Rows 1–3 selected; total is their sum | |
| 6 | Tap the third period again | Selection clears | |
| 7 | Type an amount covering 2 periods exactly | Rows 1–2 selected; change 0.00 | |
| 8 | Type an amount covering 2 periods plus 50.00 | Rows 1–2 selected; change 50.00 | |
| 9 | Type an amount below the oldest period | Button off; message names both figures | |
| 10 | Proceed, enter an OR from the booklet | Serial shown formatted; button on | |
| 11 | Enter an OR outside the booklet | Refused, naming the reason | |
| 12 | Enter an OR skipping a number | Warning, confirmable, NOT a block | |
| 13 | Record it | Returns to shift; count and total updated | |
| 14 | Reopen the same lease | Paid periods GONE; ranks closed up | |
| 15 | **Airplane mode on.** Collect a second receipt | Records normally; no network error | |
| 16 | Shift screen, still offline | Count and total include the offline receipt | |
| 17 | Force-quit and reopen, still offline | Both receipts still counted | |
| 18 | Ambulant fee: pick a class, quantity 3 | Line priced from the rate table | |
| 19 | Ambulant with a fee type having no current rate | Refusal names the fee and the date | |
| 20 | Spoil a form | Accepted with a reason; refuses a used serial | |
| 21 | **Airplane mode off.** Sync | Outbox reaches 0 pending | |
| 22 | Reopen the lease | Server's own rows now shown; no double subtraction | |
| 23 | Close out, declare the exact cash | Closes; variance 0.00 | |
| 24 | (Second shift) Close out declaring 20.00 short | Variance -20.00, signed, recorded not hidden | |

## Bugs found

<one section per bug: what happened, why no Node test caught it, the fix>
```

- [ ] **Step 3: Run the sequence and transcribe every row**

Fill the Observed column as you go, not afterwards. Where a row fails, stop and fix it — the point of this task is the bugs it finds, and 3b-i's experience is that the interesting ones are not wrong code.

- [ ] **Step 4: Verify the whole suite from a clean database**

```bash
pnpm db:reset
API_URL=http://127.0.0.1:54321 ANON_KEY=<anon> SERVICE_ROLE_KEY=<service> \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test
pnpm typecheck
```

Record the exact file and test counts. Do not round them and do not carry forward a previous phase's figures.

- [ ] **Step 5: Write the handover**

Create `docs/superpowers/phase-3b-ii-handover.md` following `phase-3b-i-handover.md`'s structure: what exists, what the device found that Node testing did not, where the falsification checks were run and what they showed (the eight from spec §4.1, with the observed failure messages), deviations from this plan and why, known gaps carried forward, and what Phase 4 inherits.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/measurements/phase-3b-ii-device-smoke.md \
        docs/superpowers/phase-3b-ii-handover.md
git commit -m "docs: phase 3b-ii device smoke and handover

The checklist rows carry what was observed on the tablet, not what was
expected to happen. Where a row is blank it was not run."
```

---

## Verification Summary

| Layer | Command | When |
| --- | --- | --- |
| Pure packages | `npx vitest run packages/shared packages/sync-engine packages/db-local` | Every task 2–6 |
| Postgres-backed | `API_URL=… ANON_KEY=… SERVICE_ROLE_KEY=… DB_URL=… pnpm test` | Tasks 1, 3, 12 |
| Types | `pnpm typecheck` | Every task |
| Bundle resolves | `cd apps/collector && npx expo export --platform android` | Tasks 7–11 |
| The tablet | The §1.3 sequence | Task 12 |

**The eight falsification checks** (spec §4.1) are distributed across Tasks 2, 3, 4, 5 and 6. Each must be run, its failure observed, reverted, and the observation recorded in the task's commit message. A check that was not run is a check that did not happen.
