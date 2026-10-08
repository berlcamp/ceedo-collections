# Collection Reports, Phase 3: Account Chart and Fee Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every peso the system receives can be placed on exactly one account line. This phase adds:
- the account chart and its dated rules;
- the fee catalogue the office's reports need;
- office receipts, which may be paid by check;
- cash-ticket entry;
- `receipt_account_lines`, the one function every later report reads.

**Architecture:**
- **Database.** Ten migrations:
  - `064` adds the enum value `other`. It is deployed in a bundle of its own.
  - `065` adds the columns that office receipts, keyed fees and checks need.
  - `066` adds the chart tables and the rule RPC.
  - `067` changes posting: keyed amounts, payment mode, and the device check guard.
  - `068` adds office shifts and office receipts.
  - `069` adds cash tickets and folds them into shift totals.
  - `070` adds `receipt_account_lines`.
  - `071` is the office's catalogue seed. It is held back from production until the office has reviewed it.
- **Web.**
  - Chart screens are entries in the existing admin registry.
  - Rules, unclassified receipts, office receipts and cash tickets are custom pages, built in the style of Recovery and Remittances.

**Tech Stack:** Postgres (Supabase local, ports 563xx), Next.js app router (`apps/web`), zod 4, vitest, `pg` for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`. This plan covers rollout phase 3. Phases 1–2 are deployed; production is at `20261007000063`.

## Global Constraints

- **Schema and access:**
  - All objects live in schema `ceedo_collections`.
  - New views and read functions are `security invoker`.
  - Every write to a ledger-like table goes through a `security definer` RPC. Direct `insert/update/delete` is revoked from `anon, authenticated, service_role`.
- **Roles** (the `app_role` enum):
  - `admin` writes the chart and rules.
  - `supervisor` or `admin` post office receipts and open or close office shifts.
  - `supervisor`, `accounting` or `admin` enter and cancel cash tickets.
  - Back office (`supervisor`, `accounting`, `admin`) reads everything new.
- **Money:**
  - Postgres stores `numeric(14,2)` pesos.
  - TypeScript uses integer centavos (`Centavos`, `fromPesos(Number(v))` from `@ceedo/shared`).
  - Server actions send pesos to RPCs.
- **Dates:** Asia/Manila business dates, written `YYYY-MM-DD`.
- **The tablet's reason vocabulary is frozen.**
  - `PushResult.reason` is a strict enum on tablets already in the field (`packages/shared/src/reason-codes.ts`). An unknown code fails the whole sync.
  - **No new reason codes.** A keyed line with a bad amount returns `amount_mismatch`. A device receipt claiming a check returns `server_error`, with a `detail` sentence.
- **Function edits copy the whole body.**
  - `create or replace` replaces the whole function, so every redefinition reproduces the latest body **verbatim**, then applies the edit shown.
  - The latest bodies:
    - `post_collection` is in `20260919000043` (lines 39–323).
    - `sync_push` is in `20260929000059`, from line 79 to the end of that function.
    - `close_shift` is in `20260928000051`, from line 283 to just before `sync_pull` at about line 383.
    - `office_close_shift` and `recovery_refusal` are in `20260930000060`.
    - `clear_all_data` is in `20260929000052`.
- **Migrations:**
  - Files: `supabase/migrations/20261008000064_*.sql` … `20261008000071_*.sql`.
  - Apply locally with `supabase migration up`.
  - After each one, run `pnpm db:types` and commit `packages/shared/src/db.types.ts`. CI runs `scripts/check-types-current.sh`.
- **Tests:**
  - Run from the repo root: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <file>`.
  - Run `supabase db reset` before any full-suite run you intend to trust.
- **Before pushing `main`:** run `pnpm --filter @ceedo/web build`. Any type error blocks the push.
- **Production DB:**
  - Changes reach production only as bundles from `node scripts/bundle-migrations.mjs`, which the user runs by hand.
  - Never push, deploy or run SQL against production without the user's go-ahead.
- **PostgREST returns at most 1000 rows.** Page any list read with `.range()`, through `allPages` in `apps/web/lib/reports/data.ts`, which Task 8 exports.
- **Office spreadsheets and real names never enter the repo.** Bus companies and account names are business names and are fine. Cashier and tenant names are not.

### Spec deviations (deliberate; state them in the PR description)

1. **Rules become two tables.** `account_rules` holds one row per key and date range. `account_rule_shares` holds its accounts and `share_bps`.
   - The spec's flat table needs an exclusion constraint that allows identical ranges *within* a set but not *across* sets. Postgres cannot express that on one table.
   - With two tables, the exclusion constraint sits on `account_rules`, and a deferred trigger checks that the shares sum to 10000.
2. **`treasurer_lines` and `rcd_columns` gain `code text unique`**, so the seed and the built-ins can name them.
3. **An office shift has no tablet.**
   - `shifts.device_id` and `collections.device_id` become nullable.
   - `shifts.kind` (`device` | `office`) says which kind of shift it is, with check `(kind = 'device') = (device_id is not null)`.
   - `collections` gets check `payment_mode = 'cash' or device_id is null`. That makes "a check only from the office" a database fact.
4. **The officer cannot sign in.**
   - The officer is the collector-role person who holds the booklet, and collectors have no web login.
   - So office receipts are posted by a **supervisor or admin on the officer's behalf**, into an office shift in the officer's name.
5. **Screens live at `/accounts/*`, not `/admin/accounts`.** The app has no `/admin` prefix: the `(admin)` route group adds none. Back office can read them; only admins can write.
6. **The seed adds no rates.**
   - The seeded fee types that are priced by rate (delivery, parking, storage, entrance, burial, slaughterhouse sub-fees, veterinary, Night Market, Tabo) get **no rates**. The office enters them on the Rates screen before anyone collects them.
   - No guessed prices. This also keeps them off the tablets until then, because a tablet lists only fees that have a rate.
7. **Sections are allowed on `terminal` and `other` facilities**, not only on markets.
   - IBJT rents Building 2, Building 3, Kiosk and Rentables stalls. Parking and slaughterhouse facilities still refuse sections.
8. **Fee types keep `facility_type` in step with `facility_id`.** When `facility_id` is set, a trigger copies the facility's type into `fee_types.facility_type`.
   - Tablets filter by `facility_type` until phase 7, so a facility-specific fee is offered at that *kind* of facility in the meantime.
9. **`receipt_account_lines` returns more columns than the spec lists.** The extras are `cash_ticket_id`, `line_id`, `shift_id`, `facility_id`, `section_id`, `rate_class`, `quantity` and `portion`, which phases 4–6 need.
10. **The tenant-payments grid is not re-keyed by account here.** That moves to the phase 4 plan, together with the Night Market and Tabo payer rows.
    - This phase only stops a receipt that has fee lines (an occupancy fee on a lease) from appearing in the grid as rent.
11. **Monthly adjustments and control totals are phase 5**, as the spec's rollout says.
12. **`clear_all_data` reinstalls the chart.** The super-admin "clear all data" wipes every table, so it now reinstalls the built-ins (Task 2) and the catalogue (Task 7) afterwards.

## Review Focus

1. **Cancelling a cash ticket on a shift that is short and partly settled** must be refused when the remaining shortage would fall below what has already been settled. Otherwise the shift would be over-settled. (Task 6 test.)
2. **A lease receipt that pays only a surcharge** (`gross` equals the surcharge allocations) must give one surcharge portion and **no** zero-peso base row. (Task 7 test.)
3. **A split of a tiny amount** (₱0.01 at 7500/2500) must still sum exactly to the portion. All the money goes to the larger share, and no zero row is emitted. (Task 7 test.)
4. **An occupancy-fee receipt on a lease** (lease plus a keyed line, no allocations) must appear **once** in `receipt_account_lines`, matched on the lease's section. It must not appear in `lease_receipts_by_day`, and it must not change the lease's balance. (Task 7 test.)
5. **A tablet push whose receipt claims `payment_mode: 'check'`** must reject that one entry with `server_error` and a detail sentence. The other entries in the same push must still post. (Task 4 test.)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261008000064_facility_type_other.sql` | `facility_type` gains `other` (deployed alone: a new enum value cannot be used in the transaction that adds it) |
| `supabase/migrations/20261008000065_office_and_keyed_columns.sql` | `fee_types.amount_mode/facility_id`, `collections.payment_mode/check_*`, nullable `device_id`, `shifts.kind`, sections allowed on terminal/other |
| `supabase/migrations/20261008000066_account_chart.sql` | `treasurer_lines`, `rcd_columns`, `collection_accounts`, `account_rules`, `account_rule_shares`, built-ins, `replace_account_rule`, `clear_all_data` reinstall |
| `supabase/migrations/20261008000067_keyed_lines_payment_mode.sql` | `post_collection` keyed lines + payment columns; `sync_push` check guard; `recovery_refusal` sentence |
| `supabase/migrations/20261008000068_office_receipts.sql` | `office_shift`, `post_office_receipt`, `close_office_shift` |
| `supabase/migrations/20261008000069_cash_tickets.sql` | `cash_ticket_sales`, record/cancel RPCs, `close_shift` + `office_close_shift` + `close_office_shift` count tickets |
| `supabase/migrations/20261008000070_receipt_account_lines.sql` | `receipt_account_lines(from, to)`; `lease_receipts_by_day` skips receipts with lines |
| `supabase/migrations/20261008000071_account_catalogue.sql` | `install_account_catalogue()` (facilities, sections, fee types, accounts, rules) and its first run |
| `supabase/seed.sql` | idempotent inserts so `db reset` works after 071 |
| `scripts/bundle-migrations.mjs` | `--through <version>` |
| `tests/helpers/accounts.ts` | `createAccount`, `createRule`, `accountId` test helpers |
| `tests/db/office-keyed-columns.test.ts` | Task 1 |
| `tests/db/account-chart.test.ts` | Task 2 |
| `tests/db/keyed-lines-payment-mode.test.ts` | Task 4 |
| `tests/db/office-receipts.test.ts` | Task 5 |
| `tests/db/cash-tickets.test.ts` | Task 6 |
| `tests/db/receipt-account-lines.test.ts` | Task 7 |
| `tests/db/account-catalogue.test.ts` | Task 3 |
| `apps/web/lib/admin/registry.ts` | facilities `other`; fee types `amount_mode`/`facility_id`; `treasurer-lines`, `rcd-columns`, `collection-accounts` resources |
| `apps/web/lib/nav/modules.ts` | "Accounts" module; Office receipt and Cash tickets tabs |
| `apps/web/lib/accounts/{queries,actions,schemas}.ts` (+ `schemas.test.ts`) | rules list, rule creation, unclassified list |
| `apps/web/app/(admin)/accounts/rules/page.tsx`, `.../unclassified/page.tsx` | the two custom chart screens |
| `apps/web/components/accounts/{rules-table,rule-dialog,unclassified-table}.tsx` | their UI |
| `apps/web/lib/office-receipt/{queries,actions,schemas}.ts` (+ `schemas.test.ts`) | office receipt reads and actions |
| `apps/web/app/(admin)/ledger/office-receipt/page.tsx`, `components/office-receipt/*.tsx` | office receipt screen |
| `apps/web/lib/cash-tickets/{queries,actions}.ts`, `app/(admin)/ledger/cash-tickets/page.tsx`, `components/cash-tickets/*.tsx` | cash ticket screen |
| `apps/web/lib/ledger/shifts.ts`, `shift-class.ts`, `components/ledger/shifts-table.tsx` | "Office" label; overage-without-tickets flag |
| `apps/web/lib/recovery/queries.ts` | `getRecoveryShift` ignores office shifts (nullable `device_id`) |

---

### Task 1: Enum value, office/keyed columns, `--through` bundling

**Files:**
- Create: `supabase/migrations/20261008000064_facility_type_other.sql`
- Create: `supabase/migrations/20261008000065_office_and_keyed_columns.sql`
- Modify: `scripts/bundle-migrations.mjs`
- Modify: `apps/web/lib/recovery/queries.ts:115-118`, `apps/web/lib/ledger/shifts.ts:27-60`
- Test: `tests/db/office-keyed-columns.test.ts`

**Interfaces:**
- Produces:
  - `facility_type` value `'other'`.
  - `fee_types.amount_mode text ('rate'|'keyed')` and `fee_types.facility_id uuid null`.
  - `collections.payment_mode text ('cash'|'check')`, plus `check_no text`, `bank text` and `check_date date`.
  - `shifts.kind text ('device'|'office')`.
  - `shifts.device_id` and `collections.device_id` become nullable.
  - Index `shifts_one_open_office_shift`.
  - `bundle-migrations.mjs --through <version>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/office-keyed-columns.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, uniqueCode } from "../helpers/supabase";

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => db.end());

async function facility(type: string) {
  const { rows } = await db.query(
    `insert into ceedo_collections.facilities (code, name, type) values ($1, $1, $2::ceedo_collections.facility_type) returning id`,
    [uniqueCode("F"), type],
  );
  return rows[0].id as string;
}

describe("facilities and sections", () => {
  it("accepts an 'other' facility, and sections on terminal and other facilities", async () => {
    for (const type of ["terminal", "other"]) {
      const id = await facility(type);
      await expect(
        db.query(
          `insert into ceedo_collections.sections (facility_id, name, default_accrual_period) values ($1, 'Building 2', 'daily')`,
          [id],
        ),
      ).resolves.toBeDefined();
    }
  });

  it("still refuses sections on parking and slaughterhouse facilities", async () => {
    const id = await facility("parking");
    await expect(
      db.query(
        `insert into ceedo_collections.sections (facility_id, name, default_accrual_period) values ($1, 'X', 'daily')`,
        [id],
      ),
    ).rejects.toThrow(/Sections may not belong/);
  });
});

describe("fee_types", () => {
  it("defaults to rate mode and copies the facility's type when facility_id is set", async () => {
    const fid = await facility("other");
    const { rows } = await db.query(
      `insert into ceedo_collections.fee_types (code, name, facility_id) values ($1, 'x', $2)
       returning amount_mode, facility_type::text`,
      [uniqueCode("FT"), fid],
    );
    expect(rows[0]).toEqual({ amount_mode: "rate", facility_type: "other" });
  });

  it("refuses an unknown amount mode", async () => {
    await expect(
      db.query(`insert into ceedo_collections.fee_types (code, name, amount_mode) values ($1, 'x', 'free')`, [uniqueCode("FT")]),
    ).rejects.toThrow(/amount_mode/);
  });
});

describe("collections payment mode", () => {
  async function insertCollection(fx: Awaited<ReturnType<typeof createCollectionFixture>>, extra: Record<string, unknown>) {
    const cols = { id: randomUUID(), or_no: 1990, booklet_id: fx.bookletId, collector_id: fx.collectorId,
      device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", business_date: "2026-10-05",
      fee_type_id: fx.perHeadFeeTypeId, gross_amount: 0, ...extra };
    const keys = Object.keys(cols);
    // gross_amount 0 violates its own check; the payment checks must fire on their own, so
    // each case below sets a positive gross and expects the payment constraint by name.
    await db.query(
      `insert into ceedo_collections.collections (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(cols),
    );
  }

  it("refuses a check without its details", async () => {
    const fx = await createCollectionFixture(db);
    await expect(insertCollection(fx, { gross_amount: 10, device_id: null, payment_mode: "check" }))
      .rejects.toThrow(/collections_check_details/);
  });

  it("refuses a check on a tablet receipt", async () => {
    const fx = await createCollectionFixture(db);
    await expect(insertCollection(fx, { gross_amount: 10, payment_mode: "check", check_no: "1", bank: "LBP", check_date: "2026-10-05" }))
      .rejects.toThrow(/collections_check_only_from_office/);
  });
});

describe("shifts", () => {
  it("requires a device on a device shift and none on an office shift", async () => {
    const fx = await createCollectionFixture(db);
    await expect(
      db.query(
        `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
         values ($1, $2, null, '2026-10-05', now(), 'open', 'device')`,
        [randomUUID(), fx.collectorId],
      ),
    ).rejects.toThrow(/shifts_device_matches_kind/);
    await db.query(
      `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
       values ($1, $2, null, '2026-10-05', now(), 'open', 'office')`,
      [randomUUID(), fx.collectorId],
    );
    await expect(
      db.query(
        `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
         values ($1, $2, null, '2026-10-05', now(), 'open', 'office')`,
        [randomUUID(), fx.collectorId],
      ),
    ).rejects.toThrow(/shifts_one_open_office_shift/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/office-keyed-columns.test.ts`
Expected: FAIL. The `other` value is invalid input for enum `facility_type`, and the columns do not exist.

- [ ] **Step 3: Write the migrations**

```sql
-- supabase/migrations/20261008000064_facility_type_other.sql
-- City Gym, Cotta, Public Cemetery, Night Market, IBJT Tabo, Unitop: places the office
-- collects at that are neither markets, terminals, parking nor the slaughterhouse.
--
-- ALONE IN ITS FILE AND ITS BUNDLE. Postgres refuses to use an enum value in the transaction
-- that added it ("unsafe use of new value"), and a production bundle is one transaction. Deploy
-- with `--through 20261008000064` first; everything after it goes in the next bundle.
alter type ceedo_collections.facility_type add value if not exists 'other';
```

```sql
-- supabase/migrations/20261008000065_office_and_keyed_columns.sql
-- Collection reports phase 3 (spec 2026-10-07): the columns office receipts, keyed fees and
-- checks need. No behaviour changes here beyond constraints; the RPCs follow in 067-069.

-- 1. Sections may hang off a terminal or an 'other' facility too. IBJT rents Building 2,
--    Building 3, Kiosk and Rentables stalls; Wellness Park is a market. Parking and the
--    slaughterhouse stay without sections.
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

  if facility_kind is null or facility_kind in ('parking', 'slaughterhouse') then
    raise exception 'Sections may not belong to a % facility', coalesce(facility_kind::text, 'missing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function ceedo_collections.assert_facility_keeps_sections_valid()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if new.type in ('parking', 'slaughterhouse')
     and old.type is distinct from new.type
     and exists (select 1 from ceedo_collections.sections where facility_id = old.id)
  then
    raise exception
      'Cannot change facility % to % while it still has sections', old.code, new.type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 2. Fee types: keyed amounts, and an optional home facility.
alter table ceedo_collections.fee_types
  add column amount_mode text not null default 'rate'
    constraint fee_types_amount_mode check (amount_mode in ('rate', 'keyed')),
  add column facility_id uuid references ceedo_collections.facilities (id);

comment on column ceedo_collections.fee_types.amount_mode is
  'rate: priced from the rates table. keyed: the amount is typed on the receipt (one line, quantity 1).';
comment on column ceedo_collections.fee_types.facility_id is
  'The one facility this fee belongs to (PM CR vs IBJT CR). Null: any facility of facility_type.';

-- Tablets filter on facility_type until phase 7, so a facility-specific fee keeps the type of
-- its facility rather than relying on two columns an admin must keep in step by hand.
create or replace function ceedo_collections.fee_type_follows_facility()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if new.facility_id is not null then
    select type into new.facility_type from ceedo_collections.facilities where id = new.facility_id;
  end if;
  return new;
end;
$$;

create trigger fee_types_follow_facility
  before insert or update of facility_id, facility_type on ceedo_collections.fee_types
  for each row execute function ceedo_collections.fee_type_follows_facility();
revoke execute on function ceedo_collections.fee_type_follows_facility() from public;

-- 3. Office shifts carry no tablet.
alter table ceedo_collections.shifts
  add column kind text not null default 'device'
    constraint shifts_kind check (kind in ('device', 'office')),
  alter column device_id drop not null,
  add constraint shifts_device_matches_kind check ((kind = 'device') = (device_id is not null));

-- One open office shift per officer per day; office_shift() (068) finds it or opens it.
create unique index shifts_one_open_office_shift
  on ceedo_collections.shifts (collector_id, business_date)
  where kind = 'office' and status = 'open';

-- 4. Receipts: payment mode, and no tablet on an office receipt.
alter table ceedo_collections.collections
  alter column device_id drop not null,
  add column payment_mode text not null default 'cash'
    constraint collections_payment_mode check (payment_mode in ('cash', 'check')),
  add column check_no   text,
  add column bank       text,
  add column check_date date,
  -- The three check fields exist exactly when the receipt is a check.
  add constraint collections_check_details check (
    (payment_mode = 'check') = (check_no is not null and bank is not null and check_date is not null)
    and (payment_mode = 'check' or (check_no is null and bank is null and check_date is null))
  ),
  -- Collectors in the field take cash. A check is accepted at the office only, and an office
  -- receipt is the only kind with no tablet.
  add constraint collections_check_only_from_office check (payment_mode = 'cash' or device_id is null);
```

- [ ] **Step 4: Add `--through` to the bundle script**

In `scripts/bundle-migrations.mjs`, after the `after` lines (around line 28), add:

```js
const throughIndex = process.argv.indexOf("--through");
const through = throughIndex > -1 ? process.argv[throughIndex + 1] : null;
```

Change the filter line to:

```js
const files = all.filter(
  (f) => (!after || f.slice(0, 14) > after) && (!through || f.slice(0, 14) <= through),
);
```

Add this usage line to the header comment, under the `--after` example:

```
 *   node scripts/bundle-migrations.mjs --after A --through B   # A < version <= B (hold later ones back)
```

- [ ] **Step 5: Apply, regenerate types, fix the two readers of `device_id`**

Run: `supabase migration up && pnpm db:types`

`shifts.device_id` is now `string | null`, so the web build fails in two places:

1. In `apps/web/lib/recovery/queries.ts` `getRecoveryShift`, right after `if (!shift) return null;`:

```ts
  // Recovery is for a tablet's shift. An office shift (migration 0065) has no tablet and is
  // closed from the Office receipt screen instead.
  if (shift.device_id === null) return null;
```

2. In `apps/web/lib/ledger/shifts.ts`:
   - Add `kind` to the select string, after `status`.
   - Change `deviceLabel` to:

```ts
    deviceLabel: row.kind === "office" ? "Office" : (row.device?.label ?? "Unknown device"),
```

- [ ] **Step 6: Update the facilities tests that pinned the old rule**

`tests/db/facilities.test.ts` asserts two things this task deliberately changes:
- a terminal refuses sections (about line 52);
- a market with sections cannot become a terminal (about line 111).

Re-point both at `parking`:
- Insert the facility with `type: "parking"`, and update to `type: "parking"`.
- Change their message expectations to `/Sections may not belong/` and `/while it still has sections/`.

Add a case showing a market with sections may now become a terminal.

- [ ] **Step 7: Run the tests and the build**

Run: `pnpm vitest run tests/db/office-keyed-columns.test.ts tests/db/facilities.test.ts tests/db/recovery.test.ts tests/db/shifts.test.ts && pnpm --filter @ceedo/web build`
Expected: PASS, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261008000064_facility_type_other.sql supabase/migrations/20261008000065_office_and_keyed_columns.sql scripts/bundle-migrations.mjs packages/shared/src/db.types.ts apps/web/lib/recovery/queries.ts apps/web/lib/ledger/shifts.ts tests/db/office-keyed-columns.test.ts tests/db/facilities.test.ts
git commit -m "feat(ledger): office shifts, keyed fees and check columns"
```

---

### Task 2: Account chart, rules and `replace_account_rule`

**Files:**
- Create: `supabase/migrations/20261008000066_account_chart.sql`
- Create: `tests/helpers/accounts.ts`
- Test: `tests/db/account-chart.test.ts`

**Interfaces:**
- Consumes: Task 1's `fee_types.facility_id`.
- Produces:
  - Tables:
    - `treasurer_lines(id, code, name, sort_order, subtotal_group, active)`.
    - `rcd_columns(id, code, name, sort_order, active)`.
    - `collection_accounts(id, code, name, facility_id, group_name, sort_order, kind, treasurer_line_id, rcd_column_id, active)`.
    - `account_rules(id, fee_type_id, facility_id, section_id, rate_class, portion, effective_from, effective_to)`.
    - `account_rule_shares(id, rule_id, account_id, share_bps)`.
  - Built-ins: treasurer line `TL_OTHER`, RCD column `RC_OTHER`, account `UNCLASSIFIED`.
  - Functions:
    - `install_chart_builtins()`.
    - `replace_account_rule(p_fee_type_id uuid, p_facility_id uuid, p_section_id uuid, p_rate_class text, p_portion text, p_effective_from date, p_shares jsonb) returns uuid`. `p_shares` is `[{account_id, share_bps}]`.
  - Test helpers in `tests/helpers/accounts.ts`:
    - `createAccount(db, code?) → id`.
    - `createRule(db, {feeTypeId, facilityId?, sectionId?, rateClass?, portion?, from?, to?, shares: [accountId, bps][]}) → ruleId`.
    - `accountId(db, code) → id`.

- [ ] **Step 1: Write the test helper**

```ts
// tests/helpers/accounts.ts
import type { Client as PgClient } from "pg";
import { uniqueCode } from "./supabase";

/** An account on the built-in "Other collections" line and column. */
export async function createAccount(db: PgClient, code = uniqueCode("ACC")): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.collection_accounts
       (code, name, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
     select $1, $1, 'Test', 1, 'income', t.id, r.id
       from ceedo_collections.treasurer_lines t, ceedo_collections.rcd_columns r
      where t.code = 'TL_OTHER' and r.code = 'RC_OTHER'
     returning id`,
    [code],
  );
  return rows[0].id as string;
}

export async function accountId(db: PgClient, code: string): Promise<string> {
  const { rows } = await db.query(`select id from ceedo_collections.collection_accounts where code = $1`, [code]);
  if (!rows[0]) throw new Error(`No account ${code}`);
  return rows[0].id as string;
}

/**
 * A rule set inserted as the owner, bypassing replace_account_rule's admin gate. The
 * deferred shares trigger still runs at commit, so the shares must sum to 10000.
 */
export async function createRule(
  db: PgClient,
  r: {
    feeTypeId: string;
    facilityId?: string | null;
    sectionId?: string | null;
    rateClass?: string | null;
    portion?: "base" | "surcharge";
    from?: string;
    to?: string | null;
    shares: [string, number][];
  },
): Promise<string> {
  await db.query("begin");
  try {
    const { rows } = await db.query(
      `insert into ceedo_collections.account_rules
         (fee_type_id, facility_id, section_id, rate_class, portion, effective_from, effective_to)
       values ($1, $2, $3, $4, $5, $6::date, $7::date) returning id`,
      [r.feeTypeId, r.facilityId ?? null, r.sectionId ?? null, r.rateClass ?? null,
       r.portion ?? "base", r.from ?? "2026-10-01", r.to ?? null],
    );
    const id = rows[0].id as string;
    for (const [account, bps] of r.shares) {
      await db.query(
        `insert into ceedo_collections.account_rule_shares (rule_id, account_id, share_bps) values ($1, $2, $3)`,
        [id, account, bps],
      );
    }
    await db.query("commit");
    return id;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/db/account-chart.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, uniqueCode, type TestClient } from "../helpers/supabase";
import { accountId, createAccount, createRule } from "../helpers/accounts";

let db: Client;
let admin: TestClient;
let supervisor: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin } = await createAppUser({ email: "chart-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "chart-supervisor", role: "supervisor" }));
});
afterAll(async () => db.end());

async function feeType(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type) values ($1, $1, 'market') returning id`,
    [uniqueCode("FT")],
  );
  return rows[0].id as string;
}

