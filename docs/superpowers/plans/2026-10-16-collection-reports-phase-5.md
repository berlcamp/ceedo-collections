# Collection Reports, Phase 5: Monthly Summary, Adjustments and Control Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the office's *Monthly Summary of Collections* (account lines × Jan–Dec for a year) from the system's own receipts. Alongside it:
- accounting's monthly adjustments;
- the cashier's control totals;
- the Monthly tenant payments grid, re-keyed by account line so its blocks agree with the summary.

**Architecture:**
- **Database:**
  - Migration `073` adds `monthly_adjustments` and `monthly_control_totals`. Both are append-only, written only through `security definer` RPCs.
  - Migration `074` adds three `security invoker` reads over `receipt_account_lines`:
    - `monthly_account_totals(from, to)`: account × month sums;
    - `tenant_payment_portions(from, to)`: portions summed per lease or payer, account, portion and day;
    - `lease_home_accounts(from, to)`: the rent account a lease belongs to when it paid nothing.
  - `receipt_account_lines` stays the one source. The new reads only group it.
- **Report framework:** a `year` report parameter.
- **Builders:** pure functions, as in phase 4.
  - `builders/monthly-summary.ts` builds the summary from one `SummaryInput`.
  - `builders/tenant-payments.ts` is rewritten around account blocks.
  - Each is fed by a reader in `lib/reports/`.
- **Screen:** `/ledger/adjustments`, where accounting enters adjustments and control totals. It sits in the Reports module.

**Tech Stack:** Postgres (Supabase local, ports 563xx), Next.js app router (`apps/web`), ExcelJS, zod 4, vitest, `pg` for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`. This plan covers:
- rollout phase 5: report 4, "Monthly summary of collections", plus `monthly_adjustments` and `monthly_control_totals`;
- report 2's re-keying and its Night Market/Tabo payer rows, which phase 4 handed to this phase (phase 4 plan, deviation 7).

Phases 1–4 are merged (`main` at `cc542c5`). The latest migration is `20261014000072`, and production is at 072.

## Global Constraints

- **Schema and access:**
  - All objects live in schema `ceedo_collections`.
  - New views and read functions are `security invoker`.
  - Every write to a ledger-like table goes through a `security definer` RPC. Direct `insert/update/delete` is revoked from `anon, authenticated, service_role`.
- **Roles** (`app_role`): `collector | supervisor | accounting | admin`.
  - Back office (`supervisor`, `accounting`, `admin`) reads everything new.
  - `accounting` and `admin` write adjustments and control totals.
- **Money:**
  - Postgres stores `numeric(14,2)` pesos.
  - TypeScript uses integer centavos (`Centavos`, `fromPesos(Number(v))` from `@ceedo/shared`).
  - Report money cells are centavos; server actions send pesos to RPCs.
- **Dates:**
  - Asia/Manila business dates, written `YYYY-MM-DD`; months are `YYYY-MM` in TypeScript and the first of the month (`date`) in SQL.
  - "This month" in SQL is `date_trunc('month', now() at time zone 'Asia/Manila')::date`.
- **Cutover:** the system starts on **2026-10-01**. The 2026 summary shows October–December only (spec "Out of scope: History before cutover").
- **Migrations:**
  - Files: `supabase/migrations/20261016000073_monthly_adjustments.sql` and `supabase/migrations/20261016000074_monthly_reads.sql`.
  - Apply locally with `supabase migration up`.
  - Then run `pnpm db:types` and commit `packages/shared/src/db.types.ts`. CI runs `scripts/check-types-current.sh`.
  - `db.types.ts` must come from **Supabase CLI 2.117.0**, the version CI pins. Check `supabase --version` before generating.
- **Tests:**
  - Run from the repo root: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <file>`.
  - Run `supabase db reset` before any full-suite run you intend to trust.
  - The DB suite shares one database. Assert on accounts, payers and months your test created (`createAccount`, `uniqueCode`), never on global sums.
- **Before pushing `main`:** run `pnpm --filter @ceedo/web build`. Any type error blocks the push.
- **Production DB:**
  - Changes reach production only as bundles from `node scripts/bundle-migrations.mjs --after 20261014000072`, which the user runs by hand.
  - Check `select max(version) from ceedo_collections.deployed_migrations;` first.
  - Never push, deploy or run SQL against production without the user's go-ahead.
- **PostgREST returns at most 1000 rows.**
  - Page every list read through `allPages` (`apps/web/lib/reports/data.ts`), with an `.order(...)` that makes rows unique, so pages never overlap.
  - Chunk `in (...)` lists through `byIds`.
- **Office spreadsheets and real names never enter the repo.**
  - Test fixtures use fictitious names.
  - Signatory rows are seeded **without** names.

### Spec deviations (deliberate; state them in the PR description)

1. **Administrators may also write adjustments and control totals.** The spec says "accounting records them". Every other back-office write (cash tickets, office receipts) lets `admin` act too, and the office has one admin who covers for accounting.
2. **An adjustment is refused when:**
   - it is for a month that has not started;
   - it is on `UNCLASSIFIED` (money is moved off it by a rule, not adjusted);
   - it is on an inactive account.

   Adjustments that already exist on a later-deactivated account still show, as the spec requires.
3. **"†" marks the account line, not a single cell.**
   - A report cell is a number in both renderers, so the mark goes after the account's name.
   - The notes list each adjustment by account, month, amount and note.
   - Only adjustments in months the summary shows (ended, on or after cutover) are added, marked and listed. An adjustment to the current month appears once that month ends.
4. **Income accounts with no facility** (rental and electricity surcharges, and `UNCLASSIFIED`) form one block headed "All facilities". It sits where its first account falls in the chart's sort order. `UNCLASSIFIED` is shown only when it holds money.
5. **The summary-by-facility block groups by the account's facility.** That gives one row per income block, then one "Non-Income" row. It is computed from the same rows as the main table, so it always adds up to the Grand total.
6. **Three aggregate reads in SQL** (`monthly_account_totals`, `tenant_payment_portions`, `lease_home_accounts`). They are group-bys over `receipt_account_lines`, not a second classifier.
   - A year of portions is about 140,000 rows: too many to page through PostgREST.
   - `lease_home_accounts` re-applies the rule order (section > facility > fee type) for leases that paid nothing. Without it, such a lease has no block to sit in.
7. **Tenant payments:**
   - A lease appears in **every** account block it paid into that month, and always in its home block.
   - Its surcharges sit only on its home-block row, so they are counted once.
   - This keeps each block's day columns equal to that account's line in the monthly summary.
8. **Night Market and Tabo payer rows** come from the accounts `NM-FEE` and `TABO-FEE` (`PAYER_ACCOUNT_CODES` in the reader). A payer with no name is shown as "(no name)".
9. **`/ledger/adjustments` is a tab of the Reports module**, beside the reports it feeds, not of Collections.
10. **The monthly summary's signatories** are two new `report_signatories` rows (`monthly-summary`: Prepared by, Noted by), seeded without names.

## Review Focus

