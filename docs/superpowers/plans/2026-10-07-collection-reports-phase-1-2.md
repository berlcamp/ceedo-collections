# Collection Reports — Phases 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two office reports that run on today's ledger data:
- **Tenant balances as of a date**, with Aging rebuilt on the same function.
- **Monthly tenant payments**: a tenant × day grid.

**Architecture:**
- **Database:** two `security invoker` SQL functions over the existing ledger tables:
  - `lease_balances_as_of(date)`;
  - `lease_receipts_by_day(from, to)`, alongside `leases_active_between(from, to)`.
- **Builders:** pure TypeScript functions turn their rows into the existing `Report` structure. That one structure already renders on screen, in print/PDF and as xlsx.
- **Report hub:** gains two parameter kinds: `asOf` (a date meaning "on or before") and an optional `facility`.

**Tech Stack:** Postgres (Supabase local, ports 563xx), Next.js app router (`apps/web`), vitest, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`. This plan covers rollout phases 1 and 2. Phases 3–7 get their own plans.

## Global Constraints

- Schema `ceedo_collections`.
- New views and functions are `security invoker`. RLS on the underlying tables does the gating; there is no new definer code.
- Money is integer **centavos** in TypeScript (`Centavos` from `@ceedo/shared`). Postgres numeric arrives as a string and is converted with `fromPesos(Number(v))`.
- Dates are Asia/Manila business dates in `YYYY-MM-DD`. A timestamp becomes a Manila date in SQL with `(ts at time zone 'Asia/Manila')::date`.
- **PostgREST returns at most 1000 rows.** Every list read pages with `.range()`, through `allPages` in `apps/web/lib/reports/data.ts`.
- **Migrations:**
  - Named `supabase/migrations/20261007000062_*.sql` and `20261007000063_*.sql`.
  - Applied locally with `supabase migration up`.
  - After each one, run `pnpm db:types` and commit `packages/shared/src/db.types.ts`. CI runs `scripts/check-types-current.sh`.
- **Running tests:**
  - Run them from the repo root with keys exported: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <file>`.
  - Run `supabase db reset` before any full-suite run you intend to trust.
- **Before pushing `main`:** run `pnpm --filter @ceedo/web build`. Any type error blocks the push.
- **Production:**
  - The DB is updated only through `node scripts/bundle-migrations.mjs --after <version>`, a bundle the user pastes in themselves.
  - Ask the user for `select max(version) from ceedo_collections.deployed_migrations;` first.
  - Never push or deploy without the user's go-ahead.
- **Spec deviations, deliberate:**
  - *The Balances report has no Advance/Net column.* `post_collection` sets `gross_amount` to the sum of whole unpaid charge groups, so no receipt carries unallocated credit, and advance payments cannot exist today. That gap is reported to the user.
  - *Phase 2 groups the grid by facility → section.* Account lines arrive in phase 3, whose plan re-keys the grid.
  - *The row-style framework change (heading/subtotal rows) is deferred to the phase 5 plan.* One section per group plus a summary section serves both reports here.
  - *Night Market / Tabo vendors without leases are not yet in the grid.* They are cash-fee receipts with a payer reference, which phase 3 classifies. The grid covers lease receipts only.

## Review Focus

1. **A lease that is fully paid on D** must not appear in Balances. The summary must not count it either.
2. **A facility filter that matches nothing** must show the report's empty message, not crash and not show every facility.
3. **February and 31-day months** must give the grid exactly as many day columns as the month has.
4. **A receipt cancelled during the month** must vanish from the grid and its totals. If reinstated, it must come back.
5. **A lease that ended mid-month but paid in that month** must still have its row, so the grid total always equals the month's lease receipts.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261007000062_lease_balances_as_of.sql` | `lease_balances_as_of(p_date)` |
| `supabase/migrations/20261007000063_tenant_payments.sql` | `leases_active_between`, `lease_receipts_by_day` |
| `tests/db/lease-balances-as-of.test.ts` | DB tests for 062 |
| `tests/db/tenant-payments.test.ts` | DB tests for 063 |
| `apps/web/lib/reports/params.ts` (+ test) | `facilityId` in `ReportParams` |
| `apps/web/lib/reports/catalog.ts` | `ParamKind` gains `asOf`, `facility`; two new entries |
| `apps/web/lib/reports/open-exceptions.ts` (+ test) | `asOf` scoping |
| `apps/web/lib/reports/options.ts` | `getFacilityOptions`, `facilityLabel` |
| `apps/web/app/(admin)/reports/page.tsx` | renders the As-of and Facility inputs |
| `apps/web/lib/reports/builders/grouping.ts` (+ test) | `groupBySection`, `compareStall`, `rateLabel` |
| `apps/web/lib/reports/builders/balances.ts` (+ test) | `balancesReport` (pure; its data-reading wrapper is in `catalog.ts`) |
| `apps/web/lib/reports/builders/tenant-payments.ts` (+ test) | `tenantPaymentsReport` (pure; its data-reading wrapper is in `catalog.ts`) |
| `apps/web/lib/reports/data.ts` | `balancesAsOf`, `tenantPaymentData` |
| `apps/web/lib/reports/report.ts`, `xlsx.ts` (+ test), `components/reports/report-document.tsx` | `ReportSection.dense` |
| `apps/web/lib/ledger/queries.ts` | `getAging` reads `lease_balances_as_of(today)` |

---

### Task 1: `lease_balances_as_of` SQL function

**Files:**
- Create: `supabase/migrations/20261007000062_lease_balances_as_of.sql`
- Create: `tests/db/lease-balances-as-of.test.ts`
- Modify: `packages/shared/src/db.types.ts` (regenerated)

**Interfaces:**
- Produces: `ceedo_collections.lease_balances_as_of(p_date date)`, returning one row per lease with `outstanding > 0`. Columns:
  - `lease_id uuid, facility_id uuid, facility_name text, section_id uuid, section_name text, stall_no text, tenant_name text, rate_amount numeric, accrual_period accrual_period`
  - `outstanding numeric, not_yet_due numeric, bucket_1_30 numeric, bucket_31_60 numeric, bucket_61_90 numeric, bucket_over_90 numeric`
  - `oldest_due_date date, unpaid_charges integer`
- **Semantics:**
  - A charge **counts on D** if `due_date <= D`, or `period_end < D` (accrued but not yet due).
  - A receipt **counts on D** if `business_date <= D` and it has no cancellation that is (a) recorded by D (Manila date) and (b) not reinstated by D.
  - Condonations count if `condoned_at` falls on or before D.
  - Charge age is `D - due_date`. An age of 0 or less is "not yet due", matching `aging_of_receivables`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/lease-balances-as-of.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createCollectionFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00",
  });
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