describe("built-ins", () => {
  it("installs UNCLASSIFIED on the Other collections line and column", async () => {
    const { rows } = await db.query(
      `select t.code as tl, r.code as rc from ceedo_collections.collection_accounts a
         join ceedo_collections.treasurer_lines t on t.id = a.treasurer_line_id
         join ceedo_collections.rcd_columns r on r.id = a.rcd_column_id
        where a.code = 'UNCLASSIFIED'`,
    );
    expect(rows).toEqual([{ tl: "TL_OTHER", rc: "RC_OTHER" }]);
  });

  it("refuses to delete or recode UNCLASSIFIED", async () => {
    await expect(db.query(`delete from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED'`))
      .rejects.toThrow(/built-in/);
    await expect(db.query(`update ceedo_collections.collection_accounts set code = 'X' where code = 'UNCLASSIFIED'`))
      .rejects.toThrow(/built-in/);
  });
});

describe("rule constraints", () => {
  it("refuses shares that do not sum to 10000", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await expect(createRule(db, { feeTypeId: ft, shares: [[a, 9000]] })).rejects.toThrow(/add up to 100%/);
  });

  it("refuses overlapping rule sets for the same key, but allows a later one after an end", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await createRule(db, { feeTypeId: ft, to: "2026-10-31", shares: [[a, 10000]] });
    await expect(createRule(db, { feeTypeId: ft, from: "2026-10-15", shares: [[a, 10000]] }))
      .rejects.toThrow(/account_rules_no_overlap/);
    await expect(createRule(db, { feeTypeId: ft, from: "2026-11-01", shares: [[a, 10000]] })).resolves.toBeTruthy();
  });

  it("treats a different facility or rate class as a different key", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await createRule(db, { feeTypeId: ft, shares: [[a, 10000]] });
    await expect(createRule(db, { feeTypeId: ft, rateClass: "ASMO", shares: [[a, 10000]] })).resolves.toBeTruthy();
  });

  it("refuses an empty rate class (null means any class)", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await expect(createRule(db, { feeTypeId: ft, rateClass: "", shares: [[a, 10000]] })).rejects.toThrow(/rate_class/);
  });
});