1. **An adjustment entered for the current month.** The month's column is blank because it has not ended. The adjustment must not be added, marked "†" or listed in the notes until the month ends. Otherwise a note would point at a blank cell. (Task 4 test.)
2. **An inactive account with money, or one with nothing.** One that holds money (receipts or an adjustment) in the year must still have its line, or the Grand total would exceed the sum of the lines. One with nothing is hidden. (Task 4 test.)
3. **A lease that paid rent and an occupancy fee in the same month.** It must appear in both blocks, with its surcharge on the rent (home) row only. Each block's day total must equal that account's portions. (Task 6 test.)
4. **A receipt cancelled after being counted, or an adjustment cancelled.** Neither may reach any figure. The receipt is checked in the SQL aggregate (Task 2 test); the adjustment is read live-only (Task 5 reads test), and its cancellation keeps the row (Task 1 test).
5. **A control total re-entered for the same month.** The latest entry is in force. The earlier one stays on record and never reaches the report. (Task 4 test of `latestControls`; Task 1 test that both rows are kept.)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261016000073_monthly_adjustments.sql` | `monthly_adjustments`, `monthly_control_totals`, their RPCs, the `monthly-summary` signatory rows |
| `supabase/migrations/20261016000074_monthly_reads.sql` | `monthly_account_totals`, `tenant_payment_portions`, `lease_home_accounts` |
| `tests/db/monthly-adjustments.test.ts` | Task 1 |
| `tests/db/monthly-reads.test.ts` | Task 2 |
| `tests/db/monthly-summary-reads.test.ts` | Task 5 and Task 7: the readers' select strings against the live schema |
| `packages/shared/src/db.types.ts` | regenerated (Tasks 1, 2) |
| `apps/web/lib/reports/params.ts` (+ `params.test.ts`) | `ReportParams.year`, `yearBounds` |
| `apps/web/lib/reports/open-exceptions.ts` (+ test) | scopes `year` reports |
| `apps/web/lib/reports/catalog.ts` | `ParamKind` `year`; `monthly-summary` entry; `tenant-payments` build |
| `apps/web/app/(admin)/reports/page.tsx` | the hub's Year input |
| `apps/web/lib/reports/builders/monthly-summary.ts` (+ test) | the summary, by facility, control; `latestControls`, `CUTOVER_MONTH` |
| `apps/web/lib/reports/summary-data.ts` | `monthlySummaryData(year)` |
| `apps/web/lib/reports/builders/tenant-payments.ts` (+ test) | rewritten: account blocks, payer rows |
| `apps/web/lib/reports/data.ts` | `tenantPaymentData` rewritten; `PAYER_ACCOUNT_CODES` |
| `apps/web/lib/adjustments/queries.ts`, `apps/web/lib/adjustments/actions.ts` | the screen's reads and server actions |
| `apps/web/components/adjustments/*.tsx` | tables and dialogs |
| `apps/web/app/(admin)/ledger/adjustments/page.tsx` | the screen |
| `apps/web/lib/nav/modules.ts` | "Adjustments" tab in the Reports module |

---

### Task 1: Migration 073: adjustments and control totals

**Files:**
- Create: `supabase/migrations/20261016000073_monthly_adjustments.sql`
- Create: `tests/db/monthly-adjustments.test.ts`
- Modify: `packages/shared/src/db.types.ts` (regenerated)

**Interfaces:**
- Produces:
  - Table `monthly_adjustments (id, account_id, month date, amount numeric(14,2), note, entered_by, entered_at, cancelled_at, cancelled_by, cancel_reason, row_version)`. FKs to `app_users`: `monthly_adjustments_entered_by_fkey`, `monthly_adjustments_cancelled_by_fkey`.
  - Table `monthly_control_totals (id, month date, amount numeric(14,2), note, entered_by, entered_at)`. FK `monthly_control_totals_entered_by_fkey`.
  - `record_monthly_adjustment(p_account_id uuid, p_month date, p_amount numeric, p_note text) returns uuid`.
  - `cancel_monthly_adjustment(p_adjustment_id uuid, p_reason text) returns void`.
  - `record_monthly_control_total(p_month date, p_amount numeric, p_note text) returns uuid`.
  - `report_signatories` rows `('monthly-summary', 'Prepared by', 10)` and `('monthly-summary', 'Noted by', 20)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/monthly-adjustments.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, uniqueCode, type TestClient } from "../helpers/supabase";
import { accountId, createAccount } from "../helpers/accounts";

let db: Client;
let accounting: TestClient;
let admin: TestClient;
let supervisor: TestClient;
let collector: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: accounting } = await createAppUser({ email: "adj-accounting", role: "accounting" }));
  ({ client: admin } = await createAppUser({ email: "adj-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "adj-supervisor", role: "supervisor" }));
  ({ client: collector } = await createAppUser({ email: "adj-collector", role: "collector" }));
});
afterAll(async () => db.end());

const record = (c: TestClient, account: string, month: string, amount: number, note = "Over-deposit returned") =>
  c.rpc("record_monthly_adjustment", { p_account_id: account, p_month: month, p_amount: amount, p_note: note });

const control = (c: TestClient, month: string, amount: number, note: string) =>
  c.rpc("record_monthly_control_total", { p_month: month, p_amount: amount, p_note: note });

describe("record_monthly_adjustment", () => {
  it("records a negative adjustment for accounting, filed under the first of the month", async () => {
    const account = await createAccount(db);
    const { data, error } = await record(accounting, account, "2026-10-17", -250.5);
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select month::text, amount::text, note, cancelled_at from ceedo_collections.monthly_adjustments where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({ month: "2026-10-01", amount: "-250.50", note: "Over-deposit returned", cancelled_at: null });
  });

  it("lets an administrator record, and refuses a supervisor and a collector", async () => {
    const account = await createAccount(db);
    expect((await record(admin, account, "2026-10-01", 10)).error).toBeNull();
    expect((await record(supervisor, account, "2026-10-01", 10)).error?.message).toMatch(/accounting/);
    expect((await record(collector, account, "2026-10-01", 10)).error).not.toBeNull();
  });

  it("refuses a zero amount, an empty note, and a month that has not started", async () => {
    const account = await createAccount(db);
    expect((await record(accounting, account, "2026-10-01", 0)).error?.message).toMatch(/zero/);
    expect((await record(accounting, account, "2026-10-01", 5, "  ")).error?.message).toMatch(/note/);
    expect((await record(accounting, account, "2999-01-01", 5)).error?.message).toMatch(/not started/);
  });

  it("refuses UNCLASSIFIED and an inactive account", async () => {
    const unc = await accountId(db, "UNCLASSIFIED");
    expect((await record(accounting, unc, "2026-10-01", 5)).error?.message).toMatch(/Unclassified/);
    const old = await createAccount(db);
    await db.query(`update ceedo_collections.collection_accounts set active = false where id = $1`, [old]);
    expect((await record(accounting, old, "2026-10-01", 5)).error?.message).toMatch(/inactive/);
  });
});

describe("cancel_monthly_adjustment", () => {
  it("needs a reason, keeps the row marked cancelled, and refuses a second cancel", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 75);
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: " " })).error?.message)
      .toMatch(/reason/);
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "Wrong month" })).error)
      .toBeNull();
    const { rows } = await db.query(
      `select cancel_reason, cancelled_at is not null as cancelled from ceedo_collections.monthly_adjustments where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ cancel_reason: "Wrong month", cancelled: true });
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "again" })).error?.message)
      .toMatch(/already cancelled/);
  });

  it("refuses a supervisor", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 75);
    expect((await supervisor.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "x" })).error)
      .not.toBeNull();
  });
});

describe("record_monthly_control_total", () => {
  it("records for accounting, and keeps every entry: a correction is a new row", async () => {
    const note = uniqueCode("CASHIER");
    expect((await control(accounting, "2026-10-09", 1000, note)).error).toBeNull();
    expect((await control(accounting, "2026-10-01", 1200, note)).error).toBeNull();
    const { rows } = await db.query(
      `select month::text, amount::text from ceedo_collections.monthly_control_totals where note = $1 order by entered_at`,
      [note],
    );
    expect(rows).toEqual([{ month: "2026-10-01", amount: "1000.00" }, { month: "2026-10-01", amount: "1200.00" }]);
  });

  it("refuses a negative figure, a month not started, and a supervisor", async () => {
    expect((await control(accounting, "2026-10-01", -1, "x")).error?.message).toMatch(/negative/);
    expect((await control(accounting, "2999-01-01", 1, "x")).error?.message).toMatch(/not started/);
    expect((await control(supervisor, "2026-10-01", 1, "x")).error).not.toBeNull();
  });
});

describe("access", () => {
  it("lets a supervisor read, and shows a collector nothing", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 33);
    const seen = await supervisor.from("monthly_adjustments").select("id").eq("id", id!);
    expect(seen.data).toEqual([{ id }]);
    const hidden = await collector.from("monthly_adjustments").select("id").eq("id", id!);
    expect(hidden.data ?? []).toEqual([]);
  });

  it("refuses direct writes, even from an administrator", async () => {
    expect((await admin.from("monthly_adjustments").insert({} as never)).error?.code).toBe("42501");
    expect((await admin.from("monthly_control_totals").insert({} as never)).error?.code).toBe("42501");
  });

  it("seeds the monthly summary's signatories without names", async () => {
    const { rows } = await db.query(
      `select label, name from ceedo_collections.report_signatories where report_key = 'monthly-summary' order by sort_order`,
    );
    expect(rows).toEqual([{ label: "Prepared by", name: null }, { label: "Noted by", name: null }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-adjustments.test.ts`
Expected: FAIL. TypeScript accepts the unknown RPC names (the RPC typings are loose until regeneration), and at runtime PostgREST answers `Could not find the function ceedo_collections.record_monthly_adjustment`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261016000073_monthly_adjustments.sql
-- Collection reports phase 5 (spec "monthly_adjustments", "monthly_control_totals").
--   * monthly_adjustments: lines no receipt produces (withholding tax, disapproved leave,
--     prior-period adjustments, over-deposit), entered by accounting per account and month.
--     Append-only: a mistake is cancelled with a reason, never deleted or edited.
--   * monthly_control_totals: the cashier's figure for a month. Every entry is kept; the
--     latest per month is the one in force.
--   * report_signatories rows for the monthly summary, seeded without names.

create table ceedo_collections.monthly_adjustments (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references ceedo_collections.collection_accounts (id),
  month         date not null check (month = date_trunc('month', month)::date),
  amount        numeric(14,2) not null check (amount <> 0),
  note          text not null check (length(trim(note)) > 0),
  entered_by    uuid not null references ceedo_collections.app_users (id),
  entered_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references ceedo_collections.app_users (id),
  cancel_reason text,
  row_version   bigint not null default 0,
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0)
);

create index monthly_adjustments_month_idx on ceedo_collections.monthly_adjustments (month);

create trigger monthly_adjustments_row_version
  before insert or update on ceedo_collections.monthly_adjustments
  for each row execute function ceedo_collections.bump_row_version();
select ceedo_collections.attach_audit('monthly_adjustments');

create table ceedo_collections.monthly_control_totals (
  id         uuid primary key default gen_random_uuid(),
  month      date not null check (month = date_trunc('month', month)::date),
  amount     numeric(14,2) not null check (amount >= 0),
  note       text,
  entered_by uuid not null references ceedo_collections.app_users (id),
  entered_at timestamptz not null default now()
);

create index monthly_control_totals_month_idx on ceedo_collections.monthly_control_totals (month, entered_at);
select ceedo_collections.attach_audit('monthly_control_totals');

alter table ceedo_collections.monthly_adjustments enable row level security;
alter table ceedo_collections.monthly_control_totals enable row level security;
create policy monthly_adjustments_read on ceedo_collections.monthly_adjustments
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
create policy monthly_control_totals_read on ceedo_collections.monthly_control_totals
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
revoke insert, update, delete on ceedo_collections.monthly_adjustments from anon, authenticated, service_role;
revoke insert, update, delete on ceedo_collections.monthly_control_totals from anon, authenticated, service_role;
grant select on ceedo_collections.monthly_adjustments, ceedo_collections.monthly_control_totals
  to authenticated, service_role;

-- A month is "started" once its first day has come in Manila.
create or replace function ceedo_collections.assert_month_started(p_month date)
returns date
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_month is null then
    raise exception 'Choose the month';
  end if;
  if v_month > date_trunc('month', now() at time zone 'Asia/Manila')::date then
    raise exception '% has not started yet', to_char(v_month, 'FMMonth YYYY');
  end if;
  return v_month;
end;
$$;
revoke execute on function ceedo_collections.assert_month_started(date) from public;

create or replace function ceedo_collections.record_monthly_adjustment(
  p_account_id uuid,
  p_month      date,
  p_amount     numeric,
  p_note       text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month   date;
  v_account ceedo_collections.collection_accounts;
  v_id      uuid;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may enter monthly adjustments'
      using errcode = 'insufficient_privilege';
  end if;
  v_month := ceedo_collections.assert_month_started(p_month);
  if p_amount is null or p_amount = 0 then
    raise exception 'The amount cannot be zero';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Explain the adjustment in the note';
  end if;

  select * into v_account from ceedo_collections.collection_accounts where id = p_account_id;
  if not found then
    raise exception 'No such account';
  end if;
  if v_account.code = 'UNCLASSIFIED' then
    raise exception 'Adjust a real account, not Unclassified. Money on Unclassified is moved by an account rule';
  end if;
  if not v_account.active then
    raise exception 'That account is inactive; choose an active account';
  end if;

  insert into ceedo_collections.monthly_adjustments (account_id, month, amount, note, entered_by)
  values (p_account_id, v_month, p_amount, trim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function ceedo_collections.cancel_monthly_adjustment(
  p_adjustment_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_row ceedo_collections.monthly_adjustments;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may cancel monthly adjustments'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling an adjustment needs a written reason';
  end if;

  select * into v_row from ceedo_collections.monthly_adjustments where id = p_adjustment_id for update;
  if not found then
    raise exception 'No such adjustment';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'This adjustment is already cancelled';
  end if;

  update ceedo_collections.monthly_adjustments
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_adjustment_id;
end;
$$;

create or replace function ceedo_collections.record_monthly_control_total(
  p_month  date,
  p_amount numeric,
  p_note   text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month date;
  v_id    uuid;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may enter the control total'
      using errcode = 'insufficient_privilege';
  end if;
  v_month := ceedo_collections.assert_month_started(p_month);
  if p_amount is null or p_amount < 0 then
    raise exception 'The control total cannot be negative';
  end if;

  insert into ceedo_collections.monthly_control_totals (month, amount, note, entered_by)
  values (v_month, p_amount, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.record_monthly_adjustment(uuid, date, numeric, text) from public;
revoke execute on function ceedo_collections.cancel_monthly_adjustment(uuid, text) from public;
revoke execute on function ceedo_collections.record_monthly_control_total(date, numeric, text) from public;
grant execute on function ceedo_collections.record_monthly_adjustment(uuid, date, numeric, text) to authenticated;
grant execute on function ceedo_collections.cancel_monthly_adjustment(uuid, text) to authenticated;
grant execute on function ceedo_collections.record_monthly_control_total(date, numeric, text) to authenticated;

insert into ceedo_collections.report_signatories (report_key, label, sort_order) values
  ('monthly-summary', 'Prepared by', 10),
  ('monthly-summary', 'Noted by',    20)
on conflict (report_key, label) do nothing;
```

`clear_all_data` needs no change. The two new tables are data, so the wipe truncates them, which is right. `report_signatories` is already on its keep-list (072).

- [ ] **Step 4: Apply, regenerate types, run the test**

```bash
supabase migration up
supabase --version   # must print 2.117.0
pnpm db:types
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-adjustments.test.ts
```
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000073_monthly_adjustments.sql tests/db/monthly-adjustments.test.ts packages/shared/src/db.types.ts
git commit -m "feat(db): monthly adjustments and control totals (migration 073)"
```

---

### Task 2: Migration 074: the month and tenant-grid reads

**Files:**
- Create: `supabase/migrations/20261016000074_monthly_reads.sql`
- Create: `tests/db/monthly-reads.test.ts`
- Modify: `packages/shared/src/db.types.ts` (regenerated)

**Interfaces:**
- Consumes: `receipt_account_lines(p_from, p_to)` (070); `leases_active_between(p_from, p_to)` (063).
- Produces:
  - `monthly_account_totals(p_from date, p_to date) returns table (month date, account_id uuid, amount numeric(14,2))`. Live portions only, summed per account and month; `month` is the first of the month.
  - `tenant_payment_portions(p_from date, p_to date) returns table (lease_id uuid, payer_ref text, account_id uuid, portion text, business_date date, amount numeric(14,2))`. Live portions summed per (lease, payer, account, portion, day). `payer_ref` is null whenever `lease_id` is set, and blank names are null.
  - `lease_home_accounts(p_from date, p_to date) returns table (lease_id uuid, account_id uuid)`. One row per lease from `leases_active_between`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/monthly-reads.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

async function charge(due: string, amount = "50.00") {
  await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount, surcharge_bps, source)
     values ($1, $2, 'rental', $3::date, $3::date, $3::date, $4, 0, 'manual')`,
    [fx.leaseId, fx.feeTypeId, due, amount],
  );
}

/** A walk-in fee at the fixture's facility, 10.00 per head. */
async function walkInFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode, facility_id)
     values ($1, $1, 'market', 'rate', $2) returning id`,
    [uniqueCode("FT"), facilityId],
  );
  await db.query(
    `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
     values ($1, '', '2026-01-01', 10, 'per_head')`,
    [rows[0].id],
  );
  return rows[0].id as string;
}

describe("monthly_account_totals", () => {
  it("sums each account per month and leaves cancelled receipts out", async () => {
    const acct = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[acct, 10000]] });
    await charge("2026-10-01");
    await charge("2026-10-02");
    await charge("2026-10-03");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-11-03T02:00:00+00:00" });
    const gone = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-11-04T02:00:00+00:00" });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by) values ($1, 'x', $2)`,
      [gone, fx.collectorId],
    );
    const { rows } = await db.query(
      `select month::text, amount::text from ceedo_collections.monthly_account_totals('2026-01-01', '2026-12-31')
        where account_id = $1 order by month`,
      [acct],
    );
    expect(rows).toEqual([{ month: "2026-10-01", amount: "50.00" }, { month: "2026-11-01", amount: "50.00" }]);
  });
});

