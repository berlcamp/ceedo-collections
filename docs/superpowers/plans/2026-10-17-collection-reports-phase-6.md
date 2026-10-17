# Collection Reports, Phase 6: Collections Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the *Collections detail* report: every live collection in a month as one line per receipt portion, payments per tenant, and totals by account. It replaces the office's QuickBooks Online entry log and its pivots.

**Architecture:**
- **No migration.** The reader calls `receipt_account_lines(D, D)`, the one source every collections report shares, once per day of the month. It runs at most 4 days at a time and filters `cancelled = false` in PostgREST.
  - A month in one call costs about 2 s at production volume (see `summary-data.ts`). Pages of 1000 would re-run it about 12 times and pass PostgREST's 8 s statement limit.
  - A day is about 400 lines, usually one page. `allPages` still pages a day that runs over.
- **Builder:** `builders/collections-detail.ts`, a pure function of one `DetailInput` plus the filters, as in phases 4 and 5.
- **Filters** (facility, collector, account, tenant, customer text) are applied in the builder, not in SQL. All three sections then come from one filtered list, so Section 1 = Section 3 holds by construction.
- **Report framework:**
  - `ReportParams` gains `accountId`, `tenantId` and `customer`.
  - `ParamKind` gains `account`, `tenant` and `customer`.
  - `ReportEntry.optional` marks a `collector` (or `lease`) parameter the hub may leave as "All".

**Tech Stack:** Next.js app router (`apps/web`), ExcelJS (existing `toXlsx`), vitest, `@supabase/supabase-js`, and `pg` for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`, especially "5. Collections detail", "Unclassified warning" and "`receipt_account_lines`". This plan covers rollout phase 6. Phases 1–5 are merged; the latest migration is `20261016000076`, and production is at 076.

## Global Constraints

- **Money:** report money cells are integer centavos (`Centavos`, `fromPesos(Number(v))` from `@ceedo/shared`). `receipt_account_lines.amount` is `numeric(14,2)` pesos.
- **Dates:** Asia/Manila business dates, written `YYYY-MM-DD`; months are `YYYY-MM`. Use `monthBounds`, `longMonth` and `longDate` from `apps/web/lib/reports/params.ts`.
- **Cancelled receipts are left out** of every section. Status is current (`standing_cancellations`), as `receipt_account_lines.cancelled` already reports it.
- **Invariant (spec):** with no filters, Section 1 total = Section 3 total = the month's column in the monthly summary, before adjustments.
- **Layout:** landscape. The xlsx export puts each section on its own sheet (`ReportSection.sheet`, ≤ 31 characters).
- **Unclassified warning:** when the period has a non-zero `UNCLASSIFIED` total, show a band linking to `/accounts/unclassified?month=YYYY-MM`. Task 2's test pins the wording.
- **PostgREST returns at most 1000 rows.** Page every read through `allPages` with an `.order(...)` that makes rows unique, and chunk `in (...)` lists through `byIds` (`apps/web/lib/reports/data.ts`).
- **Tests:**
  - Run from the repo root: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <file>`.
  - The DB suite shares one database. Assert only on accounts, fee types and leases your test created (`createAccount`, `uniqueCode`), never on global sums.
  - Run `supabase db reset` before any full-suite run you intend to trust.
- **Before pushing:** run `pnpm --filter @ceedo/web build`. Any type error blocks the push.
- **Real names never enter the repo.** Fixtures use fictitious names.

### Spec deviations and decisions (state them in the PR description)

1. **Type** of a line:
   - `Cash ticket`: `source = 'cash_ticket'`.
   - `Occupancy`: a line whose fee type code is `OCCUPANCY`.
   - `Rental`: a lease receipt's rent or surcharge portion (`lease_id` set, `line_id` null).
   - `Walk-in`: every other line, including a fee line on a lease receipt, because QuickBooks had no fourth type.
2. **Customer** of a line:
   - the tenant's name whenever the line carries a `lease_id`;
   - otherwise the trimmed `payer_ref`;
   - otherwise "Walk-in". Cash tickets carry no payer, so they read "Walk-in".