describe("replace_account_rule", () => {
  const call = (client: TestClient, ft: string, from: string, shares: { account_id: string; share_bps: number }[]) =>
    client.rpc("replace_account_rule", {
      p_fee_type_id: ft, p_facility_id: null, p_section_id: null, p_rate_class: null,
      p_portion: "base", p_effective_from: from, p_shares: shares,
    });

  it("refuses anyone but an admin", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const { error } = await call(supervisor, ft, "2026-10-01", [{ account_id: a, share_bps: 10000 }]);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("ends the current set the day before and starts the new one", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const b = await createAccount(db);
    const first = await call(admin, ft, "2026-10-01", [{ account_id: a, share_bps: 10000 }]);
    expect(first.error).toBeNull();
    const second = await call(admin, ft, "2026-11-01", [{ account_id: a, share_bps: 7500 }, { account_id: b, share_bps: 2500 }]);
    expect(second.error).toBeNull();
    const { rows } = await db.query(
      `select effective_from::text f, effective_to::text t from ceedo_collections.account_rules
        where fee_type_id = $1 order by effective_from`,
      [ft],
    );
    expect(rows).toEqual([{ f: "2026-10-01", t: "2026-10-31" }, { f: "2026-11-01", t: null }]);
  });

  it("never rewrites: a start on or before the current set's start is refused", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await call(admin, ft, "2026-10-10", [{ account_id: a, share_bps: 10000 }]);
    const { error } = await call(admin, ft, "2026-10-10", [{ account_id: a, share_bps: 10000 }]);
    expect(error?.message).toMatch(/already starts on/);
  });

  it("says so in words when the shares do not add up", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const { error } = await call(admin, ft, "2026-10-01", [{ account_id: a, share_bps: 5000 }]);
    expect(error?.message).toMatch(/add up to 100%/);
  });

  it("is readable by back office, not writable directly", async () => {
    const { error: readError } = await supervisor.from("account_rules").select("id").limit(1);
    expect(readError).toBeNull();
    const { error } = await admin.from("account_rule_shares").insert({
      rule_id: "00000000-0000-0000-0000-000000000000",
      account_id: await accountId(db, "UNCLASSIFIED"),
      share_bps: 10000,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/account-chart.test.ts`
Expected: FAIL. The relation `collection_accounts` does not exist.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20261008000066_account_chart.sql
-- Collection reports phase 3: the account chart and its dated rules (spec "Data model").
-- Every receipt portion is placed on an account by the most specific rule in force on its
-- business date (receipt_account_lines, 070); a portion no rule places goes to UNCLASSIFIED.

create table ceedo_collections.treasurer_lines (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  sort_order     integer not null,
  subtotal_group smallint not null check (subtotal_group in (1, 2)),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0
);

create table ceedo_collections.rcd_columns (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.collection_accounts (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  -- Null for cross-facility groups (Surcharges, Non-Income).
  facility_id       uuid references ceedo_collections.facilities (id),
  group_name        text not null,
  sort_order        integer not null,
  kind              text not null check (kind in ('income', 'non_income')),
  -- Both required: no peso may fall off the Treasurer page or the per-collector matrix.
  treasurer_line_id uuid not null references ceedo_collections.treasurer_lines (id),
  rcd_column_id     uuid not null references ceedo_collections.rcd_columns (id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  row_version       bigint not null default 0
);

create index collection_accounts_facility_idx on ceedo_collections.collection_accounts (facility_id);

select ceedo_collections.apply_master_data_policies('treasurer_lines');
select ceedo_collections.apply_master_data_policies('rcd_columns');
select ceedo_collections.apply_master_data_policies('collection_accounts');
select ceedo_collections.attach_audit('collection_accounts');

-- The built-ins. receipt_account_lines sends every unplaced portion to UNCLASSIFIED, so it
-- must always exist and keep its code.
create or replace function ceedo_collections.assert_builtin_account_kept()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.code = 'UNCLASSIFIED' and (tg_op = 'DELETE' or new.code <> old.code) then
    raise exception 'UNCLASSIFIED is a built-in account; it cannot be deleted or recoded'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger collection_accounts_builtin
  before update or delete on ceedo_collections.collection_accounts
  for each row execute function ceedo_collections.assert_builtin_account_kept();
revoke execute on function ceedo_collections.assert_builtin_account_kept() from public;

-- ---------------------------------------------------------------------------------------
-- Rules. One account_rules row is a RULE SET: a key (fee type, facility, section, rate
-- class, portion) and a date range. Its accounts and shares are account_rule_shares rows.
-- A set is never edited: replace_account_rule ends it and starts the next, so a month
-- already reported is never restated.

create table ceedo_collections.account_rules (
  id             uuid primary key default gen_random_uuid(),
  fee_type_id    uuid not null references ceedo_collections.fee_types (id),
  facility_id    uuid references ceedo_collections.facilities (id),
  section_id     uuid,
  -- Null: any rate class. Never '' -- that would be a second spelling of "any".
  rate_class     text check (rate_class is null or length(rate_class) > 0),
  portion        text not null check (portion in ('base', 'surcharge')),
  effective_from date not null,
  effective_to   date,
  created_by     uuid references ceedo_collections.app_users (id),
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  -- A section names its facility; the composite key from migration 0007 checks they agree.
  check (section_id is null or facility_id is not null),
  constraint account_rules_section_in_facility
    foreign key (section_id, facility_id)
    references ceedo_collections.sections (id, facility_id),
  constraint account_rules_no_overlap exclude using gist (
    fee_type_id with =,
    (coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(rate_class, '')) with =,
    portion with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index account_rules_fee_type_idx on ceedo_collections.account_rules (fee_type_id, portion);

create table ceedo_collections.account_rule_shares (
  id         uuid primary key default gen_random_uuid(),
  rule_id    uuid not null references ceedo_collections.account_rules (id),
  account_id uuid not null references ceedo_collections.collection_accounts (id),
  share_bps  integer not null check (share_bps between 1 and 10000),
  unique (rule_id, account_id)
);

-- Checked at commit: a set and its shares are inserted in one transaction, so a per-
-- statement check would see the set with no shares yet.
create or replace function ceedo_collections.assert_rule_shares_whole()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_rule  uuid;
  v_total integer;
begin
  -- IF, not CASE: PL/pgSQL resolves record fields in any expression it plans, and
  -- account_rules rows have no rule_id; an untaken IF branch is never planned.
  if tg_table_name = 'account_rules' then
    v_rule := new.id;
  else
    v_rule := new.rule_id;
  end if;
  if not exists (select 1 from ceedo_collections.account_rules where id = v_rule) then
    return null;
  end if;
  select coalesce(sum(share_bps), 0) into v_total
    from ceedo_collections.account_rule_shares where rule_id = v_rule;
  if v_total <> 10000 then
    -- The percent sign travels in the argument: in RAISE, "%%" is a literal and "%" a
    -- placeholder, so a literal sign after a placeholder cannot be written in the format.
    raise exception 'The shares of a rule must add up to 100%% (this one adds up to %)',
      to_char(v_total / 100.0, 'FM990.00') || '%'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger account_rules_shares_whole
  after insert on ceedo_collections.account_rules
  deferrable initially deferred
  for each row execute function ceedo_collections.assert_rule_shares_whole();

create constraint trigger account_rule_shares_whole
  after insert on ceedo_collections.account_rule_shares
  deferrable initially deferred
  for each row execute function ceedo_collections.assert_rule_shares_whole();

revoke execute on function ceedo_collections.assert_rule_shares_whole() from public;

select ceedo_collections.attach_audit('account_rules');
select ceedo_collections.attach_audit('account_rule_shares');

alter table ceedo_collections.account_rules enable row level security;
alter table ceedo_collections.account_rule_shares enable row level security;
create policy account_rules_read on ceedo_collections.account_rules
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
create policy account_rule_shares_read on ceedo_collections.account_rule_shares
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
revoke insert, update, delete on ceedo_collections.account_rules from anon, authenticated, service_role;
revoke insert, update, delete on ceedo_collections.account_rule_shares from anon, authenticated, service_role;
grant select on ceedo_collections.account_rules, ceedo_collections.account_rule_shares to authenticated, service_role;

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.install_chart_builtins()
returns void
language sql
security definer
set search_path = ceedo_collections, pg_temp
as $$
  insert into ceedo_collections.treasurer_lines (code, name, sort_order, subtotal_group)
  values ('TL_OTHER', 'Other collections', 110, 1)
  on conflict (code) do nothing;

  insert into ceedo_collections.rcd_columns (code, name, sort_order)
  values ('RC_OTHER', 'Other collections', 120)
  on conflict (code) do nothing;

  insert into ceedo_collections.collection_accounts
    (code, name, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
  select 'UNCLASSIFIED', 'Unclassified', 'Unclassified', 99999, 'income', t.id, r.id
    from ceedo_collections.treasurer_lines t, ceedo_collections.rcd_columns r
   where t.code = 'TL_OTHER' and r.code = 'RC_OTHER'
  on conflict (code) do nothing;
$$;

revoke execute on function ceedo_collections.install_chart_builtins() from public;
select ceedo_collections.install_chart_builtins();

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.replace_account_rule(
  p_fee_type_id    uuid,
  p_facility_id    uuid,
  p_section_id     uuid,
  p_rate_class     text,
  p_portion        text,
  p_effective_from date,
  p_shares         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_facility uuid := p_facility_id;
  v_class    text := nullif(trim(coalesce(p_rate_class, '')), '');
  v_current  ceedo_collections.account_rules;
  v_id       uuid;
  v_total    integer;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may change the account rules'
      using errcode = 'insufficient_privilege';
  end if;
  if p_fee_type_id is null or p_effective_from is null then
    raise exception 'Choose the fee and the date the rule starts';
  end if;
  if p_portion not in ('base', 'surcharge') then
    raise exception 'The portion must be base or surcharge';
  end if;
  if p_section_id is not null then
    select facility_id into v_facility from ceedo_collections.sections where id = p_section_id;
  end if;

  -- One writer at a time: two admins replacing the same key must queue, not both end it.
  perform pg_advisory_xact_lock(hashtext('ceedo_collections.account_rules'));

  if exists (
    select 1 from ceedo_collections.account_rules r
     where r.fee_type_id = p_fee_type_id and r.portion = p_portion
       and r.facility_id is not distinct from v_facility
       and r.section_id is not distinct from p_section_id
       and r.rate_class is not distinct from v_class
       and r.effective_from >= p_effective_from
  ) then
    raise exception 'A rule for this fee already starts on or after %. Rules are never rewritten; choose a later start date',
      to_char(p_effective_from, 'Mon DD, YYYY');
  end if;

  select * into v_current from ceedo_collections.account_rules r
   where r.fee_type_id = p_fee_type_id and r.portion = p_portion
     and r.facility_id is not distinct from v_facility
     and r.section_id is not distinct from p_section_id
     and r.rate_class is not distinct from v_class
     and (r.effective_to is null or r.effective_to >= p_effective_from)
   for update;
  if found then
    update ceedo_collections.account_rules
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  if jsonb_array_length(coalesce(p_shares, '[]'::jsonb)) = 0 then
    if v_current.id is null then
      raise exception 'Add at least one account to the rule';
    end if;
    return null;  -- ended, not replaced
  end if;

  select coalesce(sum((s ->> 'share_bps')::integer), 0) into v_total
    from jsonb_array_elements(p_shares) s;
  if v_total <> 10000 then
    raise exception 'The shares of a rule must add up to 100%% (these add up to %)',
      to_char(v_total / 100.0, 'FM990.00') || '%';
  end if;

  insert into ceedo_collections.account_rules
    (fee_type_id, facility_id, section_id, rate_class, portion, effective_from, created_by)
  values (p_fee_type_id, v_facility, p_section_id, v_class, p_portion, p_effective_from, auth.uid())
  returning id into v_id;

  insert into ceedo_collections.account_rule_shares (rule_id, account_id, share_bps)
  select v_id, (s ->> 'account_id')::uuid, (s ->> 'share_bps')::integer
    from jsonb_array_elements(p_shares) s;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.replace_account_rule(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function ceedo_collections.replace_account_rule(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;
```

Then append to the same migration: `clear_all_data` copied **verbatim** from `20260929000052` (the function from `create or replace function ceedo_collections.clear_all_data()` to its closing `$$;`), with one edit right after the `execute 'truncate ' …` block's `end if;`:

```sql
  -- The chart's built-ins are part of the schema, not test data: receipt_account_lines
  -- cannot place an unclassified portion without them.
  perform ceedo_collections.install_chart_builtins();
```

Also copy its trailing `revoke` and `grant` lines.

- [ ] **Step 5: Apply, regenerate types, and run the test**

Run: `supabase migration up && pnpm db:types && pnpm vitest run tests/db/account-chart.test.ts tests/db/super-admin.test.ts`
Expected: PASS. `super-admin.test.ts` proves that `clear_all_data` still runs.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261008000066_account_chart.sql packages/shared/src/db.types.ts tests/helpers/accounts.ts tests/db/account-chart.test.ts
git commit -m "feat(accounts): account chart, dated rule sets and replace_account_rule"
```

---

### Task 3: Fee catalogue seed (`install_account_catalogue`)

This task's migration is numbered **071**, and it is written last of the database work. The receipt tests in Task 7 must not depend on it, and production will hold it back until the office has reviewed it.

**Do this task after Task 7.** It sits here so the plan reads in data-model order.

**Files:**
- Create: `supabase/migrations/20261008000071_account_catalogue.sql`
- Modify: `supabase/seed.sql` (make its inserts idempotent)
- Test: `tests/db/account-catalogue.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's columns.
  - Task 2's tables, `install_chart_builtins()` and `createRule`/`accountId` helpers.
  - Task 7's `receipt_account_lines`.
- Produces:
  - `install_account_catalogue()`: idempotent, security definer, not granted to anyone.
  - The seeded codes the later phases read: facilities `CPM, IBJT, WP, SLH, COTTA, CEM, GYM, NM, TABO, UNITOP`, plus the treasurer line, RCD column and account codes listed below.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/account-catalogue.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, postCollectionAsOwner, resetCutover, uniqueCode } from "../helpers/supabase";

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const lines = async (collectionId: string) =>
  (await db.query(
    `select a.code, l.amount::text as amount from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31') l
       join ceedo_collections.collection_accounts a on a.id = l.account_id
      where l.collection_id = $1 order by a.code`,
    [collectionId],
  )).rows;

async function feeId(code: string) {
  return (await db.query(`select id from ceedo_collections.fee_types where code = $1`, [code])).rows[0].id as string;
}

describe("install_account_catalogue", () => {
  it("is idempotent", async () => {
    const count = async () =>
      (await db.query(
        `select (select count(*) from ceedo_collections.collection_accounts)::int a,
                (select count(*) from ceedo_collections.account_rules)::int r,
                (select count(*) from ceedo_collections.fee_types)::int f`,
      )).rows[0];
    const before = await count();
    await db.query(`select ceedo_collections.install_account_catalogue()`);
    expect(await count()).toEqual(before);
  });

  it("seeds the monthly summary's lines on both groupings", async () => {
    const { rows } = await db.query(
      `select count(*)::int n from ceedo_collections.collection_accounts where code <> 'UNCLASSIFIED'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(100);
  });

  it("splits ante-mortem 75/25 between the slaughterhouse and NMIS", async () => {
    const fx = await createCollectionFixture(db);
    const ante = await feeId("SLH_ANTE");
    await db.query(
      `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
       values ($1, '', '2026-10-01', 100.01, 'per_head')
       on conflict do nothing`,
      [ante],
    );
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: ante, lines: [{ fee_type_id: ante, quantity: 1 }],
    });
    expect(await lines(id)).toEqual([
      { code: "NI-NMIS", amount: "25.00" },
      { code: "SLH-ANTE", amount: "75.01" },
    ]);
  });

  it("places Public Mall daily rent by section", async () => {
    await resetCutover(db);
    const fx = await createCollectionFixture(db, { accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00" });
    const { rows } = await db.query(
      `select s.id from ceedo_collections.sections s join ceedo_collections.facilities f on f.id = s.facility_id
        where f.code = 'CPM' and s.name = 'Bakery'`,
    );
    const stall = await db.query(
      `insert into ceedo_collections.stalls (section_id, stall_no) values ($1, $2) returning id`,
      [rows[0].id, uniqueCode("B")],
    );
    await db.query(`update ceedo_collections.leases set stall_id = $1 where id = $2`, [stall.rows[0].id, fx.leaseId]);
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount, surcharge_bps, source)
       values ($1, $2, 'rental', '2026-10-01', '2026-10-01', '2026-10-01', 50, 0, 'manual')`,
      [fx.leaseId, fx.feeTypeId],
    );
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect(await lines(id)).toEqual([{ code: "CPM-DR-BAKERY", amount: "50.00" }]);
  });

  it("places a keyed electricity payment on its non-income line", async () => {
    const fx = await createCollectionFixture(db);
    const elec = await feeId("ELEC_CPM");
    const { rows } = await db.query(
      `select ceedo_collections.post_collection($1::jsonb) r`,
      [JSON.stringify({
        id: randomUUID(), or_no: 1970, booklet_id: fx.bookletId, collector_id: fx.collectorId,
        device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: elec,
        lease_id: null, allocations: [], lines: [{ fee_type_id: elec, quantity: 1, amount: "1722.00" }],
      })],
    );
    expect(rows[0].r.status).toBe("accepted");
    expect(await lines(rows[0].r.collection_id)).toEqual([{ code: "NI-ELEC-CPM", amount: "1722.00" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/account-catalogue.test.ts`
Expected: FAIL. The function `install_account_catalogue()` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261008000071_account_catalogue.sql
-- The office's account chart and fee catalogue (spec "Seed migration"), from the 2026
-- Monthly Summary of Collection Report. HELD BACK FROM PRODUCTION until the office has
-- reviewed the list: bundle the earlier migrations with `--through 20261008000070`.
--
-- Idempotent and re-runnable: clear_all_data() calls it again after wiping, so a test-data
-- reset does not leave the system without its chart. Every insert is keyed by a natural key
-- and skips what exists. Existing facilities keep their names (production's CPM is
-- "Central Public Market"; the office calls it City Public Mall -- an open question).
--
-- No rates. Rate-mode fees seeded here have no price until the office enters one on the
-- Rates screen; a tablet only offers a fee that has a rate, so none of these reach a tablet
-- before then.

create or replace function ceedo_collections.install_account_catalogue()
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  perform ceedo_collections.install_chart_builtins();

  -- Facilities ----------------------------------------------------------------------
  insert into facilities (code, name, type) values
    ('CPM',    'City Public Mall',                    'market'),
    ('IBJT',   'Integrated Bus and Jeepney Terminal', 'terminal'),
    ('WP',     'Wellness Park',                       'market'),
    ('SLH',    'Slaughterhouse',                      'slaughterhouse'),
    ('COTTA',  'Cotta (Fortress)',                    'other'),
    ('CEM',    'Public Cemetery',                     'other'),
    ('GYM',    'City Gym',                            'other'),
    ('NM',     'Night Market',                        'other'),
    ('TABO',   'IBJT Tabo',                           'other'),
    ('UNITOP', 'Unitop',                              'other')
  on conflict (code) do nothing;

  -- Sections ------------------------------------------------------------------------
  insert into sections (facility_id, name, default_accrual_period)
  select f.id, v.name, v.period::accrual_period
    from (values
      ('CPM', 'Bakery', 'daily'), ('CPM', 'Dressed Chicken', 'daily'), ('CPM', 'Dried Fish', 'daily'),
      ('CPM', 'Dry Goods', 'daily'), ('CPM', 'Flowers', 'daily'), ('CPM', 'Food Court', 'daily'),
      ('CPM', 'Fresh Fish', 'daily'), ('CPM', 'Fresh Meat', 'daily'), ('CPM', 'Fresh Vegetables', 'daily'),
      ('CPM', 'Fruits', 'daily'), ('CPM', 'Grains', 'daily'), ('CPM', 'Grinder', 'daily'),
      ('CPM', 'Mini-Grocery', 'daily'), ('CPM', 'Native Product', 'daily'),
      ('CPM', 'Parlor/Barber Shop', 'daily'), ('CPM', 'Tobacco', 'daily'), ('CPM', 'Ukay-Ukay', 'daily'),
      ('CPM', 'Rentable Space', 'monthly'), ('CPM', 'Semi-Rentable Space', 'monthly'),
      ('IBJT', 'Building 2', 'daily'), ('IBJT', 'Building 3', 'daily'),
      ('IBJT', 'Kiosk', 'daily'), ('IBJT', 'Rentables', 'daily'),
      ('WP', 'Food Court', 'daily'), ('WP', 'Kiosk', 'daily')
    ) as v(fc, name, period)
    join facilities f on f.code = v.fc
  on conflict (facility_id, name) do nothing;

  -- Fee types -----------------------------------------------------------------------
  -- The ones the seed and production already have, so a fresh database (where this runs
  -- before seed.sql) has them for the rules below. Same values as seed.sql.
  insert into fee_types (code, name, accrues, surcharge_bps, facility_type) values
    ('MKT_DAILY',   'Market stall rental (daily)',   true,  300, 'market'),
    ('MKT_WEEKLY',  'Market stall rental (weekly)',  true,  300, 'market'),
    ('MKT_MONTHLY', 'Market stall rental (monthly)', true,  300, 'market'),
    ('TERMINAL',    'Terminal fee',                  false, 0,   'terminal'),
    ('SLAUGHTER',   'Slaughter fee',                 false, 0,   'slaughterhouse')
  on conflict (code) do nothing;

  update fee_types ft set facility_id = f.id
    from facilities f
   where ft.facility_id is null
     and ((ft.code = 'TERMINAL' and f.code = 'IBJT') or (ft.code = 'SLAUGHTER' and f.code = 'SLH'));

  -- facility_type for a facility-specific fee is copied by fee_types_follow_facility; the
  -- value given here only matters for the facility-less ones (OCCUPANCY, CITATION).
  insert into fee_types (code, name, accrues, facility_id, facility_type, amount_mode)
  select v.code, v.name, false, f.id, v.ftype::facility_type, v.mode
    from (values
      ('OCCUPANCY',      'Occupancy fee',                         null,     'market', 'keyed'),
      ('CITATION',       'Citation ticket',                       null,     'other',  'keyed'),
      ('CPM_CR',         'Public Mall CR (cash ticket)',          'CPM',    null,     'keyed'),
      ('CPM_CERT',       'Public Mall certification',             'CPM',    null,     'keyed'),
      ('CPM_DELIVERY',   'Public Mall delivery fee',              'CPM',    null,     'rate'),
      ('CPM_MISC',       'Public Mall miscellaneous fee',         'CPM',    null,     'keyed'),
      ('CPM_PARKING',    'Public Mall parking fee',               'CPM',    null,     'rate'),
      ('CPM_STORAGE',    'Public Mall storage fee',               'CPM',    null,     'rate'),
      ('IBJT_CR',        'IBJT CR (cash ticket)',                 'IBJT',   null,     'keyed'),
      ('IBJT_CERT',      'IBJT certification',                    'IBJT',   null,     'keyed'),
      ('IBJT_MISC',      'IBJT miscellaneous fee',                'IBJT',   null,     'keyed'),
      ('IBJT_PARKING',   'IBJT parking fee',                      'IBJT',   null,     'rate'),
      ('WP_CR',          'Wellness Park CR (cash ticket)',        'WP',     null,     'keyed'),
      ('WP_CERT',        'Wellness Park certification',           'WP',     null,     'keyed'),
      ('WP_MISC',        'Wellness Park miscellaneous fee',       'WP',     null,     'keyed'),
      ('WP_PLAYGROUND',  'Wellness Park playground entrance',     'WP',     null,     'rate'),
      ('WP_FITNESS',     'Wellness Park fitness ground entrance', 'WP',     null,     'rate'),
      ('COTTA_ENTRANCE', 'Cotta entrance fee',                    'COTTA',  null,     'rate'),
      ('CEM_BURIAL',     'Burial fee (Brgy. Bongbong)',           'CEM',    null,     'rate'),
      ('GYM_RENTAL',     'City Gym rental',                       'GYM',    null,     'keyed'),
      ('NM_FEE',         'Night Market fee',                      'NM',     null,     'rate'),
      ('TABO_FEE',       'IBJT Tabo fee',                         'TABO',   null,     'rate'),
      ('SLH_ANTE',       'Ante-mortem fee',                       'SLH',    null,     'rate'),
      ('SLH_POST',       'Post-mortem fee',                       'SLH',    null,     'rate'),
      ('SLH_CORRAL',     'Corral fee',                            'SLH',    null,     'rate'),
      ('SLH_ENTRAILS',   'Entrails fee',                          'SLH',    null,     'rate'),
      ('SLH_PERMIT',     'Permit to slaughter fee',               'SLH',    null,     'rate'),
      ('SLH_REG',        'Registration fee',                      'SLH',    null,     'rate'),
      ('SLH_AF52',       'Form AF 52 (certificate of transfer)',  'SLH',    null,     'rate'),
      ('SLH_AF53',       'Form AF 53 (certificate of ownership)', 'SLH',    null,     'rate'),
      ('VET_FEE',        'Veterinary fee',                        'SLH',    null,     'rate'),
      ('ELEC_CPM',       'Electricity bill payment (Public Mall)',   'CPM',    null, 'keyed'),
      ('ELEC_IBJT',      'Electricity bill payment (IBJT)',          'IBJT',   null, 'keyed'),
      ('ELEC_WP',        'Electricity bill payment (Wellness Park)', 'WP',     null, 'keyed'),
      ('ELEC_UNITOP',    'Electricity bill payment (Unitop)',        'UNITOP', null, 'keyed'),
      ('ELEC_SUR_CPM',   'Electricity surcharge (Public Mall)',      'CPM',    null, 'keyed'),
      ('ELEC_SUR_IBJT',  'Electricity surcharge (IBJT)',             'IBJT',   null, 'keyed'),
      ('ELEC_SUR_WP',    'Electricity surcharge (Wellness Park)',    'WP',     null, 'keyed'),
      ('ELEC_SUR_UNITOP','Electricity surcharge (Unitop)',           'UNITOP', null, 'keyed')
    ) as v(code, name, fc, ftype, mode)
    left join facilities f on f.code = v.fc
  on conflict (code) do nothing;

  -- Treasurer lines and RCD columns (TL_OTHER / RC_OTHER are the built-ins) ------------
  insert into treasurer_lines (code, name, sort_order, subtotal_group) values
    ('TL_SLH',      'Slaughterhouse fees',                       10, 1),
    ('TL_PM',       'Public Mall stall rentals/misc',            20, 1),
    ('TL_PM_CR',    'Public Mall CR',                            30, 1),
    ('TL_IBJT',     'IBJT stall rentals/parking/misc',           40, 1),
    ('TL_IBJT_CR',  'IBJT CR',                                   50, 1),
    ('TL_COTTA',    'Cotta Fort entrance/misc',                  60, 1),
    ('TL_CEM',      'Public cemetery',                           70, 1),
    ('TL_WP',       'Wellness Park stall rentals/misc',          80, 1),
    ('TL_WP_CR',    'Wellness Park comfort rooms',               90, 1),
    ('TL_WP_PLAY',  'Wellness Park playground',                 100, 1),
    ('TL_NMIS',     'Ante/post-mortem fees',                    200, 2),
    ('TL_ELEC',     'Electricity bill payments',                210, 2),
    ('TL_ELEC_SUR', 'Surcharges on electricity bill payments',  220, 2)
  on conflict (code) do nothing;

  insert into rcd_columns (code, name, sort_order) values
    ('RC_PM',       'Public Mall',                 10),
    ('RC_SUR',      'Surcharges – stall rentals',  20),
    ('RC_SLH',      'Slaughterhouse',              30),
    ('RC_NMIS',     'Ante/post-mortems',           40),
    ('RC_IBJT',     'IBJT',                        50),
    ('RC_WP',       'Wellness Park',               60),
    ('RC_CEM',      'Public cemetery',             70),
    ('RC_COTTA',    'Cotta Fort',                  80),
    ('RC_CIT',      'Citation ticket',             90),
    ('RC_ELEC',     'Electricity bill payments',  100),
    ('RC_ELEC_SUR', 'Surcharges – electricity',   110)
  on conflict (code) do nothing;

  -- Accounts, in the monthly summary's order. Accounts whose Treasurer line or RCD column
  -- the office has not decided (City Gym, occupancy fees, rental surcharges' Treasurer
  -- line, citation's Treasurer line, Night Market, Tabo, veterinary, the adjustment-only
  -- lines) sit on TL_OTHER / RC_OTHER until it does.
  insert into collection_accounts
    (code, name, facility_id, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
  select v.code, v.name, f.id, v.grp, row_number() over (order by v.ord) * 10, v.kind, t.id, r.id
    from (values
      (  1, 'GYM-RENTAL',           'City Gym Rental',                          'GYM',   'City Gym',                     'income', 'TL_OTHER',   'RC_OTHER'),
      (  2, 'CPM-DR-BAKERY',        'Bakery Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  3, 'CPM-DR-DRESSEDCHICKEN','Dressed Chicken Section - Daily Rent',     'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  4, 'CPM-DR-DRIEDFISH',     'Dried Fish Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  5, 'CPM-DR-DRYGOODS',      'Dry Good Section - Daily Rent',            'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  6, 'CPM-DR-FLOWERS',       'Flowers Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  7, 'CPM-DR-FOODCOURT',     'Food Court Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  8, 'CPM-DR-FRESHFISH',     'Fresh Fish Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  9, 'CPM-DR-FRESHMEAT',     'Fresh Meat Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 10, 'CPM-DR-FRESHVEG',      'Fresh Vegetables Section - Daily Rent',    'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 11, 'CPM-DR-FRUITS',        'Fruits Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 12, 'CPM-DR-GRAINS',        'Grains Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 13, 'CPM-DR-GRINDER',       'Grinder Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 14, 'CPM-DR-MINIGROCERY',   'Mini-Grocery Section - Daily Rent',        'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 15, 'CPM-DR-NATIVE',        'Native Product Section - Daily Rent',      'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 16, 'CPM-DR-PARLOR',        'Parlor/Barber Shop - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 17, 'CPM-DR-TOBACCO',       'Tobacco Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 18, 'CPM-DR-UKAY',          'Ukay-Ukay Section - Daily Rent',           'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 19, 'CPM-MR-RENTABLE',      'Rentable Space - Monthly Rent',            'CPM',   'Rentable Space',               'income', 'TL_PM',      'RC_PM'),
      ( 20, 'CPM-MR-SEMI',          'Semi-Rentable Space - Monthly Rent',       'CPM',   'Rentable Space',               'income', 'TL_PM',      'RC_PM'),
      ( 21, 'CPM-OF-BAKERY',        'Bakery Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 22, 'CPM-OF-DRESSEDCHICKEN','Dressed Chicken Section - Occupancy Fee',  'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 23, 'CPM-OF-DRIEDFISH',     'Dried Fish Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 24, 'CPM-OF-DRYGOODS',      'Dry Good Section - Occupancy Fee',         'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 25, 'CPM-OF-FLOWERS',       'Flower Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 26, 'CPM-OF-FOODCOURT',     'Food Court Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 27, 'CPM-OF-FRESHFISH',     'Fresh Fish Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 28, 'CPM-OF-FRESHMEAT',     'Fresh Meat Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 29, 'CPM-OF-FRESHVEG',      'Fresh Vegetables Section - Occupancy Fee', 'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 30, 'CPM-OF-FRUITS',        'Fruits Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 31, 'CPM-OF-GRINDER',       'Grinder Section - Occupancy Fee',          'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 32, 'CPM-OF-MINIGROCERY',   'Mini-Grocery Section - Occupancy Fee',     'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 33, 'CPM-OF-NATIVE',        'Native Product Section - Occupancy Fee',   'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 34, 'CPM-OF-PARLOR',        'Parlor/Barber Shop - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 35, 'CPM-OF-TOBACCO',       'Tobacco Section - Occupancy Fee',          'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 36, 'CPM-OF-UKAY',          'Ukay-Ukay Section - Occupancy Fee',        'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 37, 'CPM-OF-RENTABLES',     'Rentables - Occupancy Fee',                'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 38, 'CPM-CR',               'City Public Mall CR',                      'CPM',   'Other Collections',            'income', 'TL_PM_CR',   'RC_PM'),
      ( 39, 'CPM-CERT',             'City Public Mall Certification',           'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 40, 'CPM-DELIVERY',         'City Public Mall Delivery Fee',            'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 41, 'CPM-MISC',             'City Public Mall Miscellaneous Fee',       'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 42, 'CPM-PARKING',          'City Public Mall Parking Fee',             'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 43, 'CPM-STORAGE',          'City Public Mall Storage Fee',             'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 44, 'CPM-OVERDEP',          'Over Deposit',                             'CPM',   'Other Collections',            'income', 'TL_OTHER',   'RC_OTHER'),
      ( 45, 'COTTA-ENTRANCE',       'Entrance Fee - Cotta (Fortress)',          'COTTA', 'Cotta (Fortress)',             'income', 'TL_COTTA',   'RC_COTTA'),
      ( 46, 'IBJT-DR-B2',           'Building 2 Rentals - IBJT',                'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 47, 'IBJT-DR-B3',           'Building 3 Rentals - IBJT',                'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 48, 'IBJT-DR-KIOSK',        'Kiosk Rentals - IBJT',                     'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 49, 'IBJT-DR-RENTABLES',    'Rentables - IBJT',                         'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 50, 'IBJT-OF-B2',           'IBJT Building 2 - Occupancy Fee',          'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 51, 'IBJT-OF-B3',           'IBJT Building 3 - Occupancy Fee',          'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 52, 'IBJT-OF-RENTABLES',    'IBJT Rentables - Occupancy Fee',           'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 53, 'IBJT-CR',              'IBJT CR',                                  'IBJT',  'Other Collections',            'income', 'TL_IBJT_CR', 'RC_IBJT'),
      ( 54, 'IBJT-CERT',            'IBJT Certification',                       'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 55, 'IBJT-MISC',            'IBJT Miscellaneous Fee',                   'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 56, 'IBJT-PARKING',         'IBJT Parking Fee',                         'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 57, 'IBJT-TF-ASMO',         'Terminal Fee - ASMO',                      'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 58, 'IBJT-TF-LOTRADISCO',   'Terminal Fee - LOTRADISCO',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 59, 'IBJT-TF-OZORDITRANSCO','Terminal Fee - OZORDITRANSCO',             'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 60, 'IBJT-TF-RTMI',         'Terminal Fee - RTMI',                      'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 61, 'IBJT-TF-STAMARIA',     'Terminal Fee - STA. MARIA',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 62, 'IBJT-TF-SUPERFIVE',    'Terminal Fee - Super Five',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 63, 'IBJT-TF-TANGUB',       'Terminal Fee - Tangub Express',            'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 64, 'IBJT-TF-TUDELA',       'Terminal Fee - Tudela Liner',              'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 65, 'CEM-BURIAL',           'Burial Fee - Brgy. Bongbong Cemetery',     'CEM',   'Public Cemetery',              'income', 'TL_CEM',     'RC_CEM'),
      ( 66, 'SLH-ANTE',             'Ante Mortem',                              'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 67, 'SLH-CORRAL',           'Corral Fee',                               'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 68, 'SLH-ENTRAILS',         'Entrails Fee',                             'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 69, 'SLH-AF52',             'Form AF 52 - Certificate of Transfer',     'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 70, 'SLH-AF53',             'Form AF 53 - Certificate of Ownership',    'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 71, 'SLH-PERMIT',           'Permit to Slaughter Fee',                  'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 72, 'SLH-POST',             'Post-Mortem',                              'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 73, 'SLH-REG',              'Registration Fee',                         'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 74, 'SLH-SLAUGHTER',        'Slaughter Fee',                            'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 75, 'SUR-RENT-IBJT',        'IBJT Rental Surcharge',                    null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 76, 'SUR-RENT-CPM',         'Public Mall Rental Surcharge',             null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 77, 'SUR-RENT-WP',          'Wellness Park Rental Surcharge',           null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 78, 'SUR-ELEC-IBJT',        'IBJT Electricity Surcharge',               null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 79, 'SUR-ELEC-CPM',         'Public Mall Electricity Surcharge',        null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 80, 'SUR-ELEC-WP',          'Wellness Park Electricity Surcharge',      null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 81, 'SUR-ELEC-UNITOP',      'Unitop Electricity Surcharge',             null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 82, 'WP-DR-FOODCOURT',      'Food Court Daily Rent - WP',               'WP',    'Daily Rent',                   'income', 'TL_WP',      'RC_WP'),
      ( 83, 'WP-DR-KIOSK',          'Kiosk Daily Rent - WP',                    'WP',    'Daily Rent',                   'income', 'TL_WP',      'RC_WP'),
      ( 84, 'WP-OF-FOODCOURT',      'Food Court Occupancy Fee - WP',            'WP',    'Occupancy Fee',                'income', 'TL_OTHER',   'RC_OTHER'),
      ( 85, 'WP-OF-KIOSK',          'Kiosk Occupancy Fee - WP',                 'WP',    'Occupancy Fee',                'income', 'TL_OTHER',   'RC_OTHER'),
      ( 86, 'WP-CR',                'Wellness Park CR',                         'WP',    'Other Collections',            'income', 'TL_WP_CR',   'RC_WP'),
      ( 87, 'WP-CERT',              'Wellness Park Certification',              'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 88, 'WP-FITNESS',           'Entrance fee Adult''s Fitness Ground',     'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 89, 'WP-PLAYGROUND',        'Entrance Fee Children''s Playground',      'WP',    'Other Collections',            'income', 'TL_WP_PLAY', 'RC_WP'),
      ( 90, 'WP-MISC',              'Wellness Park Miscellaneous Fee',          'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 91, 'NM-FEE',               'Night Market',                             'NM',    'Night Market',                 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 92, 'TABO-FEE',             'IBJT Tabo',                                'TABO',  'IBJT Tabo',                    'income', 'TL_OTHER',   'RC_OTHER'),
      ( 93, 'NI-NMIS',              'Ante Mortem/Post-Mortem NMIS',             null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_NMIS',  'RC_NMIS'),
      ( 94, 'NI-CITATION',          'Citation Ticket',                          null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_CIT'),
      ( 95, 'NI-ELEC-IBJT',         'IBJT Electricity',                         null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 96, 'NI-ELEC-CPM',          'Public Mall Electricity',                  null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 97, 'NI-ELEC-WP',           'Wellness Park Electricity',                null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 98, 'NI-ELEC-UNITOP',       'Unitop Electricity',                       null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 99, 'NI-PRIORADJ',          'Prior Period Cash Remittance Adjustments', null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (100, 'NI-VET',               'Veterinary Fee',                           null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (101, 'NI-LEAVE',             'Payment for Disapproved Leave',            null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (102, 'NI-WTAX',              'Withholding Tax - Cash Advance',           null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER')
    ) as v(ord, code, name, fc, grp, kind, tl, rc)
    left join facilities f on f.code = v.fc
    join treasurer_lines t on t.code = v.tl
    join rcd_columns r on r.code = v.rc
  on conflict (code) do nothing;

  -- Rules ---------------------------------------------------------------------------
  -- (fee code, facility code, section name, rate class, portion, account code, share_bps).
  -- One temp table per call; a rule set is a distinct (fee, facility, section, class,
  -- portion), its shares the rows that share that key.
  create temporary table if not exists _seed_rule (
    fee text, fc text, sec text, rc text, portion text, acct text, bps integer
  ) on commit drop;
  truncate _seed_rule;

  -- Rent, by section, for each rental fee type.
  insert into _seed_rule
  select fee, v.fc, v.sec, null, 'base', v.acct, 10000
    from (values
      ('CPM', 'Bakery', 'CPM-DR-BAKERY'), ('CPM', 'Dressed Chicken', 'CPM-DR-DRESSEDCHICKEN'),
      ('CPM', 'Dried Fish', 'CPM-DR-DRIEDFISH'), ('CPM', 'Dry Goods', 'CPM-DR-DRYGOODS'),
      ('CPM', 'Flowers', 'CPM-DR-FLOWERS'), ('CPM', 'Food Court', 'CPM-DR-FOODCOURT'),
      ('CPM', 'Fresh Fish', 'CPM-DR-FRESHFISH'), ('CPM', 'Fresh Meat', 'CPM-DR-FRESHMEAT'),
      ('CPM', 'Fresh Vegetables', 'CPM-DR-FRESHVEG'), ('CPM', 'Fruits', 'CPM-DR-FRUITS'),
      ('CPM', 'Grains', 'CPM-DR-GRAINS'), ('CPM', 'Grinder', 'CPM-DR-GRINDER'),
      ('CPM', 'Mini-Grocery', 'CPM-DR-MINIGROCERY'), ('CPM', 'Native Product', 'CPM-DR-NATIVE'),
      ('CPM', 'Parlor/Barber Shop', 'CPM-DR-PARLOR'), ('CPM', 'Tobacco', 'CPM-DR-TOBACCO'),
      ('CPM', 'Ukay-Ukay', 'CPM-DR-UKAY'),
      ('CPM', 'Rentable Space', 'CPM-MR-RENTABLE'), ('CPM', 'Semi-Rentable Space', 'CPM-MR-SEMI'),
      ('IBJT', 'Building 2', 'IBJT-DR-B2'), ('IBJT', 'Building 3', 'IBJT-DR-B3'),
      ('IBJT', 'Kiosk', 'IBJT-DR-KIOSK'), ('IBJT', 'Rentables', 'IBJT-DR-RENTABLES'),
      ('WP', 'Food Court', 'WP-DR-FOODCOURT'), ('WP', 'Kiosk', 'WP-DR-KIOSK')
    ) as v(fc, sec, acct)
    cross join (values ('MKT_DAILY'), ('MKT_WEEKLY'), ('MKT_MONTHLY')) as r(fee);

  -- Rental surcharge portion, per facility.
  insert into _seed_rule
  select fee, v.fc, null, null, 'surcharge', v.acct, 10000
    from (values ('CPM', 'SUR-RENT-CPM'), ('IBJT', 'SUR-RENT-IBJT'), ('WP', 'SUR-RENT-WP')) as v(fc, acct)
    cross join (values ('MKT_DAILY'), ('MKT_WEEKLY'), ('MKT_MONTHLY')) as r(fee);

  -- Occupancy fee, by the paying lease's section.
  insert into _seed_rule
  select 'OCCUPANCY', v.fc, v.sec, null, 'base', v.acct, 10000
    from (values
      ('CPM', 'Bakery', 'CPM-OF-BAKERY'), ('CPM', 'Dressed Chicken', 'CPM-OF-DRESSEDCHICKEN'),
      ('CPM', 'Dried Fish', 'CPM-OF-DRIEDFISH'), ('CPM', 'Dry Goods', 'CPM-OF-DRYGOODS'),
      ('CPM', 'Flowers', 'CPM-OF-FLOWERS'), ('CPM', 'Food Court', 'CPM-OF-FOODCOURT'),
      ('CPM', 'Fresh Fish', 'CPM-OF-FRESHFISH'), ('CPM', 'Fresh Meat', 'CPM-OF-FRESHMEAT'),
      ('CPM', 'Fresh Vegetables', 'CPM-OF-FRESHVEG'), ('CPM', 'Fruits', 'CPM-OF-FRUITS'),
      ('CPM', 'Grinder', 'CPM-OF-GRINDER'), ('CPM', 'Mini-Grocery', 'CPM-OF-MINIGROCERY'),
      ('CPM', 'Native Product', 'CPM-OF-NATIVE'), ('CPM', 'Parlor/Barber Shop', 'CPM-OF-PARLOR'),
      ('CPM', 'Tobacco', 'CPM-OF-TOBACCO'), ('CPM', 'Ukay-Ukay', 'CPM-OF-UKAY'),
      ('CPM', 'Rentable Space', 'CPM-OF-RENTABLES'), ('CPM', 'Semi-Rentable Space', 'CPM-OF-RENTABLES'),
      ('IBJT', 'Building 2', 'IBJT-OF-B2'), ('IBJT', 'Building 3', 'IBJT-OF-B3'),
      ('IBJT', 'Rentables', 'IBJT-OF-RENTABLES'),
      ('WP', 'Food Court', 'WP-OF-FOODCOURT'), ('WP', 'Kiosk', 'WP-OF-KIOSK')
    ) as v(fc, sec, acct);

  -- Terminal fee, by bus company (the rate class).
  insert into _seed_rule
  select 'TERMINAL', null, null, v.rc, 'base', v.acct, 10000
    from (values
      ('ASMO', 'IBJT-TF-ASMO'), ('LOTRADISCO', 'IBJT-TF-LOTRADISCO'),
      ('OZORDITRANSCO', 'IBJT-TF-OZORDITRANSCO'), ('RTMI', 'IBJT-TF-RTMI'),
      ('STA. MARIA', 'IBJT-TF-STAMARIA'), ('Super Five', 'IBJT-TF-SUPERFIVE'),
      ('Tangub Express', 'IBJT-TF-TANGUB'), ('Tudela Liner', 'IBJT-TF-TUDELA')
    ) as v(rc, acct);

  -- One fee type, one account.
  insert into _seed_rule
  select v.fee, null, null, null, 'base', v.acct, 10000
    from (values
      ('CPM_CR', 'CPM-CR'), ('CPM_CERT', 'CPM-CERT'), ('CPM_DELIVERY', 'CPM-DELIVERY'),
      ('CPM_MISC', 'CPM-MISC'), ('CPM_PARKING', 'CPM-PARKING'), ('CPM_STORAGE', 'CPM-STORAGE'),
      ('IBJT_CR', 'IBJT-CR'), ('IBJT_CERT', 'IBJT-CERT'), ('IBJT_MISC', 'IBJT-MISC'),
      ('IBJT_PARKING', 'IBJT-PARKING'),
      ('WP_CR', 'WP-CR'), ('WP_CERT', 'WP-CERT'), ('WP_MISC', 'WP-MISC'),
      ('WP_PLAYGROUND', 'WP-PLAYGROUND'), ('WP_FITNESS', 'WP-FITNESS'),
      ('COTTA_ENTRANCE', 'COTTA-ENTRANCE'), ('CEM_BURIAL', 'CEM-BURIAL'), ('GYM_RENTAL', 'GYM-RENTAL'),
      ('NM_FEE', 'NM-FEE'), ('TABO_FEE', 'TABO-FEE'),
      ('SLAUGHTER', 'SLH-SLAUGHTER'), ('SLH_CORRAL', 'SLH-CORRAL'), ('SLH_ENTRAILS', 'SLH-ENTRAILS'),
      ('SLH_PERMIT', 'SLH-PERMIT'), ('SLH_REG', 'SLH-REG'), ('SLH_AF52', 'SLH-AF52'),
      ('SLH_AF53', 'SLH-AF53'), ('VET_FEE', 'NI-VET'), ('CITATION', 'NI-CITATION'),
      ('ELEC_CPM', 'NI-ELEC-CPM'), ('ELEC_IBJT', 'NI-ELEC-IBJT'),
      ('ELEC_WP', 'NI-ELEC-WP'), ('ELEC_UNITOP', 'NI-ELEC-UNITOP'),
      ('ELEC_SUR_CPM', 'SUR-ELEC-CPM'), ('ELEC_SUR_IBJT', 'SUR-ELEC-IBJT'),
      ('ELEC_SUR_WP', 'SUR-ELEC-WP'), ('ELEC_SUR_UNITOP', 'SUR-ELEC-UNITOP')
    ) as v(fee, acct);

  -- Ante- and post-mortem: 75% city income, 25% NMIS (spec decision; open question on the
  -- effective date).
  insert into _seed_rule values
    ('SLH_ANTE', null, null, null, 'base', 'SLH-ANTE', 7500),
    ('SLH_ANTE', null, null, null, 'base', 'NI-NMIS',  2500),
    ('SLH_POST', null, null, null, 'base', 'SLH-POST', 7500),
    ('SLH_POST', null, null, null, 'base', 'NI-NMIS',  2500);

  -- Resolve codes to ids. A key whose facility or section is missing is skipped, never
  -- widened into a broader rule.
  create temporary table if not exists _seed_rule_ids (
    fee_type_id uuid, facility_id uuid, section_id uuid, rate_class text, portion text,
    account_id uuid, bps integer
  ) on commit drop;
  truncate _seed_rule_ids;

  insert into _seed_rule_ids
  select ft.id, f.id, s.id, r.rc, r.portion, a.id, r.bps
    from _seed_rule r
    join fee_types ft on ft.code = r.fee
    join collection_accounts a on a.code = r.acct
    left join facilities f on f.code = r.fc
    left join sections s on s.facility_id = f.id and s.name = r.sec
   where (r.fc is null or f.id is not null)
     and (r.sec is null or s.id is not null);

  insert into account_rules (fee_type_id, facility_id, section_id, rate_class, portion, effective_from)
  select distinct k.fee_type_id, k.facility_id, k.section_id, k.rate_class, k.portion, date '2026-10-01'
    from _seed_rule_ids k
   where not exists (
     select 1 from account_rules x
      where x.fee_type_id = k.fee_type_id and x.portion = k.portion
        and x.facility_id is not distinct from k.facility_id
        and x.section_id is not distinct from k.section_id
        and x.rate_class is not distinct from k.rate_class);

  insert into account_rule_shares (rule_id, account_id, share_bps)
  select x.id, k.account_id, k.bps
    from _seed_rule_ids k
    join account_rules x
      on x.fee_type_id = k.fee_type_id and x.portion = k.portion
     and x.facility_id is not distinct from k.facility_id
     and x.section_id is not distinct from k.section_id
     and x.rate_class is not distinct from k.rate_class
     and x.effective_from = date '2026-10-01'
   where not exists (select 1 from account_rule_shares s where s.rule_id = x.id);
end;
$$;

revoke execute on function ceedo_collections.install_account_catalogue() from public;
select ceedo_collections.install_account_catalogue();
```

Then append `clear_all_data` copied **verbatim** from Task 2's migration (066), changing only the one `perform` line to:

```sql
  -- The chart and catalogue are configuration, not test data.
  perform ceedo_collections.install_account_catalogue();
```

Keep its revoke and grant lines.

- [ ] **Step 4: Make `seed.sql` idempotent**

`supabase db reset` runs migrations first and `seed.sql` second, so 071 already created `CPM`, `IBJT`, `SLH` and the `MKT_*`, `TERMINAL` and `SLAUGHTER` fee types. In `supabase/seed.sql`:
- Add `on conflict (code) do nothing` to the facilities insert and the fee_types insert.
- Add `on conflict (facility_id, name) do nothing` to both sections inserts.
- Narrow the stalls insert so it does not number the 19 catalogue sections. Its `where` becomes:

```sql
where s.facility_id = (select id from ceedo_collections.facilities where code = 'CPM')
  and s.name in ('Fish', 'Meat', 'Vegetable', 'Dry Goods')
on conflict (section_id, stall_no) do nothing;
```

- [ ] **Step 5: Reset, regenerate types, and run the full DB suite**

Run: `supabase db reset && pnpm db:types && set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db`
Expected: PASS, including `account-catalogue.test.ts` and `super-admin.test.ts`.

If a pre-existing test counted facilities or fee types, fix that test to count only its own rows. Do not change the catalogue.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261008000071_account_catalogue.sql supabase/seed.sql packages/shared/src/db.types.ts tests/db/account-catalogue.test.ts
git commit -m "feat(accounts): office account chart and fee catalogue seed"
```

---

### Task 4: Keyed lines and payment mode in `post_collection`; the device check guard

**Files:**
- Create: `supabase/migrations/20261008000067_keyed_lines_payment_mode.sql`
- Test: `tests/db/keyed-lines-payment-mode.test.ts`

**Interfaces:**
- Consumes: Task 1's `fee_types.amount_mode` and the `collections` payment columns.
- Produces:
  - `post_collection` accepts a line `amount` on a keyed fee type. It must be quantity 1 and an amount above 0; anything else returns `{status:'rejected', reason:'amount_mismatch'}`.
  - It writes `payment_mode`, `check_no`, `bank` and `check_date` from the payload.
  - `sync_push` rejects a non-cash receipt with `server_error` and a detail, and strips check fields from what it posts.
  - `recovery_refusal` handles `amount_mismatch`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/keyed-lines-payment-mode.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, createSyncFixture, uniqueCode, type CollectionFixture } from "../helpers/supabase";

let db: Client;
let orNo = 1100;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => db.end());

async function keyedFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode) values ($1, $1, 'market', 'keyed') returning id`,
    [uniqueCode("KEY")],
  );
  return rows[0].id as string;
}

async function post(fx: CollectionFixture, fee: string, line: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { rows } = await db.query(`select ceedo_collections.post_collection($1::jsonb) r`, [
    JSON.stringify({
      id: randomUUID(), or_no: ++orNo, booklet_id: fx.bookletId, collector_id: fx.collectorId,
      device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: fee,
      lease_id: null, allocations: [], lines: [{ fee_type_id: fee, ...line }], ...extra,
    }),
  ]);
  return rows[0].r as { status: string; reason?: string; collection_id?: string; gross_amount?: string };
}

describe("keyed lines", () => {
  it("takes the typed amount as one line of quantity 1", async () => {
    const fx = await createCollectionFixture(db);
    const fee = await keyedFee();
    const r = await post(fx, fee, { quantity: 1, amount: "1722.50" });
    expect(r.status).toBe("accepted");
    const { rows } = await db.query(
      `select quantity, unit_rate::text, amount::text from ceedo_collections.collection_lines where collection_id = $1`,
      [r.collection_id],
    );
    expect(rows).toEqual([{ quantity: 1, unit_rate: "1722.50", amount: "1722.50" }]);
  });

  it.each([
    [{ quantity: 1, amount: "0" }],
    [{ quantity: 1, amount: "-5" }],
    [{ quantity: 1 }],
    [{ quantity: 2, amount: "10" }],
  ])("refuses %j with amount_mismatch", async (line) => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, await keyedFee(), line);
    expect(r).toMatchObject({ status: "rejected", reason: "amount_mismatch" });
  });

  it("ignores a typed amount on a rate fee: the rate table decides", async () => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, fx.perHeadFeeTypeId, { quantity: 2, amount: "99999" });
    expect(r.status).toBe("accepted");
    expect(Number(r.gross_amount)).toBe(2 * Number(fx.perHeadRate));
  });

  it("records an occupancy fee on a lease with no allocations", async () => {
    const fx = await createCollectionFixture(db);
    const fee = await keyedFee();
    const r = await post(fx, fee, { quantity: 1, amount: "200" }, { lease_id: fx.leaseId });
    expect(r.status).toBe("accepted");
    const { rows } = await db.query(`select lease_id from ceedo_collections.collections where id = $1`, [r.collection_id]);
    expect(rows[0].lease_id).toBe(fx.leaseId);
  });
});

describe("payment mode", () => {
  it("defaults to cash", async () => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, fx.perHeadFeeTypeId, { quantity: 1 });
    const { rows } = await db.query(`select payment_mode from ceedo_collections.collections where id = $1`, [r.collection_id]);
    expect(rows[0].payment_mode).toBe("cash");
  });
});

describe("sync_push", () => {
  it("rejects a tablet receipt that claims a check, and posts its neighbour", async () => {
    const sx = await createSyncFixture(db);
    const entry = (extra: Record<string, unknown>) => ({
      type: "collection",
      payload: {
        id: randomUUID(), or_no: ++orNo, booklet_id: sx.bookletId, collector_id: sx.collectorId,
        collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: sx.perHeadFeeTypeId, lease_id: null,
        allocations: [], lines: [{ fee_type_id: sx.perHeadFeeTypeId, quantity: 1 }], ...extra,
      },
    });
    const { rows } = await db.query(`select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`, [
      sx.deviceId,
      JSON.stringify([entry({ payment_mode: "check", check_no: "1", bank: "LBP", check_date: "2026-10-05" }), entry({})]),
    ]);
    const results = rows[0].result as { status: string; reason?: string; detail?: string }[];
    expect(results[0]).toMatchObject({ status: "rejected", reason: "server_error" });
    expect(results[0].detail).toMatch(/office only/);
    expect(results[1].status).toBe("accepted");
  });
});
```

Before writing this, open `tests/helpers/supabase.ts:723` (`createSyncFixture`) and confirm its return fields. If it does not return `bookletId`, `collectorId`, `deviceId` and `perHeadFeeTypeId`, build the entry from the fields it does return. Its device is cleared for its collector.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/keyed-lines-payment-mode.test.ts`
Expected: FAIL. The keyed line is rejected `rate_not_found`, and the check entry is accepted by the tablet path or fails on the constraint.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261008000067_keyed_lines_payment_mode.sql`. Start with this header:

```sql
-- Collection reports phase 3: keyed amounts and payment mode reach the ledger.
--
-- post_collection: migration 0043's body verbatim but for (a) keyed lines take their amount
-- from the payload instead of the rate table, and (b) the INSERT writes payment_mode and the
-- check fields. No new reason code (tablets parse a strict enum): a bad keyed amount is
-- `amount_mismatch`, already in the vocabulary.
--
-- sync_push: migration 0059's body verbatim but for one branch refusing a non-cash receipt.
-- Field collectors take cash; the database refuses a check with a tablet anyway
-- (collections_check_only_from_office), and this turns that into a sentence.
```

Then copy `post_collection` verbatim from `20260919000043` (from `create or replace function ceedo_collections.post_collection` through its closing `$$;` and the two `revoke` lines). Apply these edits.

(a) Add to the `declare` block:

```sql
  v_mode         text;
  v_unit         numeric(14,2);
```

(b) Replace the whole lines loop, from `for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines'` through its `end loop;`, with:

```sql
  -- Lines. A rate fee: the quantity from the caller, the unit rate from the rate table as of
  -- the collection date -- a modified client can claim twelve hogs, not a price. A keyed fee
  -- (electricity, certification, occupancy...): one line of quantity 1 at the typed amount.
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    select amount_mode into v_mode
      from ceedo_collections.fee_types where id = (v_line ->> 'fee_type_id')::uuid;

    if v_mode = 'keyed' then
      if coalesce((v_line ->> 'quantity')::integer, 0) <> 1
         or coalesce(nullif(v_line ->> 'amount', '')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'rejected', 'reason', 'amount_mismatch',
          'detail', 'A keyed fee is one line of quantity 1 with an amount above zero');
      end if;
      v_unit := round((v_line ->> 'amount')::numeric, 2);
    else
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
      v_unit := v_rate.amount;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'fee_type_id', v_line ->> 'fee_type_id',
      'rate_class', coalesce(v_line ->> 'rate_class', ''),
      'quantity', (v_line ->> 'quantity')::integer,
      'unit_rate', v_unit));

    v_gross := v_gross + ((v_line ->> 'quantity')::integer * v_unit);
  end loop;
```

(c) Replace the `insert into ceedo_collections.collections (...) values (...)` with:

```sql
    insert into ceedo_collections.collections (
      id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
      fee_type_id, lease_id, payer_ref, notes, shift_id, gross_amount, synced_at, posted_by,
      payment_mode, check_no, bank, check_date
    )
    values (
      v_id, v_or_no, v_booklet_id, v_collector_id, v_device_id, v_collected_at, v_business,
      v_fee_type_id, v_lease_id, p_payload ->> 'payer_ref', p_payload ->> 'notes',
      v_shift_id, v_gross, now(), auth.uid(),
      coalesce(nullif(p_payload ->> 'payment_mode', ''), 'cash'),
      nullif(trim(p_payload ->> 'check_no'), ''),
      nullif(trim(p_payload ->> 'bank'), ''),
      nullif(p_payload ->> 'check_date', '')::date
    );
```

Next, copy `sync_push` verbatim from `20260929000059`, with its revoke and grant lines. Insert this branch **before** `elsif v_type = 'collection' then`:

```sql
      elsif v_type = 'collection'
            and coalesce(nullif(v_payload ->> 'payment_mode', ''), 'cash') <> 'cash' then
        -- Still `server_error` (no new codes; see 0059). A tablet has no check field, so this
        -- is a modified or broken client; the paper receipt still needs a supervisor.
        v_one := jsonb_build_object('status', 'rejected', 'reason', 'server_error',
          'detail', 'Checks are accepted at the office only; a tablet receipt must be cash.');
```

Then change the post in the plain `collection` branch to strip check fields:

```sql
        v_one := ceedo_collections.post_collection(
                   (v_payload - 'check_no' - 'bank' - 'check_date')
                   || jsonb_build_object('device_id', p_device_id, 'payment_mode', 'cash'));
```

Last, copy `recovery_refusal` verbatim from `20260930000060`. Add this before its `else`:

```sql
    when 'amount_mismatch'       then 'Enter an amount above zero for that fee'
```

- [ ] **Step 4: Apply, regenerate types, and run the tests**

Run: `supabase migration up && pnpm db:types && pnpm vitest run tests/db/keyed-lines-payment-mode.test.ts tests/db/post-collection.test.ts tests/db/sync-push.test.ts tests/db/recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008000067_keyed_lines_payment_mode.sql packages/shared/src/db.types.ts tests/db/keyed-lines-payment-mode.test.ts
git commit -m "feat(ledger): keyed fee amounts and payment mode on receipts"
```

---

### Task 5: Office shifts and office receipts

**Files:**
- Create: `supabase/migrations/20261008000068_office_receipts.sql`
- Test: `tests/db/office-receipts.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's `shifts.kind` and nullable `device_id`.
  - Task 4's `post_collection` payment fields and `recovery_refusal`.
- Produces:
  - `office_shift(p_collector_id uuid, p_business_date date) returns uuid`.
  - `post_office_receipt(p_shift_id uuid, p_receipt jsonb) returns uuid`. `p_receipt` holds `booklet_id, or_no, collected_at, fee_type_id, lease_id, payer_ref, notes, allocations[{group_rank}], lines[{fee_type_id, rate_class, quantity, amount}], payment_mode, check_no, bank, check_date`.
  - `close_office_shift(p_shift_id uuid, p_declared_total numeric) returns jsonb`, shaped `{status, system_count, system_total, variance}`.
  - Task 6 re-defines `close_office_shift` so it counts cash tickets.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/office-receipts.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, createCollectionFixture, resetCutover, type CollectionFixture, type TestClient } from "../helpers/supabase";

let db: Client;
let supervisor: TestClient;
let accounting: TestClient;
const DAY = "2026-10-05";
let orNo = 1200;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: supervisor } = await createAppUser({ email: "office-supervisor", role: "supervisor" }));
  ({ client: accounting } = await createAppUser({ email: "office-accounting", role: "accounting" }));
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const shiftFor = async (client: TestClient, fx: CollectionFixture) =>
  client.rpc("office_shift", { p_collector_id: fx.collectorId, p_business_date: DAY });

function cashLine(fx: CollectionFixture, extra: Record<string, unknown> = {}) {
  return {
    booklet_id: fx.bookletId, or_no: ++orNo, collected_at: `${DAY}T12:00:00+08:00`,
    fee_type_id: fx.perHeadFeeTypeId, lease_id: null, payer_ref: "Walk-in",
    allocations: [], lines: [{ fee_type_id: fx.perHeadFeeTypeId, quantity: 2 }], ...extra,
  };
}

describe("office_shift", () => {
  it("refuses accounting; opens one office shift per officer and day for a supervisor", async () => {
    const fx = await createCollectionFixture(db);
    expect((await shiftFor(accounting, fx)).error?.message).toMatch(/supervisor or administrator/);
    const a = await shiftFor(supervisor, fx);
    const b = await shiftFor(supervisor, fx);
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    const { rows } = await db.query(`select kind, device_id, status from ceedo_collections.shifts where id = $1`, [a.data]);
    expect(rows[0]).toEqual({ kind: "office", device_id: null, status: "open" });
  });
});

describe("post_office_receipt", () => {
  it("posts a cash receipt with no tablet into the office shift", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const { data, error } = await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select device_id, shift_id, payment_mode, collector_id from ceedo_collections.collections where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({ device_id: null, shift_id: shiftId, payment_mode: "cash", collector_id: fx.collectorId });
  });

  it("posts a check with its details, and refuses one without them", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const bad = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { payment_mode: "check", bank: "LBP" }),
    });
    expect(bad.error?.message).toMatch(/check number, bank and check date/);
    const good = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId,
      p_receipt: cashLine(fx, { payment_mode: "check", check_no: "000123", bank: "LBP", check_date: DAY }),
    });
    expect(good.error).toBeNull();
  });

  it("refuses a device shift, a closed office shift, and a receipt dated another day", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const wrongDay = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { collected_at: "2026-10-06T12:00:00+08:00" }),
    });
    expect(wrongDay.error?.message).toMatch(/must be dated/);
    await supervisor.rpc("close_office_shift", { p_shift_id: shiftId, p_declared_total: 0 });
    const closed = await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    expect(closed.error?.message).toMatch(/not open/);
  });

  it("turns post_collection's refusals into sentences", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const { error } = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { or_no: 5 }),
    });
    expect(error?.message).toMatch(/outside the booklet/);
  });
});

describe("close_office_shift", () => {
  it("closes with the server's totals and a signed variance", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    const gross = 2 * Number(fx.perHeadRate);
    const { data, error } = await supervisor.rpc("close_office_shift", { p_shift_id: shiftId, p_declared_total: gross - 1 });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "closed", system_count: 1 });
    expect(Number((data as { variance: number }).variance)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/office-receipts.test.ts`
Expected: FAIL. The function `office_shift` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261008000068_office_receipts.sql
-- Office receipts (spec "Screens: /ledger/office-receipt"). The office issues ORs at the
-- counter -- including checks, which field collectors never take. The officer holding the
-- booklet is a collector-role person with no web login, so a supervisor or admin posts on
-- their behalf, into an OFFICE SHIFT in the officer's name: kind 'office', no tablet.
-- The shift closes and is deposited like any other, so remittances need no change.
--
-- Every receipt goes through post_collection: booklet, serial, oldest-months-first, rates
-- and keyed amounts are the tablet's own rules, not a copy of them.

create or replace function ceedo_collections.assert_office_poster()
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may post office receipts'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function ceedo_collections.assert_office_poster() from public;

create or replace function ceedo_collections.office_shift(
  p_collector_id  uuid,
  p_business_date date
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id      uuid;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_office_poster();
  if p_business_date is null or p_business_date > ceedo_collections.business_date() then
    raise exception 'Choose a business date that is not in the future';
  end if;
  if not exists (select 1 from ceedo_collections.app_users
                  where id = p_collector_id and role = 'collector' and status = 'active') then
    raise exception 'That person is not an active collector';
  end if;

  select id into v_id from ceedo_collections.shifts
   where collector_id = p_collector_id and business_date = p_business_date
     and kind = 'office' and status = 'open';
  if found then
    return v_id;
  end if;

  v_id := gen_random_uuid();
  insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
  values (v_id, p_collector_id, null, p_business_date, now(), 'open', 'office');

  insert into ceedo_collections.audit_log (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'office_shift', 'shifts', v_id, null,
          jsonb_build_object('collector_id', p_collector_id, 'business_date', p_business_date));
  return v_id;
exception
  -- Two supervisors opening the same officer's day at once: the loser takes the winner's.
  when unique_violation then
    select id into v_id from ceedo_collections.shifts
     where collector_id = p_collector_id and business_date = p_business_date
       and kind = 'office' and status = 'open';
    return v_id;
end;
$$;

create or replace function ceedo_collections.post_office_receipt(
  p_shift_id uuid,
  p_receipt  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift   ceedo_collections.shifts;
  v_mode    text := coalesce(nullif(p_receipt ->> 'payment_mode', ''), 'cash');
  v_payload jsonb := p_receipt;
  v_result  jsonb;
  v_id      uuid := gen_random_uuid();
begin
  perform ceedo_collections.assert_office_poster();

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found or v_shift.kind <> 'office' then
    raise exception 'No such office shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That office shift is not open (it is %); open the day again to add receipts', v_shift.status;
  end if;
  if ((p_receipt ->> 'collected_at')::timestamptz at time zone 'Asia/Manila')::date
     is distinct from v_shift.business_date then
    raise exception 'The receipt must be dated %, the shift''s day',
      to_char(v_shift.business_date, 'Mon DD, YYYY');
  end if;

  if v_mode not in ('cash', 'check') then
    raise exception 'Payment must be cash or check';
  end if;
  if v_mode = 'check' then
    if coalesce(trim(p_receipt ->> 'check_no'), '') = '' or coalesce(trim(p_receipt ->> 'bank'), '') = ''
       or coalesce(p_receipt ->> 'check_date', '') = '' then
      raise exception 'A check needs its check number, bank and check date';
    end if;
  else
    v_payload := v_payload - 'check_no' - 'bank' - 'check_date';
  end if;

  -- Identity, collector, tablet (none) and shift are facts of the office shift, applied
  -- after the caller's input so none of them can be overridden.
  v_result := ceedo_collections.post_collection(
    v_payload || jsonb_build_object('id', v_id, 'collector_id', v_shift.collector_id,
                                    'device_id', null, 'shift_id', v_shift.id,
                                    'payment_mode', v_mode));
  if v_result ->> 'status' <> 'accepted' then
    raise exception '%', ceedo_collections.recovery_refusal(v_result);
  end if;
  return v_id;
end;
$$;

create or replace function ceedo_collections.close_office_shift(
  p_shift_id       uuid,
  p_declared_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts;
  v_system_count integer;
  v_system_total numeric(14,2);
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_office_poster();
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash and checks handed over for this day';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found or v_shift.kind <> 'office' then
    raise exception 'No such office shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That office shift is not open (it is %)', v_shift.status;
  end if;

  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (select 1 from ceedo_collections.standing_cancellations cc
                      where cc.collection_id = c.id);

  update ceedo_collections.shifts
     set status = 'closed', closed_at = now(), declared_total = p_declared_total,
         system_total = v_system_total, system_count = v_system_count,
         variance = p_declared_total - v_system_total
   where id = p_shift_id;

  insert into ceedo_collections.audit_log (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'close_office_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('declared_total', p_declared_total, 'system_total', v_system_total,
                             'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.office_shift(uuid, date) from public;
revoke execute on function ceedo_collections.post_office_receipt(uuid, jsonb) from public;
revoke execute on function ceedo_collections.close_office_shift(uuid, numeric) from public;
grant execute on function ceedo_collections.office_shift(uuid, date) to authenticated;
grant execute on function ceedo_collections.post_office_receipt(uuid, jsonb) to authenticated;
grant execute on function ceedo_collections.close_office_shift(uuid, numeric) to authenticated;
```

- [ ] **Step 4: Apply, regenerate types, and run the tests**

Run: `supabase migration up && pnpm db:types && pnpm vitest run tests/db/office-receipts.test.ts tests/db/remittances.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008000068_office_receipts.sql packages/shared/src/db.types.ts tests/db/office-receipts.test.ts
git commit -m "feat(ledger): office shifts and office receipts, cash or check"
```

---

### Task 6: Cash-ticket sales and shift totals

**Files:**
- Create: `supabase/migrations/20261008000069_cash_tickets.sql`
- Test: `tests/db/cash-tickets.test.ts`

**Interfaces:**
- Consumes: shifts; `variance_settlements` (migration 0058); keyed fee types.
- Produces:
  - Table `cash_ticket_sales(id, shift_id, collector_id, business_date, fee_type_id, amount, ticket_from, ticket_to, note, entered_by, entered_at, cancelled_at, cancelled_by, cancel_reason)`.
  - `record_cash_ticket_sale(p_shift_id uuid, p_fee_type_id uuid, p_amount numeric, p_ticket_from integer, p_ticket_to integer, p_note text) returns uuid`.
  - `cancel_cash_ticket_sale(p_sale_id uuid, p_reason text) returns void`.
  - `shift_cash_tickets(p_shift_id uuid) returns numeric`.
  - `close_shift`, `office_close_shift` and `close_office_shift` now store `system_total` as receipts plus live cash tickets.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/cash-tickets.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, createCollectionFixture, uniqueCode, type CollectionFixture, type TestClient } from "../helpers/supabase";

let db: Client;
let supervisor: TestClient;
let accounting: TestClient;
let accountingId: string;
let collectorClient: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: supervisor } = await createAppUser({ email: "ct-supervisor", role: "supervisor" }));
  ({ client: accounting, userId: accountingId } = await createAppUser({ email: "ct-accounting", role: "accounting" }));
  ({ client: collectorClient } = await createAppUser({ email: "ct-collector", role: "collector" }));
});
afterAll(async () => db.end());

async function ticketFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode) values ($1, 'PM CR cash ticket', 'market', 'keyed') returning id`,
    [uniqueCode("CR")],
  );
  return rows[0].id as string;
}

async function shift(fx: CollectionFixture, s: { status: string; declared?: string; system?: string }) {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status, declared_total, system_total, variance)
     values ($1, $2, $3, '2026-10-05', now(), $4, $5::numeric, $6::numeric, $5::numeric - $6::numeric)`,
    [id, fx.collectorId, fx.deviceId, s.status, s.declared ?? null, s.system ?? null],
  );
  return id;
}

const record = (client: TestClient, shiftId: string, fee: string, amount: number) =>
  client.rpc("record_cash_ticket_sale", {
    p_shift_id: shiftId, p_fee_type_id: fee, p_amount: amount, p_ticket_from: null, p_ticket_to: null, p_note: null,
  });

const totals = async (id: string) =>
  (await db.query(`select system_total::text s, variance::text v from ceedo_collections.shifts where id = $1`, [id])).rows[0];

describe("record_cash_ticket_sale", () => {
  it("refuses a collector's login", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await record(collectorClient, await shift(fx, { status: "open" }), await ticketFee(), 100);
    expect(error).not.toBeNull();
  });

  it("raises a closed shift's system total and turns its overage into balance", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "closed", declared: "4000.00", system: "1000.00" });
    const { error } = await record(accounting, id, await ticketFee(), 3000);
    expect(error).toBeNull();
    expect(await totals(id)).toEqual({ s: "4000.00", v: "0.00" });
  });

  it("leaves an open shift's totals for close to compute", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "open" });
    await record(supervisor, id, await ticketFee(), 500);
    expect(await totals(id)).toEqual({ s: null, v: null });
  });

  it("refuses a remitted shift and a rate (not keyed) fee", async () => {
    const fx = await createCollectionFixture(db);
    const remitted = await shift(fx, { status: "remitted", declared: "1", system: "1" });
    expect((await record(supervisor, remitted, await ticketFee(), 1)).error?.message).toMatch(/remitted/);
    const open = await shift(fx, { status: "open" });
    expect((await record(supervisor, open, fx.perHeadFeeTypeId, 1)).error?.message).toMatch(/cash-ticket fee/);
  });
});

describe("cancel_cash_ticket_sale", () => {
  it("needs a reason, and lowers the system total again", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "closed", declared: "4000.00", system: "1000.00" });
    const { data: saleId } = await record(accounting, id, await ticketFee(), 3000);
    expect((await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: " " })).error?.message)
      .toMatch(/reason/);
    expect((await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: "Wrong shift" })).error).toBeNull();
    expect(await totals(id)).toEqual({ s: "1000.00", v: "3000.00" });
  });

  it("refuses when settlements would exceed the shortage that remains", async () => {
    const fx = await createCollectionFixture(db);
    // Short 500 after a 3000 ticket; 400 already settled. Cancelling the ticket would make
    // the shift 2500 OVER, with 400 settled against a shortage that no longer exists.
    const id = await shift(fx, { status: "closed", declared: "3500.00", system: "1000.00" });
    const { data: saleId } = await record(accounting, id, await ticketFee(), 3000);
    await db.query(
      `insert into ceedo_collections.variance_settlements (shift_id, amount, reference, received_at, recorded_by)
       values ($1, 400, 'OR 1', '2026-10-06', $2)`,
      [id, accountingId],
    );
    const { error } = await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: "test" });
    expect(error?.message).toMatch(/settled/);
  });
});

describe("close_shift", () => {
  it("compares the device's figures with receipts only, and stores receipts plus tickets", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "open" });
    await record(supervisor, id, await ticketFee(), 250);
    const { rows } = await db.query(
      `select ceedo_collections.close_shift($1, $2, 250, 0, 0) r`,
      [id, fx.deviceId],
    );
    expect(rows[0].r.status).toBe("closed");
    expect(await totals(id)).toEqual({ s: "250.00", v: "0.00" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/cash-tickets.test.ts`
Expected: FAIL. The function `record_cash_ticket_sale` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261008000069_cash_tickets.sql
-- Cash-ticket sales (spec "cash_ticket_sales"): comfort-room tickets and the like, sold for
-- cash the collector remits but written on no OR. A supervisor or accounting enters the
-- lump per collector per day against the collector's shift, until the shift is remitted.
--
-- A shift's system_total is now receipts PLUS live cash tickets. The collector's declared
-- cash already includes the ticket money, so until it is entered the shift reads as an
-- overage. Entering or cancelling a sale on a CLOSED shift recomputes its system_total and
-- variance; an open shift's close (close_shift / office_close_shift / close_office_shift)
-- adds them in. close_shift still compares the DEVICE's count and total with receipts only:
-- the tablet knows nothing of cash tickets.

create table ceedo_collections.cash_ticket_sales (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references ceedo_collections.shifts (id),
  collector_id  uuid not null references ceedo_collections.app_users (id),
  business_date date not null,
  fee_type_id   uuid not null references ceedo_collections.fee_types (id),
  amount        numeric(14,2) not null check (amount > 0),
  ticket_from   integer,
  ticket_to     integer,
  note          text,
  entered_by    uuid not null references ceedo_collections.app_users (id),
  entered_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references ceedo_collections.app_users (id),
  cancel_reason text,
  row_version   bigint not null default 0,
  check ((ticket_from is null) = (ticket_to is null)),
  check (ticket_to is null or ticket_to >= ticket_from),
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0)
);

create index cash_ticket_sales_shift_idx on ceedo_collections.cash_ticket_sales (shift_id);
create index cash_ticket_sales_date_idx on ceedo_collections.cash_ticket_sales (business_date);

create trigger cash_ticket_sales_row_version
  before insert or update on ceedo_collections.cash_ticket_sales
  for each row execute function ceedo_collections.bump_row_version();
select ceedo_collections.attach_audit('cash_ticket_sales');

alter table ceedo_collections.cash_ticket_sales enable row level security;
create policy cash_ticket_sales_read on ceedo_collections.cash_ticket_sales
  for select to authenticated using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));
revoke insert, update, delete on ceedo_collections.cash_ticket_sales from anon, authenticated, service_role;
grant select on ceedo_collections.cash_ticket_sales to authenticated, service_role;

create or replace function ceedo_collections.shift_cash_tickets(p_shift_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ceedo_collections, pg_temp
as $$
  select coalesce(sum(amount), 0)::numeric(14,2)
    from ceedo_collections.cash_ticket_sales
   where shift_id = p_shift_id and cancelled_at is null;
$$;
revoke execute on function ceedo_collections.shift_cash_tickets(uuid) from public;

-- After a sale changes on a closed shift: recompute, and refuse if live settlements would
-- then exceed what the shift is still short.
create or replace function ceedo_collections.restate_shift_for_tickets(p_shift ceedo_collections.shifts, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_total    numeric(14,2);
  v_variance numeric(14,2);
  v_settled  numeric(14,2);
begin
  if p_shift.system_total is null then
    return;  -- still open: its close counts the tickets
  end if;
  v_total := p_shift.system_total + p_delta;
  v_variance := p_shift.declared_total - v_total;

  select coalesce(sum(amount), 0) into v_settled
    from ceedo_collections.variance_settlements
   where shift_id = p_shift.id and cancelled_at is null;
  if v_settled > greatest(-v_variance, 0) then
    raise exception 'This shift already has ₱% settled against its shortage; after this change it would be short only ₱%. Cancel the settlement first',
      to_char(v_settled, 'FM999,999,990.00'), to_char(greatest(-v_variance, 0), 'FM999,999,990.00');
  end if;

  update ceedo_collections.shifts
     set system_total = v_total, variance = v_variance
   where id = p_shift.id;
end;
$$;
revoke execute on function ceedo_collections.restate_shift_for_tickets(ceedo_collections.shifts, numeric) from public;

create or replace function ceedo_collections.record_cash_ticket_sale(
  p_shift_id    uuid,
  p_fee_type_id uuid,
  p_amount      numeric,
  p_ticket_from integer,
  p_ticket_to   integer,
  p_note        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift ceedo_collections.shifts;
  v_id    uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'accounting', 'admin') then
    raise exception 'Only a supervisor, accounting or an administrator may enter cash tickets'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be more than zero';
  end if;
  if (p_ticket_from is null) <> (p_ticket_to is null) or p_ticket_to < p_ticket_from then
    raise exception 'Enter both ticket serials, the last no lower than the first, or neither';
  end if;
  if not exists (select 1 from ceedo_collections.fee_types
                  where id = p_fee_type_id and active and not accrues and amount_mode = 'keyed') then
    raise exception 'Choose a cash-ticket fee (an active fee with a typed amount)';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  if v_shift.status = 'remitted' then
    raise exception 'That shift is already remitted; its cash is final';
  end if;

  insert into ceedo_collections.cash_ticket_sales
    (shift_id, collector_id, business_date, fee_type_id, amount, ticket_from, ticket_to, note, entered_by)
  values
    (v_shift.id, v_shift.collector_id, v_shift.business_date, p_fee_type_id, p_amount,
     p_ticket_from, p_ticket_to, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  perform ceedo_collections.restate_shift_for_tickets(v_shift, p_amount);
  return v_id;
end;
$$;

create or replace function ceedo_collections.cancel_cash_ticket_sale(
  p_sale_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_sale  ceedo_collections.cash_ticket_sales;
  v_shift ceedo_collections.shifts;
begin
  if not ceedo_collections.has_role('supervisor', 'accounting', 'admin') then
    raise exception 'Only a supervisor, accounting or an administrator may cancel cash tickets'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling a cash-ticket entry needs a written reason';
  end if;

  select * into v_sale from ceedo_collections.cash_ticket_sales where id = p_sale_id for update;
  if not found then
    raise exception 'No such cash-ticket entry';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'This entry is already cancelled';
  end if;
  select * into v_shift from ceedo_collections.shifts where id = v_sale.shift_id for update;
  if v_shift.status = 'remitted' then
    raise exception 'That shift is already remitted; its cash is final';
  end if;

  update ceedo_collections.cash_ticket_sales
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_sale_id;

  perform ceedo_collections.restate_shift_for_tickets(v_shift, -v_sale.amount);
end;
$$;

revoke execute on function ceedo_collections.record_cash_ticket_sale(uuid, uuid, numeric, integer, integer, text) from public;
revoke execute on function ceedo_collections.cancel_cash_ticket_sale(uuid, text) from public;
grant execute on function ceedo_collections.record_cash_ticket_sale(uuid, uuid, numeric, integer, integer, text) to authenticated;
grant execute on function ceedo_collections.cancel_cash_ticket_sale(uuid, text) to authenticated;
```

Then, in the same migration, redefine the three close functions. Each is copied **verbatim** from its latest migration with one edit:

1. **`close_shift`** (from `20260928000051`):
   - Leave the mismatch comparison alone. It compares `p_device_count` and `p_device_total` with the receipts-only `v_system_total`.
   - Directly **after** the mismatch `if … end if;`, add:

```sql
  -- Cash tickets: entered by the office, unknown to the tablet, part of the cash declared.
  v_system_total := v_system_total + ceedo_collections.shift_cash_tickets(p_shift_id);
```

2. **`office_close_shift`** (from `20260930000060`): add the same line directly after its `select count(*) … into v_system_count, v_system_total …;`.

3. **`close_office_shift`** (from Task 5's `068`): add the same line directly after its `select … into v_system_count, v_system_total …;`.

Keep each function's own `revoke` and `grant` lines.

- [ ] **Step 4: Apply, regenerate types, and run the tests**

Run: `supabase migration up && pnpm db:types && pnpm vitest run tests/db/cash-tickets.test.ts tests/db/close-shift.test.ts tests/db/shift-scoped-closeout.test.ts tests/db/recovery.test.ts tests/db/office-receipts.test.ts tests/db/variance-settlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008000069_cash_tickets.sql packages/shared/src/db.types.ts tests/db/cash-tickets.test.ts
git commit -m "feat(ledger): cash-ticket sales counted in shift totals"
```

---

### Task 7: `receipt_account_lines`

**Files:**
- Create: `supabase/migrations/20261008000070_receipt_account_lines.sql`
- Test: `tests/db/receipt-account-lines.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's tables and `tests/helpers/accounts.ts`.
  - Task 6's `cash_ticket_sales`.
- Produces:
  - `receipt_account_lines(p_from date, p_to date)`. It returns `(source text, collection_id uuid, cash_ticket_id uuid, line_id uuid, or_no integer, booklet_id uuid, shift_id uuid, business_date date, collector_id uuid, lease_id uuid, payer_ref text, fee_type_id uuid, facility_id uuid, section_id uuid, rate_class text, quantity integer, portion text, account_id uuid, payment_mode text, amount numeric(14,2), cancelled boolean)`.
  - `lease_receipts_by_day` now skips receipts that have lines.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/receipt-account-lines.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL, createCollectionFixture, createOutsiderClient, postCollectionAsOwner, resetCutover,
  uniqueCode, type CollectionFixture,
} from "../helpers/supabase";
import { accountId, createAccount, createRule } from "../helpers/accounts";

let db: Client;
let fx: CollectionFixture;
let facilityId: string;
let sectionId: string;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, { accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00" });
  const { rows } = await db.query(
    `select s.id as section_id, s.facility_id from ceedo_collections.stalls st
       join ceedo_collections.sections s on s.id = st.section_id where st.id = $1`,
    [fx.stallId],
  );
  ({ section_id: sectionId, facility_id: facilityId } = rows[0]);
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const linesOf = async (collectionId: string) =>
  (await db.query(
    `select portion, account_id, amount::text as amount, cancelled
       from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31')
      where collection_id = $1 order by portion, amount`,
    [collectionId],
  )).rows;

async function charge(due: string, amount = "50.00", type = "rental", parent: string | null = null) {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, parent_charge_id, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, $3::ceedo_collections.charge_type, $4, $5::date, $5::date, $5::date, $6, 0, 'manual') returning id`,
    [fx.leaseId, fx.feeTypeId, type, parent, due, amount],
  );
  return rows[0].id as string;
}

async function ownFee(mode = "rate", rate = "10.00"): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode, facility_id)
     values ($1, $1, 'market', $2, $3) returning id`,
    [uniqueCode("FT"), mode, facilityId],
  );
  if (mode === "rate") {
    await db.query(
      `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
       values ($1, '', '2026-01-01', $2, 'per_head'), ($1, 'big', '2026-01-01', 20, 'per_head')`,
      [rows[0].id, rate],
    );
  }
  return rows[0].id as string;
}

describe("lease receipts", () => {
  it("splits base and surcharge and places each by the section rule", async () => {
    const rent = await charge("2026-10-01");
    await charge("2026-10-01", "1.50", "surcharge", rent);
    const base = await createAccount(db);
    const sur = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[base, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, portion: "surcharge", shares: [[sur, 10000]] });
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect(await linesOf(id)).toEqual([
      { portion: "base", account_id: base, amount: "50.00", cancelled: false },
      { portion: "surcharge", account_id: sur, amount: "1.50", cancelled: false },
    ]);
  });

  it("emits no zero base row for a surcharge-only receipt", async () => {
    // A rent already paid by an earlier receipt, its surcharge raised later and paid alone.
    const rent = await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    await charge("2026-10-01", "1.50", "surcharge", rent);
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const rows = await linesOf(id);
    expect(rows.map((r) => r.portion)).toEqual(["surcharge"]);
  });

  it("prefers section over facility over fee type, and falls to UNCLASSIFIED", async () => {
    await charge("2026-10-01");
    const byFacility = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, shares: [[byFacility, 10000]] });
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect((await linesOf(id))[0].account_id).toBe(byFacility);

    const bySection = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[bySection, 10000]] });
    expect((await linesOf(id))[0].account_id).toBe(bySection);
  });

  it("sends a portion with no rule at any level to UNCLASSIFIED", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect((await linesOf(id))[0].account_id).toBe(await accountId(db, "UNCLASSIFIED"));
  });

  it("uses the rule in force on the business date", async () => {
    await charge("2026-10-01");
    await charge("2026-10-02");
    const oct = await createAccount(db);
    const later = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, to: "2026-10-05", shares: [[oct, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, from: "2026-10-06", shares: [[later, 10000]] });
    const a = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const b = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-06T02:00:00+00:00" });
    expect((await linesOf(a))[0].account_id).toBe(oct);
    expect((await linesOf(b))[0].account_id).toBe(later);
  });

  it("returns a cancelled receipt flagged, and unflags it on reinstatement", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2) returning id`,
      [id, fx.collectorId],
    );
    expect((await linesOf(id))[0].cancelled).toBe(true);
    await db.query(
      `insert into ceedo_collections.collection_reinstatements (cancellation_id, reason, reinstated_by) values ($1, 'x', $2)`,
      [rows[0].id, fx.collectorId],
    );
    expect((await linesOf(id))[0].cancelled).toBe(false);
  });
});

describe("line receipts", () => {
  it("matches a rate class over a class-less rule, and the fee's own facility", async () => {
    const fee = await ownFee();
    const any = await createAccount(db);
    const big = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[any, 10000]] });
    await createRule(db, { feeTypeId: fee, rateClass: "big", shares: [[big, 10000]] });
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee,
      lines: [{ fee_type_id: fee, quantity: 1 }, { fee_type_id: fee, rate_class: "big", quantity: 1 }],
    });
    const rows = await linesOf(id);
    expect(rows.map((r) => [r.account_id, r.amount])).toEqual([[any, "10.00"], [big, "20.00"]]);
    const { rows: f } = await db.query(
      `select distinct facility_id from ceedo_collections.receipt_account_lines('2026-10-01','2026-10-31') where collection_id = $1`,
      [id],
    );
    expect(f).toEqual([{ facility_id: facilityId }]);
  });

  it("splits by share and gives the rounding remainder to the largest share", async () => {
    const fee = await ownFee("rate", "0.01");
    const big = await createAccount(db);
    const small = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[big, 7500], [small, 2500]] });
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity: 1 }],
    });
    expect((await linesOf(id)).map((r) => [r.account_id, r.amount])).toEqual([[big, "0.01"]]);
  });

  it("places an occupancy fee on a lease by the lease's section, once, and keeps it out of the rent grid", async () => {
    const fee = await ownFee("keyed");
    const occ = await createAccount(db);
    await createRule(db, { feeTypeId: fee, facilityId, sectionId, shares: [[occ, 10000]] });
    const { rows } = await db.query(`select ceedo_collections.post_collection($1::jsonb) r`, [JSON.stringify({
      id: randomUUID(), or_no: 1990, booklet_id: fx.bookletId, collector_id: fx.collectorId, device_id: fx.deviceId,
      collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: fee, lease_id: fx.leaseId,
      allocations: [], lines: [{ fee_type_id: fee, quantity: 1, amount: "200" }],
    })]);
    const id = rows[0].r.collection_id as string;
    expect(await linesOf(id)).toEqual([{ portion: "base", account_id: occ, amount: "200.00", cancelled: false }]);
    const grid = await db.query(
      `select * from ceedo_collections.lease_receipts_by_day('2026-10-01','2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(grid.rows).toEqual([]);
  });

  it("sends an unmatched line to UNCLASSIFIED", async () => {
    const fee = await ownFee();
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity: 3 }],
    });
    expect(await linesOf(id)).toEqual([
      { portion: "base", account_id: await accountId(db, "UNCLASSIFIED"), amount: "30.00", cancelled: false },
    ]);
  });
});