describe("tenant_payment_portions", () => {
  it("adds up one payer's walk-in lines per account and day", async () => {
    const fee = await walkInFee();
    const nm = await createAccount(db);
    await createRule(db, { feeTypeId: fee, shares: [[nm, 10000]] });
    const payer = uniqueCode("Vendor");
    for (const quantity of [1, 2]) {
      await postCollectionAsOwner(db, fx, {
        leaseId: null, groupRanks: [], feeTypeId: fee, lines: [{ fee_type_id: fee, quantity }],
        payerRef: payer, collectedAt: "2026-10-07T02:00:00+00:00",
      });
    }
    const { rows } = await db.query(
      `select lease_id, payer_ref, portion, business_date::text as d, amount::text
         from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31') where account_id = $1`,
      [nm],
    );
    expect(rows).toEqual([{ lease_id: null, payer_ref: payer, portion: "base", d: "2026-10-07", amount: "30.00" }]);
  });

  it("keys a lease receipt by its lease, with no payer name", async () => {
    const acct = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[acct, 10000]] });
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], payerRef: "ignored", collectedAt: "2026-10-05T02:00:00+00:00" });
    const { rows } = await db.query(
      `select lease_id, payer_ref, amount::text from ceedo_collections.tenant_payment_portions('2026-10-01', '2026-10-31')
        where account_id = $1`,
      [acct],
    );
    expect(rows).toEqual([{ lease_id: fx.leaseId, payer_ref: null, amount: "50.00" }]);
  });
});

describe("lease_home_accounts", () => {
  it("places a lease by the base rule for its latest rental charge's fee type and section", async () => {
    const byFacility = await createAccount(db);
    const bySection = await createAccount(db);
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, shares: [[byFacility, 10000]] });
    await createRule(db, { feeTypeId: fx.feeTypeId, facilityId, sectionId, shares: [[bySection, 10000]] });
    await charge("2026-10-01");
    const { rows } = await db.query(
      `select account_id from ceedo_collections.lease_home_accounts('2026-10-01', '2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows).toEqual([{ account_id: bySection }]);
  });

  it("falls back to UNCLASSIFIED when no rule places the lease", async () => {
    await charge("2026-10-01");
    const { rows } = await db.query(
      `select account_id from ceedo_collections.lease_home_accounts('2026-10-01', '2026-10-31') where lease_id = $1`,
      [fx.leaseId],
    );
    expect(rows).toEqual([{ account_id: await accountId(db, "UNCLASSIFIED") }]);
  });
});

describe("access", () => {
  it("returns nothing to a user outside the system", async () => {
    const outsider = await createOutsiderClient();
    const range = { p_from: "2026-10-01", p_to: "2026-10-31" };
    for (const { data, error } of [
      await outsider.rpc("monthly_account_totals", range),
      await outsider.rpc("tenant_payment_portions", range),
      await outsider.rpc("lease_home_accounts", range),
    ]) {
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-reads.test.ts`
Expected: FAIL with `function ceedo_collections.monthly_account_totals(unknown, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261016000074_monthly_reads.sql
-- Collection reports phase 5: reads for the Monthly summary and the re-keyed tenant grid.
-- Each groups receipt_account_lines (070), the single classifier; none classifies anew,
-- except lease_home_accounts, which places a lease that PAID nothing (so it has no portion
-- to read a placement from) by the same rule order.
-- Cancelled receipts (status as of now) are left out of every sum.

create or replace function ceedo_collections.monthly_account_totals(p_from date, p_to date)
returns table (month date, account_id uuid, amount numeric(14,2))
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select date_trunc('month', r.business_date)::date, r.account_id, sum(r.amount)::numeric(14,2)
    from ceedo_collections.receipt_account_lines(p_from, p_to) r
   where not r.cancelled
   group by 1, 2;
$$;

-- Per lease (rent, surcharge, occupancy) or, without a lease, per payer name.
create or replace function ceedo_collections.tenant_payment_portions(p_from date, p_to date)
returns table (
  lease_id      uuid,
  payer_ref     text,
  account_id    uuid,
  portion       text,
  business_date date,
  amount        numeric(14,2)
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select r.lease_id,
         case when r.lease_id is null then nullif(trim(r.payer_ref), '') end,
         r.account_id, r.portion, r.business_date, sum(r.amount)::numeric(14,2)
    from ceedo_collections.receipt_account_lines(p_from, p_to) r
   where not r.cancelled
   group by 1, 2, 3, 4, 5;
$$;

-- The rent account a lease belongs to, for the grid's block of a lease that paid nothing.
-- Fee type: that of the lease's latest rental charge due by p_to; with none, the market
-- rental fee for its accrual period (as opening balances choose it, migration 0013).
-- Rule: the base rule in force on p_to, section > facility > fee type, no rate class (a
-- lease receipt carries none); its largest share. No rule: UNCLASSIFIED.
create or replace function ceedo_collections.lease_home_accounts(p_from date, p_to date)
returns table (lease_id uuid, account_id uuid)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with active as (
    select a.lease_id, a.facility_id, a.section_id
      from ceedo_collections.leases_active_between(p_from, p_to) a
  ),
  fee as (
    select a.*, coalesce(
      (select ch.fee_type_id
         from ceedo_collections.charges ch
        where ch.lease_id = a.lease_id and ch.charge_type = 'rental' and ch.due_date <= p_to
        order by ch.due_date desc, ch.id
        limit 1),
      (select ft.id
         from ceedo_collections.leases l
         join ceedo_collections.fee_types ft
           on ft.code = case l.accrual_period when 'daily' then 'MKT_DAILY'
                                              when 'weekly' then 'MKT_WEEKLY'
                                              else 'MKT_MONTHLY' end
        where l.id = a.lease_id)
    ) as fee_type_id
      from active a
  )
  select f.lease_id, coalesce(
    (select sh.account_id
       from ceedo_collections.account_rules r
       join ceedo_collections.account_rule_shares sh on sh.rule_id = r.id
      where r.fee_type_id = f.fee_type_id
        and r.portion = 'base'
        and r.rate_class is null
        and (r.facility_id is null or r.facility_id = f.facility_id)
        and (r.section_id is null or r.section_id = f.section_id)
        and p_to >= r.effective_from
        and (r.effective_to is null or p_to <= r.effective_to)
      order by (r.section_id is not null) desc, (r.facility_id is not null) desc,
               sh.share_bps desc, sh.account_id
      limit 1),
    (select id from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED')
  )
    from fee f;
$$;

revoke execute on function ceedo_collections.monthly_account_totals(date, date) from public;
revoke execute on function ceedo_collections.tenant_payment_portions(date, date) from public;
revoke execute on function ceedo_collections.lease_home_accounts(date, date) from public;
grant execute on function ceedo_collections.monthly_account_totals(date, date) to authenticated;
grant execute on function ceedo_collections.tenant_payment_portions(date, date) to authenticated;
grant execute on function ceedo_collections.lease_home_accounts(date, date) to authenticated;
```

- [ ] **Step 4: Apply, regenerate types, run the test**

```bash
supabase migration up
pnpm db:types
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-reads.test.ts tests/db/receipt-account-lines.test.ts
```
Expected: PASS. `receipt-account-lines` is unchanged and must stay green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000074_monthly_reads.sql tests/db/monthly-reads.test.ts packages/shared/src/db.types.ts
git commit -m "feat(db): monthly account totals, tenant-grid portions, lease home accounts (migration 074)"
```

---

### Task 3: The `year` report parameter

**Files:**
- Modify: `apps/web/lib/reports/params.ts`
- Modify: `apps/web/lib/reports/params.test.ts`
- Modify: `apps/web/lib/reports/open-exceptions.ts`
- Modify: `apps/web/lib/reports/open-exceptions.test.ts`
- Modify: `apps/web/lib/reports/catalog.ts` (`ParamKind` only)
- Modify: `apps/web/app/(admin)/reports/page.tsx`

**Interfaces:**
- Produces:
  - `ReportParams.year: string`, four digits, defaulting to the Manila year.
  - `yearBounds(year: string): { from: string; to: string }`.
  - `ParamKind` gains `"year"`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/lib/reports/params.test.ts`:
- Add `year: "2026",` after `month` in **both** existing `toEqual` objects. The second test passes no year, so it also defaults to 2026.
- Change the import line to `import { longDate, longMonth, manilaToday, monthBounds, readParams, yearBounds } from "./params";`.
- Append inside the `describe`:

```ts
  it("reads a four-digit year and bounds it", () => {
    expect(readParams({ year: "2027" }, lateUtc).year).toBe("2027");
    expect(readParams({ year: "27" }, lateUtc).year).toBe("2026");
    expect(yearBounds("2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
```

In `apps/web/lib/reports/open-exceptions.test.ts`:
- Change the `params` constant to `{ date: "2026-09-29", month: "2026-09", year: "2026", collectorId: ALICE, leaseId: LEASE, facilityId: null }`.
- Append inside the `describe`:

```ts
  it("scopes a yearly report to the Manila year", () => {
    const rows = [ex(ALICE, "2026-12-31T15:30:00Z"), ex(BOB, "2026-12-31T16:30:00Z")]; // 23:30 Dec 31; 00:30 Jan 1
    expect(exceptionsInScope(rows, ["year"], params)).toEqual([rows[0]]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.test.ts`
Expected: FAIL. `yearBounds` is not exported, and `year` is missing from the objects.

- [ ] **Step 3: Implement**

In `apps/web/lib/reports/params.ts`:
- Add to `ReportParams`, after `month`:

```ts
  /** A calendar year, YYYY. */
  year: string;
```

- Add `const YEAR = /^\d{4}$/;` beside `MONTH`.
- In `readParams`, add `year: YEAR.test(one("year")) ? one("year") : today.slice(0, 4),` after `month,` in the returned object.
- After `monthBounds`, add:

```ts
/** The first and last day of a YYYY year. */
export function yearBounds(year: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
```

In `apps/web/lib/reports/catalog.ts`:
- Change the `ParamKind` line to

```ts
export type ParamKind = "date" | "asOf" | "month" | "year" | "collector" | "lease" | "facility";
```

In `apps/web/lib/reports/open-exceptions.ts`:
- Add this before the `asOf` line:

```ts
    if (kinds.includes("year")) return on.slice(0, 4) === p.year;
```

In `apps/web/app/(admin)/reports/page.tsx`:
- After the `month` block, add:

```tsx
              {report.params.includes("year") ? (
                <label className="text-xs text-ink-2">
                  Year
                  <TextInput
                    type="number"
                    name="year"
                    min={2026}
                    max={2100}
                    step={1}
                    defaultValue={today.slice(0, 4)}
                    className="mt-1 w-28"
                    required
                  />
                </label>
              ) : null}
```

Then find any other `ReportParams` literal that now lacks `year`:

```bash
pnpm --filter @ceedo/web exec tsc --noEmit
```
Add `year: "2026"` to each one tsc reports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.test.ts && pnpm --filter @ceedo/web exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/params.ts apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.ts apps/web/lib/reports/open-exceptions.test.ts apps/web/lib/reports/catalog.ts "apps/web/app/(admin)/reports/page.tsx"
git commit -m "feat(web): year report parameter"
```

---

### Task 4: The Monthly summary builder

**Files:**
- Create: `apps/web/lib/reports/builders/monthly-summary.ts`
- Create: `apps/web/lib/reports/builders/monthly-summary.test.ts`

**Interfaces:**
- Consumes: `Report`, `ReportRow`, `RowStyle`, `pesos` (`../report`); `longMonth` (`../params`).
- Produces (Task 5 relies on these names):

```ts
export const CUTOVER_MONTH = "2026-10";
export interface SummaryAccount {
  id: string; code: string; name: string; facilityId: string | null; groupName: string;
  sortOrder: number; kind: "income" | "non_income"; active: boolean;
}
export interface MonthAmount { month: string; accountId: string; amount: Centavos } // month "YYYY-MM"
export interface SummaryAdjustment extends MonthAmount { note: string }
export interface ControlTotal { month: string; amount: Centavos; note: string | null; enteredAt: string }
export interface SummaryInput {
  year: string; today: string; accounts: SummaryAccount[]; facilities: { id: string; name: string }[];
  totals: MonthAmount[]; adjustments: SummaryAdjustment[]; controls: ControlTotal[];
  signatories: { label: string; name: string | null; title: string | null }[];
}
export function latestControls(rows: ControlTotal[]): Map<string, ControlTotal>;
export function monthlySummaryReport(input: SummaryInput): Report;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/reports/builders/monthly-summary.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { toXlsx } from "../xlsx";
import {
  latestControls, monthlySummaryReport, type MonthAmount, type SummaryAccount, type SummaryInput,
} from "./monthly-summary";

const acct = (id: string, over: Partial<SummaryAccount>): SummaryAccount => ({
  id, code: id.toUpperCase(), name: id, facilityId: "f-cpm", groupName: "Other Collections",
  sortOrder: 10, kind: "income", active: true, ...over,
});
const amt = (month: string, accountId: string, pesos: number): MonthAmount => ({
  month, accountId, amount: fromPesos(pesos),
});

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    year: "2026",
    today: "2026-12-15",
    facilities: [{ id: "f-cpm", name: "Public Mall" }, { id: "f-ibjt", name: "IBJT" }],
    accounts: [
      acct("bak", { name: "Bakery - Daily Rent", groupName: "Stall Sections Daily Rent", sortOrder: 20 }),
      acct("rent", { name: "Rentable Space - Monthly Rent", groupName: "Rentable Space", sortOrder: 190 }),
      acct("old", { name: "Old fee", sortOrder: 440, active: false }),
      acct("kiosk", { name: "Kiosk Rentals", facilityId: "f-ibjt", groupName: "IBJT Daily Rent", sortOrder: 480 }),
      acct("gone", { name: "Gone fee", facilityId: "f-ibjt", sortOrder: 550, active: false }),
      acct("sur", { name: "PM Rental Surcharge", facilityId: null, groupName: "Rental Surcharge", sortOrder: 760 }),
      acct("nmis", { name: "NMIS", facilityId: null, groupName: "Regulatory Collection (Non-Income)", sortOrder: 930, kind: "non_income" }),
      acct("unc", { code: "UNCLASSIFIED", name: "Unclassified", facilityId: null, groupName: "Unclassified", sortOrder: 99999 }),
    ],
    totals: [
      amt("2026-09", "bak", 777), // before cutover: never shown
      amt("2026-10", "bak", 1000), amt("2026-10", "rent", 500), amt("2026-10", "kiosk", 300),
      amt("2026-10", "sur", 30), amt("2026-10", "gone", 50), amt("2026-10", "nmis", 100),
      amt("2026-11", "bak", 1100), amt("2026-11", "kiosk", 200), amt("2026-11", "nmis", 120),
      amt("2026-12", "bak", 999), // December has not ended on the 15th
    ],
    adjustments: [
      { ...amt("2026-11", "rent", -20), note: "Over-deposit returned" },
      { ...amt("2026-12", "bak", 5), note: "Not yet" },
    ],
    controls: [
      { month: "2026-10", amount: fromPesos(2080), note: null, enteredAt: "2026-11-01T01:00:00.000000+00:00" },
      { month: "2026-10", amount: fromPesos(2100), note: "Recounted", enteredAt: "2026-11-02T01:00:00.000000+00:00" },
      { month: "2026-11", amount: fromPesos(1400), note: null, enteredAt: "2026-12-01T01:00:00.000000+00:00" },
    ],
    signatories: [{ label: "Prepared by", name: "Signer One", title: "Accountant" }, { label: "Noted by", name: null, title: null }],
    ...over,
  };
}

const rowOf = (r: ReturnType<typeof monthlySummaryReport>, section: number, label: string) =>
  r.sections[section]!.rows.find((x) => x.account === label)!;

describe("monthlySummaryReport", () => {
  it("follows the chart: facility heading, group heading, lines, sub-totals, then the totals", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[0]!.rows.map((x) => x.account)).toEqual([
      "Public Mall",
      "Stall Sections Daily Rent", "Bakery - Daily Rent", "Total Stall Sections Daily Rent",
      "Rentable Space", "Rentable Space - Monthly Rent †", "Total Rentable Space",
      "Total Public Mall",
      "IBJT",
      "IBJT Daily Rent", "Kiosk Rentals", "Total IBJT Daily Rent",
      "Other Collections", "Gone fee", "Total Other Collections",
      "Total IBJT",
      "All facilities",
      "Rental Surcharge", "PM Rental Surcharge", "Total Rental Surcharge",
      "Total All facilities",
      "Total Income",
      "Non-Income",
      "Regulatory Collection (Non-Income)", "NMIS", "Total Regulatory Collection (Non-Income)",
      "Total Non-Income",
      "Grand total",
    ]);
    expect(rowOf(r, 0, "Public Mall").$style).toBe("heading");
    expect(rowOf(r, 0, "Bakery - Daily Rent").$indent).toBe(2);
    expect(rowOf(r, 0, "Total Public Mall").$style).toBe("subtotal");
    expect(rowOf(r, 0, "Total Income").$style).toBe("total");
    expect(r.title).toBe("Monthly Summary of Collections");
    expect(r.scope).toBe("Year 2026");
    expect(r.layout).toBe("landscape");
  });

  it("shows only ended months on or after cutover; the rest are blank, not zero", () => {
    const bak = rowOf(monthlySummaryReport(input()), 0, "Bakery - Daily Rent");
    expect(bak.m1).toBeNull();
    expect(bak.m9).toBeNull();
    expect(bak.m10).toBe(100_000);
    expect(bak.m11).toBe(110_000);
    expect(bak.m12).toBeNull();
    expect(bak.total).toBe(210_000);
  });

  it("totals groups, facilities, income, non-income and the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(rowOf(r, 0, "Total Public Mall")).toMatchObject({ m10: 150_000, m11: 108_000 });
    expect(rowOf(r, 0, "Total IBJT")).toMatchObject({ m10: 35_000, m11: 20_000 });
    expect(rowOf(r, 0, "Total Income")).toMatchObject({ m10: 188_000, m11: 128_000 });
    expect(rowOf(r, 0, "Total Non-Income")).toMatchObject({ m10: 10_000, m11: 12_000 });
    expect(rowOf(r, 0, "Grand total")).toMatchObject({ m10: 198_000, m11: 140_000, total: 338_000 });
  });

  it("agrees with its inputs: grand total = shown receipts + shown adjustments", () => {
    const i = input();
    const shown = (m: string) => m >= "2026-10" && m < "2026-12";
    const expected = [...i.totals, ...i.adjustments].filter((x) => shown(x.month)).reduce((a, x) => a + x.amount, 0);
    expect(rowOf(monthlySummaryReport(i), 0, "Grand total").total).toBe(expected);
  });

  it("adds, marks and lists only adjustments in shown months", () => {
    const r = monthlySummaryReport(input());
    expect(rowOf(r, 0, "Rentable Space - Monthly Rent †")).toMatchObject({ m10: 50_000, m11: -2_000 });
    expect(r.sections[0]!.rows.some((x) => x.account === "Bakery - Daily Rent †")).toBe(false);
    expect(r.notes).toContain("† Rentable Space - Monthly Rent, November 2026: -20.00. Over-deposit returned");
    expect(r.notes!.some((n) => n.includes("Not yet"))).toBe(false);
  });

  it("keeps an inactive account that holds money and hides one that holds none", () => {
    const labels = monthlySummaryReport(input()).sections[0]!.rows.map((x) => x.account);
    expect(labels).toContain("Gone fee");
    expect(labels).not.toContain("Old fee");
  });

  it("hides UNCLASSIFIED when empty; shows it and warns when it holds money", () => {
    expect(monthlySummaryReport(input()).warnings).toEqual([]);
    const r = monthlySummaryReport(input({ totals: [...input().totals, amt("2026-11", "unc", 10)] }));
    expect(rowOf(r, 0, "Unclassified").m11).toBe(1_000);
    expect(r.warnings).toEqual([
      {
        text: "10.00 of 2026's collections is on no account (Unclassified).",
        href: "/accounts/unclassified?month=2026-11",
        linkText: "Classify it",
      },
    ]);
  });

  it("summarises by facility, adding up to the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[1]!.title).toBe("Summary by facility");
    expect(r.sections[1]!.rows.map((x) => [x.account, x.total])).toEqual([
      ["Public Mall", 258_000], ["IBJT", 55_000], ["All facilities", 3_000], ["Non-Income", 22_000], ["Grand total", 338_000],
    ]);
  });

  it("sets the control total in force (the latest) against the grand total", () => {
    const r = monthlySummaryReport(input());
    expect(r.sections[2]!.title).toBe("Control total");
    expect(rowOf(r, 2, "Cashier's control total")).toMatchObject({ m10: 210_000, m11: 140_000, m12: null, total: 350_000 });
    expect(rowOf(r, 2, "Difference (control − system)")).toMatchObject({ m10: 12_000, m11: 0, total: 12_000 });
    expect(r.notes).toContain("Control total, October 2026: Recounted");
  });

  it("leaves a month with no control total blank, not a difference against zero", () => {
    const r = monthlySummaryReport(input({ controls: [] }));
    expect(rowOf(r, 2, "Cashier's control total")).toMatchObject({ m10: null, total: null });
    expect(rowOf(r, 2, "Difference (control − system)")).toMatchObject({ m10: null, total: null });
  });

  it("opens the next year from January, and shows nothing before a month has ended", () => {
    const next = monthlySummaryReport(input({ year: "2027", today: "2027-03-10", totals: [amt("2027-01", "bak", 10)], adjustments: [], controls: [] }));
    expect(rowOf(next, 0, "Bakery - Daily Rent")).toMatchObject({ m1: 1_000, m2: 0, m3: null, total: 1_000 });
    const early = monthlySummaryReport(input({ today: "2026-10-20" }));
    expect(rowOf(early, 0, "Grand total")).toMatchObject({ m10: null, total: null });
  });

  it("signs with the configured signatories and exports", async () => {
    const r = monthlySummaryReport(input());
    expect(r.signatures).toEqual([
      { label: "Prepared by", name: "Signer One", title: "Accountant" },
      { label: "Noted by", name: undefined, title: undefined },
    ]);
    expect((await toXlsx(r)).byteLength).toBeGreaterThan(0);
  });
});