3. **Facility** of a line is `receipt_account_lines.facility_id` (the lease's facility, or the fee type's), else the account's facility, else blank. The facility filter uses the same value, so a facility-less fee on a facility-less account (e.g. citation) is left out when a facility is chosen.
4. **"tenant?" filters by tenant** (`tenants.id`), across all that tenant's leases. The existing `lease` parameter is not reused.
5. **"Searchable by customer"** is a URL parameter `q`: a case-insensitive substring match on Customer, applied to Sections 1 and 2. It is a parameter rather than a browser-side filter so that the Excel export and printout match the screen, as every other report parameter does.
6. **Section 2 has one row per lease**, not per tenant name. That gives the spec's Stall column a single value and keeps two tenants with the same name apart.
   - Columns: Rent (Rental base), Surcharge (Rental surcharge), Occupancy (Occupancy lines), Other (Walk-in lines on the lease's receipts).
   - Lease-less payers are not in Section 2; they are in Section 1.
7. **A portion split across accounts by a rule is one line per account.** Each line is a receipt portion on one account, so the same OR can appear on several lines.
8. **Order of Section 1:** date, then OR number, then cash tickets (no OR) by collector name, then line order (collection, line, portion, account) for a stable tie-break.

## Review Focus

1. **A receipt split across accounts by `share_bps`.** The same OR appears on two lines, one per account, and the two amounts sum to the portion. Section 3 shows each account's share. (Task 2 test.)
2. **A lease receipt carrying both rent and a fee line** (a mixed receipt, migration 076). It gives one `Rental` line and one `Walk-in` or `Occupancy` line, both under the tenant's name. Section 2 splits them into Rent and Other or Occupancy, and the row total equals the receipt. (Task 2 test.)
3. **A cash ticket.** It has no OR, Type "Cash ticket" and Customer "Walk-in", and is sorted after that day's ORs. It counts in Sections 1 and 3 but not in Section 2. (Task 2 test.)
4. **Facility filter on a facility-less fee type.** The account's facility decides. When neither has one, the line is shown only with no facility filter. (Task 2 test.)
5. **A receipt cancelled after it was posted.** It must not come back from the reader's per-day call, so it reaches no section. (Task 3 DB test, through the reader's own PostgREST call.)

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/lib/reports/params.ts` (+ `params.test.ts`) | `ReportParams.accountId`, `.tenantId`, `.customer` |
| `apps/web/lib/reports/catalog.ts` | `ParamKind` `account`, `tenant`, `customer`; `ReportEntry.optional`; the `collections-detail` entry |
| `apps/web/lib/reports/options.ts` | `getAccountOptions`, `getTenantOptions` |
| `apps/web/app/(admin)/reports/page.tsx` | the hub renders optional collector, account, tenant and customer inputs |
| `apps/web/lib/reports/builders/collections-detail.ts` (+ test) | the three sections, filters, warning |
| `apps/web/lib/reports/detail-data.ts` | `collectionsDetailData(month, tenantId)`: per-day reads, chart and names |
| `apps/web/lib/reports/data.ts` | `mapPool`: bounded-concurrency map |
| `tests/db/collections-detail-reads.test.ts` | the reader's selects against the live schema; cancelled receipts excluded; day-by-day = month |

---

### Task 1: Optional filters in the report framework and hub

**Files:**
- Modify: `apps/web/lib/reports/params.ts`, `apps/web/lib/reports/params.test.ts`
- Modify: `apps/web/lib/reports/catalog.ts` (types only in this task)
- Modify: `apps/web/lib/reports/options.ts`
- Modify: `apps/web/app/(admin)/reports/page.tsx`

**Interfaces:**
- Produces:
  - `ReportParams.accountId: string | null` (URL `account`, UUID or null).
  - `ReportParams.tenantId: string | null` (URL `tenant`, UUID or null).
  - `ReportParams.customer: string` (URL `q`, trimmed, at most 100 characters, `""` when absent).
  - `ParamKind` adds `"account" | "tenant" | "customer"`.
  - `ReportEntry.optional?: ParamKind[]`: the parameters the hub offers with an "All …" choice and does not require.
  - `getAccountOptions(): Promise<{ id: string; label: string }[]>`: active accounts plus `UNCLASSIFIED`, in `sort_order`, labelled by `name`.
  - `getTenantOptions(): Promise<{ id: string; label: string }[]>`: every tenant by `full_name`.

- [ ] **Step 1: Update the params tests**

In `params.test.ts`, add `accountId: null, tenantId: null, customer: ""` to both existing `toEqual` objects. Then add:

```ts
it("reads the optional detail filters", () => {
  const p = readParams(
    { account: "22222222-2222-4222-8222-222222222222", tenant: "nope", q: "  santos  " },
    lateUtc,
  );
  expect(p.accountId).toBe("22222222-2222-4222-8222-222222222222");
  expect(p.tenantId).toBeNull();
  expect(p.customer).toBe("santos");
  expect(readParams({ q: "x".repeat(150) }, lateUtc).customer).toHaveLength(100);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts`
Expected: FAIL. The new keys are missing.

- [ ] **Step 3: Implement the three fields in `readParams`**

Use the existing `UUID` check for `account` and `tenant`. For `customer`, use `one("q").trim().slice(0, 100)`.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.test.ts`
Expected: PASS. `exceptionsInScope` needs no change: an account, tenant or customer filter cannot be matched to an exception's payload, so those exceptions keep counting, as the file's comment prescribes.

- [ ] **Step 5: Catalog types, options and hub inputs**

- `catalog.ts`: extend `ParamKind` and add `optional?: ParamKind[]` to `ReportEntry`, with a doc comment: "Parameters the hub offers with an 'All …' choice; the rest are required."
- `options.ts`: add `getAccountOptions` and `getTenantOptions` as specified above. Use `allPages` with `.order("sort_order").order("id")` and `.order("full_name").order("id")`.
- `page.tsx`:
  - Load the two option lists when `needs` has `account` or `tenant`.
  - For `collector` and `lease`: when `report.optional?.includes(kind)`, render a first option `<option value="">All collectors</option>` (or "All leases"), drop `required`, and default to `""`. Otherwise keep today's markup.
  - Add an `account` select ("All accounts" first) and a `tenant` select ("All tenants" first). Neither is required.
  - Add a `customer` text input: `name="q"`, label "Customer contains", class `mt-1 w-48`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ceedo/web typecheck`
Expected: no errors. Existing reports render as before, since none sets `optional`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/reports/params.ts apps/web/lib/reports/params.test.ts apps/web/lib/reports/catalog.ts apps/web/lib/reports/options.ts "apps/web/app/(admin)/reports/page.tsx"
git commit -m "feat(web): optional account, tenant, collector and customer report filters"
```

---

### Task 2: The Collections detail builder

**Files:**
- Create: `apps/web/lib/reports/builders/collections-detail.ts`
- Test: `apps/web/lib/reports/builders/collections-detail.test.ts`

**Interfaces:**
- Consumes: `Report`, `ReportSection`, `sectionTotals` and `pesos` (`../report`); `longMonth` and `longDate` (`../params`); `compareStall` (`./grouping`).
- Produces:

```ts
export type DetailType = "Rental" | "Occupancy" | "Walk-in" | "Cash ticket";

export interface DetailLine {
  source: "receipt" | "cash_ticket";
  collectionId: string | null;
  cashTicketId: string | null;
  lineId: string | null;
  orNo: number | null;
  businessDate: string;
  collectorId: string;
  leaseId: string | null;
  payerRef: string | null;
  feeTypeId: string;
  facilityId: string | null;
  portion: "base" | "surcharge";
  accountId: string;
  paymentMode: "cash" | "check";
  amount: Centavos;
}

export interface DetailInput {
  month: string;                       // YYYY-MM
  lines: DetailLine[];                 // live (not cancelled) only
  accounts: { id: string; code: string; name: string; facilityId: string | null; sortOrder: number }[];
  facilities: { id: string; name: string }[];
  collectors: { id: string; name: string }[];
  leases: { id: string; tenantId: string; tenantName: string; stallNo: string }[];
  occupancyFeeTypeIds: string[];
  /** The filtered tenant's name for the scope line, when a tenant filter is set. */
  tenantName: string | null;
}

export interface DetailFilters {
  facilityId: string | null;
  collectorId: string | null;
  accountId: string | null;
  tenantId: string | null;
  customer: string;                    // "" = no search
}

export function detailType(line: DetailLine, occupancyFeeTypeIds: string[]): DetailType;
export function collectionsDetailReport(input: DetailInput, filters: DetailFilters): Report;
```

- [ ] **Step 1: Write the failing tests**

Write a fixture in the style of `tenant-payments.test.ts`:
- accounts `a-rent` (Public Mall, sortOrder 20), `a-occ` "Bakery Section - Occupancy Fee" (Public Mall, 210), `a-del` (Public Mall delivery, 400), `a-sur` (facility null, 760), `a-cit` (citation, facility null, 950) and `a-unc` (code `UNCLASSIFIED`, null, 9999);
- facilities `f-pm` "Public Mall" and `f-ibjt` "IBJT";
- collectors `c-ana` "Ana Reyes" and `c-ben` "Ben Cruz";
- leases `l-1` (tenant `t-1` "Maria Santos", stall "12") and `l-2` (tenant `t-2` "Jose Lim", stall "3");
- `occupancyFeeTypeIds: ["ft-occ"]`;
- a helper `line(over: Partial<DetailLine>): DetailLine`. Its defaults are a receipt base portion of 100.00 cash on `2026-10-05`, collector `c-ana`, account `a-rent`, facility `f-pm`, no lease, no line.

Tests, by name, with their assertions:

```ts
it("is landscape, titled, and scoped to the month", () => {
  const r = collectionsDetailReport(input({}), NO_FILTERS);
  expect(r.title).toBe("Collections detail");
  expect(r.scope).toBe("October 2026");
  expect(r.layout).toBe("landscape");
  expect(r.sections.map((s) => s.sheet)).toEqual(["Lines", "Per tenant", "By account"]);
});

it("types and names each line", () => {
  // rent portion of l-1; occupancy line of l-1; walk-in with payer; walk-in without; cash ticket
  // expect section 1 rows' (type, customer):
  // ["Rental","Maria Santos"], ["Occupancy","Maria Santos"], ["Walk-in","Victory Liner"],
  // ["Walk-in","Walk-in"], ["Cash ticket","Walk-in"]
});

it("orders by date, then OR, with the day's cash tickets after its ORs", () => {
  // OR 1002 on 10-05, OR 1001 on 10-05, a cash ticket by c-ben on 10-05, OR 900 on 10-06
  // expect or column: ["1001","1002",null,"900"]
});

it("shows a split portion as one line per account, summing to the portion", () => {
  // OR 1001 base split: 66.67 on a-rent, 33.33 on a-del
  // section 1: two rows with or "1001"; section 3: a-rent 6667, a-del 3333
});

it("totals Section 1 and Section 3 to the same centavo", () => {
  // a mix of every type over two accounts and a cash ticket
  const r = collectionsDetailReport(input({ lines: MIX }), NO_FILTERS);
  expect(sectionTotals(r.sections[0]!)!.amount).toBe(sectionTotals(r.sections[2]!)!.amount);
});

it("splits each lease's month into rent, surcharge, occupancy and other", () => {
  // l-1: rent 500, surcharge 15, occupancy 200, a delivery-fee line on its receipt 30
  // row for Maria Santos: { customer: "Maria Santos", facility: "Public Mall", stall: "12",
  //   rent: 50000, surcharge: 1500, occupancy: 20000, other: 3000, total: 71500 }
  // rows sorted by name: Jose Lim before Maria Santos; totalLabel "Grand total"
  // a lease-less walk-in is not in section 2
});

it("places a facility-less fee by its account's facility for the facility filter", () => {
  // line with facilityId null on a-del (Public Mall) → kept under f-pm, facility column "Public Mall"
  // line with facilityId null on a-cit (no facility) → dropped under f-pm, kept with no filter, facility column null
});

it("narrows every section by collector, account, tenant and customer", () => {
  // collector c-ben: only Ben's lines; account a-occ: only occupancy lines, section 3 one row;
  // tenant t-2: only l-2's lines; customer "SANTOS" (case-insensitive): only Maria Santos lines
  // after each filter, section 1 total === section 3 total
});

it("names the filters in the scope", () => {
  const r = collectionsDetailReport(
    input({ tenantName: "Jose Lim" }),
    { facilityId: "f-pm", collectorId: "c-ben", accountId: "a-occ", tenantId: "t-2", customer: "lim" },
  );
  expect(r.scope).toBe(
    "October 2026 · Public Mall · Ben Cruz · Bakery Section - Occupancy Fee · Jose Lim · customer “lim”",
  );
});

it("warns when the list holds unclassified money, and not otherwise", () => {
  const r = collectionsDetailReport(input({ lines: [line({ accountId: "a-unc", amount: fromPesos(40) })] }), NO_FILTERS);
  expect(r.warnings).toEqual([{
    text: "40.00 of this month's collections is on no account (UNCLASSIFIED).",
    href: "/accounts/unclassified?month=2026-10",
    linkText: "Review unclassified receipts",
  }]);
  expect(collectionsDetailReport(input({}), NO_FILTERS).warnings ?? []).toEqual([]);
});

it("says what is left out and what reconciles", () => {
  expect(r.notes).toEqual([
    "Cancelled receipts are left out.",
    "With no filters, the total equals the month's column in the Monthly summary before adjustments.",
  ]);
});

it("shows an empty state for a month with nothing", () => {
  // each section's `empty`: "No collections match.", "No tenant paid.", "No collections match."
});
```

The commented tests are the assertions to write as code: build the lines named and assert exactly the values given.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run apps/web/lib/reports/builders/collections-detail.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement `collections-detail.ts`**

- **Columns, Section 1** "Collection lines" (sheet `Lines`):
  - `date` Date (`date`);
  - `or` OR # (`text`: a serial takes no thousands separator);
  - `type` Type, `customer` Customer, `facility` Facility, `collector` Collector, `account` Account (all `text`);
  - `mode` Payment mode (`text`: "Cash" or "Check");
  - `amount` Amount (`money`, total).
- **Section 2** "Payments per tenant" (sheet `Per tenant`, `totalLabel: "Grand total"`, `breakBefore: true`):
  - `customer`, `facility`, `stall` (`text`);
  - `rent`, `surcharge`, `occupancy`, `other`, `total` (`money`, total).
  - Sort by tenant name (`localeCompare("en")`), then `compareStall`.
- **Section 3** "Totals by account" (sheet `By account`, `breakBefore: true`):
  - `account`, `facility` (`text`); `amount` (`money`, total).
  - One row per account with money, in account `sortOrder`.
- **Filtering:** filter once, in this order: facility (decision 3), collector, account, tenant (via `leases[].tenantId`), customer (lower-cased `includes`). Then build all three sections from the filtered list.
- **Unclassified warning:** the total of filtered lines whose account has code `UNCLASSIFIED`.
- **Scope:** `longMonth(month)`, then each set filter's name joined by " · ", and `customer “…”` last.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run apps/web/lib/reports/builders/collections-detail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/builders/collections-detail.ts apps/web/lib/reports/builders/collections-detail.test.ts
git commit -m "feat(web): collections detail builder: lines, per tenant, by account"
```

---

### Task 3: Read a month day by day; add the report to the catalogue

**Files:**
- Create: `apps/web/lib/reports/detail-data.ts`
- Modify: `apps/web/lib/reports/data.ts` (add `mapPool`)
- Modify: `apps/web/lib/reports/catalog.ts` (the entry)
- Test: `tests/db/collections-detail-reads.test.ts`

**Interfaces:**
- Consumes: `DetailInput` and `DetailLine` (Task 2); `allPages`, `byIds` (`data.ts`); `monthBounds`.
- Produces:
  - `mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>` in `data.ts`. Results come back in input order, with at most `limit` calls in flight, and the first rejection rejects the whole call.
  - `collectionsDetailData(month: string, tenantId: string | null): Promise<DetailInput>` in `detail-data.ts`.
  - Catalogue entry `collections-detail`.

- [ ] **Step 1: Write the DB test (failing until the reader's calls are right)**

`tests/db/collections-detail-reads.test.ts`. Model the fixture setup on `tests/db/cross-report-invariant.test.ts`: `resetCutover`, `createCollectionFixture`, `createAccount`, `createRule`, `postCollectionAsOwner`, and the cancellation insert at its line 86. Add the same header comment as `monthly-summary-reads.test.ts`: the select strings are copied verbatim from `detail-data.ts` and must be kept in step.

```ts
it("the reader's selects resolve against the live schema", async () => {
  // as a supervisor (createAppUser), each with .range(0, 0):
  //  rpc("receipt_account_lines", { p_from: "2026-10-05", p_to: "2026-10-05" }).eq("cancelled", false)
  //    .order("or_no").order("collection_id").order("cash_ticket_id").order("line_id")
  //    .order("portion").order("account_id")
  //  from("collection_accounts").select("id, code, name, facility_id, sort_order").order("sort_order").order("id")
  //  from("facilities").select("id, name").order("name").order("id")
  //  from("app_users").select("id, full_name").order("full_name").order("id")
  //  from("fee_types").select("id").eq("code", "OCCUPANCY")
  //  from("leases").select("id, tenant_id, stalls(stall_no), tenants(full_name)").in("id", [fx.leaseId])
  //  from("tenants").select("full_name").eq("id", <fixture tenant id>).maybeSingle()
  // expect every error toBeNull()
}, 30_000);

it("does not return a cancelled receipt through the reader's call", async () => {
  // post two receipts on 2026-10-05 for the fixture lease, cancel one
  // the supervisor client's rpc call above (no range) filtered to the two collection ids
  // returns only the live one's portions
}, 30_000);

it("a month read day by day equals the Monthly summary's month", async () => {
  // post receipts on 2026-10-01, 10-15 and 10-31 on a test account (createAccount + createRule)
  // SQL: per-account sum over generate_series('2026-10-01','2026-10-31','1 day') d,
  //      receipt_account_lines(d::date, d::date) where not cancelled and account_id = $1
  // equals monthly_account_totals('2026-10-01','2026-10-31') for account $1
});
```

As in Task 2, the commented tests are the assertions to write as code.

- [ ] **Step 2: Run it**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/collections-detail-reads.test.ts`
Expected: PASS, since the schema already exists. If a select fails, the reader in Step 3 must use the corrected string.

- [ ] **Step 3: Implement `mapPool` and `collectionsDetailData`**

- **Days:** every date from `monthBounds(month).from` to `.to`.
- **Each day:** `allPages` over the rpc call exactly as in the test, run through `mapPool(days, 4, …)`, then flattened.
- **In parallel with the days:** accounts, facilities, every `app_users` row (`id, full_name`, so a back-office user who posted an office receipt still has a name), the occupancy fee type ids, and the filtered tenant's name when `tenantId` is set.
- **Leases:** `byIds` over the lines' distinct `lease_id`s, mapped to `{ id, tenantId, tenantName, stallNo }`.
- **Lines:** map rows to `DetailLine` with `centavos(r.amount)`. Keep only the columns `DetailLine` names.

- [ ] **Step 4: Catalogue entry**

In `catalog.ts`, add after `tenant-payments`:

```ts
{
  key: "collections-detail",
  title: "Collections detail",
  purpose: "Every collection in a month, one line per account, with each tenant's payments and totals by account. Replaces the QuickBooks entry log.",
  params: ["month", "facility", "collector", "account", "tenant", "customer"],
  optional: ["collector"],
  build: async (p) =>
    collectionsDetailReport(await collectionsDetailData(p.month, p.tenantId), {
      facilityId: p.facilityId, collectorId: p.collectorId, accountId: p.accountId,
      tenantId: p.tenantId, customer: p.customer,
    }),
},
```

- [ ] **Step 5: Typecheck and run the report's tests**

Run: `pnpm --filter @ceedo/web typecheck && pnpm vitest run apps/web/lib/reports tests/db/collections-detail-reads.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/reports/detail-data.ts apps/web/lib/reports/data.ts apps/web/lib/reports/catalog.ts tests/db/collections-detail-reads.test.ts
git commit -m "feat(web): collections detail report, read a day at a time"
```

---

### Task 4: Check it in the running app; build; full suite

**Files:** none new. Fix whatever this turns up, in the task that owns the code.

- [ ] **Step 1: Full suite on a fresh database**

```bash
supabase db reset
set -a; eval "$(supabase status -o env)"; set +a; pnpm test
```
Expected: every test passes. If every `http/` and `device/` test fails with ECONNREFUSED, the edge runtime container has stopped. Run `docker start supabase_edge_runtime_ceedo-collections` and rerun.

- [ ] **Step 2: Build**

Run: `pnpm --filter @ceedo/web build`
Expected: success.

- [ ] **Step 3: Look at it in the browser**

Use the `run` skill. Sign in as an admin, and seed receipts from the super-admin "test data" screen if needed. Then check:
- `/reports` shows "Collections detail" with Month, Facility, an optional Collector ("All collectors"), Account, Tenant and "Customer contains".
- Opening it for a month with receipts shows three sections. The Section 1 and Section 3 totals are equal.
- With no filters, Section 3's per-account totals equal `/reports/monthly-summary` for that month's column, before adjustments. Check two or three accounts.
- A filter narrows all three sections, and the scope line names it.
- Excel has three sheets: Lines, Per tenant, By account. Print preview is landscape.

- [ ] **Step 4: Time it**

Open the report for the local month with the most receipts and note how long it takes. Above about 5 s locally, report the figure before going further, because production volume (about 12,000 lines a month) is larger.

- [ ] **Step 5: Hand over**

Report to the user:
- what was built;
- the deviations above, which go in the PR description;
- that there is **no migration**, so there is no production bundle and only the web deploy.

Leave pushing and opening the PR to `superpowers:finishing-a-development-branch`.