describe("cash tickets and access", () => {
  it("returns a live cash ticket as source cash_ticket, and drops a cancelled one", async () => {
    const fee = await ownFee("keyed");
    const shiftId = randomUUID();
    await db.query(
      `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status)
       values ($1, $2, $3, '2026-10-05', now(), 'open')`,
      [shiftId, fx.collectorId, fx.deviceId],
    );
    const ins = async () =>
      (await db.query(
        `insert into ceedo_collections.cash_ticket_sales (shift_id, collector_id, business_date, fee_type_id, amount, entered_by)
         values ($1, $2, '2026-10-05', $3, 470, $2) returning id`,
        [shiftId, fx.collectorId, fee],
      )).rows[0].id as string;
    const live = await ins();
    const gone = await ins();
    await db.query(
      `update ceedo_collections.cash_ticket_sales set cancelled_at = now(), cancelled_by = collector_id, cancel_reason = 'x' where id = $1`,
      [gone],
    );
    const { rows } = await db.query(
      `select source, cash_ticket_id, collection_id, amount::text from ceedo_collections.receipt_account_lines('2026-10-01','2026-10-31')
        where fee_type_id = $1`,
      [fee],
    );
    expect(rows).toEqual([{ source: "cash_ticket", cash_ticket_id: live, collection_id: null, amount: "470.00" }]);
  });

  it("shows nothing to a non-staff user", async () => {
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.rpc("receipt_account_lines", { p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/receipt-account-lines.test.ts`
Expected: FAIL. The function `receipt_account_lines` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261008000070_receipt_account_lines.sql
-- The single source for every collections report (spec "Computation"): one row per receipt
-- PORTION, placed on an account by the most specific rule in force on its business date.
--
-- Three exclusive branches, so no peso is counted twice:
--   * a receipt with collection_lines: one base portion per line, matched on the line's fee
--     type and rate class; facility/section from its lease if it has one (an occupancy fee),
--     else the fee type's own facility;
--   * a lease receipt with NO lines: a surcharge portion (its allocations to surcharge
--     charges) and a base portion (the rest: rent, opening balance);
--   * a live cash_ticket_sales row: one base portion, matched like a line.
-- Specificity: section > facility > fee type only; with a rate class > without, at the same
-- level. A rule set with several accounts divides by share_bps, rounded to the centavo, the
-- remainder to the largest share. No match: UNCLASSIFIED. Zero-peso rows are not emitted.
-- Cancelled receipts are returned flagged (status as of now); totals must exclude them.

create or replace function ceedo_collections.receipt_account_lines(p_from date, p_to date)
returns table (
  source         text,
  collection_id  uuid,
  cash_ticket_id uuid,
  line_id        uuid,
  or_no          integer,
  booklet_id     uuid,
  shift_id       uuid,
  business_date  date,
  collector_id   uuid,
  lease_id       uuid,
  payer_ref      text,
  fee_type_id    uuid,
  facility_id    uuid,
  section_id     uuid,
  rate_class     text,
  quantity       integer,
  portion        text,
  account_id     uuid,
  payment_mode   text,
  amount         numeric(14,2),
  cancelled      boolean
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with recv as (
    select c.id, c.or_no, c.booklet_id, c.shift_id, c.business_date, c.collector_id, c.lease_id,
           c.payer_ref, c.fee_type_id, c.payment_mode, c.gross_amount,
           s.facility_id as lease_facility_id, st.section_id as lease_section_id,
           exists (select 1 from ceedo_collections.standing_cancellations x
                    where x.collection_id = c.id) as cancelled,
           exists (select 1 from ceedo_collections.collection_lines li
                    where li.collection_id = c.id) as has_lines
      from ceedo_collections.collections c
      left join ceedo_collections.leases   l  on l.id = c.lease_id
      left join ceedo_collections.stalls   st on st.id = l.stall_id
      left join ceedo_collections.sections s  on s.id = st.section_id
     where c.business_date between p_from and p_to
  ),
  portions as (
    select 'receipt'::text as source, r.id as collection_id, null::uuid as cash_ticket_id,
           null::uuid as line_id, r.or_no, r.booklet_id, r.shift_id, r.business_date,
           r.collector_id, r.lease_id, r.payer_ref, r.fee_type_id,
           r.lease_facility_id as facility_id, r.lease_section_id as section_id,
           null::text as rate_class, null::integer as quantity, p.portion, r.payment_mode,
           p.amount::numeric(14,2) as amount, r.cancelled
      from recv r
      cross join lateral (
        select coalesce(sum(a.amount), 0) as sur
          from ceedo_collections.collection_allocations a
          join ceedo_collections.charges ch on ch.id = a.charge_id
         where a.collection_id = r.id and ch.charge_type = 'surcharge'
      ) s
      cross join lateral (values ('surcharge', s.sur), ('base', r.gross_amount - s.sur)) as p(portion, amount)
     where r.lease_id is not null and not r.has_lines and p.amount <> 0

    union all
    select 'receipt', r.id, null, li.id, r.or_no, r.booklet_id, r.shift_id, r.business_date,
           r.collector_id, r.lease_id, r.payer_ref, li.fee_type_id,
           coalesce(r.lease_facility_id, ft.facility_id), r.lease_section_id,
           li.rate_class, li.quantity, 'base', r.payment_mode, li.amount, r.cancelled
      from recv r
      join ceedo_collections.collection_lines li on li.collection_id = r.id
      join ceedo_collections.fee_types ft on ft.id = li.fee_type_id

    union all
    select 'cash_ticket', null, t.id, null, null, null, t.shift_id, t.business_date,
           t.collector_id, null, null, t.fee_type_id, ft.facility_id, null,
           null, null, 'base', 'cash', t.amount, false
      from ceedo_collections.cash_ticket_sales t
      join ceedo_collections.fee_types ft on ft.id = t.fee_type_id
     where t.business_date between p_from and p_to and t.cancelled_at is null
  ),
  numbered as (
    select row_number() over () as pk, p.* from portions p
  ),
  chosen as (
    select n.pk, (
      select r.id
        from ceedo_collections.account_rules r
       where r.fee_type_id = n.fee_type_id
         and r.portion = n.portion
         and (r.facility_id is null or r.facility_id = n.facility_id)
         and (r.section_id is null or r.section_id = n.section_id)
         and (r.rate_class is null or r.rate_class = n.rate_class)
         and n.business_date >= r.effective_from
         and (r.effective_to is null or n.business_date <= r.effective_to)
       order by (r.section_id is not null) desc, (r.facility_id is not null) desc,
                (r.rate_class is not null) desc
       limit 1
    ) as rule_id
    from numbered n
  ),
  split as (
    select n.*, sh.account_id,
           round(n.amount * sh.share_bps / 10000.0, 2) as raw,
           row_number() over (partition by n.pk order by sh.share_bps desc, a.code) as rk,
           sum(round(n.amount * sh.share_bps / 10000.0, 2)) over (partition by n.pk) as raw_total
      from numbered n
      join chosen c on c.pk = n.pk
      join ceedo_collections.account_rule_shares sh on sh.rule_id = c.rule_id
      join ceedo_collections.collection_accounts a on a.id = sh.account_id
  ),
  placed as (
    select s.source, s.collection_id, s.cash_ticket_id, s.line_id, s.or_no, s.booklet_id,
           s.shift_id, s.business_date, s.collector_id, s.lease_id, s.payer_ref, s.fee_type_id,
           s.facility_id, s.section_id, s.rate_class, s.quantity, s.portion, s.account_id,
           s.payment_mode,
           (s.raw + case when s.rk = 1 then s.amount - s.raw_total else 0 end)::numeric(14,2) as amount,
           s.cancelled
      from split s
    union all
    select n.source, n.collection_id, n.cash_ticket_id, n.line_id, n.or_no, n.booklet_id,
           n.shift_id, n.business_date, n.collector_id, n.lease_id, n.payer_ref, n.fee_type_id,
           n.facility_id, n.section_id, n.rate_class, n.quantity, n.portion,
           (select id from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED'),
           n.payment_mode, n.amount, n.cancelled
      from numbered n
      join chosen c on c.pk = n.pk
     where c.rule_id is null
  )
  select * from placed where amount <> 0;
$$;

revoke execute on function ceedo_collections.receipt_account_lines(date, date) from public;
grant execute on function ceedo_collections.receipt_account_lines(date, date) to authenticated;
```

Append `lease_receipts_by_day`, copied verbatim from `20261007000063`, with one more condition in its `where` clause:

```sql
    -- A receipt with fee lines (an occupancy fee on a lease) is not rent; it is classified
    -- through its lines (receipt_account_lines) and must not inflate the rent grid.
    and not exists (
      select 1 from ceedo_collections.collection_lines li where li.collection_id = col.id
    )
```

- [ ] **Step 4: Apply, regenerate types, and run the tests**

Run: `supabase migration up && pnpm db:types && pnpm vitest run tests/db/receipt-account-lines.test.ts tests/db/tenant-payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008000070_receipt_account_lines.sql packages/shared/src/db.types.ts tests/db/receipt-account-lines.test.ts
git commit -m "feat(accounts): receipt_account_lines places every receipt portion"
```

**Now do Task 3**, the catalogue seed (migration 071).

---

### Task 8: Registry: facilities, fee types, chart resources, nav

**Files:**
- Modify: `apps/web/lib/admin/registry.ts` (the facilities entry around lines 82–125, and the fee-types entry around lines 338–400)
- Modify: `apps/web/lib/nav/modules.ts`
- Modify: `apps/web/lib/reports/data.ts` (export `allPages`)
- Modify: `tests/db/registry-parity.test.ts` (add the three chart tables)
- Test: `apps/web/lib/admin/edit.test.ts` (existing), `apps/web/lib/nav/modules.test.ts` (existing), `apps/web/lib/admin/registry.test.ts` (existing)

**Interfaces:**
- Consumes: Task 1's and Task 2's tables.
- Produces:
  - Registry keys `treasurer-lines`, `rcd-columns` and `collection-accounts`.
  - Nav module `accounts`, with tabs `/collection-accounts`, `/treasurer-lines`, `/rcd-columns`, `/accounts/rules` and `/accounts/unclassified`.
  - Collections tabs `/ledger/office-receipt` (supervisor, admin) and `/ledger/cash-tickets`.
  - `allPages` exported from `lib/reports/data.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/nav/modules.test.ts`:

```ts
it("files the account chart under Accounts and the office screens under Collections", () => {
  const admin = navFor("admin").flatMap((s) => s.modules);
  const accounts = admin.find((m) => m.key === "accounts");
  expect(accounts?.tabs.map((t) => t.href)).toEqual([
    "/collection-accounts", "/treasurer-lines", "/rcd-columns", "/accounts/rules", "/accounts/unclassified",
  ]);
  const collections = admin.find((m) => m.key === "collections");
  expect(collections?.tabs.map((t) => t.href)).toContain("/ledger/office-receipt");
  const accounting = navFor("accounting").flatMap((s) => s.modules).find((m) => m.key === "collections");
  expect(accounting?.tabs.map((t) => t.href)).not.toContain("/ledger/office-receipt");
  expect(accounting?.tabs.map((t) => t.href)).toContain("/ledger/cash-tickets");
});
```

Add to `apps/web/lib/admin/registry.test.ts` (match its existing import of `RESOURCES`):

```ts
it("lets a non-accruing fee leave 'collected at' blank when it names its facility", () => {
  const schema = RESOURCES["fee-types"].schema;
  const base = { code: "X", name: "X", accrues: false, surcharge_bps: 0, amount_mode: "keyed", active: true };
  expect(schema.safeParse({ ...base, facility_type: null, facility_id: null }).success).toBe(false);
  expect(schema.safeParse({ ...base, facility_type: null, facility_id: "00000000-0000-0000-0000-000000000001" }).success).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ceedo/web vitest run lib/nav/modules.test.ts lib/admin/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change the registry**

In the **facilities** entry:
- Change its schema `type` to `z.enum(["market", "terminal", "parking", "slaughterhouse", "other"])`.
- Add the option `{ value: "other", label: "Other (gym, cemetery, night market…)" }`.
- Change its help to `"Markets, terminals and other facilities may have sections and stalls; parking and the slaughterhouse do not."`

In the **fee-types** entry, change the schema to:

```ts
    schema: z.object({
      code: name,
      name,
      accrues: z.boolean(),
      surcharge_bps: z.number().int().min(0).max(10000),
      amount_mode: z.enum(["rate", "keyed"]),
      facility_id: uuid.nullable(),
      facility_type: z.enum(["market", "terminal", "parking", "slaughterhouse", "other"]).nullable(),
      active: z.boolean(),
    })
    // An on-the-spot fee with no site would be offered on EVERY tablet. A fee that names its
    // facility takes that facility's type automatically (migration 0065's trigger).
    .superRefine((value, ctx) => {
      if (!value.accrues && value.facility_type === null && value.facility_id === null) {
        ctx.addIssue({
          code: "custom",
          path: ["facility_type"],
          message: "Choose the facility, or the kind of facility, where this fee is collected.",
        });
      }
    }),
```

Add to its `fields`, after `surcharge_bps`:

```ts
      {
        name: "amount_mode",
        label: "Amount",
        type: "select",
        options: [
          { value: "rate", label: "From the rate table" },
          { value: "keyed", label: "Typed on the receipt" },
        ],
        help: "Typed: electricity, certification, occupancy and other fees whose amount varies.",
      },
      {
        name: "facility_id",
        label: "Facility",
        type: "select",
        optionsFrom: "facilities",
        optional: true,
        emptyLabel: "Any facility of the kind below",
        help: "For a fee that belongs to one facility, e.g. Public Mall CR.",
      },
```

Also:
- Add the option `{ value: "other", label: "Other" }` to `facility_type`.
- Add the columns `{ key: "amount_mode", label: "Amount" }` and `{ key: "facilities", label: "Facility", emptyText: "Any" }`.
- Change its `select` to `"id, code, name, accrues, surcharge_bps, amount_mode, facility_id, facility_type, active, facilities(name)"`.
- Keep the remaining keys of that `select` as they are today; add only the new ones.

Append three resources (place them before `devices`):

```ts
  {
    key: "treasurer-lines",
    table: "treasurer_lines",
    title: "Treasurer lines",
    singular: "Treasurer line",
    empty:
      "No Treasurer lines yet. A Treasurer line is one particulars row of the Daily Collection Report sent to the City Treasurer; every account rolls up into exactly one.",
    schema: z.object({
      code: name,
      name,
      sort_order: z.number().int(),
      subtotal_group: z.number().int().min(1).max(2),
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. TL_PM" },
      { name: "name", label: "Particulars", type: "text" },
      { name: "sort_order", label: "Order", type: "number" },
      { name: "subtotal_group", label: "Sub-total", type: "number", help: "1 or 2" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "sort_order", label: "Order" },
      { key: "name", label: "Particulars" },
      { key: "subtotal_group", label: "Sub-total" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select: "id, code, name, sort_order, subtotal_group, active",
    orderBy: "sort_order",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "rcd-columns",
    table: "rcd_columns",
    title: "Collector matrix columns",
    singular: "column",
    empty:
      "No columns yet. These are the columns of the Collections-per-collector matrix; every account rolls up into exactly one.",
    schema: z.object({ code: name, name, sort_order: z.number().int(), active: z.boolean() }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. RC_PM" },
      { name: "name", label: "Column", type: "text" },
      { name: "sort_order", label: "Order", type: "number" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "sort_order", label: "Order" },
      { key: "name", label: "Column" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select: "id, code, name, sort_order, active",
    orderBy: "sort_order",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "collection-accounts",
    table: "collection_accounts",
    title: "Accounts",
    singular: "account",
    // The code is how rules, reports and the built-in UNCLASSIFIED name an account.
    lockedOnEdit: ["code"],
    empty:
      "No accounts yet. An account is one line of the Monthly Summary of Collections. Rules place each receipt on one; each account belongs to one Treasurer line and one matrix column.",
    schema: z.object({
      code: name,
      name,
      facility_id: uuid.nullable(),
      group_name: name,
      sort_order: z.number().int(),
      kind: z.enum(["income", "non_income"]),
      treasurer_line_id: uuid,
      rcd_column_id: uuid,
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. CPM-DR-BAKERY" },
      { name: "name", label: "Name", type: "text" },
      { name: "facility_id", label: "Facility", type: "select", optionsFrom: "facilities", optional: true, emptyLabel: "None (cross-facility)" },
      { name: "group_name", label: "Group", type: "text", help: "The summary's sub-heading, e.g. Stall Sections Daily Rent" },
      { name: "sort_order", label: "Order", type: "number" },
      {
        name: "kind",
        label: "Kind",
        type: "select",
        options: [
          { value: "income", label: "Income" },
          { value: "non_income", label: "Non-income (regulatory)" },
        ],
      },
      { name: "treasurer_line_id", label: "Treasurer line", type: "select", optionsFrom: "treasurer-lines" },
      { name: "rcd_column_id", label: "Matrix column", type: "select", optionsFrom: "rcd-columns" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "facilities", label: "Facility", emptyText: "—" },
      { key: "group_name", label: "Group" },
      { key: "treasurer_lines", label: "Treasurer line" },
      { key: "rcd_columns", label: "Matrix column" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select:
      "id, code, name, facility_id, group_name, sort_order, kind, treasurer_line_id, rcd_column_id, active, facilities(name), treasurer_lines(name), rcd_columns(name)",
    orderBy: "sort_order",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
```

If `lockedOnEdit` or `emptyLabel` behave differently from what this assumes, read their doc comments in `resource.ts` and adjust. Keep the intent: an account's code cannot be changed once it is saved.

- [ ] **Step 4: Change the nav**

In `apps/web/lib/nav/modules.ts`, add these Collections tabs after Exceptions:

```ts
          { href: "/ledger/office-receipt", label: "Office receipt", roles: ["supervisor", "admin"] },
          { href: "/ledger/cash-tickets", label: "Cash tickets" },
```

Add an Accounts module to "Records", after `fees`:

```ts
      {
        key: "accounts",
        label: "Accounts",
        tabs: [
          { resource: "collection-accounts" },
          { resource: "treasurer-lines" },
          { resource: "rcd-columns" },
          { href: "/accounts/rules", label: "Rules" },
          { href: "/accounts/unclassified", label: "Unclassified" },
        ],
      },
```

- [ ] **Step 5: Export `allPages`, extend the parity test, and run the tests**

In `apps/web/lib/reports/data.ts`, change `async function allPages` to `export async function allPages`.

In `tests/db/registry-parity.test.ts`, add `"treasurer_lines", "rcd_columns", "collection_accounts"` to `TABLES`. Also add a select-expression case for `collection_accounts`, using the registry's select string verbatim.

Run: `pnpm --filter @ceedo/web vitest run lib && pnpm vitest run tests/db/registry-parity.test.ts && pnpm --filter @ceedo/web build`
Expected: PASS, and the build succeeds. The `/accounts/*` and `/ledger/*` tab pages do not exist yet. That is fine: the nav only links to them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/admin/registry.ts apps/web/lib/admin/registry.test.ts apps/web/lib/nav/modules.ts apps/web/lib/nav/modules.test.ts apps/web/lib/reports/data.ts tests/db/registry-parity.test.ts
git commit -m "feat(web): account chart screens, keyed fees and facility-specific fee types"
```

---

### Task 9: Rules and Unclassified screens

**Files:**
- Create: `apps/web/lib/accounts/schemas.ts`, `apps/web/lib/accounts/schemas.test.ts`
- Create: `apps/web/lib/accounts/queries.ts`, `apps/web/lib/accounts/actions.ts`
- Create: `apps/web/app/(admin)/accounts/rules/page.tsx`, `apps/web/app/(admin)/accounts/unclassified/page.tsx`
- Create: `apps/web/components/accounts/rules-table.tsx`, `apps/web/components/accounts/rule-dialog.tsx`, `apps/web/components/accounts/unclassified-table.tsx`

**Interfaces:**
- Consumes:
  - `replace_account_rule` (Task 2) and `receipt_account_lines` (Task 7).
  - `allPages` (Task 8).
  - `readParams`, `monthBounds`, `manilaToday` and `longMonth` from `lib/reports/params.ts`.
- Produces:
  - `ruleSchema` and `sharesToBps(rows: {accountId: string; percent: string}[]): {account_id: string; share_bps: number}[]`, which throws on a bad total.
  - `getRuleSets(): Promise<RuleSetRow[]>`, `getUnclassified(from, to): Promise<UnclassifiedRow[]>` and `getRuleChoices(): Promise<RuleChoices>`.
  - The action `saveRule(formData): Promise<SaveResult>`.

- [ ] **Step 1: Write the failing schema test**

```ts
// apps/web/lib/accounts/schemas.test.ts
import { describe, expect, it } from "vitest";
import { ruleSchema, sharesToBps } from "./schemas";

describe("sharesToBps", () => {
  it("turns percents into basis points that sum to 10000", () => {
    expect(sharesToBps([{ accountId: "a", percent: "75" }, { accountId: "b", percent: "25" }]))
      .toEqual([{ account_id: "a", share_bps: 7500 }, { account_id: "b", share_bps: 2500 }]);
  });
  it("accepts two decimals", () => {
    expect(sharesToBps([{ accountId: "a", percent: "33.34" }, { accountId: "b", percent: "66.66" }])
      .map((s) => s.share_bps)).toEqual([3334, 6666]);
  });
  it.each([
    [[{ accountId: "a", percent: "90" }]],
    [[{ accountId: "a", percent: "100" }, { accountId: "a", percent: "0" }]],
    [[]],
  ])("refuses %j", (rows) => {
    expect(() => sharesToBps(rows)).toThrow();
  });
});

describe("ruleSchema", () => {
  it("needs a fee type, a portion and a start date, and blanks become null", () => {
    const r = ruleSchema.parse({
      feeTypeId: "00000000-0000-0000-0000-000000000001", facilityId: "", sectionId: "", rateClass: " ",
      portion: "base", effectiveFrom: "2026-10-01",
    });
    expect(r).toMatchObject({ facilityId: null, sectionId: null, rateClass: null });
    expect(ruleSchema.safeParse({ portion: "base", effectiveFrom: "2026-10-01" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ceedo/web vitest run lib/accounts/schemas.test.ts`
Expected: FAIL. The module `./schemas` is not found.

- [ ] **Step 3: Write `schemas.ts`**

```ts
// apps/web/lib/accounts/schemas.ts
import { z } from "zod";

/** Kept apart from the "use server" actions so they can be unit-tested (same reason as lib/recovery/schemas.ts). */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const ruleSchema = z.object({
  feeTypeId: z.guid("Choose the fee"),
  facilityId: z.preprocess(blankToNull, z.guid().nullable()),
  sectionId: z.preprocess(blankToNull, z.guid().nullable()),
  rateClass: z.preprocess(blankToNull, z.string().trim().nullable()),
  portion: z.enum(["base", "surcharge"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date"),
});

/** Percent strings (two decimals) to basis points. Throws a sentence when they are not whole. */
export function sharesToBps(rows: { accountId: string; percent: string }[]): { account_id: string; share_bps: number }[] {
  const shares = rows
    .filter((r) => r.accountId)
    .map((r) => ({ account_id: r.accountId, share_bps: Math.round(Number(r.percent) * 100) }));
  if (shares.length === 0) throw new Error("Add at least one account");
  if (shares.some((s) => !Number.isFinite(s.share_bps) || s.share_bps < 1)) throw new Error("Every share must be more than 0%");
  if (new Set(shares.map((s) => s.account_id)).size !== shares.length) throw new Error("Name each account once");
  const total = shares.reduce((a, s) => a + s.share_bps, 0);
  if (total !== 10000) throw new Error(`The shares must add up to 100% (they add up to ${(total / 100).toFixed(2)}%)`);
  return shares;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ceedo/web vitest run lib/accounts/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Write queries and the action**

```ts
// apps/web/lib/accounts/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages } from "@/lib/reports/data";

export interface RuleSetRow {
  id: string;
  feeType: string;
  facility: string | null;
  section: string | null;
  rateClass: string | null;
  portion: "base" | "surcharge";
  effectiveFrom: string;
  effectiveTo: string | null;
  shares: { account: string; percent: number }[];
}

export async function getRuleSets(): Promise<RuleSetRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((from, to) =>
    supabase
      .from("account_rules")
      .select(
        "id, rate_class, portion, effective_from, effective_to, fee_types(name), facilities(name), sections!account_rules_section_in_facility(name), account_rule_shares(share_bps, collection_accounts(code, name))",
      )
      .order("effective_from", { ascending: false })
      .range(from, to),
  );
  return rows
    .map((r) => ({
      id: r.id,
      feeType: r.fee_types?.name ?? "—",
      facility: r.facilities?.name ?? null,
      section: r.sections?.name ?? null,
      rateClass: r.rate_class,
      portion: r.portion as "base" | "surcharge",
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      shares: (r.account_rule_shares ?? []).map((s) => ({
        account: `${s.collection_accounts?.code ?? ""} · ${s.collection_accounts?.name ?? ""}`,
        percent: s.share_bps / 100,
      })),
    }))
    .sort((a, b) => a.feeType.localeCompare(b.feeType) || (a.facility ?? "").localeCompare(b.facility ?? ""));
}

export interface RuleChoices {
  feeTypes: { id: string; name: string }[];
  facilities: { id: string; name: string }[];
  sections: { id: string; name: string; facilityId: string }[];
  accounts: { id: string; label: string }[];
}

export async function getRuleChoices(): Promise<RuleChoices> {
  const supabase = await ledgerClient();
  const [fees, facilities, sections, accounts] = await Promise.all([
    supabase.from("fee_types").select("id, name").eq("active", true).order("name"),
    supabase.from("facilities").select("id, name").eq("active", true).order("name"),
    supabase.from("sections").select("id, name, facility_id").eq("active", true).order("name"),
    supabase.from("collection_accounts").select("id, code, name").eq("active", true).order("sort_order"),
  ]);
  for (const r of [fees, facilities, sections, accounts]) if (r.error) throw r.error;
  return {
    feeTypes: fees.data ?? [],
    facilities: facilities.data ?? [],
    sections: (sections.data ?? []).map((s) => ({ id: s.id, name: s.name, facilityId: s.facility_id })),
    accounts: (accounts.data ?? []).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
  };
}

export interface UnclassifiedRow {
  key: string;
  businessDate: string;
  orNo: number | null;
  source: string;
  feeTypeId: string;
  feeType: string;
  facilityId: string | null;
  facility: string | null;
  sectionId: string | null;
  section: string | null;
  rateClass: string | null;
  portion: "base" | "surcharge";
  amount: Centavos;
}

/** Every portion of the period that no rule places, excluding cancelled receipts. */
export async function getUnclassified(from: string, to: string): Promise<UnclassifiedRow[]> {
  const supabase = await ledgerClient();
  const { data: unc, error } = await supabase.from("collection_accounts").select("id").eq("code", "UNCLASSIFIED").single();
  if (error) throw error;
  const rows = await allPages((a, b) =>
    supabase.rpc("receipt_account_lines", { p_from: from, p_to: to })
      .eq("account_id", unc.id).eq("cancelled", false)
      .order("business_date").order("or_no")
      .range(a, b),
  );
  const [fees, facilities, sections] = await Promise.all([
    supabase.from("fee_types").select("id, name"),
    supabase.from("facilities").select("id, name"),
    supabase.from("sections").select("id, name"),
  ]);
  const name = (list: { id: string; name: string }[] | null, id: string | null) =>
    id ? (list ?? []).find((x) => x.id === id)?.name ?? null : null;
  return rows.map((r, i) => ({
    key: `${r.collection_id ?? r.cash_ticket_id}-${r.line_id ?? r.portion}-${i}`,
    businessDate: r.business_date,
    orNo: r.or_no,
    source: r.source,
    feeTypeId: r.fee_type_id,
    feeType: name(fees.data, r.fee_type_id) ?? "—",
    facilityId: r.facility_id,
    facility: name(facilities.data, r.facility_id),
    sectionId: r.section_id,
    section: name(sections.data, r.section_id),
    rateClass: r.rate_class || null,
    portion: r.portion as "base" | "surcharge",
    amount: fromPesos(Number(r.amount)),
  }));
}
```

```ts
// apps/web/lib/accounts/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";
import { ruleSchema, sharesToBps } from "./schemas";

function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

/** replace_account_rule ends the current set the day before and starts this one. */
export async function saveRule(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return failure("Only an administrator may change the account rules.");

  const parsed = ruleSchema.safeParse({
    feeTypeId: formData.get("feeTypeId"),
    facilityId: formData.get("facilityId") ?? "",
    sectionId: formData.get("sectionId") ?? "",
    rateClass: formData.get("rateClass") ?? "",
    portion: formData.get("portion"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  let shares;
  try {
    const ids = formData.getAll("accountId").map(String);
    const percents = formData.getAll("percent").map(String);
    shares = sharesToBps(ids.map((accountId, i) => ({ accountId, percent: percents[i] ?? "" })));
  } catch (e) {
    return { ok: false, fieldErrors: { shares: (e as Error).message } };
  }

  const r = parsed.data;
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("replace_account_rule", {
    p_fee_type_id: r.feeTypeId,
    p_facility_id: r.facilityId,
    p_section_id: r.sectionId,
    p_rate_class: r.rateClass,
    p_portion: r.portion,
    p_effective_from: r.effectiveFrom,
    p_shares: shares,
  });
  if (error) return failure(error.message);
  revalidatePath("/accounts/rules");
  revalidatePath("/accounts/unclassified");
  return { ok: true, id: data ?? "" };
}
```

If the generated types give `p_facility_id` and the other nullable arguments a non-null type, pass `r.facilityId ?? undefined`. Supabase types optional RPC arguments that way. Check `db.types.ts`.

- [ ] **Step 6: Write the pages and components**

```tsx
// apps/web/app/(admin)/accounts/rules/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { RuleDialog } from "@/components/accounts/rule-dialog";
import { RulesTable } from "@/components/accounts/rules-table";
import { getRuleChoices, getRuleSets } from "@/lib/accounts/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Account rules (spec "Screens: /admin/accounts"). A rule places a fee's receipts on one or
 * more accounts from a date. Rules are never edited: a new rule for the same fee, facility,
 * section, class and portion ends the old one the day before. `?fee=&facility=&section=&rateClass=&portion=&from=`
 * prefills the dialog (the Unclassified screen's "Create rule" link).
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requireStaff();
  const prefill = await searchParams;
  const [rows, choices] = await Promise.all([getRuleSets(), getRuleChoices()]);
  return (
    <div>
      <ScreenHeader
        title="Account rules"
        note="Which account each fee's receipts land on. A section rule beats a facility rule, which beats a fee-only rule; a rule naming a rate class beats one that does not. Changing a rule starts a new one from a date; months already reported are never restated."
        actions={staff.role === "admin" ? <RuleDialog choices={choices} today={manilaToday()} prefill={prefill} /> : null}
      />
      <RulesTable rows={rows} />
    </div>
  );
}
```

```tsx
// apps/web/components/accounts/rules-table.tsx
import type { RuleSetRow } from "@/lib/accounts/queries";

export function RulesTable({ rows }: { rows: RuleSetRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-2">No rules yet. Until a fee has a rule, its receipts show as Unclassified.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3">
        <tr>
          <th className="py-2">Fee</th><th>Facility</th><th>Section</th><th>Class</th><th>Portion</th>
          <th>From</th><th>To</th><th>Accounts</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {rows.map((r) => (
          <tr key={r.id} className={r.effectiveTo ? "text-ink-3" : undefined}>
            <td className="py-2">{r.feeType}</td>
            <td>{r.facility ?? "Any"}</td>
            <td>{r.section ?? "Any"}</td>
            <td>{r.rateClass ?? "Any"}</td>
            <td>{r.portion}</td>
            <td className="tabular-nums">{r.effectiveFrom}</td>
            <td className="tabular-nums">{r.effectiveTo ?? "—"}</td>
            <td>
              {r.shares.map((s) => (
                <div key={s.account}>
                  {s.account}
                  {r.shares.length > 1 ? <span className="text-ink-3"> · {s.percent}%</span> : null}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// apps/web/components/accounts/rule-dialog.tsx
"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { useSubmit } from "@/components/ui/use-submit";
import { saveRule } from "@/lib/accounts/actions";
import type { RuleChoices } from "@/lib/accounts/queries";
import type { SaveResult } from "@/lib/admin/save-result";

type Share = { accountId: string; percent: string };

export function RuleDialog({
  choices,
  today,
  prefill,
}: {
  choices: RuleChoices;
  today: string;
  prefill: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(prefill.fee));
  const [facilityId, setFacilityId] = useState(prefill.facility ?? "");
  const [shares, setShares] = useState<Share[]>([{ accountId: "", percent: "100" }]);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await saveRule(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.replace("/accounts/rules");
      router.refresh();
    }
  });
  const errors = result && !result.ok ? result.fieldErrors : {};
  const sections = choices.sections.filter((s) => s.facilityId === facilityId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass("primary", "md")}>
        <Plus size={14} strokeWidth={2} />
        New rule
      </DialogTrigger>
      <DialogContent
        busy={busy}
        title="New account rule"
        description="Starts on the date given; an existing rule for the same fee, facility, section, class and portion ends the day before."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="rule-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save rule"}
            </Button>
          </>
        }
      >
        <form id="rule-form" onSubmit={onSubmit}>
          <FieldShell id="feeTypeId" label="Fee" error={errors.feeTypeId}>
            <NativeSelect id="feeTypeId" name="feeTypeId" defaultValue={prefill.fee ?? ""}>
              <option value="" disabled>Choose…</option>
              {choices.feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </NativeSelect>
          </FieldShell>
          <div className="grid grid-cols-2 gap-x-3">
            <FieldShell id="facilityId" label="Facility" error={errors.facilityId}>
              <NativeSelect id="facilityId" name="facilityId" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                <option value="">Any</option>
                {choices.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </NativeSelect>
            </FieldShell>
            <FieldShell id="sectionId" label="Section" error={errors.sectionId}>
              <NativeSelect id="sectionId" name="sectionId" defaultValue={prefill.section ?? ""} disabled={!facilityId}>
                <option value="">Any</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </FieldShell>
            <FieldShell id="rateClass" label="Rate class" error={errors.rateClass} help="Blank: any class. e.g. RTMI for a bus company.">
              <TextInput id="rateClass" name="rateClass" defaultValue={prefill.rateClass ?? ""} />
            </FieldShell>
            <FieldShell id="portion" label="Portion" error={errors.portion}>
              <NativeSelect id="portion" name="portion" defaultValue={prefill.portion ?? "base"}>
                <option value="base">Base (rent, fee)</option>
                <option value="surcharge">Surcharge on rent</option>
              </NativeSelect>
            </FieldShell>
            <FieldShell id="effectiveFrom" label="Starts" error={errors.effectiveFrom}>
              <TextInput id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={prefill.from ?? today} />
            </FieldShell>
          </div>

          <FieldShell id="shares" label="Accounts" error={errors.shares} help="Split a fee by adding accounts; the shares must add up to 100%.">
            <div className="space-y-2">
              {shares.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect
                    name="accountId"
                    value={s.accountId}
                    onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}
                  >
                    <option value="" disabled>Choose an account…</option>
                    {choices.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </NativeSelect>
                  <TextInput
                    name="percent"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    className="w-24"
                    value={s.percent}
                    onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => setShares([...shares, { accountId: "", percent: "" }])}
              >
                Add an account
              </button>
            </div>
          </FieldShell>

          {result && !result.ok && result.formError ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">{result.formError}</p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// apps/web/app/(admin)/accounts/unclassified/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { UnclassifiedTable } from "@/components/accounts/unclassified-table";
import { getUnclassified } from "@/lib/accounts/queries";
import { longMonth, monthBounds, readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/** Receipt portions no rule places. Every one of them reaches the reports as UNCLASSIFIED until a rule covers it. */
export default async function UnclassifiedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const { month } = readParams(await searchParams);
  const { from, to } = monthBounds(month);
  const rows = await getUnclassified(from, to);
  return (
    <div>
      <ScreenHeader
        title="Unclassified receipts"
        note={`Money received in ${longMonth(month)} that no account rule places. Create a rule starting on or before the receipt's date and it moves to that account in every report.`}
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Month
          <TextInput type="month" name="month" defaultValue={month} className="mt-1 w-40" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <UnclassifiedTable rows={rows} canCreate={staff.role === "admin"} monthStart={from} />
    </div>
  );
}
```

```tsx
// apps/web/components/accounts/unclassified-table.tsx
import Link from "next/link";
import { pesos } from "@/lib/reports/report";
import type { UnclassifiedRow } from "@/lib/accounts/queries";

export function UnclassifiedTable({ rows, canCreate, monthStart }: { rows: UnclassifiedRow[]; canCreate: boolean; monthStart: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-2">Every receipt this month has an account.</p>;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3">
        <tr>
          <th className="py-2">Date</th><th>OR</th><th>Fee</th><th>Facility</th><th>Section</th><th>Class</th>
          <th>Portion</th><th className="text-right">Amount</th><th />
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {rows.map((r) => {
          const q = new URLSearchParams({
            fee: r.feeTypeId, facility: r.facilityId ?? "", section: r.sectionId ?? "",
            rateClass: r.rateClass ?? "", portion: r.portion, from: monthStart,
          });
          return (
            <tr key={r.key}>
              <td className="py-2 tabular-nums">{r.businessDate}</td>
              <td className="tabular-nums">{r.orNo ?? (r.source === "cash_ticket" ? "cash ticket" : "—")}</td>
              <td>{r.feeType}</td>
              <td>{r.facility ?? "—"}</td>
              <td>{r.section ?? "—"}</td>
              <td>{r.rateClass ?? "—"}</td>
              <td>{r.portion}</td>
              <td className="text-right tabular-nums">{pesos(r.amount)}</td>
              <td className="text-right">
                {canCreate ? <Link className="text-xs underline" href={`/accounts/rules?${q}`}>Create rule</Link> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td colSpan={7} className="py-2">Total unclassified</td>
          <td className="text-right tabular-nums">{pesos(total)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
```

- [ ] **Step 7: Build and check by hand**

Run: `pnpm --filter @ceedo/web build`
Expected: the build succeeds.

Then start the app (`pnpm --filter @ceedo/web dev`) and sign in as an admin. Check that:
- `/accounts/rules` lists the seeded rules (after Task 3).
- `/accounts/unclassified?month=2026-10` lists the local test receipts on facilities without rules.
- A "Create rule" link opens the prefilled dialog, saving it removes the row, and saving a 90% split shows the error under Accounts.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/accounts apps/web/app/\(admin\)/accounts apps/web/components/accounts
git commit -m "feat(web): account rules editor and unclassified receipts"
```

---

### Task 10: Office receipt screen

**Files:**
- Create: `apps/web/lib/office-receipt/schemas.ts`, `schemas.test.ts`, `queries.ts`, `actions.ts`
- Create: `apps/web/app/(admin)/ledger/office-receipt/page.tsx`
- Create: `apps/web/components/office-receipt/day-picker.tsx`, `receipt-form.tsx`, `close-form.tsx`
- Reuse: `components/recovery/recovered-receipts.tsx` and `close-summary.tsx`, `lib/recovery/queries.ts` (`getHeldBooklets`, `getUnpaidGroups`, `getLeaseFeeType`) and `lib/recovery/months.ts` (`tickedRanks`)

**Interfaces:**
- Consumes:
  - `office_shift`, `post_office_receipt` and `close_office_shift` (Task 5).
  - Keyed fee types (Task 1).
- Produces:
  - Route `/ledger/office-receipt`, which shows a day picker and, with `?shift=<id>`, the day itself.
  - `officeReceiptSchema` and `buildOfficePayload(r): Record<string, unknown>`.

- [ ] **Step 1: Write the failing schema test**

```ts
// apps/web/lib/office-receipt/schemas.test.ts
import { describe, expect, it } from "vitest";
import { buildOfficePayload, officeReceiptSchema } from "./schemas";

const base = {
  shiftId: "00000000-0000-0000-0000-000000000001",
  bookletId: "00000000-0000-0000-0000-000000000002",
  orNo: "6320800",
  businessDate: "2026-10-05",
  kind: "fees",
  paymentMode: "cash",
};

describe("officeReceiptSchema / buildOfficePayload", () => {
  it("builds fee lines: keyed amounts as one line, rate lines with quantity", () => {
    const r = officeReceiptSchema.parse({
      ...base,
      lines: JSON.stringify([
        { feeTypeId: "00000000-0000-0000-0000-00000000000a", keyed: true, amount: "1722.00" },
        { feeTypeId: "00000000-0000-0000-0000-00000000000b", keyed: false, rateClass: "hog", quantity: "3" },
      ]),
    });
    expect(buildOfficePayload(r, null)).toMatchObject({
      or_no: 6320800,
      collected_at: "2026-10-05T12:00:00+08:00",
      fee_type_id: "00000000-0000-0000-0000-00000000000a",
      payment_mode: "cash",
      allocations: [],
      lines: [
        { fee_type_id: "00000000-0000-0000-0000-00000000000a", rate_class: "", quantity: 1, amount: "1722.00" },
        { fee_type_id: "00000000-0000-0000-0000-00000000000b", rate_class: "hog", quantity: 3 },
      ],
    });
  });

  it("requires check details for a check", () => {
    const r = officeReceiptSchema.safeParse({ ...base, paymentMode: "check", lines: "[]" });
    expect(r.success).toBe(false);
  });

  it("builds a rent receipt from ticked months", () => {
    const r = officeReceiptSchema.parse({
      ...base, kind: "rent", leaseId: "00000000-0000-0000-0000-000000000003", months: "1,2",
      paymentMode: "check", checkNo: "000123", bank: "LBP", checkDate: "2026-10-05",
    });
    expect(buildOfficePayload(r, "00000000-0000-0000-0000-0000000000ff")).toMatchObject({
      fee_type_id: "00000000-0000-0000-0000-0000000000ff",
      lease_id: "00000000-0000-0000-0000-000000000003",
      allocations: [{ group_rank: 1 }, { group_rank: 2 }],
      lines: [],
      payment_mode: "check",
      check_no: "000123",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ceedo/web vitest run lib/office-receipt/schemas.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Write `schemas.ts`**

```ts
// apps/web/lib/office-receipt/schemas.ts
import { z } from "zod";
import { tickedRanks } from "@/lib/recovery/months";

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

export const dayPickerSchema = z.object({
  collectorId: z.guid("Choose the officer"),
  businessDate: dateOnly,
});

const lineSchema = z.object({
  feeTypeId: z.guid("Choose the fee"),
  keyed: z.boolean(),
  rateClass: z.string().optional(),
  quantity: z.coerce.number().int().positive("Enter the quantity").optional(),
  amount: z.string().optional(),
});

export const officeReceiptSchema = z
  .object({
    shiftId: z.guid(),
    bookletId: z.guid("Choose the booklet"),
    orNo: z.coerce.number().int().positive("Enter the OR number"),
    businessDate: dateOnly,
    kind: z.enum(["rent", "fees"]),
    leaseId: z.preprocess(blankToUndefined, z.guid().optional()),
    months: z.string().optional(),
    // The fee rows, serialised by the form: a variable-length list does not fit FormData's flat keys.
    lines: z.string().optional(),
    payerRef: z.string().trim().optional(),
    paymentMode: z.enum(["cash", "check"]),
    checkNo: z.preprocess(blankToUndefined, z.string().trim().optional()),
    bank: z.preprocess(blankToUndefined, z.string().trim().optional()),
    checkDate: z.preprocess(blankToUndefined, dateOnly.optional()),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMode === "check") {
      for (const key of ["checkNo", "bank", "checkDate"] as const) {
        if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required for a check" });
      }
    }
    if (v.kind === "rent" && !v.leaseId) ctx.addIssue({ code: "custom", path: ["leaseId"], message: "Choose the lease" });
  });

export type OfficeReceipt = z.infer<typeof officeReceiptSchema>;

/** Throws a sentence for the form when the rows are unusable. `rentFeeTypeId` is the lease's rental fee type (rent kind only). */
export function buildOfficePayload(r: OfficeReceipt, rentFeeTypeId: string | null): Record<string, unknown> {
  const check =
    r.paymentMode === "check" ? { check_no: r.checkNo, bank: r.bank, check_date: r.checkDate } : {};
  const common = {
    or_no: r.orNo,
    booklet_id: r.bookletId,
    // Noon Manila keeps the receipt inside its business day.
    collected_at: `${r.businessDate}T12:00:00+08:00`,
    payer_ref: r.payerRef || null,
    payment_mode: r.paymentMode,
    ...check,
  };

  if (r.kind === "rent") {
    const ranks = tickedRanks((r.months ?? "").split(",").filter(Boolean).map(Number));
    return { ...common, fee_type_id: rentFeeTypeId, lease_id: r.leaseId, allocations: ranks.map((group_rank) => ({ group_rank })), lines: [] };
  }

  const rows = z.array(lineSchema).min(1, "Add at least one fee").parse(JSON.parse(r.lines || "[]"));
  const lines = rows.map((l) =>
    l.keyed
      ? { fee_type_id: l.feeTypeId, rate_class: "", quantity: 1, amount: l.amount ?? "" }
      : { fee_type_id: l.feeTypeId, rate_class: l.rateClass ?? "", quantity: l.quantity ?? 0 },
  );
  // An occupancy fee names the lease that paid it; such a receipt allocates to no charge.
  return { ...common, fee_type_id: rows[0].feeTypeId, lease_id: r.leaseId ?? null, allocations: [], lines };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ceedo/web vitest run lib/office-receipt/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the queries and actions**

```ts
// apps/web/lib/office-receipt/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages } from "@/lib/reports/data";

export interface OfficeFee {
  id: string;
  name: string;
  keyed: boolean;
  rateClasses: { rateClass: string; amount: Centavos }[];
}

/** Non-accruing active fees: keyed ones with no rate, and rate ones with the classes priced on `date`. */
export async function getOfficeFees(date: string): Promise<OfficeFee[]> {
  const supabase = await ledgerClient();
  const [fees, rates] = await Promise.all([
    supabase.from("fee_types").select("id, name, amount_mode").eq("accrues", false).eq("active", true).order("name"),
    supabase.from("rates").select("fee_type_id, rate_class, amount").lte("effective_from", date)
      .or(`effective_to.is.null,effective_to.gte.${date}`),
  ]);
  if (fees.error) throw fees.error;
  if (rates.error) throw rates.error;
  return (fees.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    keyed: f.amount_mode === "keyed",
    rateClasses: (rates.data ?? [])
      .filter((r) => r.fee_type_id === f.id)
      .map((r) => ({ rateClass: r.rate_class, amount: fromPesos(Number(r.amount)) })),
  }));
}

/** Every active lease, "stall · section · tenant": the office takes payments for any of them. */
export async function getAllActiveLeases(): Promise<{ id: string; label: string }[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((from, to) =>
    supabase.from("leases")
      .select("id, stalls(stall_no, sections(name, facilities(name))), tenants(full_name)")
      .eq("status", "active")
      .range(from, to),
  );
  return rows
    .map((l) => ({
      id: l.id,
      label: [l.stalls?.sections?.facilities?.name, l.stalls?.sections?.name, l.stalls?.stall_no, l.tenants?.full_name]
        .map((p) => p ?? "—").join(" · "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getOfficers(): Promise<{ id: string; name: string }[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("app_users").select("id, full_name")
    .eq("role", "collector").eq("status", "active").order("full_name");
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, name: u.full_name }));
}

export interface OfficeShift {
  id: string;
  collectorId: string;
  collectorName: string;
  businessDate: string;
  status: string;
  declaredTotal: Centavos | null;
  variance: Centavos | null;
  receipts: { id: string; orNo: number; payer: string; mode: string; amount: Centavos }[];
}

export async function getOfficeShift(shiftId: string): Promise<OfficeShift | null> {
  const supabase = await ledgerClient();
  const { data: s, error } = await supabase.from("shifts")
    .select("id, kind, collector_id, business_date, status, declared_total, variance, collector:app_users!shifts_collector_id_fkey(full_name)")
    .eq("id", shiftId).maybeSingle();
  if (error) throw error;
  if (!s || s.kind !== "office") return null;
  const { data: rows, error: rowsError } = await supabase.from("collections")
    .select("id, or_no, payer_ref, payment_mode, gross_amount, leases(tenants(full_name))")
    .eq("shift_id", shiftId).order("or_no");
  if (rowsError) throw rowsError;
  return {
    id: s.id,
    collectorId: s.collector_id,
    collectorName: s.collector?.full_name ?? "—",
    businessDate: s.business_date,
    status: s.status,
    declaredTotal: s.declared_total === null ? null : fromPesos(Number(s.declared_total)),
    variance: s.variance === null ? null : fromPesos(Number(s.variance)),
    receipts: (rows ?? []).map((r) => ({
      id: r.id,
      orNo: r.or_no,
      payer: r.leases?.tenants?.full_name ?? r.payer_ref ?? "Walk-in",
      mode: r.payment_mode,
      amount: fromPesos(Number(r.gross_amount)),
    })),
  };
}
```

```ts
// apps/web/lib/office-receipt/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import type { Database } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { getLeaseFeeType, getUnpaidGroups } from "@/lib/recovery/queries";
import type { UnpaidGroup } from "@/lib/recovery/months";
import { pesosField } from "@/lib/recovery/schemas";
import { requireStaff } from "@/lib/supabase/session";
import { z } from "zod";
import { buildOfficePayload, dayPickerSchema, officeReceiptSchema } from "./schemas";

type Payload = Database["ceedo_collections"]["Functions"]["post_office_receipt"]["Args"]["p_receipt"];

function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}
async function gate(): Promise<SaveResult | null> {
  const staff = await requireStaff();
  return staff.role === "supervisor" || staff.role === "admin"
    ? null
    : failure("Only a supervisor or administrator may post office receipts.");
}
function refresh() {
  revalidatePath("/ledger/office-receipt");
  revalidatePath("/ledger/shifts");
  revalidatePath("/ledger/collections");
}

export async function openOfficeDay(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = dayPickerSchema.safeParse({ collectorId: formData.get("collectorId"), businessDate: formData.get("businessDate") });
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("office_shift", {
    p_collector_id: parsed.data.collectorId, p_business_date: parsed.data.businessDate,
  });
  if (error) return failure(error.message);
  return { ok: true, id: data };
}

export async function postOfficeReceipt(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = officeReceiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;

  let payload: Record<string, unknown>;
  try {
    const rentFee = r.kind === "rent" && r.leaseId ? await getLeaseFeeType(r.leaseId) : null;
    payload = buildOfficePayload(r, rentFee);
  } catch (e) {
    return { ok: false, fieldErrors: { lines: (e as Error).message } };
  }

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("post_office_receipt", {
    p_shift_id: r.shiftId, p_receipt: payload as unknown as Payload,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id: data };
}

export async function closeOfficeDay(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = z.object({ shiftId: z.guid(), declaredTotal: pesosField("Enter the cash and checks handed over") })
    .safeParse({ shiftId: formData.get("shiftId"), declaredTotal: formData.get("declaredTotal") });
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("close_office_shift", {
    p_shift_id: parsed.data.shiftId, p_declared_total: parsed.data.declaredTotal,
  });
  if (error) return failure(error.message);
  refresh();
  revalidatePath("/ledger/remittances");
  return { ok: true, id: parsed.data.shiftId };
}

export async function officeUnpaidGroups(leaseId: string): Promise<UnpaidGroup[]> {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") throw new Error("Not allowed");
  return getUnpaidGroups(leaseId);
}
```

- [ ] **Step 6: Write the page and components**

```tsx
// apps/web/app/(admin)/ledger/office-receipt/page.tsx
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ScreenHeader } from "@/components/shell/screen-header";
import { CloseSummary } from "@/components/recovery/close-summary";
import { DayPicker } from "@/components/office-receipt/day-picker";
import { OfficeCloseForm } from "@/components/office-receipt/close-form";
import { OfficeReceiptForm } from "@/components/office-receipt/receipt-form";
import { Money } from "@/components/ledger/money";
import { fromCentavos } from "@ceedo/shared";
import { getAllActiveLeases, getOfficeFees, getOfficers, getOfficeShift } from "@/lib/office-receipt/queries";
import { getHeldBooklets } from "@/lib/recovery/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Office receipts: ORs issued at the office counter, cash or check (spec "Screens"). The
 * officer holding the booklet has no web login, so a supervisor posts on their behalf into
 * the officer's office shift for the day, then closes it with the cash and checks handed over.
 */
export default async function OfficeReceiptPage({ searchParams }: { searchParams: Promise<{ shift?: string }> }) {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") redirect("/");
  const { shift: shiftId } = await searchParams;

  if (!shiftId) {
    return (
      <div>
        <ScreenHeader
          title="Office receipt"
          note="Choose the officer who issued the receipts and the day. Each receipt is checked exactly as a tablet receipt is — the booklet, the serial, the oldest unpaid months first — and may be paid in cash or by check."
        />
        <DayPicker officers={await getOfficers()} today={manilaToday()} />
      </div>
    );
  }
  if (!z.guid().safeParse(shiftId).success) notFound();
  const shift = await getOfficeShift(shiftId);
  if (!shift) notFound();

  const [booklets, leases, fees] = await Promise.all([
    getHeldBooklets(shift.collectorId, shift.businessDate),
    getAllActiveLeases(),
    getOfficeFees(shift.businessDate),
  ]);
  const total = shift.receipts.reduce((a, r) => a + r.amount, 0);

  return (
    <div>
      <ScreenHeader title="Office receipt" note={`${shift.collectorName} · office · ${shift.businessDate}`} />
      <table className="mb-6 w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr><th className="py-2">OR</th><th>Payer</th><th>Paid by</th><th className="text-right">Amount</th></tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {shift.receipts.map((r) => (
            <tr key={r.id}>
              <td className="py-2 tabular-nums">{r.orNo}</td><td>{r.payer}</td><td>{r.mode}</td>
              <td className="text-right"><Money amount={fromCentavos(r.amount)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-semibold"><td colSpan={3} className="py-2">Total</td>
          <td className="text-right"><Money amount={fromCentavos(total)} /></td></tr></tfoot>
      </table>
      {shift.status === "open" ? (
        <>
          <OfficeReceiptForm shift={shift} booklets={booklets} leases={leases} fees={fees} />
          <OfficeCloseForm shiftId={shift.id} total={total} />
        </>
      ) : shift.variance !== null && shift.declaredTotal !== null ? (
        <CloseSummary declaredTotal={shift.declaredTotal} variance={shift.variance} />
      ) : null}
    </div>
  );
}
```

Check `CloseSummary`'s and `Money`'s prop types against their files. `Money` takes `fromCentavos(...)`, as on the Remittances page. Pass what each expects.

`day-picker.tsx` is a client form with an officer `NativeSelect` and a date `TextInput` (`max={today}`). On submit, `useSubmit` calls `openOfficeDay`, then on `ok` calls `router.push(\`/ledger/office-receipt?shift=${outcome.id}\`)`. Model its markup on `components/recovery/shift-picker.tsx`, without the tablet field.

`close-form.tsx` is a client form with hidden `shiftId` and a `declaredTotal` money input that defaults to `(total / 100).toFixed(2)`. Its submit button reads "Close the day". It calls `closeOfficeDay`, then `router.refresh()`. Model it on `components/recovery/close-form.tsx`, without the "data was lost" confirmation.

`receipt-form.tsx` is a client component:

```tsx
// apps/web/components/office-receipt/receipt-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { useSubmit } from "@/components/ui/use-submit";
import { officeUnpaidGroups, postOfficeReceipt } from "@/lib/office-receipt/actions";
import type { OfficeFee, OfficeShift } from "@/lib/office-receipt/queries";
import type { UnpaidGroup } from "@/lib/recovery/months";
import type { HeldBooklet } from "@/lib/recovery/queries";
import { pesos } from "@/lib/reports/report";
import type { SaveResult } from "@/lib/admin/save-result";

type Line = { feeTypeId: string; keyed: boolean; rateClass: string; quantity: string; amount: string };
const emptyLine: Line = { feeTypeId: "", keyed: false, rateClass: "", quantity: "1", amount: "" };

export function OfficeReceiptForm({
  shift, booklets, leases, fees,
}: { shift: OfficeShift; booklets: HeldBooklet[]; leases: { id: string; label: string }[]; fees: OfficeFee[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"rent" | "fees">("rent");
  const [leaseId, setLeaseId] = useState("");
  const [groups, setGroups] = useState<UnpaidGroup[]>([]);
  const [ticked, setTicked] = useState(0); // the oldest N groups
  const [lines, setLines] = useState<Line[]>([emptyLine]);
  const [mode, setMode] = useState<"cash" | "check">("cash");
  const [result, setResult] = useState<SaveResult | null>(null);

  async function chooseLease(id: string) {
    setLeaseId(id);
    setTicked(0);
    setGroups(id && kind === "rent" ? await officeUnpaidGroups(id) : []);
  }

  const lineTotal = (l: Line) => {
    if (l.keyed) return Math.round(Number(l.amount || 0) * 100);
    const fee = fees.find((f) => f.id === l.feeTypeId);
    const rate = fee?.rateClasses.find((r) => r.rateClass === l.rateClass);
    return (rate?.amount ?? 0) * Number(l.quantity || 0);
  };
  const total = kind === "rent"
    ? groups.slice(0, ticked).reduce((a, g) => a + g.outstanding, 0)
    : lines.reduce((a, l) => a + lineTotal(l), 0);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    formData.set("kind", kind);
    formData.set("months", Array.from({ length: ticked }, (_, i) => i + 1).join(","));
    formData.set("lines", JSON.stringify(lines.map((l) => ({
      feeTypeId: l.feeTypeId, keyed: l.keyed, rateClass: l.rateClass, quantity: l.quantity, amount: l.amount,
    }))));
    const outcome = await postOfficeReceipt(formData);
    setResult(outcome);
    if (outcome.ok) {
      setLines([emptyLine]); setTicked(0); setGroups([]); setLeaseId("");
      router.refresh();
    }
  });
  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <form onSubmit={onSubmit} className="mb-8 rounded-lg border border-rule p-4">
      <h2 className="mb-3 text-sm font-semibold">Add a receipt</h2>
      <input type="hidden" name="shiftId" value={shift.id} />
      <input type="hidden" name="businessDate" value={shift.businessDate} />
      <div className="grid grid-cols-3 gap-x-3">
        <FieldShell id="bookletId" label="Booklet" error={errors.bookletId}>
          <NativeSelect id="bookletId" name="bookletId" defaultValue="">
            <option value="" disabled>{booklets.length ? "Choose…" : "This officer held no booklet that day"}</option>
            {booklets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </NativeSelect>
        </FieldShell>
        <FieldShell id="orNo" label="OR number" error={errors.orNo}>
          <TextInput id="orNo" name="orNo" inputMode="numeric" autoComplete="off" />
        </FieldShell>
        <FieldShell id="kind" label="For">
          <NativeSelect id="kind" value={kind} onChange={(e) => { setKind(e.target.value as "rent" | "fees"); setGroups([]); setTicked(0); }}>
            <option value="rent">Rent (unpaid months)</option>
            <option value="fees">Fees (electricity, occupancy, certification…)</option>
          </NativeSelect>
        </FieldShell>
      </div>

      <FieldShell id="leaseId" label={kind === "rent" ? "Lease" : "Lease (occupancy fee only)"} error={errors.leaseId}>
        <NativeSelect id="leaseId" name="leaseId" value={leaseId} onChange={(e) => chooseLease(e.target.value)}>
          <option value="">{kind === "rent" ? "Choose…" : "None"}</option>
          {leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </NativeSelect>
      </FieldShell>

      {kind === "rent" ? (
        <FieldShell id="months" label="Months paid" error={errors.months} help="Oldest first; tick through the last month paid.">
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {groups.map((g, i) => (
              <li key={g.groupRank}>
                <label className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <input type="checkbox" checked={i < ticked} onChange={() => setTicked(i < ticked ? i : i + 1)} />
                  <span className="flex-1">{g.periodStart} – {g.periodEnd}</span>
                  <span className="tabular-nums">{pesos(g.outstanding)}</span>
                </label>
              </li>
            ))}
          </ul>
        </FieldShell>
      ) : (
        <FieldShell id="lines" label="Fees" error={errors.lines}>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const fee = fees.find((f) => f.id === l.feeTypeId);
              const set = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="flex gap-2">
                  <NativeSelect value={l.feeTypeId} onChange={(e) => {
                    const f = fees.find((x) => x.id === e.target.value);
                    set({ feeTypeId: e.target.value, keyed: f?.keyed ?? false, rateClass: f?.rateClasses[0]?.rateClass ?? "" });
                  }}>
                    <option value="" disabled>Choose a fee…</option>
                    {fees.map((f) => (
                      <option key={f.id} value={f.id} disabled={!f.keyed && f.rateClasses.length === 0}>
                        {f.name}{!f.keyed && f.rateClasses.length === 0 ? " (no rate in effect)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  {l.keyed ? (
                    <TextInput type="number" step="0.01" min="0.01" placeholder="Amount" className="w-32"
                      value={l.amount} onChange={(e) => set({ amount: e.target.value })} />
                  ) : (
                    <>
                      {fee && fee.rateClasses.length > 1 ? (
                        <NativeSelect value={l.rateClass} onChange={(e) => set({ rateClass: e.target.value })}>
                          {fee.rateClasses.map((r) => <option key={r.rateClass} value={r.rateClass}>{r.rateClass || "standard"}</option>)}
                        </NativeSelect>
                      ) : null}
                      <TextInput type="number" min="1" step="1" className="w-20" value={l.quantity}
                        onChange={(e) => set({ quantity: e.target.value })} />
                    </>
                  )}
                  <span className="w-28 self-center text-right tabular-nums">{pesos(lineTotal(l))}</span>
                </div>
              );
            })}
            <button type="button" className="text-xs underline" onClick={() => setLines([...lines, emptyLine])}>
              Add a fee line
            </button>
          </div>
        </FieldShell>
      )}

      <div className="grid grid-cols-4 gap-x-3">
        <FieldShell id="payerRef" label="Payer (if not a tenant)">
          <TextInput id="payerRef" name="payerRef" autoComplete="off" />
        </FieldShell>
        <FieldShell id="paymentMode" label="Paid by">
          <NativeSelect id="paymentMode" name="paymentMode" value={mode} onChange={(e) => setMode(e.target.value as "cash" | "check")}>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </NativeSelect>
        </FieldShell>
        {mode === "check" ? (
          <>
            <FieldShell id="checkNo" label="Check no." error={errors.checkNo}><TextInput id="checkNo" name="checkNo" /></FieldShell>
            <FieldShell id="bank" label="Bank" error={errors.bank}><TextInput id="bank" name="bank" /></FieldShell>
            <FieldShell id="checkDate" label="Check date" error={errors.checkDate}>
              <TextInput id="checkDate" name="checkDate" type="date" />
            </FieldShell>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm">Receipt total: <strong className="tabular-nums">{pesos(total)}</strong></span>
        <Button type="submit" variant="primary" loading={busy}>{busy ? "Posting…" : "Post receipt"}</Button>
      </div>
      {result && !result.ok && result.formError ? (
        <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">{result.formError}</p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 7: Build and check by hand**

Run: `pnpm --filter @ceedo/web test && pnpm --filter @ceedo/web build`
Expected: PASS, and the build succeeds.

In the dev app, as a supervisor:
1. Open a day for a collector who holds a booklet.
2. Post a rent receipt by check, and a fees receipt with an ELEC_CPM line of ₱1,722 plus an ELEC_SUR_CPM line of ₱30.
3. Close the day.
4. The shift shows on `/ledger/shifts` labelled "Office", and on `/ledger/remittances` as undeposited.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/office-receipt apps/web/app/\(admin\)/ledger/office-receipt apps/web/components/office-receipt
git commit -m "feat(web): office receipt screen, cash or check"
```

---

### Task 11: Cash tickets screen and the shifts flag

**Files:**
- Create: `apps/web/lib/cash-tickets/queries.ts`, `actions.ts`
- Create: `apps/web/app/(admin)/ledger/cash-tickets/page.tsx`
- Create: `apps/web/components/cash-tickets/record-dialog.tsx`, `cash-tickets-table.tsx`
- Modify: `apps/web/lib/ledger/shift-class.ts` (`ShiftRow` gains `cashTicketTotal: number`), `apps/web/lib/ledger/shifts.ts`, `apps/web/components/ledger/shifts-table.tsx`
- Test: `apps/web/lib/ledger/shifts.test.ts` (existing)

**Interfaces:**
- Consumes:
  - `record_cash_ticket_sale` and `cancel_cash_ticket_sale` (Task 6).
  - `cash_ticket_sales` reads.
  - `selectByIds` from `lib/ledger/queries.ts`.
- Produces:
  - Route `/ledger/cash-tickets?date=YYYY-MM-DD`.
  - `needsCashTickets(row: Pick<ShiftRow, "variance" | "cashTicketTotal">): boolean`, exported from `shift-class.ts`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/ledger/shifts.test.ts`:

```ts
import { needsCashTickets } from "./shift-class";

describe("needsCashTickets", () => {
  it("flags an overage with no cash-ticket entry", () => {
    expect(needsCashTickets({ variance: 300000, cashTicketTotal: 0 })).toBe(true);
  });
  it("does not flag a balanced shift, a short one, or one with tickets entered", () => {
    expect(needsCashTickets({ variance: 0, cashTicketTotal: 0 })).toBe(false);
    expect(needsCashTickets({ variance: -100, cashTicketTotal: 0 })).toBe(false);
    expect(needsCashTickets({ variance: 300000, cashTicketTotal: 150000 })).toBe(false);
    expect(needsCashTickets({ variance: null, cashTicketTotal: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ceedo/web vitest run lib/ledger/shifts.test.ts`
Expected: FAIL. `needsCashTickets` is not exported.

- [ ] **Step 3: Implement the flag**

In `shift-class.ts`:
- Add `cashTicketTotal: number;` (centavos) to `ShiftRow`.
- Add:

```ts
/**
 * A shift whose declared cash exceeds its receipts and has no cash-ticket entry: usually the
 * comfort-room or other ticket money, which the office has not entered yet (spec
 * "cash_ticket_sales"). A flag to look, not an error.
 */
export function needsCashTickets(row: { variance: number | null; cashTicketTotal: number }): boolean {
  return row.variance !== null && row.variance > 0 && row.cashTicketTotal === 0;
}
```

In `shifts.ts` `getShifts`, fetch the live tickets for the listed shifts and sum them per shift:

```ts
  const tickets = await selectByIds(shiftIds, (chunk) =>
    supabase.from("cash_ticket_sales").select("shift_id, amount").in("shift_id", chunk).is("cancelled_at", null),
  );
  const ticketTotal = new Map<string, number>();
  for (const t of tickets) ticketTotal.set(t.shift_id, (ticketTotal.get(t.shift_id) ?? 0) + fromPesos(Number(t.amount)));
```

- Import `selectByIds` from `./queries`.
- Set `cashTicketTotal: ticketTotal.get(row.id) ?? 0` on each row.

In `components/ledger/shifts-table.tsx`, next to the variance cell, render this when `needsCashTickets(row)`:

```tsx
<Link href={`/ledger/cash-tickets?date=${row.businessDate}`} className="ml-2 text-xs text-warn underline">
  Over, no cash tickets
</Link>
```

Use whichever warn tone class the table already uses; check its status marks.

- [ ] **Step 4: Write the cash-ticket reads, actions, page and dialog**

```ts
// apps/web/lib/cash-tickets/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "@/lib/ledger/queries";

export interface TicketShift { id: string; label: string }
export interface TicketRow {
  id: string; collector: string; fee: string; amount: Centavos; serials: string | null;
  note: string | null; cancelled: boolean; cancelReason: string | null; shiftStatus: string;
}

/** The day's shifts (any kind) a ticket can still be entered against: not remitted. */
export async function shiftsOn(date: string): Promise<TicketShift[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("shifts")
    .select("id, kind, status, collector:app_users!shifts_collector_id_fkey(full_name), device:devices!shifts_device_id_fkey(label)")
    .eq("business_date", date).neq("status", "remitted");
  if (error) throw error;
  return (data ?? [])
    .map((s) => ({ id: s.id, label: `${s.collector?.full_name ?? "—"} · ${s.kind === "office" ? "Office" : s.device?.label ?? "—"} · ${s.status}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function ticketFees(): Promise<{ id: string; name: string }[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("fee_types").select("id, name")
    .eq("active", true).eq("accrues", false).eq("amount_mode", "keyed").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function ticketsOn(date: string): Promise<TicketRow[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.from("cash_ticket_sales")
    .select("id, amount, ticket_from, ticket_to, note, cancelled_at, cancel_reason, fee_types(name), collector:app_users!cash_ticket_sales_collector_id_fkey(full_name), shifts(status)")
    .eq("business_date", date).order("entered_at");
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    collector: t.collector?.full_name ?? "—",
    fee: t.fee_types?.name ?? "—",
    amount: fromPesos(Number(t.amount)),
    serials: t.ticket_from === null ? null : `${t.ticket_from}–${t.ticket_to}`,
    note: t.note,
    cancelled: t.cancelled_at !== null,
    cancelReason: t.cancel_reason,
    shiftStatus: t.shifts?.status ?? "—",
  }));
}
```

```ts
// apps/web/lib/cash-tickets/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const failure = (message: string): SaveResult => ({ ok: false, fieldErrors: {}, formError: message });
const optionalInt = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().positive().optional());

const recordSchema = z.object({
  shiftId: z.guid("Choose the collector's shift"),
  feeTypeId: z.guid("Choose the ticket"),
  amount: z.coerce.number().positive("The amount must be more than zero"),
  ticketFrom: optionalInt,
  ticketTo: optionalInt,
  note: z.string().trim().optional(),
});

async function gate() {
  const staff = await requireStaff();
  return ["supervisor", "accounting", "admin"].includes(staff.role) ? null : failure("Not allowed.");
}

export async function recordCashTickets(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = recordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("record_cash_ticket_sale", {
    p_shift_id: r.shiftId, p_fee_type_id: r.feeTypeId, p_amount: r.amount,
    p_ticket_from: r.ticketFrom ?? null, p_ticket_to: r.ticketTo ?? null, p_note: r.note ?? null,
  });
  if (error) return failure(error.message);
  revalidatePath("/ledger/cash-tickets");
  revalidatePath("/ledger/shifts");
  return { ok: true, id: data };
}

export async function cancelCashTickets(id: string, reason: string): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("cancel_cash_ticket_sale", { p_sale_id: id, p_reason: reason });
  if (error) return failure(error.message);
  revalidatePath("/ledger/cash-tickets");
  revalidatePath("/ledger/shifts");
  return { ok: true, id };
}
```

If the generated RPC argument types reject `null` for the optional integers, pass `undefined` instead.

```tsx
// apps/web/app/(admin)/ledger/cash-tickets/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CashTicketsTable } from "@/components/cash-tickets/cash-tickets-table";
import { RecordCashTicketsDialog } from "@/components/cash-tickets/record-dialog";
import { shiftsOn, ticketFees, ticketsOn } from "@/lib/cash-tickets/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Cash tickets (spec "cash_ticket_sales"): comfort-room and similar tickets, sold for cash
 * the collector remits but on no OR. Entered per collector per day against their shift; the
 * shift's total and variance follow. Cancelling needs a reason; nothing is deleted.
 */
export default async function CashTicketsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireStaff();
  const { date: raw } = await searchParams;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : manilaToday();
  const [shifts, fees, rows] = await Promise.all([shiftsOn(date), ticketFees(), ticketsOn(date)]);
  return (
    <div>
      <ScreenHeader
        title="Cash tickets"
        note="Ticket money the collector hands over with their ORs. Enter it against the collector's shift for the day, before the shift is remitted."
        actions={<RecordCashTicketsDialog shifts={shifts} fees={fees} />}
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Day
          <TextInput type="date" name="date" defaultValue={date} className="mt-1 w-44" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <CashTicketsTable rows={rows} />
    </div>
  );
}
```

Build `record-dialog.tsx` on the pattern of `components/remittances/record-dialog.tsx`. Its fields, in order:
- shift (`NativeSelect` over `shifts`, `name="shiftId"`);
- ticket (`name="feeTypeId"`, over `fees`);
- amount (number, step 0.01);
- first and last ticket serial (optional numbers `ticketFrom` and `ticketTo`);
- note.

It calls `recordCashTickets`.

Build `cash-tickets-table.tsx` to list the rows, showing collector, ticket, serials, amount, note, and "cancelled — reason" when cancelled. Each live row whose `shiftStatus` is not `remitted` gets a Cancel button. The button opens a small dialog with a required reason textarea, which calls `cancelCashTickets(id, reason)` and then `router.refresh()`. Reuse the cancel-with-reason pattern in `components/remittances/row-actions.tsx`.

- [ ] **Step 5: Test, build and check by hand**

Run: `pnpm --filter @ceedo/web test && pnpm --filter @ceedo/web build`
Expected: PASS, and the build succeeds.

In the dev app:
1. Close a test shift over by ₱3,000. `/ledger/shifts` flags it.
2. Enter a ₱3,000 PM CR ticket against it. The flag clears and the variance reads 0.
3. Cancel the ticket with a reason. The overage returns.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/cash-tickets apps/web/app/\(admin\)/ledger/cash-tickets apps/web/components/cash-tickets apps/web/lib/ledger/shift-class.ts apps/web/lib/ledger/shifts.ts apps/web/lib/ledger/shifts.test.ts apps/web/components/ledger/shifts-table.tsx
git commit -m "feat(web): cash-ticket entry and the overage flag on shifts"
```

---

### Task 12: Full verification and production bundles

**Files:** none new. This task verifies and prepares the deploy.

- [ ] **Step 1: Run the full suite from a clean database**

Run: `supabase db reset && set -a; eval "$(supabase status -o env)"; set +a; pnpm test && pnpm --filter @ceedo/web build && ./scripts/check-types-current.sh`
Expected:
- All tests pass.
- The build succeeds.
- The types are current.

If a failure is unrelated to this phase, compare it against `main` before calling it pre-existing.

- [ ] **Step 2: Build the production bundles. Do not run them.**

```bash
node scripts/bundle-migrations.mjs --after 20261007000063 --through 20261008000064
node scripts/bundle-migrations.mjs --after 20261008000064 --through 20261008000070
```

These write `dist-sql/ceedo-20261008000064-20261008000064.sql` and `dist-sql/ceedo-20261008000065-20261008000070.sql`.

**Hold back `071`** (the catalogue). The spec says the office reviews the account list first. When they approve it, run:

```bash
node scripts/bundle-migrations.mjs --after 20261008000070
```

- [ ] **Step 3: Hand over to the user**

Report:
1. The bundle paths, in the order they must run.
2. A first step: `select max(version) from ceedo_collections.deployed_migrations;` must return `20261007000063`.
3. The spec deviations (the Global Constraints list).
4. What the office must do before 071 is useful:
   - review the account list in the migration;
   - enter rates for the seeded rate-mode fees;
   - answer the open questions: the Treasurer and RCD placement of the TL_OTHER/RC_OTHER accounts, the 75/25 effective date, and whether CPM should be renamed "City Public Mall".
5. Web deploy is a push to `main` after the user's go-ahead, not before.