describe("latestControls", () => {
  it("keeps the latest entry per month", () => {
    const m = latestControls(input().controls);
    expect(m.get("2026-10")!.amount).toBe(210_000);
    expect(m.get("2026-11")!.amount).toBe(140_000);
  });
});
```

Before running, check `toXlsx`'s signature in `apps/web/lib/reports/xlsx.ts`. If it returns something other than a `Buffer`/`ArrayBuffer`, adjust only that last assertion to whatever `daily-collection/report.test.ts` uses for its export check.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/monthly-summary.test.ts`
Expected: FAIL with `Failed to resolve import "./monthly-summary"`.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/reports/builders/monthly-summary.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth } from "../params";
import { pesos, type Report, type ReportColumn, type ReportRow, type RowStyle } from "../report";

/**
 * The system starts fresh on this month (spec "History before cutover"): earlier months
 * stay in QuickBooks and the office's Excel files, so the summary leaves them blank.
 */
export const CUTOVER_MONTH = "2026-10";

export interface SummaryAccount {
  id: string;
  code: string;
  name: string;
  facilityId: string | null;
  groupName: string;
  sortOrder: number;
  kind: "income" | "non_income";
  active: boolean;
}

/** One account's sum for one month (YYYY-MM). */
export interface MonthAmount {
  month: string;
  accountId: string;
  amount: Centavos;
}

export interface SummaryAdjustment extends MonthAmount {
  note: string;
}

export interface ControlTotal {
  month: string;
  amount: Centavos;
  note: string | null;
  enteredAt: string;
}

