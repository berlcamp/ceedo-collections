# Collection Reports, Phase 4: Daily Collection Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, for one business date, the office's Daily Collection Report from the system's own receipts. It has three parts:
- the page sent to the City Treasurer;
- the collections-per-collector matrix with its deposit block;
- the per-collector abstracts.

**Architecture:**
- **Database:** one migration (`072`) adds:
  - `report_signatories`, the names printed under "Prepared by" and "Noted by";
  - the `collections (business_date)` index the spec asks for;
  - `report_signatories` on `clear_all_data`'s keep-list.
- **Report framework** (`apps/web/lib/reports/`):
  - rows may carry a style and an indent;
  - a section may have its own orientation, worksheet, page break and totals label;
  - a report may carry screen-only warnings, and its signatures may carry titles.
- **Builder:** pure functions in `apps/web/lib/reports/builders/daily-collection/`, fed one `DailyInput` read by `apps/web/lib/reports/daily-data.ts` from `receipt_account_lines(D, D)` and the chart. Every figure comes from the same portions, so the three parts agree by construction.

**Tech Stack:** Postgres (Supabase local, ports 563xx), Next.js app router (`apps/web`), ExcelJS, zod 4, vitest, `pg` for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`, report 1, "Daily Collection Report". This plan covers rollout phase 4. Phases 1–3 are merged (`main` at `8abe4f1`). The latest migration is `20261008000071`.

## Global Constraints

- **Schema and access:**
  - All objects live in schema `ceedo_collections`.
  - New views and read functions are `security invoker`.
  - Master data uses `apply_master_data_policies(table)`: back office reads, admin writes.
- **Roles** (`app_role`): `collector | supervisor | accounting | admin`. Back office means `supervisor`, `accounting` and `admin`.
- **Money:**
  - Postgres stores `numeric(14,2)` pesos.
  - TypeScript uses integer centavos (`Centavos`, `fromPesos(Number(v))` from `@ceedo/shared`).
  - Report money cells are centavos, and the renderers turn them into pesos.
- **Dates:** Asia/Manila business dates, written `YYYY-MM-DD`.
- **Migrations:**
  - File: `supabase/migrations/20261014000072_daily_collection_report.sql`.
  - Apply locally with `supabase migration up`.
  - Then run `pnpm db:types` and commit `packages/shared/src/db.types.ts`. CI runs `scripts/check-types-current.sh`.
- **Function edits copy the whole body.** `create or replace` replaces the whole function. The latest `clear_all_data` body is in `20261008000071_account_catalogue.sql`, from line 406 to the end of that function. Reproduce it **verbatim**, then apply the edit shown.
- **Tests:**
  - Run from the repo root: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <file>`.
  - Run `supabase db reset` before any full-suite run you intend to trust.
- **Before pushing `main`:** run `pnpm --filter @ceedo/web build`. Any type error blocks the push.
- **Production DB:**
  - Changes reach production only as bundles from `node scripts/bundle-migrations.mjs --after <version>`, which the user runs by hand.
  - Check `select max(version) from ceedo_collections.deployed_migrations;` first.
  - Never push, deploy or run SQL against production without the user's go-ahead.
- **PostgREST returns at most 1000 rows.** Page every list read through `allPages` (`apps/web/lib/reports/data.ts`), and chunk `in (...)` lists through `byIds` (exported in Task 6).
- **Office spreadsheets and real names never enter the repo.**
  - Test fixtures use fictitious names.
  - The signatory rows are seeded **without** names; an admin types them in.

### Spec deviations (deliberate; state them in the PR description)

1. **The row-style and layout framework change lands here, not in phase 5.** The phase 1–2 plan deferred it. The Treasurer page needs its Sub-total 1, Sub-total 2 and Grand total rows, and the report mixes portrait and landscape parts.
2. **Orientation is per section, with `Report.layout` as the default.** The spec's single `Report.layout` cannot print part (a) portrait and parts (b)–(c) landscape in one document. Print uses CSS named pages (`@page portrait` / `@page landscape`).
3. **The xlsx export does not freeze header rows on multi-section sheets.** Freezing applies to one header row, and a sheet holding many sections has many. Sheets keep the existing dense-grid freeze (first column) and gain landscape page setup, fit to width, for landscape sections.
4. **Signatory names live in a `report_signatories` table** (admin-edited through the registry), not on the single-row `settings` table. One table serves every report that later needs signature blocks.
5. **"Other collections" is shown only when it holds money.** The built-in `TL_OTHER` line and `RC_OTHER` column hold accounts the office has not yet placed. An empty one is noise on an official page; a non-empty one must never be hidden. Any *inactive* line or column that holds money is shown too.
6. **Date of deposit.**
   - It is computed per Treasurer line, from the shifts behind that line's portions, not once for the page.
   - A live but unverified remittance shows its date followed by "(unverified)", rather than counting as undeposited.
   - Receipts on no shift count as undeposited.
7. **The tenant-payments re-keying by account, and its Night Market/Tabo payer rows, move to phase 5.** Phase 3 handed them to phase 4. They belong with the monthly summary, whose invariant they share ("tenant-payments block totals = the monthly summary's lines").
8. **The Sept 30 fixture is pure and trimmed.** The builder tests use a hand-built `DailyInput` whose portions are already classified, with fictitious names and corrected figures. Rule classification is already covered by phase 3's DB tests of `receipt_account_lines`.

## Review Focus

1. **A collector with only cancelled receipts.** Their abstract must list the receipts at zero, marked "(cancelled)". Their matrix row, if they are inactive, must not appear. No total may count them. (Task 5 test.)
2. **A Treasurer line whose money sits partly on an undeposited shift** (for example, cash tickets entered against a shift not yet remitted). The line must read "Undeposited", even when its other shifts are deposited. (Task 3 test.)
3. **An inactive collector who collected that day.** They must still get a matrix row, or their pesos would vanish from the per-collector total while staying on the Treasurer page. (Task 4 test.)
4. **A day with no receipts at all.** The Treasurer page still lists its lines blank with zero sub-totals, and the abstracts show their empty message. Nothing may crash on an empty map. (Task 6 test.)
5. **One OR split across accounts** (ante-mortem 75/25, or a lease receipt's base and surcharge). It must be **one** abstract row whose amount is the whole line, not two rows. (Task 5 test.)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261014000072_daily_collection_report.sql` | `report_signatories` (+ seed rows without names), `collections_business_date_idx`, `clear_all_data` keeps signatories |
| `tests/db/report-signatories.test.ts` | Task 1 |
| `tests/db/registry-parity.test.ts` | adds `report_signatories` |
| `packages/shared/src/db.types.ts` | regenerated |
| `apps/web/lib/admin/registry.ts`, `apps/web/lib/nav/modules.ts` | "Signatories" admin screen, in the Accounts module |
| `apps/web/lib/reports/report.ts` | `ReportRow`, `RowStyle`, section `orientation`/`sheet`/`breakBefore`/`totalLabel`, `Report.layout`/`warnings`, signature `title`; `sectionTotals` skips styled rows |
| `apps/web/lib/reports/xlsx.ts` (+ `xlsx.test.ts`) | worksheets per `sheet`, styled rows, landscape page setup, totals label, signature titles |
| `apps/web/components/reports/report-document.tsx` | named pages, page breaks, styled and indented rows, totals label, signature titles |
| `apps/web/app/(admin)/reports/[key]/page.tsx` | renders `report.warnings` (screen only) |
| `apps/web/lib/reports/builders/daily-collection/types.ts` | `DailyInput` and its parts; `byId` |
| `apps/web/lib/reports/builders/daily-collection/fixture.ts` | the trimmed Sept 30 fixture (fictitious) for tests |
| `apps/web/lib/reports/builders/daily-collection/treasurer.ts` (+ test) | part (a) and `depositLabel` |
| `apps/web/lib/reports/builders/daily-collection/matrix.ts` (+ test) | part (b): matrix and deposit block |
| `apps/web/lib/reports/builders/daily-collection/abstracts.ts` (+ test) | part (c) and `formatPeriods` |
| `apps/web/lib/reports/builders/daily-collection/report.ts` (+ test) | `dailyCollectionReport`: assembly, warnings, signatures, invariants |
| `apps/web/lib/reports/daily-data.ts` | `dailyCollectionData(date)`: the reads |
| `apps/web/lib/reports/data.ts` | exports `byIds` |
| `apps/web/lib/reports/catalog.ts` | `daily-collection` entry, first in the list |

---

### Task 1: Migration 072: signatories, the business-date index, `clear_all_data`

**Files:**
- Create: `supabase/migrations/20261014000072_daily_collection_report.sql`
- Create: `tests/db/report-signatories.test.ts`
- Modify: `tests/db/registry-parity.test.ts` (add `"report_signatories"` to `TABLES`)
- Modify: `packages/shared/src/db.types.ts` (regenerated)
- Modify: `apps/web/lib/admin/registry.ts` (new `report-signatories` entry after `collection-accounts`)
- Modify: `apps/web/lib/nav/modules.ts` (tab in the Accounts module)

**Interfaces:**
- Produces:
  - Table `ceedo_collections.report_signatories (id, report_key text, label text, name text null, title text null, sort_order int, active bool, created_at, row_version)`, with `unique (report_key, label)`.
  - Two seeded rows for `report_key = 'daily-collection'`: `('Prepared by', sort 10)` and `('Noted by', sort 20)`, each with `name` and `title` null.
  - Index `collections_business_date_idx`.
  - Registry resource key `report-signatories`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/report-signatories.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, type TestClient } from "../helpers/supabase";

let db: Client;
let admin: TestClient;
let accounting: TestClient;
let collector: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin } = await createAppUser({ email: "sig-admin", role: "admin" }));
  ({ client: accounting } = await createAppUser({ email: "sig-accounting", role: "accounting" }));
  ({ client: collector } = await createAppUser({ email: "sig-collector", role: "collector" }));
});
afterAll(async () => db.end());