/** A rental charge with explicit dates; run_accrual is not under test here. */
async function charge(due: string, amount = "50.00", periodEnd = due): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount,
        surcharge_bps, source)
     values ($1, $2, 'rental', $3::date, $3::date, $4::date, $5, 0, 'manual')
     returning id`,
    [fx.leaseId, fx.feeTypeId, periodEnd, due, amount],
  );
  return rows[0].id as string;
}

async function asOf(date: string) {
  const { rows } = await db.query(
    `select * from ceedo_collections.lease_balances_as_of($1::date) where lease_id = $2`,
    [date, fx.leaseId],
  );
  return rows;
}

const owed = async (date: string) => {
  const rows = await asOf(date);
  return rows.length === 0 ? 0 : Number(rows[0].outstanding);
};

describe("lease_balances_as_of", () => {
  it("counts only charges due by the date and receipts dated by it", async () => {
    await charge("2026-10-01");
    await charge("2026-10-02");
    // business date 2026-10-05; pays the oldest group (10-01)
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });

    expect(await owed("2026-09-30")).toBe(0);
    expect(await owed("2026-10-01")).toBe(50);
    expect(await owed("2026-10-04")).toBe(100);
    expect(await owed("2026-10-05")).toBe(50);
  });

  it("keeps a receipt cancelled after the date as paid on that date, and honours reinstatement", async () => {
    await charge("2026-10-01");
    const collectionId = await postCollectionAsOwner(db, fx, {
      groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00",
    });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, reason, cancelled_by, cancelled_at)
       values ($1, 'test', $2, '2026-10-06T02:00:00+00:00') returning id`,
      [collectionId, fx.collectorId],
    );
    expect(await owed("2026-10-05")).toBe(0);
    expect(await owed("2026-10-06")).toBe(50);

    await db.query(
      `insert into ceedo_collections.collection_reinstatements
         (cancellation_id, reason, reinstated_by, reinstated_at)
       values ($1, 'test', $2, '2026-10-07T02:00:00+00:00')`,
      [rows[0].id, fx.collectorId],
    );
    expect(await owed("2026-10-06")).toBe(50);
    expect(await owed("2026-10-07")).toBe(0);
  });

  it("applies a condonation only from the day it was recorded", async () => {
    const id = await charge("2026-10-01");
    await db.query(
      `insert into ceedo_collections.charge_condonations
         (charge_id, amount, authority_ref, reason, condoned_by, condoned_at)
       values ($1, 50.00, 'Ord. 1', 'test', $2, '2026-10-08T02:00:00+00:00')`,
      [id, fx.collectorId],
    );
    expect(await owed("2026-10-07")).toBe(50);
    expect(await owed("2026-10-08")).toBe(0);
  });

  it("ages each charge from the as-of date, not from today", async () => {
    await charge("2026-09-01", "40.00");
    await charge("2026-10-01", "10.00");

    const [oct] = await asOf("2026-10-31");
    expect(Number(oct.bucket_31_60)).toBe(40); // 60 days
    expect(Number(oct.bucket_1_30)).toBe(10); // 30 days
    expect(oct.unpaid_charges).toBe(2);

    const [dec] = await asOf("2026-12-15");
    expect(Number(dec.bucket_over_90)).toBe(40); // 105 days
    expect(Number(dec.bucket_61_90)).toBe(10); // 75 days
    expect(dec.unpaid_charges).toBe(2);
  });

  it("shows an elapsed-but-not-yet-due monthly charge as not yet due", async () => {
    await charge("2026-11-05", "300.00", "2026-10-31");
    expect(await owed("2026-10-31")).toBe(0); // period not over yet
    const [row] = await asOf("2026-11-03");
    expect(Number(row.not_yet_due)).toBe(300);
    expect(Number(row.outstanding)).toBe(300);
  });

  it("omits a lease that owes nothing on the date", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    expect(await asOf("2026-10-05")).toHaveLength(0);
  });

  it("carries the lease's facility, section, stall, tenant and rate", async () => {
    await charge("2026-10-01");
    const [row] = await asOf("2026-10-01");
    const { rows: meta } = await db.query(
      `select f.id as facility_id, s.id as section_id, st.stall_no, t.full_name
         from ceedo_collections.leases l
         join ceedo_collections.stalls st on st.id = l.stall_id
         join ceedo_collections.sections s on s.id = st.section_id
         join ceedo_collections.facilities f on f.id = s.facility_id
         join ceedo_collections.tenants t on t.id = l.tenant_id
        where l.id = $1`,
      [fx.leaseId],
    );
    expect(row.facility_id).toBe(meta[0].facility_id);
    expect(row.section_id).toBe(meta[0].section_id);
    expect(row.stall_no).toBe(meta[0].stall_no);
    expect(row.tenant_name).toBe(meta[0].full_name);
    expect(Number(row.rate_amount)).toBe(50);
    expect(row.accrual_period).toBe("daily");
  });

  it("agrees with lease_balances and aging_of_receivables at today", async () => {
    for (const [days, amount] of [[0, "5.00"], [10, "10.00"], [45, "20.00"], [75, "30.00"], [120, "40.00"]] as const) {
      await db.query(
        `insert into ceedo_collections.charges
           (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount,
            surcharge_bps, source)
         values ($1, $2, 'rental',
           ceedo_collections.business_date() - $3::int, ceedo_collections.business_date() - $3::int,
           ceedo_collections.business_date() - $3::int, $4, 0, 'manual')`,
        [fx.leaseId, fx.feeTypeId, days, amount],
      );
    }
    const { rows } = await db.query(
      `select a.*, lb.outstanding as lb_outstanding
         from ceedo_collections.lease_balances_as_of(ceedo_collections.business_date()) a
         join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
         join ceedo_collections.aging_of_receivables ag on ag.lease_id = a.lease_id
        where a.lease_id = $1
          and a.not_yet_due = ag.not_yet_due and a.bucket_1_30 = ag.bucket_1_30
          and a.bucket_31_60 = ag.bucket_31_60 and a.bucket_61_90 = ag.bucket_61_90
          and a.bucket_over_90 = ag.bucket_over_90`,
      [fx.leaseId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].outstanding)).toBe(Number(rows[0].lb_outstanding));
    expect(Number(rows[0].outstanding)).toBe(105);
  });

  it("returns nothing to an authenticated user who is not staff", async () => {
    await charge("2026-10-01");
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.rpc("lease_balances_as_of", { p_date: "2026-10-31" });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/lease-balances-as-of.test.ts`

Expected: FAIL with `function ceedo_collections.lease_balances_as_of(date) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261007000062_lease_balances_as_of.sql
--
-- What each lease owed at the end of a given business date. charge_balances answers
-- "as of now"; this answers "as of D", so a balance printed for 30 September reads the
-- same in December. security invoker: RLS on charges/collections/leases gates it exactly
-- as it gates charge_balances.
--
-- On D:
--   * a charge counts once its period has ended before D or it fell due by D;
--   * a receipt counts if dated by D and not cancelled by D (a cancellation reinstated by
--     D does not count) -- so a receipt cancelled after D still paid on D;
--   * a condonation counts from the Manila date it was recorded.
-- Age is D - due_date; 0 or less is "not yet due", as in aging_of_receivables.

create or replace function ceedo_collections.lease_balances_as_of(p_date date)
returns table (
  lease_id        uuid,
  facility_id     uuid,
  facility_name   text,
  section_id      uuid,
  section_name    text,
  stall_no        text,
  tenant_name     text,
  rate_amount     numeric(14,2),
  accrual_period  ceedo_collections.accrual_period,
  outstanding     numeric(14,2),
  not_yet_due     numeric(14,2),
  bucket_1_30     numeric(14,2),
  bucket_31_60    numeric(14,2),
  bucket_61_90    numeric(14,2),
  bucket_over_90  numeric(14,2),
  oldest_due_date date,
  unpaid_charges  integer
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with counted as (
    select col.id
    from ceedo_collections.collections col
    where col.business_date <= p_date
      and not exists (
        select 1
        from ceedo_collections.collection_cancellations cc
        where cc.collection_id = col.id
          and (cc.cancelled_at at time zone 'Asia/Manila')::date <= p_date
          and not exists (
            select 1 from ceedo_collections.collection_reinstatements r
            where r.cancellation_id = cc.id
              and (r.reinstated_at at time zone 'Asia/Manila')::date <= p_date
          )
      )
  ),
  alloc as (
    select a.charge_id, sum(a.amount) as amount
    from ceedo_collections.collection_allocations a
    join counted k on k.id = a.collection_id
    group by a.charge_id
  ),
  cond as (
    select k.charge_id, sum(k.amount) as amount
    from ceedo_collections.charge_condonations k
    where (k.condoned_at at time zone 'Asia/Manila')::date <= p_date
    group by k.charge_id
  ),
  per_charge as (
    select
      c.lease_id,
      c.due_date,
      (p_date - c.due_date) as age,
      (c.amount - coalesce(al.amount, 0) - coalesce(co.amount, 0)) as outstanding
    from ceedo_collections.charges c
    left join alloc al on al.charge_id = c.id
    left join cond  co on co.charge_id = c.id
    where c.due_date <= p_date or c.period_end < p_date
  ),
  per_lease as (
    select
      pc.lease_id,
      sum(pc.outstanding) as outstanding,
      coalesce(sum(pc.outstanding) filter (where pc.age <= 0), 0)              as not_yet_due,
      coalesce(sum(pc.outstanding) filter (where pc.age between 1 and 30), 0)  as b1,
      coalesce(sum(pc.outstanding) filter (where pc.age between 31 and 60), 0) as b2,
      coalesce(sum(pc.outstanding) filter (where pc.age between 61 and 90), 0) as b3,
      coalesce(sum(pc.outstanding) filter (where pc.age > 90), 0)              as b4,
      min(pc.due_date) as oldest,
      count(*)::integer as unpaid
    from per_charge pc
    where pc.outstanding > 0
    group by pc.lease_id
  )
  select
    l.id, f.id, f.name, s.id, s.name, st.stall_no, t.full_name,
    l.rate_amount, l.accrual_period,
    pl.outstanding::numeric(14,2), pl.not_yet_due::numeric(14,2),
    pl.b1::numeric(14,2), pl.b2::numeric(14,2), pl.b3::numeric(14,2), pl.b4::numeric(14,2),
    pl.oldest, pl.unpaid
  from per_lease pl
  join ceedo_collections.leases     l  on l.id = pl.lease_id
  join ceedo_collections.stalls     st on st.id = l.stall_id
  join ceedo_collections.sections   s  on s.id = st.section_id
  join ceedo_collections.facilities f  on f.id = s.facility_id
  join ceedo_collections.tenants    t  on t.id = l.tenant_id;
$$;

revoke execute on function ceedo_collections.lease_balances_as_of(date) from public;
grant execute on function ceedo_collections.lease_balances_as_of(date) to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

```bash
supabase migration up
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/lease-balances-as-of.test.ts
```

Expected: PASS (9 tests). If an insert into `collection_cancellations`, `collection_reinstatements` or `charge_condonations` fails on a NOT NULL column this plan does not list, read that table's migration and add the column to the test's insert. Do not change the function.

- [ ] **Step 5: Regenerate the types and commit**

```bash
pnpm db:types
git add supabase/migrations/20261007000062_lease_balances_as_of.sql tests/db/lease-balances-as-of.test.ts packages/shared/src/db.types.ts
git commit -m "feat(ledger): lease_balances_as_of — what each lease owed on a date"
```

---

### Task 2: Report parameters `asOf` and `facility`

**Files:**
- Modify: `apps/web/lib/reports/params.ts`, `apps/web/lib/reports/params.test.ts`
- Modify: `apps/web/lib/reports/catalog.ts` (only the `ParamKind` union in this task)
- Modify: `apps/web/lib/reports/open-exceptions.ts`, `apps/web/lib/reports/open-exceptions.test.ts`
- Modify: `apps/web/lib/reports/options.ts`
- Modify: `apps/web/app/(admin)/reports/page.tsx`

**Interfaces:**
- Produces:
  - `ReportParams.facilityId: string | null`, read from the `facility` query parameter (UUID or null).
  - `ParamKind = "date" | "asOf" | "month" | "collector" | "lease" | "facility"`. `asOf` reads the same `date` URL parameter.
  - `getFacilityOptions(): Promise<{ id: string; label: string }[]>`.
  - `facilityLabel(id: string | null): Promise<string | null>`.
  - `exceptionsInScope` treats `asOf` as "collected on or before `p.date`".

- [ ] **Step 1: Write the failing tests**

In `params.test.ts`, add `facilityId: null` to both existing `toEqual` objects, and append:

```ts
  it("reads an optional facility id and ignores a mangled one", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    expect(readParams({ facility: id }, lateUtc).facilityId).toBe(id);
    expect(readParams({ facility: "all" }, lateUtc).facilityId).toBeNull();
    expect(readParams({}, lateUtc).facilityId).toBeNull();
  });
```

In `open-exceptions.test.ts`, change the shared `params` constant to include `facilityId: null`, and append inside the `describe`:

```ts
  it("scopes an as-of report to everything collected on or before the date", () => {
    const rows = [
      ex(ALICE, "2026-09-28T02:00:00Z"),
      ex(BOB, "2026-09-29T15:59:00Z"), // 23:59 on the 29th in Manila
      ex(BOB, "2026-09-29T16:00:00Z"), // 00:00 on the 30th in Manila
    ];
    expect(exceptionsInScope(rows, ["asOf", "facility"], params)).toEqual([rows[0], rows[1]]);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.test.ts`

Expected: FAIL. `facilityId` is missing, and `"asOf"` is not assignable to `ParamKind`. The as-of test also returns all three rows.

- [ ] **Step 3: Implement**

`params.ts`: add the field to the interface, and set it in `readParams`.

```ts
export interface ReportParams {
  /** A business date, YYYY-MM-DD (Asia/Manila). */
  date: string;
  /** A month, YYYY-MM. */
  month: string;
  collectorId: string | null;
  leaseId: string | null;
  /** Narrows a report to one facility; null means every facility. */
  facilityId: string | null;
}
```

```ts
  return {
    date,
    month,
    collectorId: UUID.test(one("collector")) ? one("collector") : null,
    leaseId: UUID.test(one("lease")) ? one("lease") : null,
    facilityId: UUID.test(one("facility")) ? one("facility") : null,
  };
```

`catalog.ts`: replace the `ParamKind` line.

```ts
/**
 * Which inputs a report asks for; the hub renders exactly these. `asOf` is a date read
 * as "on or before" (balances); `date` is one business day.
 */
export type ParamKind = "date" | "asOf" | "month" | "collector" | "lease" | "facility";
```

`open-exceptions.ts`: insert this before `if (kinds.includes("date"))`.

```ts
    // A balance as of D is moved by every receipt dated on or before D.
    if (kinds.includes("asOf")) return on <= p.date;
```

`options.ts`: append.

```ts
export interface FacilityOption {
  id: string;
  label: string;
}

/** Every facility, by name: the hub's facility filter. */
export async function getFacilityOptions(): Promise<FacilityOption[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase.from("facilities").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ id: f.id, label: f.name }));
}

/** A facility's name for a report's scope line; null for "all facilities". */
export async function facilityLabel(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await getFacilityOptions()).find((f) => f.id === id)?.label ?? null;
}
```

`reports/page.tsx`:
- Import `getFacilityOptions` from `@/lib/reports/options`.
- Load the facilities in the same `Promise.all`.
- Render the two inputs, placing them after the `"date"` block.

```tsx
  const [collectors, leases, facilities] = await Promise.all([
    needs.has("collector") ? getCollectors() : Promise.resolve([]),
    needs.has("lease") ? getLeaseOptions() : Promise.resolve([]),
    needs.has("facility") ? getFacilityOptions() : Promise.resolve([]),
  ]);
```

```tsx
              {report.params.includes("asOf") ? (
                <label className="text-xs text-ink-2">
                  As of
                  <TextInput type="date" name="date" defaultValue={today} className="mt-1 w-40" required />
                </label>
              ) : null}
              {report.params.includes("facility") ? (
                <label className="text-xs text-ink-2">
                  Facility
                  <NativeSelect name="facility" className="mt-1 w-52" defaultValue="">
                    <option value="">All facilities</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run apps/web/lib/reports/params.test.ts apps/web/lib/reports/open-exceptions.test.ts && pnpm --filter @ceedo/web typecheck`

Expected: PASS, and no type errors. If any other file builds a `ReportParams` literal, add `facilityId: null` to it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports apps/web/app/\(admin\)/reports/page.tsx
git commit -m "feat(reports): as-of and facility report parameters"
```

---

### Task 3: Shared grouping helpers and the Balances report

**Files:**
- Create: `apps/web/lib/reports/builders/grouping.ts`, `apps/web/lib/reports/builders/grouping.test.ts`
- Create: `apps/web/lib/reports/builders/balances.ts`, `apps/web/lib/reports/builders/balances.test.ts`
- Modify: `apps/web/lib/reports/data.ts` (add `balancesAsOf`)
- Modify: `apps/web/lib/reports/catalog.ts` (add the entry)

**Interfaces:**
- Consumes:
  - `lease_balances_as_of` (Task 1).
  - `ReportParams.facilityId`, `ParamKind` `asOf`/`facility` and `facilityLabel` (Task 2).
- Produces:
  - `type AccrualPeriod = "daily" | "weekly" | "monthly"`.
  - `rateLabel(rate: Centavos, period: AccrualPeriod): string`, e.g. `"200.00/day"`.
  - `compareStall(a: string, b: string): number`, numeric-aware.
  - `groupBySection<T extends { facilityName: string; sectionName: string }>(rows: T[]): SectionGroup<T>[]`, sorted by facility and then section. Defined as `interface SectionGroup<T> { facilityName: string; sectionName: string; rows: T[] }`.
  - `interface BalanceRow { leaseId; facilityName; sectionName; stallNo; tenantName: string; rate: Centavos; accrualPeriod: AccrualPeriod; notYetDue; days1to30; days31to60; days61to90; over90; outstanding: Centavos }`.
  - `balancesReport(rows: BalanceRow[], opts: { date: string; facilityName: string | null }): Report`.
  - `balancesAsOf(date: string, facilityId: string | null): Promise<BalanceRow[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/reports/builders/grouping.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { compareStall, groupBySection, rateLabel } from "./grouping";

describe("grouping helpers", () => {
  it("orders stall numbers the way people count them", () => {
    expect(["10", "2", "G-1", "1"].sort(compareStall)).toEqual(["1", "2", "10", "G-1"]);
  });

  it("labels a rate with its period", () => {
    expect(rateLabel(fromPesos(200), "daily")).toBe("200.00/day");
    expect(rateLabel(fromPesos(30000), "monthly")).toBe("30,000.00/month");
  });

  it("groups by facility then section, both sorted", () => {
    const rows = [
      { facilityName: "Public Mall", sectionName: "Meat", id: 1 },
      { facilityName: "IBJT", sectionName: "Building 2", id: 2 },
      { facilityName: "Public Mall", sectionName: "Bakery", id: 3 },
      { facilityName: "Public Mall", sectionName: "Meat", id: 4 },
    ];
    const groups = groupBySection(rows);
    expect(groups.map((g) => `${g.facilityName}/${g.sectionName}`)).toEqual([
      "IBJT/Building 2", "Public Mall/Bakery", "Public Mall/Meat",
    ]);
    expect(groups[2]!.rows.map((r) => r.id)).toEqual([1, 4]);
  });
});
```

```ts
// apps/web/lib/reports/builders/balances.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos, type Centavos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import { balancesReport, type BalanceRow } from "./balances";

const zero = fromPesos(0);
function row(over: Partial<BalanceRow>): BalanceRow {
  return {
    leaseId: crypto.randomUUID(), facilityName: "Public Mall", sectionName: "Bakery",
    stallNo: "1", tenantName: "Tenant", rate: fromPesos(200), accrualPeriod: "daily",
    notYetDue: zero, days1to30: zero, days31to60: zero, days61to90: zero, over90: zero,
    outstanding: zero, ...over,
  };
}

describe("balancesReport", () => {
  const rows = [
    row({ stallNo: "10", tenantName: "Ten", days1to30: fromPesos(400), outstanding: fromPesos(400) }),
    row({ stallNo: "2", tenantName: "Two", over90: fromPesos(1000), outstanding: fromPesos(1000) }),
    row({ facilityName: "IBJT", sectionName: "Building 2", stallNo: "MG 1", outstanding: fromPesos(100), notYetDue: fromPesos(100) }),
  ];

  it("has one section per facility and section, stalls in counting order, then a summary", () => {
    const r = balancesReport(rows, { date: "2026-10-31", facilityName: null });
    expect(r.sections.map((s) => s.title)).toEqual([
      "IBJT · Building 2", "Public Mall · Bakery", "Summary by section",
    ]);
    expect(r.sections[1]!.rows.map((x) => x.stall)).toEqual(["2", "10"]);
    expect(r.sections[1]!.rows[0]!.rate).toBe("200.00/day");
    expect(sectionTotals(r.sections[1]!)!.owed).toBe(140000);
  });

  it("summarises each section and totals every lease", () => {
    const summary = balancesReport(rows, { date: "2026-10-31", facilityName: null }).sections.at(-1)!;
    expect(summary.rows).toEqual([
      { facility: "IBJT", section: "Building 2", leases: 1, owed: 10000 as Centavos },
      { facility: "Public Mall", section: "Bakery", leases: 2, owed: 140000 as Centavos },
    ]);
    expect(sectionTotals(summary)).toEqual({ leases: 3, owed: 150000 });
  });

  it("names the date and facility in its scope", () => {
    expect(balancesReport(rows, { date: "2026-10-31", facilityName: null }).scope)
      .toBe("All facilities · as of 31 October 2026");
    expect(balancesReport([], { date: "2026-10-31", facilityName: "IBJT" }).scope)
      .toBe("IBJT · as of 31 October 2026");
  });

  it("shows only an empty summary when nobody owes anything", () => {
    const r = balancesReport([], { date: "2026-10-31", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.rows).toEqual([]);
    expect(r.sections[0]!.empty).toBe("No tenant had an outstanding balance on this date.");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run apps/web/lib/reports/builders/grouping.test.ts apps/web/lib/reports/builders/balances.test.ts`

Expected: FAIL. The modules `./grouping` and `./balances` are not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/reports/builders/grouping.ts
import type { Centavos } from "@ceedo/shared";
import { pesos } from "../report";

export type AccrualPeriod = "daily" | "weekly" | "monthly";

const PER: Record<AccrualPeriod, string> = { daily: "day", weekly: "week", monthly: "month" };

/** "200.00/day" -- the rate as the office writes it on the April grid. */
export function rateLabel(rate: Centavos, period: AccrualPeriod): string {
  return `${pesos(rate)}/${PER[period]}`;
}

/** Stall numbers in counting order: 2 before 10, letters after digits. */
export function compareStall(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface SectionGroup<T> {
  facilityName: string;
  sectionName: string;
  rows: T[];
}

/** Rows by facility, then section -- the office's area → section blocks. */
export function groupBySection<T extends { facilityName: string; sectionName: string }>(
  rows: T[],
): SectionGroup<T>[] {
  const groups = new Map<string, SectionGroup<T>>();
  for (const row of rows) {
    const key = `${row.facilityName}\u0000${row.sectionName}`;
    let group = groups.get(key);
    if (!group) {
      group = { facilityName: row.facilityName, sectionName: row.sectionName, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()].sort(
    (a, b) => a.facilityName.localeCompare(b.facilityName) || a.sectionName.localeCompare(b.sectionName),
  );
}
```

```ts
// apps/web/lib/reports/builders/balances.ts
import { sum, type Centavos } from "@ceedo/shared";
import { longDate } from "../params";
import type { Report, ReportColumn, ReportSection } from "../report";
import { compareStall, groupBySection, rateLabel, type AccrualPeriod } from "./grouping";

export interface BalanceRow {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
  notYetDue: Centavos;
  days1to30: Centavos;
  days31to60: Centavos;
  days61to90: Centavos;
  over90: Centavos;
  outstanding: Centavos;
}

const COLUMNS: ReportColumn[] = [
  { key: "stall", label: "Stall", kind: "text" },
  { key: "tenant", label: "Tenant", kind: "text" },
  { key: "rate", label: "Rate", kind: "text" },
  { key: "nyd", label: "Not yet due", kind: "money", total: true },
  { key: "b1", label: "1–30 days", kind: "money", total: true },
  { key: "b2", label: "31–60 days", kind: "money", total: true },
  { key: "b3", label: "61–90 days", kind: "money", total: true },
  { key: "b4", label: "Over 90 days", kind: "money", total: true },
  { key: "owed", label: "Outstanding", kind: "money", total: true },
];

/** Spec report 3: what each tenant owed at the end of a date, by facility and section. */
export function balancesReport(
  rows: BalanceRow[],
  opts: { date: string; facilityName: string | null },
): Report {
  const groups = groupBySection(rows);
  const sections: ReportSection[] = groups.map((g) => ({
    title: `${g.facilityName} · ${g.sectionName}`,
    columns: COLUMNS,
    rows: [...g.rows]
      .sort((a, b) => compareStall(a.stallNo, b.stallNo))
      .map((r) => ({
        stall: r.stallNo,
        tenant: r.tenantName,
        rate: rateLabel(r.rate, r.accrualPeriod),
        nyd: r.notYetDue,
        b1: r.days1to30,
        b2: r.days31to60,
        b3: r.days61to90,
        b4: r.over90,
        owed: r.outstanding,
      })),
  }));
  sections.push({
    title: "Summary by section",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "section", label: "Section", kind: "text" },
      { key: "leases", label: "Tenants owing", kind: "int", total: true },
      { key: "owed", label: "Outstanding", kind: "money", total: true },
    ],
    rows: groups.map((g) => ({
      facility: g.facilityName,
      section: g.sectionName,
      leases: g.rows.length,
      owed: sum(g.rows.map((r) => r.outstanding)),
    })),
    empty: "No tenant had an outstanding balance on this date.",
  });
  return {
    title: "Tenant balances",
    scope: `${opts.facilityName ?? "All facilities"} · as of ${longDate(opts.date)}`,
    sections,
    notes: [
      "Outstanding is every charge due on or before the date, less receipts dated by then and write-offs recorded by then.",
      "A receipt cancelled after the date still counts as paid on it.",
    ],
  };
}
```

`data.ts`: append the following. `allPages` and `centavos` are already defined in this file. Import `BalanceRow` as a type to avoid a runtime cycle.

```ts
import type { BalanceRow } from "./builders/balances";

/** lease_balances_as_of, paged; optionally one facility. */
export async function balancesAsOf(date: string, facilityId: string | null): Promise<BalanceRow[]> {
  const supabase = await getServerClient();
  const rows = await allPages((from, to) => {
    let q = supabase.rpc("lease_balances_as_of", { p_date: date });
    if (facilityId) q = q.eq("facility_id", facilityId);
    return q.order("lease_id").range(from, to);
  });
  return rows.map((r) => ({
    leaseId: r.lease_id,
    facilityName: r.facility_name,
    sectionName: r.section_name,
    stallNo: r.stall_no,
    tenantName: r.tenant_name,
    rate: centavos(r.rate_amount),
    accrualPeriod: r.accrual_period,
    notYetDue: centavos(r.not_yet_due),
    days1to30: centavos(r.bucket_1_30),
    days31to60: centavos(r.bucket_31_60),
    days61to90: centavos(r.bucket_61_90),
    over90: centavos(r.bucket_over_90),
    outstanding: centavos(r.outstanding),
  }));
}
```

`catalog.ts`:
- The data-reading wrapper lives here, **not** in the builder module. `data.ts` reaches `next/headers` through `getServerClient`, and the pure builders must stay importable from vitest without it.
- Add these imports:

```ts
import { balancesReport } from "./builders/balances";
import { balancesAsOf } from "./data";
import { facilityLabel } from "./options";
```

- Insert this entry directly before the `aging` entry:

```ts
  {
    key: "balances-as-of",
    title: "Tenant balances",
    purpose: "What every tenant owed at the end of a chosen date, by facility and section, aged from that date.",
    params: ["asOf", "facility"],
    build: async (p) => {
      const [rows, facilityName] = await Promise.all([
        balancesAsOf(p.date, p.facilityId),
        facilityLabel(p.facilityId),
      ]);
      return balancesReport(rows, { date: p.date, facilityName });
    },
  },
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run apps/web/lib/reports/builders && pnpm --filter @ceedo/web typecheck`

Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports
git commit -m "feat(reports): tenant balances as of a date"
```

---

### Task 4: Aging reads `lease_balances_as_of(today)`

**Files:**
- Modify: `apps/web/lib/ledger/queries.ts:157-181` (`getAging`)

**Interfaces:**
- Consumes: `lease_balances_as_of` (Task 1); `manilaToday` from `@/lib/reports/params`.
- Produces: the same `AgingRow[]` shape as today. Its callers (`/ledger/aging`, the dashboard, the `aging` report) are unchanged.

- [ ] **Step 1: Replace `getAging`**

```ts
/**
 * Aging is the as-of-today case of lease_balances_as_of (migration 062), so it can never
 * disagree with the Tenant balances report. Paged: PostgREST stops at 1000 rows.
 */
export async function getAging(): Promise<AgingRow[]> {
  const supabase = await ledgerClient();
  const today = manilaToday();
  const rows: Database["ceedo_collections"]["Functions"]["lease_balances_as_of"]["Returns"] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc("lease_balances_as_of", { p_date: today })
      .order("bucket_over_90", { ascending: false })
      .order("lease_id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows.map((r) => ({
    leaseId: r.lease_id,
    stallNo: r.stall_no,
    stallLabel: [`Stall ${r.stall_no}`, r.section_name].filter(Boolean).join(" · "),
    tenantName: r.tenant_name,
    bucket1to30: centavos(r.bucket_1_30),
    bucket31to60: centavos(r.bucket_31_60),
    bucket61to90: centavos(r.bucket_61_90),
    bucketOver90: centavos(r.bucket_over_90),
    notYetDue: centavos(r.not_yet_due),
    total: centavos(r.outstanding),
  }));
}
```

Add `import { manilaToday } from "../reports/params";` at the top of the file. If `stallLabelsByLeaseId` is now unused, keep it only if another function still calls it; otherwise delete it so lint stays clean.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @ceedo/web typecheck && pnpm vitest run apps/web`

Expected: no type errors, and all web tests pass. Task 1's "agrees with aging_of_receivables" test already proves the figures are equal.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ledger/queries.ts
git commit -m "refactor(ledger): aging reads lease_balances_as_of(today)"
```

---

### Task 5: `leases_active_between` and `lease_receipts_by_day`

**Files:**
- Create: `supabase/migrations/20261007000063_tenant_payments.sql`
- Create: `tests/db/tenant-payments.test.ts`
- Modify: `packages/shared/src/db.types.ts` (regenerated)

**Interfaces:**
- Produces: `leases_active_between(p_from date, p_to date)`.
  - Returns `(lease_id, facility_id, facility_name, section_id, section_name, stall_no, tenant_name, rate_amount, accrual_period)`.
  - Includes every lease whose term overlaps the range, **or** that has a lease receipt dated in it.
- Produces: `lease_receipts_by_day(p_from date, p_to date)`.
  - Returns `(lease_id, business_date, base numeric, surcharge numeric)`, one row per lease per day.
  - Only lease receipts are included, and those with a standing cancellation are excluded.
  - `surcharge` is the receipt's allocations to `charge_type = 'surcharge'` charges; `base` is `gross_amount − surcharge`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/tenant-payments.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createCollectionFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00",
  });
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

async function charge(due: string, amount = "50.00", type = "rental", parent: string | null = null) {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, parent_charge_id, period_start, period_end,
        due_date, amount, surcharge_bps, source)
     values ($1, $2, $3::ceedo_collections.charge_type, $4, $5::date, $5::date, $5::date, $6, 0, 'manual')
     returning id`,
    [fx.leaseId, fx.feeTypeId, type, parent, due, amount],
  );
  return rows[0].id as string;
}

const days = async (from: string, to: string) =>
  (await db.query(
    `select lease_id, business_date::text as d, base, surcharge
       from ceedo_collections.lease_receipts_by_day($1::date, $2::date)
      where lease_id = $3 order by business_date`,
    [from, to, fx.leaseId],
  )).rows;

describe("lease_receipts_by_day", () => {
  it("sums a lease's receipts per business day, splitting out surcharges", async () => {
    const rent = await charge("2026-10-01", "50.00");
    await charge("2026-10-01", "1.50", "surcharge", rent);
    await charge("2026-10-02", "50.00");
    // the 10-01 group (rent + its surcharge) and then the 10-02 group, on the same day
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T03:00:00+00:00" });

    const rows = await days("2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe("2026-10-05");
    expect(Number(rows[0].base)).toBe(100);
    expect(Number(rows[0].surcharge)).toBe(1.5);
  });

  it("drops a cancelled receipt and restores it once reinstated", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
       values ($1, 'test', $2) returning id`,
      [id, fx.collectorId],
    );
    expect(await days("2026-10-01", "2026-10-31")).toHaveLength(0);

    await db.query(
      `insert into ceedo_collections.collection_reinstatements (cancellation_id, reason, reinstated_by)
       values ($1, 'test', $2)`,
      [rows[0].id, fx.collectorId],
    );
    expect(await days("2026-10-01", "2026-10-31")).toHaveLength(1);
  });

  it("keeps to the date range", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    expect(await days("2026-10-06", "2026-10-31")).toHaveLength(0);
  });
});

describe("leases_active_between", () => {
  const active = async (from: string, to: string) =>
    (await db.query(
      `select * from ceedo_collections.leases_active_between($1::date, $2::date) where lease_id = $3`,
      [from, to, fx.leaseId],
    )).rows;

  it("lists a lease whose term overlaps the range, with its stall and tenant", async () => {
    const rows = await active("2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].stall_no).toBe("01");
    expect(Number(rows[0].rate_amount)).toBe(50);
  });

  it("omits a lease that ended before the range and took no money in it", async () => {
    await db.query(
      `update ceedo_collections.leases set end_date = '2026-09-15', status = 'ended' where id = $1`,
      [fx.leaseId],
    );
    expect(await active("2026-10-01", "2026-10-31")).toHaveLength(0);
  });

  it("keeps an ended lease that was paid in the range", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await db.query(
      `update ceedo_collections.leases set end_date = '2026-09-15', status = 'ended' where id = $1`,
      [fx.leaseId],
    );
    expect(await active("2026-10-01", "2026-10-31")).toHaveLength(1);
  });

  it("shows neither function's rows to a non-staff user", async () => {
    const outsider = await createOutsiderClient();
    const a = await outsider.rpc("leases_active_between", { p_from: "2026-10-01", p_to: "2026-10-31" });
    const b = await outsider.rpc("lease_receipts_by_day", { p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(a.data ?? []).toEqual([]);
    expect(b.data ?? []).toEqual([]);
  });
});
```

If the "keeps an ended lease that was paid" test cannot `update` an ended lease's dates because of a constraint, set `end_date` first, then `status`, in two statements. Do not drop the test.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/tenant-payments.test.ts`

Expected: FAIL. The function `lease_receipts_by_day` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261007000063_tenant_payments.sql
--
-- The two reads behind the Monthly tenant payments grid (spec report 2). Both are
-- security invoker: RLS on leases/collections gates them.

-- Leases the grid must show for a range: every lease whose term overlaps it, plus any
-- lease that took money in it (an ended lease paying arrears must keep its row, or the
-- grid's total would fall short of the month's receipts).
create or replace function ceedo_collections.leases_active_between(p_from date, p_to date)
returns table (
  lease_id       uuid,
  facility_id    uuid,
  facility_name  text,
  section_id     uuid,
  section_name   text,
  stall_no       text,
  tenant_name    text,
  rate_amount    numeric(14,2),
  accrual_period ceedo_collections.accrual_period
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select l.id, f.id, f.name, s.id, s.name, st.stall_no, t.full_name, l.rate_amount, l.accrual_period
  from ceedo_collections.leases l
  join ceedo_collections.stalls     st on st.id = l.stall_id
  join ceedo_collections.sections   s  on s.id = st.section_id
  join ceedo_collections.facilities f  on f.id = s.facility_id
  join ceedo_collections.tenants    t  on t.id = l.tenant_id
  where (l.start_date <= p_to and (l.end_date is null or l.end_date >= p_from))
     or exists (
       select 1 from ceedo_collections.collections c
       where c.lease_id = l.id and c.business_date between p_from and p_to
     );
$$;

-- Money received per lease per business day. Surcharge is what the receipt allocated
-- to surcharge charges; base is the rest of the receipt. Receipts under a standing
-- cancellation are excluded; a reinstated one counts again.
create or replace function ceedo_collections.lease_receipts_by_day(p_from date, p_to date)
returns table (
  lease_id      uuid,
  business_date date,
  base          numeric(14,2),
  surcharge     numeric(14,2)
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select
    col.lease_id,
    col.business_date,
    sum(col.gross_amount - coalesce(sur.amount, 0))::numeric(14,2),
    sum(coalesce(sur.amount, 0))::numeric(14,2)
  from ceedo_collections.collections col
  left join lateral (
    select sum(a.amount) as amount
    from ceedo_collections.collection_allocations a
    join ceedo_collections.charges ch on ch.id = a.charge_id
    where a.collection_id = col.id and ch.charge_type = 'surcharge'
  ) sur on true
  where col.lease_id is not null
    and col.business_date between p_from and p_to
    and not exists (
      select 1 from ceedo_collections.standing_cancellations x where x.collection_id = col.id
    )
  group by col.lease_id, col.business_date;
$$;

create index if not exists collections_business_date_idx
  on ceedo_collections.collections (business_date);

revoke execute on function ceedo_collections.leases_active_between(date, date) from public;
revoke execute on function ceedo_collections.lease_receipts_by_day(date, date) from public;
grant execute on function ceedo_collections.leases_active_between(date, date) to authenticated;
grant execute on function ceedo_collections.lease_receipts_by_day(date, date) to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

```bash
supabase migration up
set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run tests/db/tenant-payments.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Regenerate the types and commit**

```bash
pnpm db:types
git add supabase/migrations/20261007000063_tenant_payments.sql tests/db/tenant-payments.test.ts packages/shared/src/db.types.ts
git commit -m "feat(ledger): lease receipts by day and leases active in a range"
```

---

### Task 6: Dense sections for wide grids

**Files:**
- Modify: `apps/web/lib/reports/report.ts` (`ReportSection`)
- Modify: `apps/web/components/reports/report-document.tsx`
- Modify: `apps/web/lib/reports/xlsx.ts`, `apps/web/lib/reports/xlsx.test.ts`

**Interfaces:**
- Produces: `ReportSection.dense?: boolean`.
  - **Print:** tables render at 9px with tight padding.
  - **xlsx:** if any section is dense, columns after the first are 10 wide (the first stays 26), and the sheet freezes the first column.

- [ ] **Step 1: Write the failing test.** Append to `xlsx.test.ts`, reusing its `readBack` helper.

```ts
describe("dense sections", () => {
  it("narrows the columns and freezes the name column", async () => {
    const wide: Report = {
      title: "Monthly tenant payments",
      scope: "October 2026",
      sections: [
        {
          dense: true,
          columns: [
            { key: "tenant", label: "Tenant", kind: "text" },
            { key: "d1", label: "1", kind: "money", total: true },
          ],
          rows: [{ tenant: "A", d1: fromCentavos(20_000) }],
        },
      ],
    };
    const book = await readBack(await toXlsx(wide));
    const sheet = book.worksheets[0]!;
    expect(sheet.getColumn(1).width).toBe(26);
    expect(sheet.getColumn(2).width).toBe(10);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 1 });
  });
});
```

If `readBack` returns something other than the workbook, adapt the first line of the test to whatever this file's existing tests use to reach the worksheet.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run apps/web/lib/reports/xlsx.test.ts`

Expected: FAIL. `dense` is not in `ReportSection`, and the width is 16.

- [ ] **Step 3: Implement**

`report.ts`: add this to `ReportSection`.

```ts
  /** A wide grid (e.g. one column per day): small print, narrow Excel columns. */
  dense?: boolean;
```

`xlsx.ts`: replace the column-width loop.

```ts
  const dense = report.sections.some((s) => s.dense);
  for (let i = 1; i <= width; i++) sheet.getColumn(i).width = i === 1 ? 26 : dense ? 10 : 16;
  if (dense) sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 0 }];
```

`report-document.tsx`: make the table and cell classes depend on `section.dense`.
- Table: `` className={`w-full border-collapse leading-snug ${section.dense ? "text-[9px]" : "text-[12px]"}`} ``.
- Every `px-1.5`: `` ${section.dense ? "px-0.5" : "px-1.5"} ``. This applies to the header, body and footer cells.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run apps/web/lib/reports && pnpm --filter @ceedo/web typecheck`

Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports/report.ts apps/web/lib/reports/xlsx.ts apps/web/lib/reports/xlsx.test.ts apps/web/components/reports/report-document.tsx
git commit -m "feat(reports): dense sections for wide day-by-day grids"
```

---

### Task 7: Monthly tenant payments report

**Files:**
- Create: `apps/web/lib/reports/builders/tenant-payments.ts`, `apps/web/lib/reports/builders/tenant-payments.test.ts`
- Modify: `apps/web/lib/reports/data.ts` (add `tenantPaymentData`)
- Modify: `apps/web/lib/reports/catalog.ts` (add the entry)

**Interfaces:**
- Consumes:
  - Task 5's functions.
  - `groupBySection`, `compareStall`, `rateLabel` and `AccrualPeriod` (Task 3).
  - `facilityLabel` (Task 2); `ReportSection.dense` (Task 6); `monthBounds` and `longMonth` (`params.ts`).
- Produces:
  - `interface PaymentLease { leaseId; facilityName; sectionName; stallNo; tenantName: string; rate: Centavos; accrualPeriod: AccrualPeriod }`.
  - `interface PaymentDay { leaseId: string; businessDate: string; base: Centavos; surcharge: Centavos }`.
  - `tenantPaymentsReport(leases: PaymentLease[], days: PaymentDay[], opts: { month: string; facilityName: string | null }): Report`.
  - `tenantPaymentData(month: string, facilityId: string | null): Promise<{ leases: PaymentLease[]; days: PaymentDay[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/reports/builders/tenant-payments.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { sectionTotals } from "../report";
import { tenantPaymentsReport, type PaymentDay, type PaymentLease } from "./tenant-payments";

function lease(id: string, over: Partial<PaymentLease> = {}): PaymentLease {
  return {
    leaseId: id, facilityName: "Public Mall", sectionName: "Bakery", stallNo: "1",
    tenantName: `Tenant ${id}`, rate: fromPesos(200), accrualPeriod: "daily", ...over,
  };
}
const day = (leaseId: string, businessDate: string, base: number, surcharge = 0): PaymentDay => ({
  leaseId, businessDate, base: fromPesos(base), surcharge: fromPesos(surcharge),
});

describe("tenantPaymentsReport", () => {
  it("has one money column per day of the month, February included", () => {
    const feb = tenantPaymentsReport([lease("a")], [], { month: "2028-02", facilityName: null });
    const dayCols = feb.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key));
    expect(dayCols).toHaveLength(29);
    expect(dayCols.at(-1)!.label).toBe("29");
    const oct = tenantPaymentsReport([lease("a")], [], { month: "2026-10", facilityName: null });
    expect(oct.sections[0]!.columns.filter((c) => /^d\d+$/.test(c.key))).toHaveLength(31);
    expect(oct.sections[0]!.dense).toBe(true);
  });

  it("puts each day's rent in its column, surcharge apart, and totals the row", () => {
    const r = tenantPaymentsReport(
      [lease("a")],
      [day("a", "2026-10-05", 600, 18), day("a", "2026-10-06", 200)],
      { month: "2026-10", facilityName: null },
    );
    const row = r.sections[0]!.rows[0]!;
    expect(row.d5).toBe(60000);
    expect(row.d6).toBe(20000);
    expect(row.d7).toBeNull();
    expect(row.surcharge).toBe(1800);
    expect(row.total).toBe(81800);
    expect(row.rate).toBe("200.00/day");
  });

  it("keeps a lease that paid nothing, with a zero total", () => {
    const r = tenantPaymentsReport([lease("a"), lease("b", { stallNo: "2" })], [day("a", "2026-10-01", 200)], {
      month: "2026-10", facilityName: null,
    });
    const unpaid = r.sections[0]!.rows[1]!;
    expect(unpaid.tenant).toBe("Tenant b");
    expect(unpaid.d1).toBeNull();
    expect(unpaid.total).toBe(0);
  });

  it("ignores days outside the month", () => {
    const r = tenantPaymentsReport([lease("a")], [day("a", "2026-09-30", 200)], {
      month: "2026-10", facilityName: null,
    });
    expect(r.sections[0]!.rows[0]!.total).toBe(0);
  });

  it("sections by facility and section, then summarises them", () => {
    const r = tenantPaymentsReport(
      [lease("a"), lease("b", { facilityName: "IBJT", sectionName: "Building 2" })],
      [day("a", "2026-10-01", 200, 6), day("b", "2026-10-02", 100)],
      { month: "2026-10", facilityName: null },
    );
    expect(r.sections.map((s) => s.title)).toEqual([
      "IBJT · Building 2", "Public Mall · Bakery", "Summary by section",
    ]);
    expect(sectionTotals(r.sections[1]!)!.total).toBe(20600);
    expect(sectionTotals(r.sections.at(-1)!)).toEqual({ leases: 2, rent: 30000, surcharge: 600, total: 30600 });
    expect(r.scope).toBe("All facilities · October 2026");
  });

  it("says so when there are no leases", () => {
    const r = tenantPaymentsReport([], [], { month: "2026-10", facilityName: "IBJT" });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.empty).toBe("No lease was active or paid in this month.");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run apps/web/lib/reports/builders/tenant-payments.test.ts`

Expected: FAIL. The module `./tenant-payments` is not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/reports/builders/tenant-payments.ts
import type { Centavos } from "@ceedo/shared";
import { longMonth, monthBounds } from "../params";
import type { Cell, Report, ReportColumn, ReportSection } from "../report";
import { compareStall, groupBySection, rateLabel, type AccrualPeriod } from "./grouping";

export interface PaymentLease {
  leaseId: string;
  facilityName: string;
  sectionName: string;
  stallNo: string;
  tenantName: string;
  rate: Centavos;
  accrualPeriod: AccrualPeriod;
}

export interface PaymentDay {
  leaseId: string;
  businessDate: string;
  base: Centavos;
  surcharge: Centavos;
}

/**
 * Spec report 2, the April "Rentable Income Collections" grid: one row per lease, one
 * column per day holding the rent received that day, surcharges totalled apart.
 */
export function tenantPaymentsReport(
  leases: PaymentLease[],
  days: PaymentDay[],
  opts: { month: string; facilityName: string | null },
): Report {
  const { from, to } = monthBounds(opts.month);
  const dayCount = Number(to.slice(8));
  const dayKeys = Array.from({ length: dayCount }, (_, i) => `d${i + 1}`);

  const byLease = new Map<string, PaymentDay[]>();
  for (const d of days) {
    if (d.businessDate < from || d.businessDate > to) continue;
    byLease.set(d.leaseId, [...(byLease.get(d.leaseId) ?? []), d]);
  }

  const columns: ReportColumn[] = [
    { key: "tenant", label: "Tenant", kind: "text" },
    { key: "stall", label: "Stall", kind: "text" },
    { key: "rate", label: "Rate", kind: "text" },
    ...dayKeys.map((key, i) => ({ key, label: String(i + 1), kind: "money" as const, total: true })),
    { key: "surcharge", label: "Surcharge", kind: "money", total: true },
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const totals = new Map<string, { rent: number; surcharge: number }>();
  const toRow = (l: PaymentLease): Record<string, Cell> => {
    const row: Record<string, Cell> = { tenant: l.tenantName, stall: l.stallNo, rate: rateLabel(l.rate, l.accrualPeriod) };
    for (const key of dayKeys) row[key] = null;
    let rent = 0;
    let surcharge = 0;
    for (const d of byLease.get(l.leaseId) ?? []) {
      const key = `d${Number(d.businessDate.slice(8))}`;
      if (d.base > 0) row[key] = ((row[key] as number | null) ?? 0) + d.base;
      rent += d.base;
      surcharge += d.surcharge;
    }
    totals.set(l.leaseId, { rent, surcharge });
    row.surcharge = surcharge > 0 ? surcharge : null;
    row.total = rent + surcharge;
    return row;
  };

  const groups = groupBySection(leases);
  const sections: ReportSection[] = groups.map((g) => ({
    title: `${g.facilityName} · ${g.sectionName}`,
    columns,
    dense: true,
    rows: [...g.rows].sort((a, b) => compareStall(a.stallNo, b.stallNo)).map(toRow),
  }));

  sections.push({
    title: "Summary by section",
    columns: [
      { key: "facility", label: "Facility", kind: "text" },
      { key: "section", label: "Section", kind: "text" },
      { key: "leases", label: "Tenants", kind: "int", total: true },
      { key: "rent", label: "Rent", kind: "money", total: true },
      { key: "surcharge", label: "Surcharge", kind: "money", total: true },
      { key: "total", label: "Total", kind: "money", total: true },
    ],
    rows: groups.map((g) => {
      const rent = g.rows.reduce((acc, l) => acc + (totals.get(l.leaseId)?.rent ?? 0), 0);
      const surcharge = g.rows.reduce((acc, l) => acc + (totals.get(l.leaseId)?.surcharge ?? 0), 0);
      return { facility: g.facilityName, section: g.sectionName, leases: g.rows.length, rent, surcharge, total: rent + surcharge };
    }),
    empty: "No lease was active or paid in this month.",
  });

  return {
    title: "Monthly tenant payments",
    scope: `${opts.facilityName ?? "All facilities"} · ${longMonth(opts.month)}`,
    sections,
    notes: [
      "Each day shows the rent received on that business date; surcharges are totalled in their own column.",
      "Cancelled receipts are excluded; a reinstated receipt counts again.",
    ],
  };
}
```

`data.ts`: append.

```ts
import type { PaymentDay, PaymentLease } from "./builders/tenant-payments";

/** The grid's leases and per-day receipts for a month; optionally one facility. */
export async function tenantPaymentData(
  month: string,
  facilityId: string | null,
): Promise<{ leases: PaymentLease[]; days: PaymentDay[] }> {
  const { from, to } = monthBounds(month);
  const supabase = await getServerClient();
  const leaseRows = await allPages((a, b) => {
    let q = supabase.rpc("leases_active_between", { p_from: from, p_to: to });
    if (facilityId) q = q.eq("facility_id", facilityId);
    return q.order("lease_id").range(a, b);
  });
  const ids = new Set(leaseRows.map((l) => l.lease_id));
  const dayRows = await allPages((a, b) =>
    supabase
      .rpc("lease_receipts_by_day", { p_from: from, p_to: to })
      .order("lease_id")
      .order("business_date")
      .range(a, b),
  );
  return {
    leases: leaseRows.map((l) => ({
      leaseId: l.lease_id,
      facilityName: l.facility_name,
      sectionName: l.section_name,
      stallNo: l.stall_no,
      tenantName: l.tenant_name,
      rate: centavos(l.rate_amount),
      accrualPeriod: l.accrual_period,
    })),
    days: dayRows
      .filter((d) => ids.has(d.lease_id))
      .map((d) => ({
        leaseId: d.lease_id,
        businessDate: d.business_date,
        base: centavos(d.base),
        surcharge: centavos(d.surcharge),
      })),
  };
}
```

Import `monthBounds` from `./params` in `data.ts` if it isn't imported already.

`catalog.ts`:
- Add `import { tenantPaymentsReport } from "./builders/tenant-payments";`.
- Add `tenantPaymentData` to the existing `./data` import.
- Insert this entry directly after `abstract`:

```ts
  {
    key: "tenant-payments",
    title: "Monthly tenant payments",
    purpose: "Every lease's rent received on each day of a month, with surcharges and totals, by facility and section.",
    params: ["month", "facility"],
    build: async (p) => {
      const [{ leases, days }, facilityName] = await Promise.all([
        tenantPaymentData(p.month, p.facilityId),
        facilityLabel(p.facilityId),
      ]);
      return tenantPaymentsReport(leases, days, { month: p.month, facilityName });
    },
  },
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run apps/web/lib/reports && pnpm --filter @ceedo/web typecheck`

Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports
git commit -m "feat(reports): monthly tenant payments grid"
```

---

### Task 8: Full verification and production bundle

**Files:** none new.

- [ ] **Step 1: Run the clean full suite**

```bash
supabase db reset
set -a; eval "$(supabase status -o env)"; set +a; pnpm test
```

Expected: every test passes. Report any failure with its output; do not paper over it.

- [ ] **Step 2: Check that the types are current and that the build passes**

```bash
bash scripts/check-types-current.sh
pnpm typecheck
pnpm --filter @ceedo/web build
```

Expected: "db.types.ts is current.", no type errors, and the build succeeds.

- [ ] **Step 3: Check the reports by eye**

1. Run the web app against local data: `pnpm --filter @ceedo/web dev`, then seed a lease with `scripts/dev-seed-daily-lease.sql` if needed.
2. Open `/reports`, then **Tenant balances** for today, and **Monthly tenant payments** for the current month.
3. For each one, check four things: the screen, the print preview (A4 landscape; the day grid fits the width), the Excel download (first column frozen), and that the facility filter narrows the report.

- [ ] **Step 4: Prepare the production bundle, but do not run it**

1. Ask the user to run `select max(version) from ceedo_collections.deployed_migrations;` on production.
2. Build the bundle with `node scripts/bundle-migrations.mjs --after <that version>`.
3. Hand the user the file path. The web deploys when `main` is pushed, which happens only on the user's say-so, after the bundle has run.