export interface SummaryInput {
  year: string;
  /** Manila business date the report is built on: months not yet ended are blank. */
  today: string;
  accounts: SummaryAccount[];
  facilities: { id: string; name: string }[];
  /** Live receipt portions, summed (monthly_account_totals). */
  totals: MonthAmount[];
  /** Live (not cancelled) adjustments of the year. */
  adjustments: SummaryAdjustment[];
  /** Every control-total entry of the year; the latest per month is in force. */
  controls: ControlTotal[];
  signatories: { label: string; name: string | null; title: string | null }[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The control total in force per month: the one entered last. */
export function latestControls(rows: ControlTotal[]): Map<string, ControlTotal> {
  const out = new Map<string, ControlTotal>();
  for (const row of rows) {
    const seen = out.get(row.month);
    if (!seen || row.enteredAt > seen.enteredAt) out.set(row.month, row);
  }
  return out;
}

interface Block {
  heading: string;
  accounts: SummaryAccount[];
}

/** Accounts (already in chart order) grouped by a key, blocks in order of their first account. */
function blocksOf(accounts: SummaryAccount[], key: (a: SummaryAccount) => string, heading: (a: SummaryAccount) => string): Block[] {
  const blocks = new Map<string, Block>();
  for (const a of accounts) {
    const k = key(a);
    const block = blocks.get(k) ?? { heading: heading(a), accounts: [] };
    block.accounts.push(a);
    blocks.set(k, block);
  }
  return [...blocks.values()];
}

/**
 * Spec report 4, the "Total Income and Non-Income Collection" sheet: account lines × Jan–Dec,
 * facility → group → line with sub-totals, Total Income, the Non-Income block, the Grand
 * total; then the summary by facility and the cashier's control total against it.
 */
export function monthlySummaryReport(input: SummaryInput): Report {
  const months = MONTH_LABELS.map((_, i) => `${input.year}-${String(i + 1).padStart(2, "0")}`);
  const current = input.today.slice(0, 7);
  const shown = new Set(months.filter((m) => m >= CUTOVER_MONTH && m < current));

  const byAccount = new Map<string, Map<string, number>>();
  const add = (accountId: string, month: string, amount: number) => {
    const perMonth = byAccount.get(accountId) ?? new Map<string, number>();
    perMonth.set(month, (perMonth.get(month) ?? 0) + amount);
    byAccount.set(accountId, perMonth);
  };
  for (const t of input.totals) add(t.accountId, t.month, t.amount);
  const adjustments = input.adjustments.filter((a) => shown.has(a.month));
  for (const a of adjustments) add(a.accountId, a.month, a.amount);
  const adjusted = new Set(adjustments.map((a) => a.accountId));

  const amountOf = (id: string, month: string) => byAccount.get(id)?.get(month) ?? 0;
  const hasMoney = (id: string) => [...(byAccount.get(id)?.values() ?? [])].some((v) => v !== 0);
  const sumOf = (accounts: SummaryAccount[]) => (month: string) =>
    accounts.reduce((acc, a) => acc + amountOf(a.id, month), 0);

  /** Month cells: blank where not shown; Total over the shown months, blank if none. */
  const cells = (get: (month: string) => number | null): ReportRow => {
    const row: ReportRow = {};
    let total: number | null = null;
    for (let i = 0; i < months.length; i++) {
      const month = months[i]!;
      const value = shown.has(month) ? get(month) : null;
      row[`m${i + 1}`] = value;
      if (value !== null) total = (total ?? 0) + value;
    }
    row.total = total;
    return row;
  };

  const visible = input.accounts
    .filter((a) => (a.code === "UNCLASSIFIED" ? hasMoney(a.id) : a.active || hasMoney(a.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const facilityName = new Map(input.facilities.map((f) => [f.id, f.name]));
  const income = visible.filter((a) => a.kind === "income");
  const nonIncome = visible.filter((a) => a.kind === "non_income");
  const facilityBlocks = blocksOf(
    income,
    (a) => a.facilityId ?? "",
    (a) => (a.facilityId ? (facilityName.get(a.facilityId) ?? "—") : "All facilities"),
  );

  const rows: ReportRow[] = [];
  const pushBlock = (block: Block, totalStyle: RowStyle) => {
    rows.push({ account: block.heading, $style: "heading" });
    for (const group of blocksOf(block.accounts, (a) => a.groupName, (a) => a.groupName)) {
      rows.push({ account: group.heading, $style: "heading", $indent: 1 });
      for (const a of group.accounts) {
        rows.push({
          account: adjusted.has(a.id) ? `${a.name} †` : a.name,
          ...cells((m) => amountOf(a.id, m)),
          $indent: 2,
        });
      }
      rows.push({ account: `Total ${group.heading}`, ...cells(sumOf(group.accounts)), $style: "subtotal", $indent: 1 });
    }
    rows.push({ account: `Total ${block.heading}`, ...cells(sumOf(block.accounts)), $style: totalStyle });
  };

  for (const block of facilityBlocks) pushBlock(block, "subtotal");
  rows.push({ account: "Total Income", ...cells(sumOf(income)), $style: "total" });
  if (nonIncome.length > 0) pushBlock({ heading: "Non-Income", accounts: nonIncome }, "total");
  const grand = sumOf(visible);
  rows.push({ account: "Grand total", ...cells(grand), $style: "total" });

  const byFacility: ReportRow[] = [
    ...facilityBlocks.map((b) => ({ account: b.heading, ...cells(sumOf(b.accounts)) })),
    ...(nonIncome.length > 0 ? [{ account: "Non-Income", ...cells(sumOf(nonIncome)) }] : []),
    { account: "Grand total", ...cells(grand), $style: "total" },
  ];

  const controls = latestControls(input.controls);
  const control: ReportRow[] = [
    { account: "Grand total (system)", ...cells(grand) },
    { account: "Cashier's control total", ...cells((m) => controls.get(m)?.amount ?? null) },
    {
      account: "Difference (control − system)",
      ...cells((m) => {
        const c = controls.get(m);
        return c ? c.amount - grand(m) : null;
      }),
    },
  ];

  const columns: ReportColumn[] = [
    { key: "account", label: "Account", kind: "text" },
    ...MONTH_LABELS.map((label, i) => ({ key: `m${i + 1}`, label, kind: "money" as const })),
    { key: "total", label: "Total", kind: "money" },
  ];

  const nameOf = new Map(input.accounts.map((a) => [a.id, a.name]));
  const sortOf = new Map(input.accounts.map((a) => [a.id, a.sortOrder]));
  const adjustmentNotes = [...adjustments]
    .sort((a, b) => a.month.localeCompare(b.month) || (sortOf.get(a.accountId) ?? 0) - (sortOf.get(b.accountId) ?? 0))
    .map((a) => `† ${nameOf.get(a.accountId) ?? "—"}, ${longMonth(a.month)}: ${pesos(a.amount)}. ${a.note}`);
  const controlNotes = [...controls.values()]
    .filter((c) => shown.has(c.month) && c.note)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((c) => `Control total, ${longMonth(c.month)}: ${c.note}`);

  const unclassified = input.accounts.find((a) => a.code === "UNCLASSIFIED");
  const unclassifiedMonths = unclassified
    ? [...(byAccount.get(unclassified.id) ?? new Map<string, number>())]
        .filter(([, v]) => v !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];
  const unclassifiedTotal = unclassifiedMonths.reduce((acc, [, v]) => acc + v, 0);

  return {
    title: "Monthly Summary of Collections",
    scope: `Year ${input.year}`,
    layout: "landscape",
    sections: [
      { title: "Total income and non-income collections", columns, rows, dense: true },
      { title: "Summary by facility", columns, rows: byFacility, dense: true },
      { title: "Control total", columns, rows: control, dense: true },
    ],
    notes: [
      `Months before the system started (${longMonth(CUTOVER_MONTH)}) and months that have not ended are left blank.`,
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
      ...adjustmentNotes,
      ...controlNotes,
    ],
    warnings:
      unclassifiedMonths.length > 0
        ? [
            {
              text: `${pesos(unclassifiedTotal)} of ${input.year}'s collections is on no account (Unclassified).`,
              href: `/accounts/unclassified?month=${unclassifiedMonths[0]![0]}`,
              linkText: "Classify it",
            },
          ]
        : [],
    signatures:
      input.signatories.length > 0
        ? input.signatories.map((s) => ({ label: s.label, name: s.name ?? undefined, title: s.title ?? undefined }))
        : undefined,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/monthly-summary.test.ts && pnpm --filter @ceedo/web exec tsc --noEmit`
Expected: PASS (13 tests), and no type errors. vitest does not typecheck, so the `tsc` run is what catches a row literal that does not fit `ReportRow`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/builders/monthly-summary.ts apps/web/lib/reports/builders/monthly-summary.test.ts
git commit -m "feat(web): monthly summary builder"
```

---

### Task 5: Read the summary's data; add it to the catalogue

**Files:**
- Create: `apps/web/lib/reports/summary-data.ts`
- Create: `tests/db/monthly-summary-reads.test.ts`
- Modify: `apps/web/lib/reports/catalog.ts`

**Interfaces:**
- Consumes: `SummaryInput` (Task 4); `monthly_account_totals` (Task 2); the tables from Task 1; `allPages` (`./data`); `manilaToday`, `yearBounds` (`./params`).
- Produces: `monthlySummaryData(year: string): Promise<SummaryInput>`; catalogue entry `monthly-summary`.

- [ ] **Step 1: Write the failing reads test**

The select strings below are copied into `summary-data.ts` in Step 3. Keep the two in step.

```ts
// tests/db/monthly-summary-reads.test.ts
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser } from "../helpers/supabase.js";
import { createAccount } from "../helpers/accounts.js";

// The select strings, filters and orderings below are copied verbatim from
// apps/web/lib/reports/summary-data.ts (and, in the last test, data.ts's tenantPaymentData)
// and must be kept in step with them: a wrong column or embedded relation passes the
// typecheck's escape hatches only to fail at runtime.
describe("Monthly summary reads resolve against the live schema", () => {
  const client = async () => (await createAppUser({ email: "msr-supervisor", role: "supervisor" })).client;

  it("summary reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.rpc("monthly_account_totals", { p_from: "2026-01-01", p_to: "2026-12-31" })
        .order("month").order("account_id").range(0, 0),
      supabase.from("collection_accounts")
        .select("id, code, name, facility_id, group_name, sort_order, kind, active").order("sort_order").order("id").range(0, 0),
      supabase.from("facilities").select("id, name").order("name").order("id").range(0, 0),
      supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
        .gte("month", "2026-01-01").lte("month", "2026-12-01").is("cancelled_at", null)
        .order("month").order("id").range(0, 0),
      supabase.from("monthly_control_totals").select("id, month, amount, note, entered_at")
        .gte("month", "2026-01-01").lte("month", "2026-12-01").order("month").order("id").range(0, 0),
      supabase.from("report_signatories").select("label, name, title")
        .eq("report_key", "monthly-summary").eq("active", true).order("sort_order").range(0, 999),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  });

  it("tenant-payments reads", async () => {
    const supabase = await client();
    const results = await Promise.all([
      supabase.rpc("leases_active_between", { p_from: "2026-10-01", p_to: "2026-10-31" }).order("lease_id").range(0, 0),
      supabase.rpc("lease_home_accounts", { p_from: "2026-10-01", p_to: "2026-10-31" }).order("lease_id").range(0, 0),
      supabase.rpc("tenant_payment_portions", { p_from: "2026-10-01", p_to: "2026-10-31" })
        .order("lease_id").order("payer_ref").order("account_id").order("portion").order("business_date").range(0, 0),
      supabase.from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id").range(0, 0),
    ]);
    for (const r of results) expect(r.error).toBeNull();
  });

  it("a cancelled adjustment is not read", async () => {
    const db = new Client({ connectionString: POSTGRES_URL });
    await db.connect();
    let account: string;
    try {
      account = await createAccount(db);
      const { userId } = await createAppUser({ email: "msr-accounting", role: "accounting" });
      await db.query(
        `insert into ceedo_collections.monthly_adjustments
           (account_id, month, amount, note, entered_by, cancelled_at, cancelled_by, cancel_reason)
         values ($1, '2026-10-01', 9, 'n', $2, now(), $2, 'wrong')`,
        [account, userId],
      );
    } finally {
      await db.end();
    }
    const supabase = await client();
    const { data, error } = await supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
      .eq("account_id", account).is("cancelled_at", null);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

The last test inserts as the database owner (`pg`), because the RPC refuses a cancelled insert by design. It then reads through PostgREST with the reader's exact filter.

- [ ] **Step 2: Run the test**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-summary-reads.test.ts`
Expected: PASS, because Tasks 1–2 already made the schema. This test pins the select strings: if Step 3 changes them, change the test too.

- [ ] **Step 3: Implement the reader and the catalogue entry**

```ts
// apps/web/lib/reports/summary-data.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import type { SummaryInput } from "./builders/monthly-summary";
import { allPages } from "./data";
import { manilaToday, yearBounds } from "./params";

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/**
 * Everything the Monthly summary reads for one year: the account × month sums of live
 * receipt portions (monthly_account_totals over receipt_account_lines), the chart, the live
 * adjustments, every control-total entry, and the signatories.
 */
export async function monthlySummaryData(year: string): Promise<SummaryInput> {
  const { from, to } = yearBounds(year);
  const lastMonth = `${year}-12-01`;
  const supabase = await getServerClient();

  const [totals, accounts, facilities, adjustments, controls, signatories] = await Promise.all([
    allPages((a, b) =>
      supabase.rpc("monthly_account_totals", { p_from: from, p_to: to }).order("month").order("account_id").range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("collection_accounts")
        .select("id, code, name, facility_id, group_name, sort_order, kind, active").order("sort_order").order("id").range(a, b),
    ),
    allPages((a, b) => supabase.from("facilities").select("id, name").order("name").order("id").range(a, b)),
    allPages((a, b) =>
      supabase.from("monthly_adjustments").select("id, account_id, month, amount, note")
        .gte("month", from).lte("month", lastMonth).is("cancelled_at", null)
        .order("month").order("id").range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("monthly_control_totals").select("id, month, amount, note, entered_at")
        .gte("month", from).lte("month", lastMonth).order("month").order("id").range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("report_signatories").select("label, name, title")
        .eq("report_key", "monthly-summary").eq("active", true).order("sort_order").range(a, b),
    ),
  ]);

  return {
    year,
    today: manilaToday(),
    accounts: accounts.map((a) => ({
      id: a.id, code: a.code, name: a.name, facilityId: a.facility_id, groupName: a.group_name,
      sortOrder: a.sort_order, kind: a.kind === "non_income" ? "non_income" : "income", active: a.active,
    })),
    facilities,
    totals: totals.map((t) => ({ month: t.month.slice(0, 7), accountId: t.account_id, amount: centavos(t.amount) })),
    adjustments: adjustments.map((a) => ({
      month: a.month.slice(0, 7), accountId: a.account_id, amount: centavos(a.amount), note: a.note,
    })),
    controls: controls.map((c) => ({
      month: c.month.slice(0, 7), amount: centavos(c.amount), note: c.note, enteredAt: c.entered_at,
    })),
    signatories: signatories.map((s) => ({ label: s.label, name: s.name, title: s.title })),
  };
}
```

In `apps/web/lib/reports/catalog.ts`:
- Add the imports:

```ts
import { monthlySummaryReport } from "./builders/monthly-summary";
import { monthlySummaryData } from "./summary-data";
```

- Insert this entry right after `daily-collection` in `REPORTS`:

```ts
  {
    key: "monthly-summary",
    title: "Monthly summary of collections",
    purpose: "Every account line by month for a year, with adjustments, totals by facility, and the cashier's control total.",
    params: ["year"],
    build: async (p) => monthlySummaryReport(await monthlySummaryData(p.year)),
  },
```

- [ ] **Step 4: Typecheck and run the tests**

Run:
```bash
pnpm --filter @ceedo/web exec tsc --noEmit
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-summary-reads.test.ts apps/web/lib/reports
```
Expected: no type errors; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/summary-data.ts apps/web/lib/reports/catalog.ts tests/db/monthly-summary-reads.test.ts
git commit -m "feat(web): monthly summary report in the catalogue"
```

---

### Task 6: Tenant payments by account (builder)

**Files:**
- Modify (rewrite): `apps/web/lib/reports/builders/tenant-payments.ts`
- Modify (rewrite): `apps/web/lib/reports/builders/tenant-payments.test.ts`

**Interfaces:**
- Consumes: `compareStall`, `rateLabel`, `AccrualPeriod` (`./grouping`); `monthBounds`, `longMonth` (`../params`).
- Produces (Task 7 relies on these names; `PaymentDay` is removed):

```ts
export interface PaymentLease {
  leaseId: string; facilityName: string; sectionName: string; stallNo: string; tenantName: string;
  rate: Centavos; accrualPeriod: AccrualPeriod; homeAccountId: string;
}
export interface PaymentPortion {
  leaseId: string | null; payerRef: string | null; accountId: string;
  portion: "base" | "surcharge"; businessDate: string; amount: Centavos;
}
export interface PaymentAccount { id: string; name: string; facilityName: string | null; sortOrder: number }
export interface TenantPaymentsInput {
  leases: PaymentLease[]; portions: PaymentPortion[]; accounts: PaymentAccount[]; payerAccountIds: string[];
}
export function tenantPaymentsReport(input: TenantPaymentsInput, opts: { month: string; facilityName: string | null }): Report;
```

- [ ] **Step 1: Write the failing test (replace the file)**

```ts
// apps/web/lib/reports/builders/tenant-payments.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import {
  tenantPaymentsReport, type PaymentAccount, type PaymentLease, type PaymentPortion, type TenantPaymentsInput,
} from "./tenant-payments";

const ACCOUNTS: PaymentAccount[] = [
  { id: "a-bak", name: "Bakery Section - Daily Rent", facilityName: "Public Mall", sortOrder: 20 },
  { id: "a-occ", name: "Bakery Section - Occupancy Fee", facilityName: "Public Mall", sortOrder: 210 },
  { id: "a-kiosk", name: "Kiosk Rentals - IBJT", facilityName: "IBJT", sortOrder: 480 },
  { id: "a-sur", name: "Public Mall Rental Surcharge", facilityName: null, sortOrder: 760 },
  { id: "a-nm", name: "Night Market", facilityName: "Night Market", sortOrder: 910 },
  { id: "a-walk", name: "Public Mall Delivery Fee", facilityName: "Public Mall", sortOrder: 400 },
];

function lease(id: string, over: Partial<PaymentLease> = {}): PaymentLease {
  return {
    leaseId: id, facilityName: "Public Mall", sectionName: "Bakery", stallNo: "1", tenantName: `Tenant ${id}`,
    rate: fromPesos(200), accrualPeriod: "daily", homeAccountId: "a-bak", ...over,
  };
}
const base = (leaseId: string | null, accountId: string, date: string, pesos: number, payerRef: string | null = null): PaymentPortion => ({
  leaseId, payerRef, accountId, portion: "base", businessDate: date, amount: fromPesos(pesos),
});
const sur = (leaseId: string, date: string, pesos: number): PaymentPortion => ({
  leaseId, payerRef: null, accountId: "a-sur", portion: "surcharge", businessDate: date, amount: fromPesos(pesos),
});
const build = (over: Partial<TenantPaymentsInput>, month = "2026-10") =>
  tenantPaymentsReport({ leases: [], portions: [], accounts: ACCOUNTS, payerAccountIds: ["a-nm"], ...over }, { month, facilityName: null });

describe("tenantPaymentsReport", () => {
  it("has one money column per day of the month, February included", () => {
    const feb = build({ leases: [lease("a")] }, "2028-02");
    const dayCols = feb.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key));
    expect(dayCols).toHaveLength(29);
    expect(dayCols.at(-1)!.label).toBe("29");
    expect(feb.sections[0]!.dense).toBe(true);
  });

  it("puts each day's rent in its column, the surcharge on the home row, and totals the row", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-10-05", 600), sur("a", "2026-10-05", 18), base("a", "a-bak", "2026-10-06", 200)],
    });
    expect(r.sections[0]!.title).toBe("Public Mall · Bakery Section - Daily Rent");
    const row = r.sections[0]!.rows[0]!;
    expect(row).toMatchObject({ tenant: "Tenant a", stall: "1", rate: "200.00/day", d5: 60000, d6: 20000, d7: null, surcharge: 1800, total: 81800 });
  });

  it("keeps a lease that paid nothing, in its home block, at zero", () => {
    const r = build({ leases: [lease("a"), lease("b", { stallNo: "2" })], portions: [base("a", "a-bak", "2026-10-01", 200)] });
    const unpaid = r.sections[0]!.rows[1]!;
    expect(unpaid).toMatchObject({ tenant: "Tenant b", d1: null, surcharge: null, total: 0 });
  });

  it("puts a lease in every block it paid into, its surcharge once, on the home row", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-10-02", 200), sur("a", "2026-10-02", 6), base("a", "a-occ", "2026-10-03", 500)],
    });
    expect(r.sections.map((s) => s.title)).toEqual([
      "Public Mall · Bakery Section - Daily Rent", "Public Mall · Bakery Section - Occupancy Fee", "Summary by account",
    ]);
    expect(r.sections[0]!.rows[0]).toMatchObject({ d2: 20000, surcharge: 600, total: 20600 });
    expect(r.sections[1]!.rows[0]).toMatchObject({ tenant: "Tenant a", d3: 50000, surcharge: null, total: 50000 });
  });

  it("gives Night Market vendors one row per payer, and ignores other walk-in fees", () => {
    const r = build({
      portions: [
        base(null, "a-nm", "2026-10-01", 30, "Vendor X"), base(null, "a-nm", "2026-10-02", 30, "Vendor X"),
        base(null, "a-nm", "2026-10-01", 10, null), base(null, "a-walk", "2026-10-01", 99, "Truck"),
      ],
    });
    expect(r.sections.map((s) => s.title)).toEqual(["Night Market · Night Market", "Summary by account"]);
    expect(r.sections[0]!.rows.map((x) => [x.tenant, x.stall, x.total])).toEqual([["(no name)", null, 1000], ["Vendor X", null, 6000]]);
  });

  it("ignores days outside the month and leases not in the list (another facility's)", () => {
    const r = build({
      leases: [lease("a")],
      portions: [base("a", "a-bak", "2026-09-30", 200), base("z", "a-kiosk", "2026-10-01", 300)],
    });
    expect(r.sections.map((s) => s.title)).toEqual(["Public Mall · Bakery Section - Daily Rent", "Summary by account"]);
    expect(r.sections[0]!.rows[0]!.total).toBe(0);
  });

  it("orders blocks by the chart and summarises them, each block's days equal to its account's portions", () => {
    const portions = [
      base("a", "a-bak", "2026-10-01", 200), sur("a", "2026-10-01", 6),
      base("b", "a-kiosk", "2026-10-02", 100), base(null, "a-nm", "2026-10-03", 40, "Vendor Y"),
    ];
    const r = build({
      leases: [lease("a"), lease("b", { facilityName: "IBJT", sectionName: "Kiosk", homeAccountId: "a-kiosk" })],
      portions,
    });
    expect(r.sections.map((s) => s.title)).toEqual([
      "Public Mall · Bakery Section - Daily Rent", "IBJT · Kiosk Rentals - IBJT", "Night Market · Night Market", "Summary by account",
    ]);
    const summary = r.sections.at(-1)!;
    expect(summary.rows.map((x) => [x.account, x.rent])).toEqual([
      ["Bakery Section - Daily Rent", 20000], ["Kiosk Rentals - IBJT", 10000], ["Night Market", 4000],
    ]);
    for (const row of summary.rows) {
      const account = ACCOUNTS.find((a) => a.name === row.account)!;
      const expected = portions.filter((p) => p.portion === "base" && p.accountId === account.id).reduce((s, p) => s + p.amount, 0);
      expect(row.rent).toBe(expected);
    }
    expect(sectionTotals(summary)).toEqual({ rows: 3, rent: 34000, surcharge: 600, total: 34600 });
    expect(r.scope).toBe("All facilities · October 2026");
  });

  it("says so when there is nothing", () => {
    const r = tenantPaymentsReport({ leases: [], portions: [], accounts: ACCOUNTS, payerAccountIds: [] }, { month: "2026-10", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.empty).toBe("No lease was active or paid in this month.");
    expect(r.scope).toBe("IBJT · October 2026");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/tenant-payments.test.ts`
Expected: FAIL. The new types are not exported, and `tenantPaymentsReport` takes its old arguments.

- [ ] **Step 3: Implement (replace the file)**

```ts
// apps/web/lib/reports/builders/tenant-payments.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth, monthBounds } from "../params";
import type { Report, ReportColumn, ReportRow, ReportSection } from "../report";
import { compareStall, rateLabel, type AccrualPeriod } from "./grouping";

export interface PaymentLease {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
  /** The rent account the lease belongs to (lease_home_accounts): its row when it paid nothing. */
  homeAccountId: string;
}

/** Live receipt portions summed per lease (or payer), account, portion and day. */
export interface PaymentPortion {
  leaseId: string | null;
  payerRef: string | null;
  accountId: string;
  portion: "base" | "surcharge";
  businessDate: string;
  amount: Centavos;
}

export interface PaymentAccount {
  id: string;
  name: string;
  facilityName: string | null;
  sortOrder: number;
}

export interface TenantPaymentsInput {
  leases: PaymentLease[];
  portions: PaymentPortion[];
  accounts: PaymentAccount[];
  /** Accounts whose lease-less payers get a row each (Night Market, Tabo). */
  payerAccountIds: string[];
}

interface GridRow {
  accountId: string;
  tenant: string;
  stall: string | null;
  rate: string | null;
  isLease: boolean;
  days: number[];
  surcharge: number;
}

/**
 * Spec report 2, the April "Rentable Income Collections" grid, in blocks by account line
 * (facility → account) so each block's day columns add up to that line of the Monthly
 * summary. One row per lease per block it paid into, plus its home block always (a lease
 * that paid nothing keeps its row); surcharges on the home row only, so they count once.
 * Night Market and Tabo vendors without a lease get one row per payer name.
 */
export function tenantPaymentsReport(
  input: TenantPaymentsInput,
  opts: { month: string; facilityName: string | null },
): Report {
  const { from, to } = monthBounds(opts.month);
  const dayCount = Number(to.slice(8));
  const dayKeys = Array.from({ length: dayCount }, (_, i) => `d${i + 1}`);
  const leaseById = new Map(input.leases.map((l) => [l.leaseId, l]));
  const payerAccounts = new Set(input.payerAccountIds);

  const grid = new Map<string, GridRow>();
  const rowFor = (accountId: string, key: string, init: Pick<GridRow, "tenant" | "stall" | "rate" | "isLease">) => {
    const k = `${accountId}\u0000${key}`;
    let row = grid.get(k);
    if (!row) {
      row = { accountId, ...init, days: Array.from({ length: dayCount }, () => 0), surcharge: 0 };
      grid.set(k, row);
    }
    return row;
  };
  const leaseRow = (accountId: string, l: PaymentLease) =>
    rowFor(accountId, `lease:${l.leaseId}`, {
      tenant: l.tenantName, stall: l.stallNo, rate: rateLabel(l.rate, l.accrualPeriod), isLease: true,
    });

  for (const l of input.leases) leaseRow(l.homeAccountId, l);
  for (const p of input.portions) {
    if (p.businessDate < from || p.businessDate > to) continue;
    const day = Number(p.businessDate.slice(8)) - 1;
    if (p.leaseId) {
      const l = leaseById.get(p.leaseId);
      if (!l) continue; // a lease outside the chosen facility
      if (p.portion === "surcharge") {
        leaseRow(l.homeAccountId, l).surcharge += p.amount;
      } else {
        const row = leaseRow(p.accountId, l);
        row.days[day] = (row.days[day] ?? 0) + p.amount;
      }
    } else if (p.portion === "base" && payerAccounts.has(p.accountId)) {
      const name = p.payerRef ?? "(no name)";
      const row = rowFor(p.accountId, `payer:${name}`, { tenant: name, stall: null, rate: null, isLease: false });
      row.days[day] = (row.days[day] ?? 0) + p.amount;
    }
  }

  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const byAccount = new Map<string, GridRow[]>();
  for (const row of grid.values()) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  const blocks = [...byAccount]
    .map(([id, rows]) => ({ account: accountById.get(id), rows }))
    .sort(
      (a, b) =>
        (a.account?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.account?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (a.account?.name ?? "").localeCompare(b.account?.name ?? ""),
    );

  const columns: ReportColumn[] = [
    { key: "tenant", label: "Tenant", kind: "text" },
    { key: "stall", label: "Stall", kind: "text" },
    { key: "rate", label: "Rate", kind: "text" },
    ...dayKeys.map((key, i) => ({ key, label: String(i + 1), kind: "money" as const, total: true })),
    { key: "surcharge", label: "Surcharge", kind: "money", total: true },
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const rentOf = (r: GridRow) => r.days.reduce((acc, v) => acc + v, 0);
  const toRow = (r: GridRow): ReportRow => {
    const row: ReportRow = { tenant: r.tenant, stall: r.stall, rate: r.rate };
    r.days.forEach((v, i) => {
      row[dayKeys[i]!] = v !== 0 ? v : null;
    });
    row.surcharge = r.surcharge !== 0 ? r.surcharge : null;
    row.total = rentOf(r) + r.surcharge;
    return row;
  };
  const byStallThenName = (a: GridRow, b: GridRow) =>
    a.isLease !== b.isLease
      ? a.isLease ? -1 : 1
      : compareStall(a.stall ?? "", b.stall ?? "") || a.tenant.localeCompare(b.tenant);

  const sections: ReportSection[] = blocks.map((b) => ({
    title: b.account ? `${b.account.facilityName ?? "All facilities"} · ${b.account.name}` : "Unknown account",
    columns,
    dense: true,
    rows: [...b.rows].sort(byStallThenName).map(toRow),
  }));

  sections.push({
    title: "Summary by account",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "account", label: "Account", kind: "text" },
      { key: "rows", label: "Rows", kind: "int", total: true },
      { key: "rent", label: "Received", kind: "money", total: true },
      { key: "surcharge", label: "Surcharge", kind: "money", total: true },
      { key: "total", label: "Total", kind: "money", total: true },
    ],
    rows: blocks.map((b) => {
      const rent = b.rows.reduce((acc, r) => acc + rentOf(r), 0);
      const surcharge = b.rows.reduce((acc, r) => acc + r.surcharge, 0);
      return {
        facility: b.account?.facilityName ?? "All facilities",
        account: b.account?.name ?? "Unknown account",
        rows: b.rows.length,
        rent,
        surcharge,
        total: rent + surcharge,
      };
    }),
    empty: "No lease was active or paid in this month.",
  });

  return {
    title: "Monthly tenant payments",
    scope: `${opts.facilityName ?? "All facilities"} · ${longMonth(opts.month)}`,
    sections,
    notes: [
      "Blocks follow the account chart. Each day shows what the row paid to that line on that business date.",
      "A lease that paid to more than one line appears in each; its surcharges are on its row in its home line.",
      "Night Market and Tabo vendors without a lease appear as one row per payer name.",
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
    ],
  };
}
```

`groupBySection` is no longer imported here. Leave it in `grouping.ts`: `balances.ts` still uses it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/tenant-payments.test.ts`
Expected: PASS (8 tests). `catalog.ts` and `data.ts` no longer typecheck until Task 7; that is expected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/builders/tenant-payments.ts apps/web/lib/reports/builders/tenant-payments.test.ts
git commit -m "feat(web): tenant payments grid by account line, with payer rows"
```

---

### Task 7: Tenant payments reader and catalogue

**Files:**
- Modify: `apps/web/lib/reports/data.ts` (rewrite `tenantPaymentData`; fix the type import)
- Modify: `apps/web/lib/reports/catalog.ts` (the `tenant-payments` build)

**Interfaces:**
- Consumes: `TenantPaymentsInput` (Task 6); `leases_active_between`, `lease_home_accounts`, `tenant_payment_portions` (Task 2).
- Produces:
  - `tenantPaymentData(month: string, facilityId: string | null): Promise<TenantPaymentsInput>`.
  - `export const PAYER_ACCOUNT_CODES = ["NM-FEE", "TABO-FEE"]`.

- [ ] **Step 1: Confirm the reads test covers the select strings**

`tests/db/monthly-summary-reads.test.ts` ("tenant-payments reads", Task 5) already runs these reads. Step 2's code must use exactly those strings and orderings.

- [ ] **Step 2: Implement**

In `apps/web/lib/reports/data.ts`:
- Replace the type import line `import type { PaymentDay, PaymentLease } from "./builders/tenant-payments";` with

```ts
import type { TenantPaymentsInput } from "./builders/tenant-payments";
```

- Replace the whole `tenantPaymentData` function (from its doc comment to its closing brace) with:

```ts
/** Accounts whose lease-less payers get a row each in the tenant grid (spec report 2). */
export const PAYER_ACCOUNT_CODES = ["NM-FEE", "TABO-FEE"];

/**
 * The tenant grid's inputs for a month: the leases (optionally one facility's) with their
 * home account, the month's live portions summed per lease or payer, account, portion and
 * day (tenant_payment_portions over receipt_account_lines), and the chart.
 */
export async function tenantPaymentData(month: string, facilityId: string | null): Promise<TenantPaymentsInput> {
  const { from, to } = monthBounds(month);
  const supabase = await getServerClient();
  const [leaseRows, homes, portions, accounts, facilities] = await Promise.all([
    allPages((a, b) => {
      let q = supabase.rpc("leases_active_between", { p_from: from, p_to: to });
      if (facilityId) q = q.eq("facility_id", facilityId);
      return q.order("lease_id").range(a, b);
    }),
    allPages((a, b) => supabase.rpc("lease_home_accounts", { p_from: from, p_to: to }).order("lease_id").range(a, b)),
    allPages((a, b) =>
      supabase.rpc("tenant_payment_portions", { p_from: from, p_to: to })
        .order("lease_id").order("payer_ref").order("account_id").order("portion").order("business_date")
        .range(a, b),
    ),
    allPages((a, b) =>
      supabase.from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id").range(a, b),
    ),
    allPages((a, b) => supabase.from("facilities").select("id, name").order("name").order("id").range(a, b)),
  ]);

  const home = new Map(homes.map((h) => [h.lease_id, h.account_id]));
  const unclassified = accounts.find((a) => a.code === "UNCLASSIFIED")?.id ?? "";
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));

  return {
    leases: leaseRows.map((l) => ({
      leaseId: l.lease_id,
      facilityName: l.facility_name,
      sectionName: l.section_name,
      stallNo: l.stall_no,
      tenantName: l.tenant_name,
      rate: centavos(l.rate_amount),
      accrualPeriod: l.accrual_period,
      homeAccountId: home.get(l.lease_id) ?? unclassified,
    })),
    portions: portions.map((p) => ({
      leaseId: p.lease_id,
      payerRef: p.payer_ref,
      accountId: p.account_id,
      portion: p.portion === "surcharge" ? "surcharge" : "base",
      businessDate: p.business_date,
      amount: centavos(p.amount),
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      facilityName: a.facility_id ? (facilityName.get(a.facility_id) ?? null) : null,
      sortOrder: a.sort_order,
    })),
    payerAccountIds: accounts
      .filter((a) => PAYER_ACCOUNT_CODES.includes(a.code) && (!facilityId || a.facility_id === facilityId))
      .map((a) => a.id),
  };
}
```

In `apps/web/lib/reports/catalog.ts`, replace the `tenant-payments` entry's `purpose` and `build` with:

```ts
    purpose: "What every lease paid on each day of a month, by facility and account line, with surcharges, Night Market and Tabo payers, and totals.",
    params: ["month", "facility"],
    build: async (p) => {
      const [input, facilityName] = await Promise.all([
        tenantPaymentData(p.month, p.facilityId),
        facilityLabel(p.facilityId),
      ]);
      return tenantPaymentsReport(input, { month: p.month, facilityName });
    },
```

`lease_receipts_by_day` is no longer read by the web app. Leave the SQL function: `tests/db/tenant-payments.test.ts` still covers it, and dropping it would need a migration this phase does not need.

- [ ] **Step 3: Typecheck and run the tests**

Run:
```bash
pnpm --filter @ceedo/web exec tsc --noEmit
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/monthly-summary-reads.test.ts apps/web/lib/reports
```
Expected: no type errors; PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/reports/data.ts apps/web/lib/reports/catalog.ts
git commit -m "feat(web): tenant payments read by account from receipt portions"
```

---

### Task 8: The Adjustments screen

**Files:**
- Create: `apps/web/lib/adjustments/queries.ts`
- Create: `apps/web/lib/adjustments/actions.ts`
- Create: `apps/web/components/adjustments/adjustments-table.tsx`
- Create: `apps/web/components/adjustments/control-totals-table.tsx`
- Create: `apps/web/components/adjustments/record-adjustment-dialog.tsx`
- Create: `apps/web/components/adjustments/control-total-dialog.tsx`
- Create: `apps/web/app/(admin)/ledger/adjustments/page.tsx`
- Modify: `apps/web/lib/nav/modules.ts`

**Interfaces:**
- Consumes: the Task 1 RPCs and tables; `ledgerClient` (`@/lib/ledger/queries`); `allPages`, `manilaDate` (`@/lib/reports/data`); `readParams`, `longMonth` (`@/lib/reports/params`); `formatDate` (`@/lib/format/date`); the UI kit the cash-ticket screen uses.
- Produces: route `/ledger/adjustments?month=YYYY-MM`.

Model every piece on the cash-ticket screen: `app/(admin)/ledger/cash-tickets/page.tsx`, `lib/cash-tickets/*`, `components/cash-tickets/*`. Same dialog, table, `useSubmit` and `SaveResult` idioms.

- [ ] **Step 1: Queries**

```ts
// apps/web/lib/adjustments/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { formatDate } from "@/lib/format/date";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages, manilaDate } from "@/lib/reports/data";

export interface AdjustmentRow {
  id: string; account: string; amount: Centavos; note: string; enteredBy: string; enteredOn: string;
  cancelled: boolean; cancelReason: string | null;
}
export interface ControlRow { id: string; amount: Centavos; note: string | null; enteredBy: string; enteredOn: string; inForce: boolean }
export interface AccountOption { id: string; label: string }

/** A month's adjustments, cancelled ones included (shown struck through, with the reason). */
export async function adjustmentsFor(monthStart: string): Promise<AdjustmentRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("monthly_adjustments")
      .select("id, amount, note, entered_at, cancelled_at, cancel_reason, collection_accounts(code, name), entered:app_users!monthly_adjustments_entered_by_fkey(full_name)")
      .eq("month", monthStart).order("entered_at").order("id").range(a, b),
  );
  return rows.map((r) => ({
    id: r.id,
    account: r.collection_accounts ? `${r.collection_accounts.code} · ${r.collection_accounts.name}` : "—",
    amount: fromPesos(Number(r.amount)),
    note: r.note,
    enteredBy: r.entered?.full_name ?? "—",
    enteredOn: formatDate(manilaDate(r.entered_at)),
    cancelled: r.cancelled_at !== null,
    cancelReason: r.cancel_reason,
  }));
}

/** Every control-total entry for a month, latest first; the first is the one in force. */
export async function controlTotalsFor(monthStart: string): Promise<ControlRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("monthly_control_totals")
      .select("id, amount, note, entered_at, entered:app_users!monthly_control_totals_entered_by_fkey(full_name)")
      .eq("month", monthStart).order("entered_at", { ascending: false }).order("id").range(a, b),
  );
  return rows.map((r, i) => ({
    id: r.id,
    amount: fromPesos(Number(r.amount)),
    note: r.note,
    enteredBy: r.entered?.full_name ?? "—",
    enteredOn: formatDate(manilaDate(r.entered_at)),
    inForce: i === 0,
  }));
}

/** Active accounts an adjustment may go to: every one but UNCLASSIFIED. */
export async function adjustableAccounts(): Promise<AccountOption[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((a, b) =>
    supabase.from("collection_accounts").select("id, code, name")
      .eq("active", true).neq("code", "UNCLASSIFIED").order("sort_order").order("id").range(a, b),
  );
  return rows.map((r) => ({ id: r.id, label: `${r.code} · ${r.name}` }));
}
```

If the generated types make `collection_accounts` or `entered` an array rather than an object, follow what `lib/cash-tickets/queries.ts` does for `fee_types` and `collector`. The FKs are single-column, so they should come back as objects.

- [ ] **Step 2: Actions**

```ts
// apps/web/lib/adjustments/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const failure = (message: string): SaveResult => ({ ok: false, fieldErrors: {}, formError: message });
const month = z.string().regex(/^\d{4}-\d{2}$/, "Choose the month");
const amount = z.string().trim().min(1, "Enter the amount").pipe(z.coerce.number());

const adjustmentSchema = z.object({
  accountId: z.guid("Choose the account"),
  month,
  amount: amount.refine((v) => v !== 0, "The amount cannot be zero"),
  note: z.string().trim().min(1, "Explain the adjustment"),
});

const controlSchema = z.object({
  month,
  amount: amount.refine((v) => v >= 0, "The control total cannot be negative"),
  note: z.string().trim().optional(),
});

async function gate() {
  const staff = await requireStaff();
  return ["accounting", "admin"].includes(staff.role) ? null : failure("Only accounting or an administrator may do this.");
}

function done(id: string): SaveResult {
  revalidatePath("/ledger/adjustments");
  revalidatePath("/reports/monthly-summary");
  return { ok: true, id };
}

export async function recordAdjustment(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("record_monthly_adjustment", {
    p_account_id: r.accountId, p_month: `${r.month}-01`, p_amount: r.amount, p_note: r.note,
  });
  if (error) return failure(error.message);
  return done(data);
}

export async function cancelAdjustment(id: string, reason: string): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("cancel_monthly_adjustment", { p_adjustment_id: id, p_reason: reason });
  if (error) return failure(error.message);
  return done(id);
}

export async function recordControlTotal(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = controlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  // The generated types call p_note non-null (no SQL default); the function takes null.
  const { data, error } = await supabase.rpc("record_monthly_control_total", {
    p_month: `${r.month}-01`, p_amount: r.amount, p_note: (r.note || null) as string,
  });
  if (error) return failure(error.message);
  return done(data);
}
```

- [ ] **Step 3: Components**

`apps/web/components/adjustments/adjustments-table.tsx`: copy `components/cash-tickets/cash-tickets-table.tsx` and make these changes:
- `CancelTicketDialog` → `CancelAdjustmentDialog`. It calls `cancelAdjustment(id, reason)`. Title "Cancel adjustment"; description "The adjustment stays on the record, marked cancelled. The monthly summary drops it."; button "Cancel adjustment"; form id `cancel-adjustment-${id}`.
- Columns (type `DataColumn<AdjustmentRow>`):
  - `account` (sort + facet on `r.account`);
  - `amount` (right-aligned `<Money amount={r.amount} />`, sortValue `r.amount`);
  - `note`: the note, or `Cancelled — {r.cancelReason}` in `text-ribbon` when cancelled;
  - `entered`: `${r.enteredBy} · ${r.enteredOn}`;
  - `actions`: the cancel dialog when `canCancel && !r.cancelled`.
- Export `AdjustmentsTable({ rows, canCancel }: { rows: AdjustmentRow[]; canCancel: boolean })`. The `columns` array is built inside the component so it can read `canCancel`.
- `DataTable` props: `urlKey="adjustments"`, `unit="adjustments"`, `rowMuted={(r) => r.cancelled}`, `searchPlaceholder="Filter by account or note…"`, `empty="No adjustments for this month."`.

`apps/web/components/adjustments/control-totals-table.tsx`: a `"use client"` `DataTable<ControlRow>` with columns:
- `amount` (Money);
- `note` (or "—");
- `entered`;
- `status`: "In force" for `r.inForce`, else "Replaced" in `text-ink-3`.

Props: `urlKey="control-totals"`, `unit="entries"`, `rowMuted={(r) => !r.inForce}`, `empty="No control total entered for this month."`.

`apps/web/components/adjustments/record-adjustment-dialog.tsx`: copy `components/cash-tickets/record-dialog.tsx` and make these changes:
- Props `{ month: string; accounts: AccountOption[] }`. The action is `recordAdjustment`; trigger "Add adjustment"; title "Add adjustment"; description `` `A line no receipt produces, for ${longMonth(month)}. Use a negative amount to reduce the account.` ``.
- Form id `adjustment-form`, with fields:
  - `<input type="hidden" name="month" value={month} />`;
  - `accountId` NativeSelect over `accounts`;
  - `amount` TextInput `type="number" step="0.01"` (no `min`: negatives are allowed);
  - `note` TextArea, `rows={3}`.

`apps/web/components/adjustments/control-total-dialog.tsx`: the same pattern.
- Props `{ month: string }`. The action is `recordControlTotal`; trigger "Enter control total"; title "Cashier's control total"; description `` `The cashier's figure for ${longMonth(month)}. A new entry replaces the one in force; earlier entries stay on record.` ``.
- Form id `control-total-form`, with fields: hidden `month`; `amount` (`type="number" step="0.01" min="0"`); `note` TextInput.

- [ ] **Step 4: Page and nav**

```tsx
// apps/web/app/(admin)/ledger/adjustments/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { AdjustmentsTable } from "@/components/adjustments/adjustments-table";
import { ControlTotalDialog } from "@/components/adjustments/control-total-dialog";
import { ControlTotalsTable } from "@/components/adjustments/control-totals-table";
import { RecordAdjustmentDialog } from "@/components/adjustments/record-adjustment-dialog";
import { adjustableAccounts, adjustmentsFor, controlTotalsFor } from "@/lib/adjustments/queries";
import { longMonth, readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Monthly adjustments and the cashier's control total (spec "monthly_adjustments",
 * "monthly_control_totals"). Accounting enters them; supervisors and admins read them.
 * Both feed the Monthly summary. Nothing is edited or deleted: an adjustment is cancelled
 * with a reason, and a control total is replaced by a newer entry.
 */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const { month } = readParams(await searchParams);
  const monthStart = `${month}-01`;
  const canWrite = staff.role === "accounting" || staff.role === "admin";
  const [adjustments, controls, accounts] = await Promise.all([
    adjustmentsFor(monthStart),
    controlTotalsFor(monthStart),
    canWrite ? adjustableAccounts() : Promise.resolve([]),
  ]);
  return (
    <div>
      <ScreenHeader
        title="Adjustments"
        note={`Lines no receipt produces, and the cashier's control total, for ${longMonth(month)}. Both appear on the Monthly summary once the month has ended.`}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <ControlTotalDialog month={month} />
              <RecordAdjustmentDialog month={month} accounts={accounts} />
            </div>
          ) : null
        }
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Month
          <TextInput type="month" name="month" defaultValue={month} className="mt-1 w-40" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <h2 className="mb-2 text-sm font-semibold text-ink">Adjustments</h2>
      <AdjustmentsTable rows={adjustments} canCancel={canWrite} />
      <h2 className="mb-2 mt-8 text-sm font-semibold text-ink">Control total</h2>
      <ControlTotalsTable rows={controls} />
    </div>
  );
}
```

In `apps/web/lib/nav/modules.ts`, change the Reports module to:

```ts
      {
        key: "reports",
        label: "Reports",
        tabs: [
          { href: "/reports", label: "Reports" },
          { href: "/ledger/adjustments", label: "Adjustments" },
        ],
      },