describe("report_signatories", () => {
  it("seeds the Daily Collection Report's two blocks, without names", async () => {
    const { rows } = await db.query(
      `select label, name, title from ceedo_collections.report_signatories
        where report_key = 'daily-collection' order by sort_order`,
    );
    expect(rows).toEqual([
      { label: "Prepared by", name: null, title: null },
      { label: "Noted by", name: null, title: null },
    ]);
  });

  it("is read by back office, not by collectors", async () => {
    const back = await accounting.from("report_signatories").select("label");
    expect(back.error).toBeNull();
    expect((back.data ?? []).length).toBeGreaterThanOrEqual(2);
    const field = await collector.from("report_signatories").select("label");
    expect(field.data ?? []).toEqual([]);
  });

  it("is written by admins only", async () => {
    const denied = await accounting
      .from("report_signatories")
      .update({ name: "Someone" })
      .eq("report_key", "daily-collection")
      .eq("label", "Prepared by")
      .select("id");
    expect(denied.data ?? []).toEqual([]);

    const ok = await admin
      .from("report_signatories")
      .update({ title: "LRCO-I" })
      .eq("report_key", "daily-collection")
      .eq("label", "Prepared by")
      .select("title");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ title: "LRCO-I" }]);
    await db.query(`update ceedo_collections.report_signatories set title = null where label = 'Prepared by'`);
  });

  it("refuses a second block with the same label on the same report", async () => {
    await expect(
      db.query(
        `insert into ceedo_collections.report_signatories (report_key, label, sort_order)
         values ('daily-collection', 'Noted by', 30)`,
      ),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it("indexes collections by business date", async () => {
    const { rows } = await db.query(
      `select 1 from pg_indexes where schemaname = 'ceedo_collections'
          and indexname = 'collections_business_date_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("is kept by clear_all_data", async () => {
    const { rows } = await db.query(
      `select pg_get_functiondef('ceedo_collections.clear_all_data()'::regprocedure) as def`,
    );
    expect(rows[0].def).toMatch(/'report_signatories'/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/report-signatories.test.ts`
Expected: FAIL with `relation "ceedo_collections.report_signatories" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261014000072_daily_collection_report.sql
-- Collection reports phase 4 (spec report 1, Daily Collection Report).
--   * report_signatories: the names under "Prepared by" / "Noted by". Seeded WITHOUT
--     names -- real names never enter the repo; an admin types them in.
--   * collections (business_date): every daily report reads one date of receipts.
--   * clear_all_data keeps the signatories: they are configuration, not test data.

create table ceedo_collections.report_signatories (
  id          uuid primary key default gen_random_uuid(),
  report_key  text not null,
  label       text not null,
  name        text,
  title       text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (report_key, label)
);

select ceedo_collections.apply_master_data_policies('report_signatories');

insert into ceedo_collections.report_signatories (report_key, label, sort_order) values
  ('daily-collection', 'Prepared by', 10),
  ('daily-collection', 'Noted by',    20)
on conflict (report_key, label) do nothing;

create index if not exists collections_business_date_idx
  on ceedo_collections.collections (business_date);
```

Then append `create or replace function ceedo_collections.clear_all_data()`, copied **verbatim** from `20261008000071_account_catalogue.sql` (line 406 to the end of the function), together with its trailing `revoke`/`grant` lines. Apply exactly one edit, to the exclusion list:

```sql
     and c.relname not in ('app_users', 'settings', 'super_admins', 'deployed_migrations',
                           'report_signatories');
```

- [ ] **Step 4: Make `db reset` reproduce the seed**

Run: `grep -n "report_signatories" supabase/seed.sql || echo none`
Expected: `none`. The migration seeds its own rows with `on conflict do nothing`, so `seed.sql` needs no change. If the grep finds something, make it idempotent the same way.

- [ ] **Step 5: Apply, regenerate types, run the test**

Run:
```bash
supabase migration up
pnpm db:types
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/report-signatories.test.ts
```
Expected: 6 passed.

- [ ] **Step 6: Add the registry entry and nav tab**

In `tests/db/registry-parity.test.ts`, add `"report_signatories",` after `"collection_accounts",` in `TABLES`.

In `apps/web/lib/admin/registry.ts`, insert this entry right after the `collection-accounts` entry's closing `},`:

```ts
  {
    key: "report-signatories",
    table: "report_signatories",
    title: "Signatories",
    singular: "signatory",
    empty:
      "No signatories yet. A signatory is a name printed under a report's signature block, e.g. the Daily Collection Report's “Prepared by”.",
    schema: z.object({
      report_key: name,
      label: name,
      name: optionalText,
      title: optionalText,
      sort_order: z.number().int(),
      active: z.boolean(),
    }),
    fields: [
      { name: "report_key", label: "Report", type: "text", help: "e.g. daily-collection" },
      { name: "label", label: "Block", type: "text", help: "e.g. Prepared by" },
      { name: "name", label: "Name", type: "text" },
      { name: "title", label: "Title", type: "text", help: "e.g. LRCO-I" },
      { name: "sort_order", label: "Order", type: "number" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "report_key", label: "Report" },
      { key: "label", label: "Block" },
      { key: "name", label: "Name", emptyText: "—" },
      { key: "title", label: "Title", emptyText: "—" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select: "id, report_key, label, name, title, sort_order, active",
    orderBy: "sort_order",
    optionLabel: "label",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
```

If the registry's `fields` type rejects a nullable text field, copy what the `tenants` entry does for `address` (`optionalText`) exactly.

In `apps/web/lib/nav/modules.ts`, in the `accounts` module's `tabs`, add `{ resource: "report-signatories" },` after `{ resource: "rcd-columns" },`.

- [ ] **Step 7: Run the parity test and typecheck**

Run:
```bash
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/registry-parity.test.ts
pnpm --filter @ceedo/web typecheck
```
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261014000072_daily_collection_report.sql tests/db/report-signatories.test.ts \
  tests/db/registry-parity.test.ts packages/shared/src/db.types.ts apps/web/lib/admin/registry.ts apps/web/lib/nav/modules.ts
git commit -m "feat(db): report signatories, business-date index on collections"
```

---

### Task 2: Report framework: row styles, per-section layout, sheets, warnings

**Files:**
- Modify: `apps/web/lib/reports/report.ts`
- Modify: `apps/web/lib/reports/xlsx.ts`
- Modify: `apps/web/lib/reports/xlsx.test.ts`
- Modify: `apps/web/components/reports/report-document.tsx`
- Modify: `apps/web/app/(admin)/reports/[key]/page.tsx`

**Interfaces:**
- Produces (in `report.ts`):
  ```ts
  export type RowStyle = "heading" | "subtotal" | "total";
  /** A row's cells by column key, plus two reserved keys the renderers read. */
  export type ReportRow = Record<string, Cell> & { $style?: RowStyle; $indent?: number };
  export type Orientation = "portrait" | "landscape";
  export interface ReportSection {
    title?: string; columns: ReportColumn[]; rows: ReportRow[]; empty?: string; dense?: boolean;
    /** Label of the totals row; default "Total". */
    totalLabel?: string;
    /** Overrides Report.layout for this section. */
    orientation?: Orientation;
    /** Worksheet name in the xlsx (≤ 31 chars). Sections without one go on the first sheet. */
    sheet?: string;
    /** Start a new printed page before this section. */
    breakBefore?: boolean;
  }
  export interface Report {
    title: string; scope: string; sections: ReportSection[]; notes?: string[];
    signatures?: { label: string; name?: string; title?: string }[];
    /** Default orientation; landscape when unset (every existing report). */
    layout?: Orientation;
    /** Screen-only notices above the report, e.g. unclassified money. */
    warnings?: { text: string; href?: string; linkText?: string }[];
  }
  export function rowStyle(row: ReportRow): RowStyle | null;
  export function rowIndent(row: ReportRow): number;
  ```
- `sectionTotals` totals only rows **without** `$style`, so a section may carry its own sub-total rows and still have a totals row.
- Existing reports are unaffected: no field they set changes meaning.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/reports/xlsx.test.ts`:

```ts
describe("styled rows, sheets and layout", () => {
  const styled: Report = {
    title: "Daily Collection Report",
    scope: "30 September 2026",
    layout: "landscape",
    sections: [
      {
        title: "Daily Collection Report",
        sheet: "Treasurer",
        orientation: "portrait",
        columns: [
          { key: "item", label: "Particulars", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [
          { item: "Slaughterhouse fees", amount: 10_000 },
          { item: "Sub-total 1", amount: 10_000, $style: "subtotal" },
          { item: "Electricity", amount: 5_000, $indent: 1 },
          { item: "Grand total", amount: 15_000, $style: "total" },
        ],
      },
      {
        title: "Per collector",
        sheet: "Per collector",
        totalLabel: "Overall total",
        columns: [
          { key: "who", label: "Collector", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [{ who: "A", amount: 15_000 }],
      },
    ],
    signatures: [{ label: "Prepared by", name: "Someone", title: "LRCO-I" }],
  };

  it("leaves styled rows out of the section's totals", () => {
    expect(sectionTotals(styled.sections[0]!)).toEqual({ amount: 15_000 });
  });

  it("puts each sheet's sections on their own worksheet", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Treasurer", "Per collector"]);
    expect(book.getWorksheet("Treasurer")!.pageSetup.orientation).toBe("portrait");
    expect(book.getWorksheet("Per collector")!.pageSetup.orientation).toBe("landscape");
    expect(book.getWorksheet("Per collector")!.pageSetup.fitToWidth).toBe(1);
  });

  it("bolds sub-total and total rows, indents, and labels the totals row", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    const treasurer = book.getWorksheet("Treasurer")!;
    let sub: ExcelJS.Row | undefined;
    let indented: ExcelJS.Row | undefined;
    treasurer.eachRow((row) => {
      if (row.getCell(1).value === "Sub-total 1") sub = row;
      if (row.getCell(1).value === "Electricity") indented = row;
    });
    expect(sub!.font?.bold).toBe(true);
    expect(indented!.getCell(1).alignment?.indent).toBe(1);

    const rows: unknown[][] = [];
    book.getWorksheet("Per collector")!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows).toContainEqual(["Overall total", 150]);
  });

  it("prints a signatory's title after the name", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    const text: string[] = [];
    book.worksheets.forEach((s) => s.eachRow((row) => text.push((row.values as unknown[]).join(" "))));
    expect(text.join(" | ")).toContain("Prepared by: Someone, LRCO-I");
  });

  it("keeps a report without sheets on one worksheet named after the title", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(report)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Abstract of Collections"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/lib/reports/xlsx.test.ts`
Expected: FAIL. TypeScript/vitest complains about `$style`/`sheet`, and the styled-rows total is `30_000` instead of `15_000`.

- [ ] **Step 3: Implement `report.ts`**

Replace the `Report`, `ReportSection` and `sectionTotals` definitions in `apps/web/lib/reports/report.ts` with the following. Keep `ColumnKind`, `ReportColumn`, `Cell`, `pesos`, `fileName` and `cellText` unchanged.

```ts
export type Orientation = "portrait" | "landscape";

/**
 * One report, as data. Parent spec §10: every report exports to Excel AND to PDF, so a
 * report is built once, here, and rendered twice: `toXlsx` for the workbook accounting
 * re-keys into eNGAS, `ReportDocument` for the page printed or saved as PDF. Neither
 * renderer computes a figure. That keeps the two exports from disagreeing.
 */
export interface Report {
  title: string;
  /** What the report covers, e.g. "Maria Santos · 23 September 2026". */
  scope: string;
  sections: ReportSection[];
  /** Printed under the last section: basis of figures, caveats. */
  notes?: string[];
  /** Signature blocks, e.g. the COA forms' "Certified correct". */
  signatures?: { label: string; name?: string; title?: string }[];
  /** Default page orientation. Landscape when unset, as every report before phase 4. */
  layout?: Orientation;
  /** Screen-only notices shown above the report (never printed): e.g. unclassified money. */
  warnings?: { text: string; href?: string; linkText?: string }[];
}

/**
 * A row's look. Sub-total and total rows are figures the builder computed; they are
 * printed bold and left out of `sectionTotals`, so a section can carry its own
 * sub-totals and still have an ordinary totals row.
 */
export type RowStyle = "heading" | "subtotal" | "total";

/** Cells by column key, plus two reserved keys the renderers read and no column uses. */
export type ReportRow = Record<string, Cell> & { $style?: RowStyle; $indent?: number };

export function rowStyle(row: ReportRow): RowStyle | null {
  return row.$style ?? null;
}

export function rowIndent(row: ReportRow): number {
  return Math.max(0, Math.floor(Number(row.$indent ?? 0)));
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Shown instead of an empty table. */
  empty?: string;
  /** A wide grid (e.g. one column per day): small print, narrow Excel columns. */
  dense?: boolean;
  /** The totals row's label; "Total" when unset. */
  totalLabel?: string;
  /** This section's page orientation; `Report.layout` when unset. */
  orientation?: Orientation;
  /** The xlsx worksheet this section goes on (≤ 31 chars); the first sheet when unset. */
  sheet?: string;
  /** Start a new printed page before this section. */
  breakBefore?: boolean;
}

/**
 * The totals row of a section: each `total` column summed over its plain rows (styled
 * sub-total/total rows are already sums), as integers (centavos).
 */
export function sectionTotals(section: ReportSection): Record<string, number> | null {
  const totalled = section.columns.filter((c) => c.total);
  const plain = section.rows.filter((r) => rowStyle(r) === null);
  if (totalled.length === 0 || plain.length === 0) return null;
  const out: Record<string, number> = {};
  for (const column of totalled) {
    out[column.key] = plain.reduce((acc, row) => acc + Number(row[column.key] ?? 0), 0);
  }
  return out;
}
```

`cellText` takes `value: Cell | undefined`. `row[c.key]` on a `ReportRow` is `Cell | RowStyle | number | undefined`, which is still assignable, because `RowStyle` is a string. Leave `cellText` as is.

- [ ] **Step 4: Implement `xlsx.ts`**

Replace `toXlsx` in `apps/web/lib/reports/xlsx.ts` with this. `value` and `format` stay as they are.

```ts
import ExcelJS from "exceljs";
import { rowIndent, rowStyle, sectionTotals, type Report, type ReportColumn, type ReportSection } from "./report";

const MONEY = "#,##0.00;[Red]-#,##0.00";

/**
 * The Excel form of a report. Money goes in as a NUMBER of pesos with a money format, not
 * as text: accounting sums and re-keys these cells, and a figure stored as "1,234.56" text
 * is one they would have to retype. Parent §10.
 *
 * Sections go on the worksheet their `sheet` names, in order of first appearance; those
 * without one go on the first sheet, named after the report.
 */
export async function toXlsx(report: Report): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "CEEDO Collections";

  const sheets = new Map<string, ReportSection[]>();
  for (const section of report.sections) {
    const name = (section.sheet ?? report.title).slice(0, 31);
    sheets.set(name, [...(sheets.get(name) ?? []), section]);
  }
  if (sheets.size === 0) sheets.set(report.title.slice(0, 31), []);

  const names = [...sheets.keys()];
  names.forEach((name, index) => {
    const sections = sheets.get(name)!;
    const sheet = book.addWorksheet(name);
    writeSheet(sheet, report, sections, index === names.length - 1);
  });

  return Buffer.from(await book.xlsx.writeBuffer());
}

function writeSheet(sheet: ExcelJS.Worksheet, report: Report, sections: ReportSection[], last: boolean) {
  const width = Math.max(...sections.map((s) => s.columns.length), 1);

  const title = sheet.addRow([report.title]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([report.scope]).font = { italic: true };
  sheet.addRow([]);

  for (const section of sections) {
    if (section.title) sheet.addRow([section.title]).font = { bold: true };

    const header = sheet.addRow(section.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.border = { bottom: { style: "thin" } };
    });

    if (section.rows.length === 0) {
      sheet.addRow([section.empty ?? "None."]).font = { italic: true };
    }
    for (const row of section.rows) {
      const added = sheet.addRow(section.columns.map((c) => value(c, row[c.key])));
      format(added, section.columns);
      const style = rowStyle(row);
      if (style) added.font = { bold: true };
      if (style === "total") {
        added.eachCell((cell) => {
          cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
        });
      }
      const indent = rowIndent(row);
      if (indent > 0) added.getCell(1).alignment = { indent };
    }

    const totals = sectionTotals(section);
    if (totals) {
      const added = sheet.addRow(
        section.columns.map((c, i) =>
          c.key in totals ? value(c, totals[c.key]!) : i === 0 ? (section.totalLabel ?? "Total") : null,
        ),
      );
      added.font = { bold: true };
      added.eachCell((cell) => {
        cell.border = { top: { style: "thin" } };
      });
      format(added, section.columns);
    }
    sheet.addRow([]);
  }

  // Notes and signatures close the document, so they go on its last sheet only.
  if (last) {
    for (const note of report.notes ?? []) sheet.addRow([note]).font = { italic: true, size: 9 };
    if (report.signatures?.length) {
      sheet.addRow([]);
      sheet.addRow(
        report.signatures.map(
          (s) => `${s.label}: ${s.name ?? "________________"}${s.title ? `, ${s.title}` : ""}`,
        ),
      );
    }
  }

  const dense = sections.some((s) => s.dense);
  for (let i = 1; i <= width; i++) sheet.getColumn(i).width = i === 1 ? 26 : dense ? 10 : 16;
  if (dense) sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 0 }];

  const orientation = sections.some((s) => (s.orientation ?? report.layout ?? "landscape") === "landscape")
    ? "landscape"
    : "portrait";
  sheet.pageSetup = { orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}
```

`paperSize: 9` is A4 in ExcelJS. If the ExcelJS types reject a key, check `node_modules/exceljs/index.d.ts` for `PageSetup` and keep the same intent.

- [ ] **Step 5: Run the xlsx tests**

Run: `pnpm vitest run apps/web/lib/reports/xlsx.test.ts`
Expected: all pass, the existing ones included. The existing "carries … the signature line" test still passes because a report without sheets has a single, and therefore last, sheet.

- [ ] **Step 6: Implement the print renderer**

In `apps/web/components/reports/report-document.tsx`:

1. Import the new helpers: `import { cellText, rowIndent, rowStyle, sectionTotals, type Report, type ReportColumn } from "@/lib/reports/report";`
2. Replace the single `<style>` line with named pages. The default page follows `report.layout`, and sections that set `orientation` get their own named page:
   ```tsx
   const layout = report.layout ?? "landscape";
   const margin = report.sections.some((s) => s.dense) ? 6 : 12;
   // ...
   <style>{`@page { size: A4 ${layout}; margin: ${margin}mm; }
   @page portrait { size: A4 portrait; margin: ${margin}mm; }
   @page landscape { size: A4 landscape; margin: ${margin}mm; }`}</style>
   ```
3. On each `<section>`, set the named page and the break:
   ```tsx
   <section
     key={i}
     className={`mb-6 ${section.breakBefore ? "break-before-page" : ""} ${section.dense ? "" : "break-inside-avoid-page"}`}
     style={section.orientation ? ({ page: section.orientation } as React.CSSProperties) : undefined}
   >
   ```
   Keep the existing `break-inside-avoid-page` behaviour as it is today. The only additions are `break-before-page` when asked and the `page` style.
4. In `tbody`, style rows and indent the first cell:
   ```tsx
   {section.rows.map((row, r) => {
     const style = rowStyle(row);
     const indent = rowIndent(row);
     return (
       <tr
         key={r}
         className={`break-inside-avoid border-b border-black/15 ${
           style === "total" ? "border-y-2 border-black font-bold" : style === "subtotal" ? "border-t border-black font-semibold" : style === "heading" ? "font-semibold uppercase" : ""
         }`}
       >
         {section.columns.map((c, n) => (
           <td
             key={c.key}
             className={`${section.dense ? "px-0.5" : "px-1.5"} py-0.5 ${numeric(c) ? "text-right tabular-nums" : ""}`}
             style={n === 0 && indent > 0 ? { paddingLeft: `${0.375 + indent}rem` } : undefined}
           >
             {cellText(c, row[c.key], section.dense)}
           </td>
         ))}
       </tr>
     );
   })}
   ```
5. In `tfoot`, replace the literal `"Total"` with `section.totalLabel ?? "Total"`.
6. In the signatures block, under the name line, add the title:
   ```tsx
   <p className="mt-8 border-t border-black pt-1 text-center text-sm font-semibold">{s.name ?? " "}</p>
   {s.title ? <p className="text-center text-xs">{s.title}</p> : null}
   ```
7. Update the doc comment's "A4 landscape" to say "A4, landscape unless the report or a section says portrait".

If `React` is not in scope for the `React.CSSProperties` cast, add `import type { CSSProperties } from "react";` and cast to `CSSProperties`.

- [ ] **Step 7: Render warnings on the report page**

In `apps/web/app/(admin)/reports/[key]/page.tsx`, directly after the exceptions banner's closing `) : null}`, add:

```tsx
      {(report.warnings ?? []).map((w) => (
        <p
          key={w.text}
          className="mb-4 rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber print:hidden"
        >
          {w.text}{" "}
          {w.href ? (
            <Link href={w.href} className="font-semibold underline">
              {w.linkText ?? "Review"}
            </Link>
          ) : null}
        </p>
      ))}
```

- [ ] **Step 8: Typecheck and run the report tests**

Run:
```bash
pnpm --filter @ceedo/web typecheck
pnpm vitest run apps/web/lib/reports
```
Expected: no type errors, and every report test passes, the existing builder tests included. Some builders annotate rows as `Record<string, Cell>[]`; that is still assignable to `ReportRow[]`. If a builder fails to type, change its annotation to `ReportRow`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/reports/report.ts apps/web/lib/reports/xlsx.ts apps/web/lib/reports/xlsx.test.ts \
  apps/web/components/reports/report-document.tsx "apps/web/app/(admin)/reports/[key]/page.tsx"
git commit -m "feat(web): report rows carry styles; sections carry orientation, sheet, page break; screen warnings"
```

---

### Task 3: Daily input types, the fixture, and the Treasurer page

**Files:**
- Create: `apps/web/lib/reports/builders/daily-collection/types.ts`
- Create: `apps/web/lib/reports/builders/daily-collection/fixture.ts`
- Create: `apps/web/lib/reports/builders/daily-collection/treasurer.ts`
- Test: `apps/web/lib/reports/builders/daily-collection/treasurer.test.ts`

**Interfaces:**
- Consumes: `ReportRow`, `ReportSection` (Task 2).
- Produces:
  - `types.ts`: `DailyPortion`, `DailyAccount`, `DailyTreasurerLine`, `DailyRcdColumn`, `DailyShift`, `DailyCollector`, `DailyFacility`, `Named`, `DailyBooklet`, `DailyLease`, `RentCover`, `DailyCashTicket`, `DailySignatory`, `DailyInput`, and `byId<T>(rows): Map<string, T>`. Exact definitions below.
  - `fixture.ts`: `sept30(): DailyInput`, plus exported id constants used by the tests.
  - `treasurer.ts`: `treasurerSection(input: DailyInput): ReportSection`, `depositLabel(shiftIds: Iterable<string | null>, shifts: Map<string, DailyShift>): string | null`, `OTHER_LINE = "TL_OTHER"`.

- [ ] **Step 1: Write `types.ts`** (types only, no test of its own)

```ts
// apps/web/lib/reports/builders/daily-collection/types.ts
import type { Centavos } from "@ceedo/shared";

/**
 * One row of receipt_account_lines (migration 070): a receipt PORTION placed on one
 * account. Every figure in the Daily Collection Report is a sum of these, which is what
 * makes the Treasurer page, the matrix and the abstracts agree by construction.
 */
export interface DailyPortion {
  source: "receipt" | "cash_ticket";
  collectionId: string | null;
  cashTicketId: string | null;
  lineId: string | null;
  orNo: number | null;
  bookletId: string | null;
  shiftId: string | null;
  collectorId: string;
  leaseId: string | null;
  payerRef: string | null;
  feeTypeId: string;
  facilityId: string | null;
  sectionId: string | null;
  rateClass: string | null;
  quantity: number | null;
  accountId: string;
  paymentMode: "cash" | "check";
  amount: Centavos;
  /** Status as of now; every total excludes these, the abstracts list them at zero. */
  cancelled: boolean;
}

export interface DailyAccount {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  treasurerLineId: string;
  rcdColumnId: string;
}

export interface DailyTreasurerLine {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  subtotalGroup: 1 | 2;
  active: boolean;
}

export interface DailyRcdColumn {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** A shift and the live remittance covering it, if any. */
export interface DailyShift {
  id: string;
  deposit: { on: string; verified: boolean } | null;
}

/** Every collector-role user, plus anyone else who collected that day. */
export interface DailyCollector {
  id: string;
  name: string;
  active: boolean;
}

export interface DailyFacility {
  id: string;
  name: string;
  type: "market" | "terminal" | "parking" | "slaughterhouse" | "other";
}

export interface Named {
  id: string;
  name: string;
}

export interface DailyBooklet {
  id: string;
  label: string;
}

export interface DailyLease {
  id: string;
  tenantName: string;
  stallNo: string;
}

/** What a lease receipt settled: all its allocations, and the rental periods among them. */
export interface RentCover {
  collectionId: string;
  allocated: Centavos;
  periods: { start: string; end: string }[];
}

export interface DailyCashTicket {
  id: string;
  ticketFrom: number | null;
  ticketTo: number | null;
  note: string | null;
}

export interface DailySignatory {
  label: string;
  name: string | null;
  title: string | null;
}

export interface DailyInput {
  /** The business date, YYYY-MM-DD. */
  date: string;
  portions: DailyPortion[];
  accounts: DailyAccount[];
  treasurerLines: DailyTreasurerLine[];
  rcdColumns: DailyRcdColumn[];
  shifts: DailyShift[];
  collectors: DailyCollector[];
  facilities: DailyFacility[];
  sections: Named[];
  feeTypes: Named[];
  booklets: DailyBooklet[];
  leases: DailyLease[];
  rentCover: RentCover[];
  cashTickets: DailyCashTicket[];
  signatories: DailySignatory[];
  /** The built-in UNCLASSIFIED account's id; null only if the chart is missing it. */
  unclassifiedAccountId: string | null;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** The account a portion sits on; a portion on an account missing from the chart is a bug. */
export function accountOf(accounts: Map<string, DailyAccount>, p: DailyPortion): DailyAccount {
  const a = accounts.get(p.accountId);
  if (!a) throw new Error(`Account ${p.accountId} is not in the chart`);
  return a;
}
```

- [ ] **Step 2: Write `fixture.ts`**

This is a trimmed Sept 30 day with fictitious names, already classified. Its figures are worked out in the comments, and the tests assert them.

```ts
// apps/web/lib/reports/builders/daily-collection/fixture.ts
import { fromPesos } from "@ceedo/shared";
import type { DailyInput, DailyPortion } from "./types";

/**
 * A trimmed, fictitious 30 September 2026 (spec "Testing"): four collectors, every kind of
 * row the report has to handle. Live totals:
 *   A  600 + 18 (lease 1001) + 1,722 + 34.44 (EBP 2001) + 1,000 (office, check, 2002) = 3,374.44
 *      (OR 1002, 200, is cancelled)
 *   B  825 + 275 (ante 3001, split 75/25) + 30 (terminal 3002) + 50 (unclassified 3003) = 1,180.00
 *   C  nothing (active)
 *   D  3,000 cash tickets (inactive collector, shift not deposited)
 *   E  nothing (inactive): appears nowhere
 * Grand total 7,554.44; checks 1,000.00; deposited 4,554.44; undeposited 3,000.00.
 */
export const ID = {
  colA: "col-a", colB: "col-b", colC: "col-c", colD: "col-d", colE: "col-e",
  shA: "sh-a", shAOffice: "sh-a-office", shB: "sh-b", shD: "sh-d",
  bkA1: "bk-a1", bkA2: "bk-a2", bkB1: "bk-b1",
  facPM: "fac-pm", facIBJT: "fac-ibjt", facSLH: "fac-slh",
  secFish: "sec-fish",
  lease1: "lease-1", lease2: "lease-2",
  ftRent: "ft-rent", ftElec: "ft-elec", ftElecSur: "ft-elec-sur", ftAnte: "ft-ante",
  ftTerminal: "ft-terminal", ftMisc: "ft-misc", ftPmCr: "ft-pm-cr",
  accPmRent: "acc-pm-rent", accPmSur: "acc-pm-sur", accPmCr: "acc-pm-cr", accSlhAnte: "acc-slh-ante",
  accNmis: "acc-nmis", accTf: "acc-tf", accElec: "acc-elec", accElecSur: "acc-elec-sur", accUnc: "acc-unc",
} as const;

const P = (pesos: number) => fromPesos(pesos);

function portion(over: Partial<DailyPortion> & Pick<DailyPortion, "collectorId" | "accountId" | "amount">): DailyPortion {
  return {
    source: "receipt", collectionId: null, cashTicketId: null, lineId: null, orNo: null, bookletId: null,
    shiftId: null, leaseId: null, payerRef: null, feeTypeId: ID.ftRent, facilityId: null, sectionId: null,
    rateClass: null, quantity: null, paymentMode: "cash", cancelled: false, ...over,
  };
}

export function sept30(): DailyInput {
  const a = { collectorId: ID.colA, shiftId: ID.shA };
  const b = { collectorId: ID.colB, shiftId: ID.shB, bookletId: ID.bkB1 };
  return {
    date: "2026-09-30",
    portions: [
      // A, booklet A1: a lease receipt (base + surcharge), then a cancelled one.
      portion({ ...a, collectionId: "c1", orNo: 1001, bookletId: ID.bkA1, leaseId: ID.lease1,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent, amount: P(600) }),
      portion({ ...a, collectionId: "c1", orNo: 1001, bookletId: ID.bkA1, leaseId: ID.lease1,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmSur, amount: P(18) }),
      portion({ ...a, collectionId: "c2", orNo: 1002, bookletId: ID.bkA1, leaseId: ID.lease2,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent, amount: P(200), cancelled: true }),
      // A, booklet A2: electricity bill + its surcharge on one OR, then an office receipt by check.
      portion({ ...a, collectionId: "c3", lineId: "l3a", orNo: 2001, bookletId: ID.bkA2, payerRef: "Stall F-9",
        feeTypeId: ID.ftElec, facilityId: ID.facPM, accountId: ID.accElec, amount: P(1722) }),
      portion({ ...a, collectionId: "c3", lineId: "l3b", orNo: 2001, bookletId: ID.bkA2, payerRef: "Stall F-9",
        feeTypeId: ID.ftElecSur, facilityId: ID.facPM, accountId: ID.accElecSur, amount: P(34.44) }),
      portion({ collectorId: ID.colA, shiftId: ID.shAOffice, collectionId: "c4", orNo: 2002, bookletId: ID.bkA2,
        leaseId: ID.lease1, facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent,
        paymentMode: "check", amount: P(1000) }),
      // B, booklet B1: ante-mortem split 75/25, a terminal fee, an unclassified fee.
      portion({ ...b, collectionId: "c5", lineId: "l5", orNo: 3001, payerRef: "Owner One", feeTypeId: ID.ftAnte,
        facilityId: ID.facSLH, rateClass: "Hog", quantity: 2, accountId: ID.accSlhAnte, amount: P(825) }),
      portion({ ...b, collectionId: "c5", lineId: "l5", orNo: 3001, payerRef: "Owner One", feeTypeId: ID.ftAnte,
        facilityId: ID.facSLH, rateClass: "Hog", quantity: 2, accountId: ID.accNmis, amount: P(275) }),
      portion({ ...b, collectionId: "c6", lineId: "l6", orNo: 3002, payerRef: "KVX 123", feeTypeId: ID.ftTerminal,
        facilityId: ID.facIBJT, rateClass: "RTMI", quantity: 1, accountId: ID.accTf, amount: P(30) }),
      portion({ ...b, collectionId: "c7", lineId: "l7", orNo: 3003, feeTypeId: ID.ftMisc,
        facilityId: ID.facPM, accountId: ID.accUnc, amount: P(50) }),
      // D: cash tickets on a shift not yet deposited.
      portion({ source: "cash_ticket", cashTicketId: "ct1", collectorId: ID.colD, shiftId: ID.shD,
        feeTypeId: ID.ftPmCr, facilityId: ID.facPM, accountId: ID.accPmCr, amount: P(3000) }),
    ],
    accounts: [
      { id: ID.accPmRent, code: "CPM-DR-FRESHFISH", name: "Fresh Fish Section - Daily Rent", sortOrder: 80, treasurerLineId: "tl-pm", rcdColumnId: "rc-pm" },
      { id: ID.accPmCr, code: "CPM-CR", name: "City Public Mall CR", sortOrder: 380, treasurerLineId: "tl-pm-cr", rcdColumnId: "rc-pm" },
      { id: ID.accTf, code: "IBJT-TF-RTMI", name: "Terminal Fee - RTMI", sortOrder: 600, treasurerLineId: "tl-ibjt", rcdColumnId: "rc-ibjt" },
      { id: ID.accSlhAnte, code: "SLH-ANTE", name: "Ante Mortem", sortOrder: 660, treasurerLineId: "tl-slh", rcdColumnId: "rc-slh" },
      { id: ID.accPmSur, code: "SUR-RENT-CPM", name: "Public Mall Rental Surcharge", sortOrder: 760, treasurerLineId: "tl-other", rcdColumnId: "rc-sur" },
      { id: ID.accElecSur, code: "SUR-ELEC-CPM", name: "Public Mall Electricity Surcharge", sortOrder: 790, treasurerLineId: "tl-elec-sur", rcdColumnId: "rc-elec-sur" },
      { id: ID.accNmis, code: "NI-NMIS", name: "Ante Mortem/Post-Mortem NMIS", sortOrder: 930, treasurerLineId: "tl-nmis", rcdColumnId: "rc-nmis" },
      { id: ID.accElec, code: "NI-ELEC-CPM", name: "Public Mall Electricity", sortOrder: 960, treasurerLineId: "tl-elec", rcdColumnId: "rc-elec" },
      { id: ID.accUnc, code: "UNCLASSIFIED", name: "Unclassified", sortOrder: 99999, treasurerLineId: "tl-other", rcdColumnId: "rc-other" },
    ],
    treasurerLines: [
      { id: "tl-slh", code: "TL_SLH", name: "Slaughterhouse fees", sortOrder: 10, subtotalGroup: 1, active: true },
      { id: "tl-pm", code: "TL_PM", name: "Public Mall stall rentals/misc", sortOrder: 20, subtotalGroup: 1, active: true },
      { id: "tl-pm-cr", code: "TL_PM_CR", name: "Public Mall CR", sortOrder: 30, subtotalGroup: 1, active: true },
      { id: "tl-ibjt", code: "TL_IBJT", name: "IBJT stall rentals/parking/misc", sortOrder: 40, subtotalGroup: 1, active: true },
      { id: "tl-cem", code: "TL_CEM", name: "Public cemetery", sortOrder: 70, subtotalGroup: 1, active: true },
      { id: "tl-other", code: "TL_OTHER", name: "Other collections", sortOrder: 110, subtotalGroup: 1, active: true },
      { id: "tl-nmis", code: "TL_NMIS", name: "Ante/post-mortem fees", sortOrder: 200, subtotalGroup: 2, active: true },
      { id: "tl-elec", code: "TL_ELEC", name: "Electricity bill payments", sortOrder: 210, subtotalGroup: 2, active: true },
      { id: "tl-elec-sur", code: "TL_ELEC_SUR", name: "Surcharges on electricity bill payments", sortOrder: 220, subtotalGroup: 2, active: true },
    ],
    rcdColumns: [
      { id: "rc-pm", code: "RC_PM", name: "Public Mall", sortOrder: 10, active: true },
      { id: "rc-sur", code: "RC_SUR", name: "Surcharges – stall rentals", sortOrder: 20, active: true },
      { id: "rc-slh", code: "RC_SLH", name: "Slaughterhouse", sortOrder: 30, active: true },
      { id: "rc-nmis", code: "RC_NMIS", name: "Ante/post-mortems", sortOrder: 40, active: true },
      { id: "rc-ibjt", code: "RC_IBJT", name: "IBJT", sortOrder: 50, active: true },
      { id: "rc-cem", code: "RC_CEM", name: "Public cemetery", sortOrder: 70, active: true },
      { id: "rc-elec", code: "RC_ELEC", name: "Electricity bill payments", sortOrder: 100, active: true },
      { id: "rc-elec-sur", code: "RC_ELEC_SUR", name: "Surcharges – electricity", sortOrder: 110, active: true },
      { id: "rc-other", code: "RC_OTHER", name: "Other collections", sortOrder: 120, active: true },
    ],
    shifts: [
      { id: ID.shA, deposit: { on: "2026-10-01", verified: true } },
      { id: ID.shAOffice, deposit: { on: "2026-10-02", verified: true } },
      { id: ID.shB, deposit: { on: "2026-10-01", verified: false } },
      { id: ID.shD, deposit: null },
    ],
    collectors: [
      { id: ID.colA, name: "Collector A", active: true },
      { id: ID.colB, name: "Collector B", active: true },
      { id: ID.colC, name: "Collector C", active: true },
      { id: ID.colD, name: "Collector D", active: false },
      { id: ID.colE, name: "Collector E", active: false },
    ],
    facilities: [
      { id: ID.facPM, name: "Public Mall", type: "market" },
      { id: ID.facIBJT, name: "IBJT", type: "terminal" },
      { id: ID.facSLH, name: "Slaughterhouse", type: "slaughterhouse" },
    ],
    sections: [{ id: ID.secFish, name: "Fresh Fish" }],
    feeTypes: [
      { id: ID.ftRent, name: "Market stall rental (daily)" },
      { id: ID.ftElec, name: "Electricity bill payment (Public Mall)" },
      { id: ID.ftElecSur, name: "Electricity surcharge (Public Mall)" },
      { id: ID.ftAnte, name: "Ante-mortem fee" },
      { id: ID.ftTerminal, name: "Terminal fee" },
      { id: ID.ftMisc, name: "Miscellaneous fee" },
      { id: ID.ftPmCr, name: "PM CR cash ticket" },
    ],
    booklets: [
      { id: ID.bkA1, label: "A1" },
      { id: ID.bkA2, label: "A2" },
      { id: ID.bkB1, label: "B1" },
    ],
    leases: [
      { id: ID.lease1, tenantName: "Tenant One", stallNo: "F-1" },
      { id: ID.lease2, tenantName: "Tenant Two", stallNo: "F-2" },
    ],
    rentCover: [
      { collectionId: "c1", allocated: P(618), periods: [
        { start: "2026-09-27", end: "2026-09-27" }, { start: "2026-09-28", end: "2026-09-28" },
        { start: "2026-09-29", end: "2026-09-29" }, { start: "2026-09-30", end: "2026-09-30" },
      ] },
      { collectionId: "c2", allocated: P(200), periods: [{ start: "2026-09-30", end: "2026-09-30" }] },
      { collectionId: "c4", allocated: P(800), periods: [{ start: "2026-10-01", end: "2026-10-05" }] },
    ],
    cashTickets: [{ id: "ct1", ticketFrom: 1, ticketTo: 600, note: null }],
    signatories: [
      { label: "Prepared by", name: "Signer One", title: "LRCO-I" },
      { label: "Noted by", name: null, title: null },
    ],
    unclassifiedAccountId: ID.accUnc,
  };
}
```

- [ ] **Step 3: Write the failing test**

```ts
// apps/web/lib/reports/builders/daily-collection/treasurer.test.ts
import { describe, expect, it } from "vitest";
import { sept30 } from "./fixture";
import { depositLabel, treasurerSection } from "./treasurer";

const rowsOf = () => treasurerSection(sept30()).rows;
const line = (name: string) => rowsOf().find((r) => r.particulars === name)!;

describe("treasurerSection", () => {
  it("lists lines in order with Sub-total 1, Sub-total 2 and the Grand total", () => {
    expect(rowsOf().map((r) => [r.particulars, r.amount, r.$style ?? null])).toEqual([
      ["Slaughterhouse fees", 82_500, null],
      ["Public Mall stall rentals/misc", 160_000, null],
      ["Public Mall CR", 300_000, null],
      ["IBJT stall rentals/parking/misc", 3_000, null],
      ["Public cemetery", null, null],
      ["Other collections", 6_800, null],
      ["Sub-total 1", 552_300, "subtotal"],
      ["Ante/post-mortem fees", 27_500, null],
      ["Electricity bill payments", 172_200, null],
      ["Surcharges on electricity bill payments", 3_444, null],
      ["Sub-total 2", 203_144, "subtotal"],
      ["Grand total", 755_444, "total"],
    ]);
  });

  it("leaves cancelled receipts out", () => {
    // OR 1002 (200.00, cancelled) is on the Public Mall line; the line holds only 600 + 1,000.
    expect(line("Public Mall stall rentals/misc").amount).toBe(160_000);
  });

  it("dates each line's collection and its deposit", () => {
    expect(line("Slaughterhouse fees")).toMatchObject({ collected: "2026-09-30", deposited: "2026-10-01 (unverified)" });
    expect(line("Public Mall stall rentals/misc").deposited).toBe("2026-10-02");
    expect(line("Public cemetery")).toMatchObject({ collected: null, deposited: null });
  });

  it("reads Undeposited when any shift behind the line is not deposited", () => {
    expect(line("Public Mall CR").deposited).toBe("Undeposited");
  });

  it("hides an empty Other collections line, and shows any line holding money", () => {
    const input = sept30();
    input.portions = input.portions.filter((p) => p.accountId !== "acc-unc" && p.accountId !== "acc-pm-sur");
    expect(treasurerSection(input).rows.map((r) => r.particulars)).not.toContain("Other collections");

    const inactive = sept30();
    inactive.treasurerLines = inactive.treasurerLines.map((l) => (l.code === "TL_PM_CR" ? { ...l, active: false } : l));
    expect(treasurerSection(inactive).rows.map((r) => r.particulars)).toContain("Public Mall CR");
  });

  it("is portrait, on the Treasurer sheet, with no automatic totals row", () => {
    const s = treasurerSection(sept30());
    expect(s.orientation).toBe("portrait");
    expect(s.sheet).toBe("Treasurer");
    expect(s.columns.some((c) => c.total)).toBe(false);
  });
});

describe("depositLabel", () => {
  const shifts = new Map([
    ["s1", { id: "s1", deposit: { on: "2026-10-01", verified: true } }],
    ["s2", { id: "s2", deposit: { on: "2026-10-03", verified: true } }],
    ["s3", { id: "s3", deposit: null }],
  ]);
  it("takes the latest deposit date", () => expect(depositLabel(["s1", "s2"], shifts)).toBe("2026-10-03"));
  it("is Undeposited for a receipt on no shift", () => expect(depositLabel(["s1", null], shifts)).toBe("Undeposited"));
  it("is Undeposited for an unknown shift", () => expect(depositLabel(["zz"], shifts)).toBe("Undeposited"));
  it("is null with no shifts", () => expect(depositLabel([], shifts)).toBeNull());
  it("is Undeposited when one is not deposited", () => expect(depositLabel(["s1", "s3"], shifts)).toBe("Undeposited"));
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/treasurer.test.ts`
Expected: FAIL with `Cannot find module './treasurer'`.

- [ ] **Step 5: Implement `treasurer.ts`**

```ts
// apps/web/lib/reports/builders/daily-collection/treasurer.ts
import type { ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyInput, type DailyShift } from "./types";

/** The built-in holding line for accounts the office has not placed (migration 066). */
export const OTHER_LINE = "TL_OTHER";

/**
 * Date of deposit for money collected on these shifts: the latest live deposit covering
 * them, "(unverified)" if any covering deposit is not yet verified, and "Undeposited" while
 * any of them -- or a receipt on no shift -- is not deposited at all. Null with no shifts.
 */
export function depositLabel(shiftIds: Iterable<string | null>, shifts: Map<string, DailyShift>): string | null {
  let latest: string | null = null;
  let unverified = false;
  let any = false;
  for (const id of shiftIds) {
    any = true;
    const deposit = id ? (shifts.get(id)?.deposit ?? null) : null;
    if (!deposit) return "Undeposited";
    if (latest === null || deposit.on > latest) latest = deposit.on;
    if (!deposit.verified) unverified = true;
  }
  if (!any) return null;
  return unverified ? `${latest} (unverified)` : latest;
}

/**
 * Part (a), the page sent to the City Treasurer: one row per Treasurer line, Sub-total 1
 * and Sub-total 2 after their groups, then the Grand total. Lines with nothing that day
 * stay on the page blank, as the office's form lists them all -- except the built-in
 * "Other collections", which is shown only when it holds money (and then always).
 */
export function treasurerSection(input: DailyInput): ReportSection {
  const accounts = byId(input.accounts);
  const shifts = byId(input.shifts);
  const amount = new Map<string, number>();
  const shiftsOf = new Map<string, Set<string | null>>();
  for (const p of input.portions) {
    if (p.cancelled) continue;
    const lineId = accountOf(accounts, p).treasurerLineId;
    amount.set(lineId, (amount.get(lineId) ?? 0) + p.amount);
    shiftsOf.set(lineId, (shiftsOf.get(lineId) ?? new Set<string | null>()).add(p.shiftId));
  }

  const shown = input.treasurerLines
    .filter((l) => (l.active && l.code !== OTHER_LINE) || (amount.get(l.id) ?? 0) !== 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows: ReportRow[] = [];
  let grand = 0;
  for (const group of [1, 2] as const) {
    let sum = 0;
    for (const l of shown.filter((x) => x.subtotalGroup === group)) {
      const a = amount.get(l.id) ?? 0;
      sum += a;
      rows.push({
        particulars: l.name,
        collected: a ? input.date : null,
        amount: a || null,
        deposited: a ? depositLabel(shiftsOf.get(l.id) ?? [], shifts) : null,
      });
    }
    grand += sum;
    rows.push({ particulars: `Sub-total ${group}`, collected: null, amount: sum, deposited: null, $style: "subtotal" });
  }
  rows.push({ particulars: "Grand total", collected: null, amount: grand, deposited: null, $style: "total" });

  return {
    title: "Daily Collection Report",
    orientation: "portrait",
    sheet: "Treasurer",
    columns: [
      { key: "particulars", label: "Particulars", kind: "text" },
      { key: "collected", label: "Date of collection", kind: "date" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "deposited", label: "Date of deposit", kind: "text" },
    ],
    rows,
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/treasurer.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/reports/builders/daily-collection/
git commit -m "feat(web): Daily Collection Report, Treasurer page (part a)"
```

---

### Task 4: Collections per collector (part b)

**Files:**
- Create: `apps/web/lib/reports/builders/daily-collection/matrix.ts`
- Test: `apps/web/lib/reports/builders/daily-collection/matrix.test.ts`

**Interfaces:**
- Consumes: `DailyInput`, `byId`, `accountOf` (Task 3); `ReportSection` (Task 2).
- Produces: `matrixSections(input: DailyInput): [ReportSection, ReportSection]`. The first is the matrix, keyed by `collector`, one key per shown RCD column's `code`, and `total`. The second is the deposit block, keyed by `item` and `amount`. `OTHER_COLUMN = "RC_OTHER"`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/reports/builders/daily-collection/matrix.test.ts
import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { sept30 } from "./fixture";
import { matrixSections } from "./matrix";

describe("matrixSections", () => {
  it("has one row per active collector and per collector who collected, by name", () => {
    const [matrix] = matrixSections(sept30());
    // C is active with nothing; D is inactive but collected; E is inactive with nothing.
    expect(matrix.rows.map((r) => r.collector)).toEqual(["Collector A", "Collector B", "Collector C", "Collector D"]);
  });

  it("puts each collector's live money in the RCD columns and totals the row", () => {
    const [matrix] = matrixSections(sept30());
    const a = matrix.rows[0]!;
    expect(a).toMatchObject({ RC_PM: 160_000, RC_SUR: 1_800, RC_ELEC: 172_200, RC_ELEC_SUR: 3_444, total: 337_444 });
    expect(a.RC_SLH).toBeNull();
    const c = matrix.rows[2]!;
    expect(c.total).toBeNull();
  });

  it("shows active columns in order, Other collections only when it holds money", () => {
    const [matrix] = matrixSections(sept30());
    expect(matrix.columns.map((c) => c.key)).toEqual([
      "collector", "RC_PM", "RC_SUR", "RC_SLH", "RC_NMIS", "RC_IBJT", "RC_CEM", "RC_ELEC", "RC_ELEC_SUR", "RC_OTHER", "total",
    ]);
    const input = sept30();
    input.portions = input.portions.filter((p) => p.accountId !== "acc-unc");
    expect(matrixSections(input)[0].columns.map((c) => c.key)).not.toContain("RC_OTHER");
  });

  it("totals to the grand total", () => {
    const [matrix] = matrixSections(sept30());
    expect(sectionTotals(matrix)!.total).toBe(755_444);
  });

  it("splits the deposit block into checks and cash, deposited and not", () => {
    const [, deposit] = matrixSections(sept30());
    expect(deposit.rows.map((r) => [r.item, r.amount])).toEqual([
      ["Less: checks", 100_000],
      ["Cash", 655_444],
      ["Total deposit", 455_444],
      ["Undeposited", 300_000],
      ["Total collection", 755_444],
    ]);
  });

  it("omits the Undeposited row when everything is deposited", () => {
    const input = sept30();
    input.shifts = input.shifts.map((s) => (s.deposit ? s : { ...s, deposit: { on: "2026-10-01", verified: true } }));
    expect(matrixSections(input)[1].rows.map((r) => r.item)).not.toContain("Undeposited");
  });

  it("is landscape on the Per collector sheet", () => {
    const [matrix, deposit] = matrixSections(sept30());
    expect([matrix.orientation, matrix.sheet, matrix.breakBefore]).toEqual(["landscape", "Per collector", true]);
    expect([deposit.orientation, deposit.sheet]).toEqual(["landscape", "Per collector"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/matrix.test.ts`
Expected: FAIL with `Cannot find module './matrix'`.

- [ ] **Step 3: Implement `matrix.ts`**

```ts
// apps/web/lib/reports/builders/daily-collection/matrix.ts
import type { ReportColumn, ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyInput } from "./types";

/** The built-in holding column for accounts the office has not placed (migration 066). */
export const OTHER_COLUMN = "RC_OTHER";

/**
 * Part (b), Collections per collector: one row per active collector -- those with nothing
 * that day too, as the office's sheet lists them all -- and per anyone else who collected,
 * so no peso on the Treasurer page is missing here. Then the deposit block.
 */
export function matrixSections(input: DailyInput): [ReportSection, ReportSection] {
  const accounts = byId(input.accounts);
  const columnsById = byId(input.rcdColumns);
  const shifts = byId(input.shifts);

  const byCollector = new Map<string, Map<string, number>>();
  const used = new Set<string>();
  let total = 0;
  let checks = 0;
  let deposited = 0;
  for (const p of input.portions) {
    if (p.cancelled) continue;
    const columnId = accountOf(accounts, p).rcdColumnId;
    used.add(columnId);
    const cells = byCollector.get(p.collectorId) ?? new Map<string, number>();
    cells.set(columnId, (cells.get(columnId) ?? 0) + p.amount);
    byCollector.set(p.collectorId, cells);
    total += p.amount;
    if (p.paymentMode === "check") checks += p.amount;
    if (p.shiftId && shifts.get(p.shiftId)?.deposit) deposited += p.amount;
  }

  const shown = input.rcdColumns
    .filter((c) => (c.active && c.code !== OTHER_COLUMN) || used.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const names = new Map(input.collectors.map((c) => [c.id, c]));
  const rowIds = new Set([
    ...input.collectors.filter((c) => c.active).map((c) => c.id),
    ...byCollector.keys(),
  ]);
  const name = (id: string) => names.get(id)?.name ?? "Unknown collector";

  const rows: ReportRow[] = [...rowIds]
    .sort((a, b) => name(a).localeCompare(name(b)))
    .map((id) => {
      const cells = byCollector.get(id);
      const row: ReportRow = { collector: name(id) };
      let sum = 0;
      for (const c of shown) {
        const v = cells?.get(c.id) ?? 0;
        row[c.code] = v || null;
        sum += v;
      }
      row.total = sum || null;
      return row;
    });

  const columns: ReportColumn[] = [
    { key: "collector", label: "Collector", kind: "text" },
    ...shown.map((c) => ({ key: c.code, label: columnsById.get(c.id)!.name, kind: "money" as const, total: true })),
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const depositRows: ReportRow[] = [
    { item: "Less: checks", amount: checks },
    { item: "Cash", amount: total - checks },
    { item: "Total deposit", amount: deposited },
    ...(total - deposited !== 0 ? [{ item: "Undeposited", amount: total - deposited }] : []),
    { item: "Total collection", amount: total, $style: "total" as const },
  ];

  return [
    {
      title: "Collections per collector",
      orientation: "landscape",
      sheet: "Per collector",
      breakBefore: true,
      totalLabel: "Over-all total",
      columns,
      rows,
      empty: "No collector is active and no one collected this day.",
    },
    {
      title: "Remittances / deposits",
      orientation: "landscape",
      sheet: "Per collector",
      columns: [
        { key: "item", label: "", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: depositRows,
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/matrix.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/builders/daily-collection/matrix.ts apps/web/lib/reports/builders/daily-collection/matrix.test.ts
git commit -m "feat(web): Daily Collection Report, collections per collector and deposits (part b)"
```

---

### Task 5: Abstracts (part c)

**Files:**
- Create: `apps/web/lib/reports/builders/daily-collection/abstracts.ts`
- Test: `apps/web/lib/reports/builders/daily-collection/abstracts.test.ts`

**Interfaces:**
- Consumes: `DailyInput`, `byId`, `accountOf` (Task 3).
- Produces:
  - `formatPeriods(periods: { start: string; end: string }[]): string | null`.
  - `abstractSections(input: DailyInput): ReportSection[]`. All are landscape on sheet `"Abstracts"`.
  - Each collector who has any receipt (live or cancelled) or cash ticket that day gets, in this order:
    1. one section per booklet, titled `"<name> · Booklet <label> (k/n)"` with `totalLabel` `"Total k/n"`. Only the first has `breakBefore`.
    2. if they sold cash tickets, `"<name> · Cash tickets"`;
    3. `"<name> · Summary by section"`, keyed by `place`, `account` and `amount`.
  - If no collector has anything, there is a single empty section.
  - Booklet section keys: `no` (int), `or` (text), `name`, `section`, `stall`, then `plate` if a terminal row is present, then `variety` and `heads` (int) if a slaughterhouse row is present, then `amount` (money, total), `total` (money, total) and `remarks`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/reports/builders/daily-collection/abstracts.test.ts
import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { abstractSections, formatPeriods } from "./abstracts";
import { sept30 } from "./fixture";

const titled = (title: string) => abstractSections(sept30()).find((s) => s.title === title)!;

describe("abstractSections", () => {
  it("gives each collector who collected their booklets, tickets and summary, by name", () => {
    expect(abstractSections(sept30()).map((s) => s.title)).toEqual([
      "Collector A · Booklet A1 (1/2)",
      "Collector A · Booklet A2 (2/2)",
      "Collector A · Summary by section",
      "Collector B · Booklet B1 (1/1)",
      "Collector B · Summary by section",
      "Collector D · Cash tickets",
      "Collector D · Summary by section",
    ]);
  });

  it("lists a lease receipt once, base and surcharge together, with the rent it settled", () => {
    const [first] = titled("Collector A · Booklet A1 (1/2)").rows;
    expect(first).toMatchObject({
      no: 1, or: "1001", name: "Tenant One", section: "Public Mall · Fresh Fish", stall: "F-1",
      amount: 61_800, total: 61_800, remarks: "Sept 27–30",
    });
  });

  it("lists a cancelled receipt at zero", () => {
    const rows = titled("Collector A · Booklet A1 (1/2)").rows;
    expect(rows[1]).toMatchObject({ no: 2, or: "1002", amount: 0, total: 0, remarks: "(cancelled)" });
    expect(sectionTotals(titled("Collector A · Booklet A1 (1/2)"))).toEqual({ amount: 61_800, total: 61_800 });
  });

  it("shows each line of a several-line OR, with the OR total on its first row", () => {
    const rows = titled("Collector A · Booklet A2 (2/2)").rows;
    expect(rows.slice(0, 2).map((r) => [r.no, r.or, r.amount, r.total, r.remarks])).toEqual([
      [1, "2001", 172_200, 175_644, "Electricity bill payment (Public Mall)"],
      [null, null, 3_444, null, "Electricity surcharge (Public Mall)"],
    ]);
    expect(rows[2]).toMatchObject({ or: "2002", amount: 100_000, remarks: "Oct 1–5; advance" });
  });

  it("is one row for a line split across accounts, with slaughterhouse and terminal columns", () => {
    const s = titled("Collector B · Booklet B1 (1/1)");
    expect(s.columns.map((c) => c.key)).toEqual([
      "no", "or", "name", "section", "stall", "plate", "variety", "heads", "amount", "total", "remarks",
    ]);
    expect(s.rows.map((r) => [r.or, r.name, r.plate, r.variety, r.heads, r.amount])).toEqual([
      ["3001", "Owner One", null, "Hog", 2, 110_000],
      ["3002", "RTMI", "KVX 123", null, null, 3_000],
      ["3003", "Miscellaneous fee", null, null, null, 5_000],
    ]);
  });

  it("leaves the extra columns off a booklet with neither", () => {
    expect(titled("Collector A · Booklet A1 (1/2)").columns.map((c) => c.key)).toEqual([
      "no", "or", "name", "section", "stall", "amount", "total", "remarks",
    ]);
  });

  it("labels each booklet's totals k/n and breaks the page per collector", () => {
    const a2 = titled("Collector A · Booklet A2 (2/2)");
    expect(a2.totalLabel).toBe("Total 2/2");
    expect(titled("Collector A · Booklet A1 (1/2)").breakBefore).toBe(true);
    expect(a2.breakBefore).toBeFalsy();
  });

  it("lists cash tickets after the ORs", () => {
    expect(titled("Collector D · Cash tickets").rows).toEqual([
      { fee: "PM CR cash ticket", tickets: "1–600", note: null, amount: 300_000 },
    ]);
    // D has no receipts, so the cash tickets open D's pages; the summary follows on.
    expect(titled("Collector D · Cash tickets").breakBefore).toBe(true);
    expect(titled("Collector D · Summary by section").breakBefore).toBeFalsy();
  });

  it("summarises each collector by section and account, live money only", () => {
    const s = titled("Collector A · Summary by section");
    expect(s.rows.map((r) => [r.place, r.account, r.amount])).toEqual([
      ["Public Mall", "Public Mall Electricity Surcharge", 3_444],
      ["Public Mall", "Public Mall Electricity", 172_200],
      ["Public Mall · Fresh Fish", "Fresh Fish Section - Daily Rent", 160_000],
      ["Public Mall · Fresh Fish", "Public Mall Rental Surcharge", 1_800],
    ]);
  });

  it("gives a collector with only cancelled receipts an abstract at zero", () => {
    const input = sept30();
    input.portions.push({ ...input.portions[2]!, collectorId: "col-e", collectionId: "c9", orNo: 1003 });
    const titles = abstractSections(input).map((s) => s.title);
    expect(titles).toContain("Collector E · Booklet A1 (1/1)");
    const summary = abstractSections(input).find((s) => s.title === "Collector E · Summary by section")!;
    expect(summary.rows).toEqual([]);
  });

  it("says so when nobody collected", () => {
    const input = sept30();
    input.portions = [];
    const sections = abstractSections(input);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.empty).toBe("No receipts or cash tickets were recorded this day.");
  });
});

describe("formatPeriods", () => {
  it("merges consecutive days within a month", () =>
    expect(formatPeriods([
      { start: "2026-09-29", end: "2026-09-29" }, { start: "2026-09-27", end: "2026-09-28" },
      { start: "2026-09-30", end: "2026-09-30" },
    ])).toBe("Sept 27–30"));
  it("prints one day alone", () => expect(formatPeriods([{ start: "2026-09-30", end: "2026-09-30" }])).toBe("Sept 30"));
  it("spans months", () => expect(formatPeriods([{ start: "2026-09-29", end: "2026-10-02" }])).toBe("Sept 29–Oct 2"));
  it("spans years", () =>
    expect(formatPeriods([{ start: "2026-12-30", end: "2027-01-02" }])).toBe("Dec 30, 2026–Jan 2, 2027"));
  it("keeps gaps apart", () =>
    expect(formatPeriods([{ start: "2026-09-01", end: "2026-09-02" }, { start: "2026-09-05", end: "2026-09-05" }]))
      .toBe("Sept 1–2, Sept 5"));
  it("is null for none", () => expect(formatPeriods([])).toBeNull());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/abstracts.test.ts`
Expected: FAIL with `Cannot find module './abstracts'`.

- [ ] **Step 3: Implement `abstracts.ts`**

```ts
// apps/web/lib/reports/builders/daily-collection/abstracts.ts
import type { ReportColumn, ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyFacility, type DailyInput, type DailyPortion } from "./types";

/** The office's month abbreviations, as on its abstracts ("Sept 1–30"). */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function show(date: string, withYear: boolean): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${MON[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/**
 * Rental periods as the office writes them in Remarks: consecutive and overlapping
 * periods merged, "Sept 27–30", "Sept 29–Oct 2", "Dec 30, 2026–Jan 2, 2027"; separate runs
 * joined by ", ". Null when there are none.
 */
export function formatPeriods(periods: { start: string; end: string }[]): string | null {
  if (periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  const runs: { start: string; end: string }[] = [];
  for (const p of sorted) {
    const last = runs.at(-1);
    if (last && p.start <= dayAfter(last.end)) {
      if (p.end > last.end) last.end = p.end;
    } else {
      runs.push({ ...p });
    }
  }
  return runs
    .map(({ start, end }) => {
      if (start === end) return show(start, false);
      const crossYear = start.slice(0, 4) !== end.slice(0, 4);
      if (crossYear) return `${show(start, true)}–${show(end, true)}`;
      if (start.slice(0, 7) === end.slice(0, 7)) return `${show(start, false)}–${Number(end.slice(8))}`;
      return `${show(start, false)}–${show(end, false)}`;
    })
    .join(", ");
}

/** One abstract row: a receipt line, or a lease receipt (which has no lines), summed over its portions. */
interface Item {
  first: DailyPortion;
  amount: number;
}

const SHEET = "Abstracts";

/**
 * Part (c), one abstract per collector in OR order, broken into one section per booklet
 * ("Total 1/n … n/n", as the office's pages are), then their cash tickets, then a summary
 * by section and account. Cancelled ORs are listed at zero.
 */
export function abstractSections(input: DailyInput): ReportSection[] {
  const accounts = byId(input.accounts);
  const facilities = byId(input.facilities);
  const sections = byId(input.sections);
  const fees = byId(input.feeTypes);
  const leases = byId(input.leases);
  const booklets = byId(input.booklets);
  const tickets = byId(input.cashTickets);
  const cover = new Map(input.rentCover.map((c) => [c.collectionId, c]));
  const names = byId(input.collectors);
  const name = (id: string) => names.get(id)?.name ?? "Unknown collector";

  const facilityOf = (p: DailyPortion): DailyFacility | undefined => (p.facilityId ? facilities.get(p.facilityId) : undefined);
  const place = (p: DailyPortion) => {
    const f = facilityOf(p)?.name;
    const s = p.sectionId ? sections.get(p.sectionId)?.name : undefined;
    return f ? (s ? `${f} · ${s}` : f) : "—";
  };
  const feeName = (id: string) => fees.get(id)?.name ?? "—";

  const collectorIds = [...new Set(input.portions.map((p) => p.collectorId))].sort((a, b) =>
    name(a).localeCompare(name(b)),
  );
  if (collectorIds.length === 0) {
    return [{
      title: "Abstracts",
      orientation: "landscape",
      sheet: SHEET,
      breakBefore: true,
      columns: [{ key: "or", label: "OR #", kind: "text" }],
      rows: [],
      empty: "No receipts or cash tickets were recorded this day.",
    }];
  }

  const out: ReportSection[] = [];
  for (const collectorId of collectorIds) {
    const mine = input.portions.filter((p) => p.collectorId === collectorId);
    const who = name(collectorId);
    let firstOfCollector = true;
    const pageBreak = () => {
      const b = firstOfCollector;
      firstOfCollector = false;
      return b;
    };

    // Receipts: items keyed by receipt + line; receipt totals; booklets in OR order.
    const items = new Map<string, Item>();
    const receiptTotal = new Map<string, number>();
    for (const p of mine) {
      if (p.source !== "receipt" || !p.collectionId) continue;
      const key = `${p.collectionId}\u0000${p.lineId ?? ""}`;
      const item = items.get(key) ?? { first: p, amount: 0 };
      item.amount += p.amount;
      items.set(key, item);
      receiptTotal.set(p.collectionId, (receiptTotal.get(p.collectionId) ?? 0) + p.amount);
    }
    const byBooklet = new Map<string, Item[]>();
    for (const item of items.values()) {
      const id = item.first.bookletId ?? "";
      byBooklet.set(id, [...(byBooklet.get(id) ?? []), item]);
    }
    const bookletOrder = [...byBooklet.entries()]
      .map(([id, list]) => ({ id, list: list.sort((a, b) => (a.first.orNo ?? 0) - (b.first.orNo ?? 0)) }))
      .sort((a, b) => (a.list[0]!.first.orNo ?? 0) - (b.list[0]!.first.orNo ?? 0));

    const remarks = (p: DailyPortion): string | null => {
      if (p.cancelled) return "(cancelled)";
      if (p.lineId) return feeName(p.feeTypeId);
      if (!p.leaseId || !p.collectionId) return null;
      const c = cover.get(p.collectionId);
      const gross = receiptTotal.get(p.collectionId) ?? 0;
      const parts = [formatPeriods(c?.periods ?? []), gross > (c?.allocated ?? 0) ? "advance" : null];
      return parts.filter(Boolean).join("; ") || null;
    };

    bookletOrder.forEach(({ id, list }, index) => {
      const k = index + 1;
      const n = bookletOrder.length;
      const types = new Set(list.map((i) => facilityOf(i.first)?.type));
      const terminal = types.has("terminal");
      const slaughter = types.has("slaughterhouse");
      const columns: ReportColumn[] = [
        { key: "no", label: "No.", kind: "int" },
        { key: "or", label: "OR #", kind: "text" },
        { key: "name", label: "Name", kind: "text" },
        { key: "section", label: "Section", kind: "text" },
        { key: "stall", label: "Stall", kind: "text" },
        ...(terminal ? [{ key: "plate", label: "Plate/Body #", kind: "text" as const }] : []),
        ...(slaughter
          ? [
              { key: "variety", label: "Variety", kind: "text" as const },
              { key: "heads", label: "Heads", kind: "int" as const },
            ]
          : []),
        { key: "amount", label: "Amount", kind: "money", total: true },
        { key: "total", label: "Total", kind: "money", total: true },
        { key: "remarks", label: "Remarks", kind: "text" },
      ];

      let no = 0;
      let lastReceipt: string | null = null;
      const rows: ReportRow[] = list.map(({ first: p, amount }) => {
        const firstOfReceipt = p.collectionId !== lastReceipt;
        lastReceipt = p.collectionId;
        if (firstOfReceipt) no += 1;
        const type = facilityOf(p)?.type;
        const lease = p.leaseId ? leases.get(p.leaseId) : undefined;
        const fee = feeName(p.feeTypeId);
        const row: ReportRow = {
          no: firstOfReceipt ? no : null,
          or: firstOfReceipt ? String(p.orNo) : null,
          name: lease?.tenantName ?? (type === "terminal" ? (p.rateClass ?? p.payerRef ?? fee) : (p.payerRef ?? fee)),
          section: place(p),
          stall: lease?.stallNo ?? null,
          amount: p.cancelled ? 0 : amount,
          total: firstOfReceipt ? (p.cancelled ? 0 : receiptTotal.get(p.collectionId!)!) : null,
          remarks: remarks(p),
        };
        if (terminal) row.plate = type === "terminal" ? p.payerRef : null;
        if (slaughter) {
          row.variety = type === "slaughterhouse" ? (p.rateClass || null) : null;
          row.heads = type === "slaughterhouse" ? p.quantity : null;
        }
        return row;
      });

      out.push({
        title: `${who} · Booklet ${booklets.get(id)?.label ?? "—"} (${k}/${n})`,
        orientation: "landscape",
        sheet: SHEET,
        breakBefore: pageBreak(),
        totalLabel: `Total ${k}/${n}`,
        columns,
        rows,
      });
    });

    // Cash tickets, one row per sale (a split sale is still one sale).
    const sales = new Map<string, { p: DailyPortion; amount: number }>();
    for (const p of mine) {
      if (p.source !== "cash_ticket" || !p.cashTicketId) continue;
      const s = sales.get(p.cashTicketId) ?? { p, amount: 0 };
      s.amount += p.amount;
      sales.set(p.cashTicketId, s);
    }
    if (sales.size > 0) {
      out.push({
        title: `${who} · Cash tickets`,
        orientation: "landscape",
        sheet: SHEET,
        breakBefore: pageBreak(),
        columns: [
          { key: "fee", label: "Ticket", kind: "text" },
          { key: "tickets", label: "Serials", kind: "text" },
          { key: "note", label: "Note", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [...sales.values()].map(({ p, amount }) => {
          const t = tickets.get(p.cashTicketId!);
          return {
            fee: feeName(p.feeTypeId),
            tickets: t?.ticketFrom != null && t?.ticketTo != null ? `${t.ticketFrom}–${t.ticketTo}` : null,
            note: t?.note ?? null,
            amount,
          };
        }),
      });
    }

    // Summary by section and account: the office's "Row Labels / Sum" table.
    const sums = new Map<string, { place: string; account: string; sort: number; amount: number }>();
    for (const p of mine) {
      if (p.cancelled) continue;
      const a = accountOf(accounts, p);
      const key = `${place(p)}\u0000${a.id}`;
      const s = sums.get(key) ?? { place: place(p), account: a.name, sort: a.sortOrder, amount: 0 };
      s.amount += p.amount;
      sums.set(key, s);
    }
    out.push({
      title: `${who} · Summary by section`,
      orientation: "landscape",
      sheet: SHEET,
      breakBefore: pageBreak(),
      columns: [
        { key: "place", label: "Section", kind: "text" },
        { key: "account", label: "Account", kind: "text" },
        { key: "amount", label: "Amount", kind: "money", total: true },
      ],
      rows: [...sums.values()]
        .sort((a, b) => a.place.localeCompare(b.place) || a.sort - b.sort)
        .map(({ place: pl, account, amount }) => ({ place: pl, account, amount })),
      empty: "Nothing live: every receipt was cancelled.",
    });
  }
  return out;
}
```

The summary test expects, within "Public Mall", the electricity surcharge (sort 790) before the electricity account (sort 960). That ordering is sort-order, which is what the code does.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/abstracts.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/builders/daily-collection/abstracts.ts apps/web/lib/reports/builders/daily-collection/abstracts.test.ts
git commit -m "feat(web): Daily Collection Report, per-collector abstracts (part c)"
```

---

### Task 6: Assemble the report, read its data, add it to the catalogue

**Files:**
- Create: `apps/web/lib/reports/builders/daily-collection/report.ts`
- Test: `apps/web/lib/reports/builders/daily-collection/report.test.ts`
- Create: `apps/web/lib/reports/daily-data.ts`
- Modify: `apps/web/lib/reports/data.ts` (export `byIds`)
- Modify: `apps/web/lib/reports/catalog.ts` (new first entry)

**Interfaces:**
- Consumes: `treasurerSection` (Task 3), `matrixSections` (Task 4), `abstractSections` (Task 5), `pesos` (`report.ts`), and `allPages`/`byIds` (`data.ts`).
- Produces:
  - `dailyCollectionReport(input: DailyInput): Report`.
  - `dailyCollectionData(date: string): Promise<DailyInput>`.
  - Catalogue key `daily-collection`, with params `["date"]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/reports/builders/daily-collection/report.test.ts
import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { toXlsx } from "../../xlsx";
import { sept30 } from "./fixture";
import { dailyCollectionReport } from "./report";

const grandOf = (r: ReturnType<typeof dailyCollectionReport>) =>
  Number(r.sections[0]!.rows.find((x) => x.particulars === "Grand total")!.amount);

describe("dailyCollectionReport", () => {
  it("agrees with itself: Treasurer grand total = per-collector total = sum of abstracts", () => {
    const r = dailyCollectionReport(sept30());
    const matrixTotal = sectionTotals(r.sections[1]!)!.total;
    const abstracts = r.sections
      .filter((s) => s.title?.endsWith("· Summary by section"))
      .reduce((acc, s) => acc + (sectionTotals(s)?.amount ?? 0), 0);
    expect(grandOf(r)).toBe(755_444);
    expect(matrixTotal).toBe(755_444);
    expect(abstracts).toBe(755_444);
  });

  it("orders the parts: Treasurer, matrix, deposits, abstracts", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.sections.slice(0, 3).map((s) => s.title)).toEqual([
      "Daily Collection Report", "Collections per collector", "Remittances / deposits",
    ]);
    expect(r.title).toBe("Daily Collection Report");
    expect(r.scope).toBe("30 September 2026");
    expect(r.layout).toBe("landscape");
  });

  it("warns, on screen, about unclassified money, linking to that month's list", () => {
    const r = dailyCollectionReport(sept30());
    expect(r.warnings).toEqual([
      {
        text: "50.00 of this day's collections is on no account and is shown under “Other collections”.",
        href: "/accounts/unclassified?month=2026-09",
        linkText: "Classify it",
      },
    ]);
    const clean = sept30();
    clean.portions = clean.portions.filter((p) => p.accountId !== "acc-unc");
    expect(dailyCollectionReport(clean).warnings).toEqual([]);
  });

  it("does not warn about a cancelled unclassified receipt", () => {
    const input = sept30();
    input.portions = input.portions.map((p) => (p.accountId === "acc-unc" ? { ...p, cancelled: true } : p));
    expect(dailyCollectionReport(input).warnings).toEqual([]);
  });

  it("signs with the configured signatories, blank where no name is set", () => {
    expect(dailyCollectionReport(sept30()).signatures).toEqual([
      { label: "Prepared by", name: "Signer One", title: "LRCO-I" },
      { label: "Noted by", name: undefined, title: undefined },
    ]);
  });

  it("renders a day with no receipts: blank lines, zero sub-totals, empty abstracts", async () => {
    const input = sept30();
    input.portions = [];
    const r = dailyCollectionReport(input);
    expect(grandOf(r)).toBe(0);
    expect(r.sections[0]!.rows.find((x) => x.particulars === "Sub-total 1")!.amount).toBe(0);
    expect(r.sections.at(-1)!.empty).toBe("No receipts or cash tickets were recorded this day.");
    const book = await toXlsx(r);
    expect(book.length).toBeGreaterThan(0);
  });

  it("exports three worksheets", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(dailyCollectionReport(sept30()))) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Treasurer", "Per collector", "Abstracts"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/report.test.ts`
Expected: FAIL with `Cannot find module './report'`.

- [ ] **Step 3: Implement `report.ts`**

```ts
// apps/web/lib/reports/builders/daily-collection/report.ts
import { longDate } from "../../params";
import { pesos, type Report } from "../../report";
import { abstractSections } from "./abstracts";
import { matrixSections } from "./matrix";
import { treasurerSection } from "./treasurer";
import type { DailyInput } from "./types";

/**
 * Spec report 1, the Daily Collection Report: (a) the page sent to the City Treasurer,
 * (b) collections per collector with the deposit block, (c) the per-collector abstracts.
 * All three are sums of the same receipt portions, so the Treasurer grand total, the
 * per-collector total and the abstracts' totals are equal by construction.
 */
export function dailyCollectionReport(input: DailyInput): Report {
  const unclassified = input.unclassifiedAccountId
    ? input.portions
        .filter((p) => !p.cancelled && p.accountId === input.unclassifiedAccountId)
        .reduce((acc, p) => acc + p.amount, 0)
    : 0;

  return {
    title: "Daily Collection Report",
    scope: longDate(input.date),
    layout: "landscape",
    sections: [treasurerSection(input), ...matrixSections(input), ...abstractSections(input)],
    warnings:
      unclassified !== 0
        ? [
            {
              text: `${pesos(unclassified)} of this day's collections is on no account and is shown under “Other collections”.`,
              href: `/accounts/unclassified?month=${input.date.slice(0, 7)}`,
              linkText: "Classify it",
            },
          ]
        : [],
    notes: [
      "Cancelled receipts are listed in the abstracts at zero and left out of every total.",
      "Date of deposit is the latest deposit covering the shifts behind a line; “Undeposited” while any of them is not yet deposited.",
      "CC: City Mayor's Office · City Administrator's Office · City Budget Office · City Accounting Office · City Treasurer's Office · File",
    ],
    signatures: input.signatories.map((s) => ({ label: s.label, name: s.name ?? undefined, title: s.title ?? undefined })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/reports/builders/daily-collection/`
Expected: every daily-collection test passes.

- [ ] **Step 5: Export `byIds` from `data.ts`**

In `apps/web/lib/reports/data.ts`, change `async function byIds<T>(` to `export async function byIds<T>(`. Nothing else changes.

- [ ] **Step 6: Implement `daily-data.ts`**

```ts
// apps/web/lib/reports/daily-data.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import type { DailyInput, DailyPortion, RentCover } from "./builders/daily-collection/types";
import { allPages, byIds } from "./data";

const centavos = (v: string | number | null): Centavos => fromPesos(Number(v ?? 0));

/**
 * Everything the Daily Collection Report reads for one business date. The portions come
 * from receipt_account_lines(D, D), the one source every collections report shares; the
 * rest is the chart, names, and what each lease receipt settled (for Remarks).
 */
export async function dailyCollectionData(date: string): Promise<DailyInput> {
  const supabase = await getServerClient();

  const [raw, accounts, lines, columns, facilities, sections, feeTypes, collectorRows, signatories] =
    await Promise.all([
      allPages((a, b) =>
        supabase
          .rpc("receipt_account_lines", { p_from: date, p_to: date })
          .order("collector_id").order("or_no").order("collection_id").order("cash_ticket_id")
          .order("line_id").order("portion").order("account_id")
          .range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("collection_accounts")
          .select("id, code, name, sort_order, treasurer_line_id, rcd_column_id").order("sort_order").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("treasurer_lines").select("id, code, name, sort_order, subtotal_group, active").order("sort_order").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("rcd_columns").select("id, code, name, sort_order, active").order("sort_order").range(a, b),
      ),
      allPages((a, b) => supabase.from("facilities").select("id, name, type").order("name").range(a, b)),
      allPages((a, b) => supabase.from("sections").select("id, name").order("name").range(a, b)),
      allPages((a, b) => supabase.from("fee_types").select("id, name").order("name").range(a, b)),
      allPages((a, b) =>
        supabase.from("app_users").select("id, full_name, status").eq("role", "collector").order("full_name").range(a, b),
      ),
      allPages((a, b) =>
        supabase.from("report_signatories").select("label, name, title")
          .eq("report_key", "daily-collection").eq("active", true).order("sort_order").range(a, b),
      ),
    ]);

  const portions: DailyPortion[] = raw.map((r) => ({
    source: r.source as DailyPortion["source"],
    collectionId: r.collection_id,
    cashTicketId: r.cash_ticket_id,
    lineId: r.line_id,
    orNo: r.or_no,
    bookletId: r.booklet_id,
    shiftId: r.shift_id,
    collectorId: r.collector_id,
    leaseId: r.lease_id,
    payerRef: r.payer_ref,
    feeTypeId: r.fee_type_id,
    facilityId: r.facility_id,
    sectionId: r.section_id,
    rateClass: r.rate_class,
    quantity: r.quantity,
    accountId: r.account_id,
    paymentMode: r.payment_mode as DailyPortion["paymentMode"],
    amount: centavos(r.amount),
    cancelled: r.cancelled,
  }));

  const ids = (pick: (p: DailyPortion) => string | null) =>
    [...new Set(portions.map(pick).filter((x): x is string => x !== null))];
  const leaseReceiptIds = [
    ...new Set(portions.filter((p) => p.leaseId && !p.lineId && p.collectionId).map((p) => p.collectionId!)),
  ];
  const knownCollectors = new Set(collectorRows.map((c) => c.id));
  const otherCollectorIds = ids((p) => p.collectorId).filter((id) => !knownCollectors.has(id));

  const [shiftRows, bookletRows, leaseRows, allocationRows, ticketRows, otherCollectors] = await Promise.all([
    byIds(ids((p) => p.shiftId), (chunk) =>
      supabase.from("shifts").select("id, remittances(deposited_at, verified_at, cancelled_at)").in("id", chunk),
    ),
    byIds(ids((p) => p.bookletId), (chunk) => supabase.from("booklets").select("id, serial_prefix").in("id", chunk)),
    byIds(ids((p) => p.leaseId), (chunk) =>
      supabase.from("leases").select("id, stalls(stall_no), tenants(full_name)").in("id", chunk),
    ),
    byIds(leaseReceiptIds, (chunk) =>
      supabase.from("collection_allocations")
        .select("collection_id, amount, charges(charge_type, period_start, period_end)").in("collection_id", chunk),
    ),
    byIds(ids((p) => p.cashTicketId), (chunk) =>
      supabase.from("cash_ticket_sales").select("id, ticket_from, ticket_to, note").in("id", chunk),
    ),
    byIds(otherCollectorIds, (chunk) => supabase.from("app_users").select("id, full_name, status").in("id", chunk)),
  ]);

  const cover = new Map<string, RentCover>();
  for (const a of allocationRows) {
    const c = cover.get(a.collection_id) ?? { collectionId: a.collection_id, allocated: centavos(0), periods: [] };
    c.allocated = (c.allocated + centavos(a.amount)) as Centavos;
    if (a.charges.charge_type === "rental") c.periods.push({ start: a.charges.period_start, end: a.charges.period_end });
    cover.set(a.collection_id, c);
  }

  return {
    date,
    portions,
    accounts: accounts.map((a) => ({
      id: a.id, code: a.code, name: a.name, sortOrder: a.sort_order,
      treasurerLineId: a.treasurer_line_id, rcdColumnId: a.rcd_column_id,
    })),
    treasurerLines: lines.map((l) => ({
      id: l.id, code: l.code, name: l.name, sortOrder: l.sort_order,
      subtotalGroup: l.subtotal_group === 2 ? 2 : 1, active: l.active,
    })),
    rcdColumns: columns.map((c) => ({ id: c.id, code: c.code, name: c.name, sortOrder: c.sort_order, active: c.active })),
    shifts: shiftRows.map((s) => {
      const r = s.remittances;
      return {
        id: s.id,
        deposit: r && r.cancelled_at === null ? { on: r.deposited_at, verified: r.verified_at !== null } : null,
      };
    }),
    collectors: [...collectorRows, ...otherCollectors].map((c) => ({
      id: c.id, name: c.full_name, active: collectorRows.includes(c) && c.status === "active",
    })),
    facilities: facilities.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    sections,
    feeTypes,
    booklets: bookletRows.map((b) => ({ id: b.id, label: b.serial_prefix })),
    leases: leaseRows.map((l) => ({ id: l.id, tenantName: l.tenants.full_name, stallNo: l.stalls.stall_no })),
    rentCover: [...cover.values()],
    cashTickets: ticketRows.map((t) => ({ id: t.id, ticketFrom: t.ticket_from, ticketTo: t.ticket_to, note: t.note })),
    signatories: signatories.map((s) => ({ label: s.label, name: s.name, title: s.title })),
    unclassifiedAccountId: accounts.find((a) => a.code === "UNCLASSIFIED")?.id ?? null,
  };
}
```

Notes for the implementer:
- `collectors` includes non-collector-role users who collected that day; they are marked `active: false`, so they get a matrix row only because they collected. Office receipts are posted under the officer, who is a collector-role user, so this is a safety net.
- If the generated types make `s.remittances` an array, take `[0]`. The relationship is many-to-one (`shifts.remittance_id → remittances.id`), so PostgREST returns an object or null.
- If `Centavos` is not a branded type, the `as Centavos` casts are harmless. Leave them.

- [ ] **Step 7: Add the catalogue entry**

In `apps/web/lib/reports/catalog.ts`:
- add the imports `import { dailyCollectionReport } from "./builders/daily-collection/report";` and `import { dailyCollectionData } from "./daily-data";`;
- add this entry as the **first** element of `REPORTS`, so the office's daily report heads the hub:

```ts
  {
    key: "daily-collection",
    title: "Daily Collection Report",
    purpose: "The day's page for the City Treasurer, collections per collector with deposits, and each collector's abstract.",
    params: ["date"],
    build: async (p) => dailyCollectionReport(await dailyCollectionData(p.date)),
  },
```

- [ ] **Step 8: Typecheck and run the web tests**

Run:
```bash
pnpm --filter @ceedo/web typecheck
pnpm vitest run apps/web/lib/reports
```
Expected: no type errors, and all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/reports/builders/daily-collection/report.ts apps/web/lib/reports/builders/daily-collection/report.test.ts \
  apps/web/lib/reports/daily-data.ts apps/web/lib/reports/data.ts apps/web/lib/reports/catalog.ts
git commit -m "feat(web): Daily Collection Report in the report hub"
```

---

### Task 7: Check it in the running app, build, full suite

**Files:**
- None created. Fix whatever the checks turn up, with a test where one can pin it.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Seed a day with real-shaped data locally**

Supabase and the web dev server must be running (`supabase start`; `pnpm --filter @ceedo/web dev`).

As an admin, use the app:
1. On `/ledger/office-receipt`, post two office receipts for one officer on today's date: one lease rent receipt, and one keyed electricity bill payment.
2. On `/ledger/cash-tickets`, enter one cash-ticket sale.
3. Under Accounts → Signatories, set "Prepared by" to a test name and title.

- [ ] **Step 2: Open the report and check each part**

Open `/reports/daily-collection?date=<today>` and check:
1. The Treasurer page lists every line. The posted money is on the right lines, and Sub-total 1 + Sub-total 2 = Grand total.
2. Collections per collector shows every active collector. The officer's row total equals the Grand total, and the deposit block reads "Undeposited" for the unremitted shift.
3. The officer's abstract lists both ORs (the EBP on one line, its OR total on the first row), the cash tickets, and a summary that totals the Grand total.
4. Print preview (⌘P): the Treasurer page is portrait, the rest landscape, and each collector starts a new page. The signature shows the name and title.
5. Excel download: three sheets (Treasurer, Per collector, Abstracts). Money cells are numbers, and the Treasurer sheet's sub-total rows are bold.
6. The unclassified warning appears only if something is unclassified. To test it, post a receipt with a fee type that has no rule.

Record what you checked, and anything wrong, in the task report.

- [ ] **Step 3: Build and run the full suite**

Run:
```bash
pnpm --filter @ceedo/web build
supabase db reset
set -a; eval "$(supabase status -o env)"; set +a; pnpm test
```
Expected: the build succeeds, and the suite passes with no new failures. If a test failed before this branch too, say so with its name.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A apps/web supabase tests packages
git commit -m "fix(web): daily collection report review fixes"
```
Only if Steps 2–3 needed changes.