```

- [ ] **Step 5: Check it typechecks and the nav test passes**

Run:
```bash
pnpm --filter @ceedo/web exec tsc --noEmit
pnpm --filter @ceedo/web lint
pnpm vitest run apps/web/lib/nav
```
Expected: no errors; PASS. If `modules.test.ts` pins the Reports module's tabs, add the new tab to its expectation.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/adjustments apps/web/components/adjustments "apps/web/app/(admin)/ledger/adjustments" apps/web/lib/nav/modules.ts apps/web/lib/nav/modules.test.ts
git commit -m "feat(web): adjustments and control totals screen"
```

---

### Task 9: Check it in the running app; build; full suite

**Files:** none new. Fix whatever this turns up, in the task that owns the code.

- [ ] **Step 1: Full suite on a fresh database**

```bash
supabase db reset
set -a; eval "$(supabase status -o env)"; set +a; pnpm test
```
Expected: every test passes. If `supabase db reset` fails on 073 or 074, fix the migration, not the seed.

- [ ] **Step 2: Build**

Run: `pnpm --filter @ceedo/web build`
Expected: success, no type errors.

- [ ] **Step 3: Look at it in the browser**

Use the `run` skill (or `pnpm --filter @ceedo/web dev`). Sign in as an admin. Use the super-admin "test data" screen if the database needs receipts. Then check:
- `/reports` shows "Monthly summary of collections" with a Year input. Opening it for 2026 shows:
  - blank Jan–Sep, and blank for the current month;
  - facility headings with group sub-totals;
  - Total Income, Non-Income and Grand total;
  - "Summary by facility" and "Control total".
- Print preview is landscape, and the Excel export opens.
- `/ledger/adjustments` (Reports module tab): add an adjustment for a past month and a control total. Then:
  - the summary shows the "†" line, the note under the report, and the difference row;
  - cancelling the adjustment, with a reason, removes it from the summary.
- As a supervisor: `/ledger/adjustments` shows both tables with no buttons.
- `/reports/tenant-payments` for a month with receipts:
  - blocks are titled "Facility · Account";
  - the summary by account's Received column equals the Monthly summary's figures for those lines in that month;
  - Night Market or Tabo payers, if the test data has any, appear as name rows.

- [ ] **Step 4: Check the cross-report invariant against the local data**

Run this on the local database (`psql "$DB_URL"` after the `eval` above):

```sql
-- For each month with receipts, the summary's source equals the live receipts and tickets.
with s as (
  select month, sum(amount) as summary
    from ceedo_collections.monthly_account_totals('2026-01-01', '2026-12-31') group by month
), c as (
  select date_trunc('month', business_date)::date as month, sum(gross_amount) as receipts
    from ceedo_collections.collections c
   where not exists (select 1 from ceedo_collections.standing_cancellations x where x.collection_id = c.id)
   group by 1
), t as (
  select date_trunc('month', business_date)::date as month, sum(amount) as tickets
    from ceedo_collections.cash_ticket_sales where cancelled_at is null group by 1
)
select coalesce(s.month, c.month) as month, s.summary, coalesce(c.receipts, 0) + coalesce(t.tickets, 0) as expected
  from s full join c on c.month = s.month left join t on t.month = coalesce(s.month, c.month)
 order by 1;
```
Expected: `summary = expected` on every row. A mismatch means a receipt is being dropped or double-counted. That is a bug in 070's branches, not something to paper over in the builder. Stop and report it.

- [ ] **Step 5: Hand over**

Report to the user:
- what was built;
- the spec deviations above, which go in the PR description;
- that production needs `node scripts/bundle-migrations.mjs --after 20261014000072`, run by the user after checking `deployed_migrations`.

Leave pushing and opening the PR to `superpowers:finishing-a-development-branch`.
