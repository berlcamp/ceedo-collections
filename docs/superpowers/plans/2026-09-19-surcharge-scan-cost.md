# CEEDO Collections — Surcharge Scan Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure `run_surcharge`'s scan cost at a stated ledger shape, ship one expression index if and only if the measurement shows the planner seeking on it, and correct the unsafe upgrade path Phase 3a's §9 names.

**Architecture:** Nothing executable changes. `run_surcharge`'s `where` clause is not touched, no view is materialised, no reader is repointed. The only candidate change is one partial expression index on `charges` whose indexed expression is byte-identical to the function's month-overdue predicate — an index alters cost, never results. A measurement harness that builds a synthetic ledger inside a transaction and rolls it back decides whether that index ships. Two tests pin the reasoning in code: one that the cheap sargable rewrite is *not* equivalent, one that the predicate the index serves still seeks.

**Tech Stack:** Postgres 17 (Supabase), plain SQL migrations under the Supabase CLI, `psql` for the measurement harness, TypeScript 5.7+, Vitest 3, `pg` 8, pnpm 10 workspaces, Node >= 22.

**Spec:** `docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md`
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Amends:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md` §9
**Phase 3a handover:** `docs/superpowers/phase-3a-handover.md`

---

## Global Constraints

Copied from the spec and from the two plans before it. Every task's requirements implicitly include these.

- **Schema name is `ceedo_collections`.** Never `public`. Every object is schema-qualified.
- **`run_surcharge`'s `where` clause does not change.** Not one character. That is the entire safety argument for this plan (spec §2). If a task finds itself editing `supabase/migrations/20260918000021_surcharge.sql`, the task is wrong.
- **The indexed expression must be byte-identical to the function's predicate term**: `(due_date + interval '1 month')::date`. Not `+ '1 month'::interval`, not `+ interval '30 days'`, not a `date_trunc` variant.
- **No behavioural test changes.** `tests/db/surcharge.test.ts` is the regression suite for this work and must not be edited. If any of it moves, something is wrong (spec §6).
- **The synthetic ledger is discarded.** The measurement harness runs inside one transaction and ends in `rollback`. It must not leave rows in the suite's database (spec §3).
- **Money is `numeric(14,2)` in Postgres and integer centavos in TypeScript.** Floats never touch a peso.
- **The business date is `ceedo_collections.business_date()`** = `(now() at time zone 'Asia/Manila')::date`, never the UTC date. It is declared `stable`, which is why the planner may use it in an index condition at all.
- **Cast dates to `::text` in SQL when a test reads them.** `node-postgres` parses `date` at local midnight and `Date#toISOString()` renders in UTC, which rolls the date back a day in Asia/Manila. Every date assertion in this plan selects `::text`.
- **The root test command is `pnpm test`**, which is `vitest run --no-file-parallelism`. `fileParallelism` in `tests/vitest.config.ts` is silently ignored by the root runner. Never verify with a filtered command alone.
- **Run `supabase db reset` before the suite.** The ledger is append-only and no role holds `DELETE`, so charges accumulate across runs.
- **Verify typecheck with `pnpm typecheck --force`.** Turbo's `>>> FULL TURBO` cache hit is not evidence the tree typechecks.
- **Never renumber an applied migration.** Phase 3a ended at `20260918000042`. This plan's one migration is `20260919000043`.
- **The harness is a development tool.** It takes `ACCESS EXCLUSIVE` on `charges` and writes six figures of rows. It is never run against production.

---

## The gate

Spec §3 makes this plan conditional, and the condition is real — a design probe saw the planner *select* an index of this shape and still filter rather than range-scan.

**Task 3 ships only if Task 2's measurement shows the date test in `Index Cond` rather than `Filter`, unforced, on the ~200,000-charge synthetic ledger.** "Unforced" means with `enable_seqscan` and `enable_bitmapscan` left alone: the question is whether the planner *chooses* the index, not whether it *can*.

If it does not: Tasks 1, 2 and 4 still ship. Task 2's write-up records the finding and names spec §5's fallback (a stored generated column plus backfill) as the next thing to consider. An unused index is worse than no index — it costs write throughput on every charge insert and every accrual run, and its presence implies a problem was solved.

**A known reason the gate may fail, which the executor must not paper over.** The index's seek range is "charges whose due date is more than a month old". On a ledger that has been accruing for a year, that is most of the table, and an index scan over most of a table loses to a sequential scan. The date predicate is highly selective only while the ledger's charges are mostly younger than a month. Task 2 therefore measures three shapes, reports the overdue fraction for each, and the write-up states at which shape the index stops paying. Do not reach for `enable_seqscan = off` to make the gate pass — that setting appears in this plan exactly once, in Task 3's suite test, where the question being asked is different and is labelled as such.

---

## File Structure

```
tests/db/
├── surcharge-predicate.test.ts        Task 1  the rejected rewrite is not equivalent; the
│                                              function's predicate text has not drifted
└── surcharge-scan-plan.test.ts        Task 3  the index is still seekable (CONDITIONAL)

scripts/
└── surcharge-scan-measure.sql         Task 2  parameterised synthetic ledger + EXPLAINs,
                                               all inside one rolled-back transaction

supabase/migrations/
└── 20260919000043_surcharge_due_idx.sql  Task 3  the one index (CONDITIONAL)

docs/superpowers/
├── measurements/2026-09-19-surcharge-scan.md  Task 2  the numbers and the gate decision
└── specs/2026-09-18-phase-3a-sync-design.md   Task 4  §9 corrected in place
```

Four files, four tasks. Task 1 is independent of everything. Task 2 gates Task 3. Task 4 is independent and can be done at any point.

---

### Task 1: Pin the non-equivalence of the sargable rewrite

Spec §5 and §6's second bullet. This documents in code why the one-line "equivalent" rewrite was rejected, and guards the predicate text the whole plan depends on. It ships whatever the gate decides.

**Files:**
- Create: `tests/db/surcharge-predicate.test.ts`
- Read only (do not modify): `supabase/migrations/20260918000021_surcharge.sql`

**Interfaces:**
- Consumes: `POSTGRES_URL` from `tests/helpers/supabase.ts:38` — the direct Postgres connection string, already used this way by `tests/db/parity.test.ts`.
- Produces: nothing other tasks import. Task 3's test file references this file by name in a comment.

- [ ] **Step 1: Write the failing test**

Create `tests/db/surcharge-predicate.test.ts` with exactly this content:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/**
 * The exact predicate term in run_surcharge's WHERE clause, as the function body spells it.
 *
 * Two things depend on this string byte for byte:
 *   - the index `charges_surcharge_due_idx` (migration 20260919000043), whose indexed
 *     expression must match it or the planner cannot use it;
 *   - the design's safety argument, which is that surcharge behaviour cannot change
 *     because the WHERE clause does not change.
 *
 * So the first test here is not about surcharges at all. It is a drift guard: it fails the
 * moment someone edits the predicate, which is the moment the index silently stops being a
 * no-op on behaviour.
 */
const PREDICATE = "v_date > (b.due_date + interval '1 month')::date";

/**
 * Every ordered pair of dates in a 16-month window: 486 days, 486 * 486 = 236,196 pairs.
 * The window runs 2026-01-01 .. 2027-05-01 so that it contains every last-day-of-a-short-
 * month due date the two predicates can disagree on.
 */
const DISAGREEMENT_SQL = `
  with window_days as (
    select ('2026-01-01'::date + n) as d from generate_series(0, 485) as n
  ),
  verdicts as (
    select
      due.d as due_date,
      v.d   as v_date,
      -- run_surcharge's predicate, verbatim apart from the variable names.
      (v.d > (due.d + interval '1 month')::date) as original,
      -- The tempting sargable rewrite. Calendar-month arithmetic is not invertible, so
      -- this is not the same question.
      (due.d < (v.d - interval '1 month')::date)  as rewrite
    from window_days due cross join window_days v
  )
  select due_date::text as due_date, v_date::text as v_date, original, rewrite
  from verdicts
  where original is distinct from rewrite
  order by due_date, v_date
`;

/** Spec §5's table, as (due_date, v_date) pairs. */
const EXPECTED_DISAGREEMENTS = [
  ["2026-02-28", "2026-03-29"],
  ["2026-02-28", "2026-03-30"],
  ["2026-02-28", "2026-03-31"],
  ["2026-04-30", "2026-05-31"],
  ["2026-06-30", "2026-07-31"],
  ["2026-09-30", "2026-10-31"],
  ["2026-11-30", "2026-12-31"],
  ["2027-02-28", "2027-03-29"],
  ["2027-02-28", "2027-03-30"],
  ["2027-02-28", "2027-03-31"],
];

describe("run_surcharge's month-overdue predicate", () => {
  it("still reads exactly as the index and the design assume", async () => {
    const { rows } = await db.query(
      "select pg_get_functiondef(p.oid) as def" +
        "  from pg_proc p" +
        "  join pg_namespace n on n.oid = p.pronamespace" +
        " where n.nspname = 'ceedo_collections' and p.proname = 'run_surcharge'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain(PREDICATE);
  });

  it("is not equivalent to the sargable rewrite, and disagrees on exactly 10 pairs", async () => {
    const { rows } = await db.query(DISAGREEMENT_SQL);

    expect(rows.map((r) => [r.due_date, r.v_date])).toEqual(EXPECTED_DISAGREEMENTS);
  });

  it("disagrees only by the rewrite failing to charge a penalty the rule charges", async () => {
    const { rows } = await db.query(DISAGREEMENT_SQL);

    // Never the other way round. If a disagreement ever appeared with original=false and
    // rewrite=true, the rewrite would be inventing penalties rather than delaying them,
    // and spec §5's "the penalty is applied up to three days late" reading would be wrong.
    expect(rows.map((r) => ({ original: r.original, rewrite: r.rewrite }))).toEqual(
      rows.map(() => ({ original: true, rewrite: false })),
    );
  });

  it("checks the whole 16-month window, not a sample of it", async () => {
    const { rows } = await db.query(
      "select count(*)::int as pairs" +
        "  from generate_series(0, 485) a, generate_series(0, 485) b",
    );

    expect(rows[0].pairs).toBe(236196);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

The local stack must be up. If it is not:

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm db:start && eval $(supabase status -o env)
```

Then:

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections/tests
pnpm vitest run db/surcharge-predicate.test.ts
```

Expected: this is a characterisation test of behaviour that already exists, so the honest way to see it fail is to break it once. Temporarily change `EXPECTED_DISAGREEMENTS`' first entry from `"2026-03-29"` to `"2026-03-28"`, re-run, and confirm the second test FAILS with a diff showing the real pair. Then put `"2026-03-29"` back.

Record what the failure said. If instead the test errors with `connect ECONNREFUSED`, the stack is not up — fix that first; that is not the failure you are looking for.

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections/tests
pnpm vitest run db/surcharge-predicate.test.ts
```

Expected: PASS, 4 tests.

If test 1 fails, `run_surcharge`'s body no longer contains `PREDICATE` — stop, and do not "fix" the test. The function changed, which means the premise of this whole plan changed.

If test 2 fails with a different set of pairs, do not adjust `EXPECTED_DISAGREEMENTS` to match. Paste the actual set into the task's report: spec §5's finding was derived on this same Postgres, and a difference means something in the environment is not what the design measured.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm typecheck --force
```

Expected: no errors.

- [ ] **Step 5: Run the full suite to confirm nothing else moved**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm db:reset && pnpm test
```

Expected: the whole suite passes, including the 13 existing cases in `tests/db/surcharge.test.ts`, which this task did not touch.

- [ ] **Step 6: Commit**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git add tests/db/surcharge-predicate.test.ts
git commit -m "$(cat <<'EOF'
test: pin why the sargable surcharge rewrite was rejected

Calendar-month arithmetic is not invertible, so
`v_date > (due_date + interval '1 month')::date` and
`due_date < (v_date - interval '1 month')::date` are not the same
question. Over every ordered date pair in a 16-month window they
disagree on ten, every one a due date on the last day of a short month,
and in every one the rewrite fails to charge a penalty the current rule
charges. `leases.due_day` is capped at 28 so monthly rentals never land
there, but daily and weekly charges derive their due dates from period
boundaries and can.

Also guards the predicate's text against drift: the index about to be
measured depends on it byte for byte.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Build the measurement harness and run the gate

Spec §3. This is the task that decides whether Task 3 exists.

**Files:**
- Create: `scripts/surcharge-scan-measure.sql`
- Create: `docs/superpowers/measurements/2026-09-19-surcharge-scan.md`

**Interfaces:**
- Consumes: `$DB_URL` from `eval $(supabase status -o env)`; the seeded `MKT_DAILY` fee type (`surcharge_bps = 300`) and `OR51` form type from `supabase/seed.sql`, creating them if a reset has not seeded them.
- Produces: the gate decision, recorded in `docs/superpowers/measurements/2026-09-19-surcharge-scan.md`. Task 3 reads that file's "Decision" section and nothing else.

- [ ] **Step 1: Write the harness**

Create `scripts/surcharge-scan-measure.sql` with exactly this content:

```sql
-- The §3 measurement gate for
-- docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md.
--
-- Builds a synthetic ledger of a stated shape, prints that shape, EXPLAINs run_surcharge's
-- candidate scan without the index and then with it, and rolls the whole thing back.
--
-- §3: "Generate the volume; do not assume it is there." A `supabase db reset` returns the
-- development database to zero, so a fresh clone measures nothing. It also requires the
-- synthetic ledger be discarded, which is why every statement below runs inside one
-- transaction that ends in ROLLBACK -- including the DROP INDEX and the ANALYZE.
--
-- DEVELOPMENT ONLY. This takes ACCESS EXCLUSIVE on `charges` for the length of the run and
-- writes six figures of rows. Never point it at production.
--
-- Usage, from the repo root with the local stack up:
--
--   eval $(supabase status -o env)
--   psql "$DB_URL" -v leases=500 -v days=400 -v settled_pct=90 \
--     -f scripts/surcharge-scan-measure.sql
--
-- The shape is the point, not the row count. `leases` * `days` is the number of rental
-- charges; `days` sets how far back the ledger reaches and therefore what fraction of it is
-- more than a month overdue -- which is exactly the selectivity the index under test lives
-- or dies by. `settled_pct` is the share of each lease's oldest charges that a collection
-- has settled, which is what the view's lateral joins have to chew through.

\set ON_ERROR_STOP on
\timing on

\if :{?leases}
\else
  \set leases 500
\endif
\if :{?days}
\else
  \set days 400
\endif
\if :{?settled_pct}
\else
  \set settled_pct 90
\endif

\echo ''
\echo '==================== surcharge scan measurement ===================='
\echo 'leases      :' :leases
\echo 'days        :' :days
\echo 'settled_pct :' :settled_pct
\echo ''

begin;

-- psql does not interpolate variables inside dollar-quoted strings, so the parameters
-- reach the DO block through a table rather than through :leases.
create temporary table measure_params (leases int, days int, settled_pct int) on commit drop;
insert into measure_params values (:leases, :days, :settled_pct);

-- The BEFORE plan has to be measured without the index whether or not the migration that
-- ships it has been applied, so that re-running this script after the fact still produces a
-- real comparison rather than two identical plans. Undone by the ROLLBACK.
drop index if exists ceedo_collections.charges_surcharge_due_idx;

do $build$
declare
  v_leases      integer;
  v_days        integer;
  v_settled_pct integer;
  v_settled     integer;
  v_today       date := ceedo_collections.business_date();
  v_fee_type    uuid;
  v_form_type   uuid;
  v_facility    uuid;
  v_section     uuid;
  v_auth_user   uuid := gen_random_uuid();
  v_booklet     uuid;
  v_device      uuid;
  v_tag         text := 'MSR' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  select leases, days, settled_pct into v_leases, v_days, v_settled_pct from measure_params;
  -- How many of each lease's charges, oldest first, a collection has settled.
  v_settled := (v_days * v_settled_pct) / 100;

  select id into v_fee_type from ceedo_collections.fee_types where code = 'MKT_DAILY';
  if v_fee_type is null then
    insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps)
    values ('MKT_DAILY', 'Market stall rental (daily)', true, 300)
    returning id into v_fee_type;
  end if;

  select id into v_form_type from ceedo_collections.form_types where code = 'OR51';
  if v_form_type is null then
    insert into ceedo_collections.form_types (code, name)
    values ('OR51', 'Official Receipt (Accountable Form 51)')
    returning id into v_form_type;
  end if;

  -- 'market': sections and stalls exist only under a market facility (assert_market_facility).
  insert into ceedo_collections.facilities (code, name, type)
  values (v_tag, 'Measurement Market ' || v_tag, 'market')
  returning id into v_facility;

  insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
  values (v_facility, 'Measurement Section', 'daily')
  returning id into v_section;

  -- Stall numbers and tenant names carry the same ordinal so the two can be zipped into
  -- leases by one join, without depending on the order INSERT ... RETURNING hands rows back.
  insert into ceedo_collections.stalls (section_id, stall_no)
  select v_section, lpad(n::text, 6, '0') from generate_series(1, v_leases) n;

  insert into ceedo_collections.tenants (full_name)
  select v_tag || '#' || lpad(n::text, 6, '0') from generate_series(1, v_leases) n;

  -- Daily accrual: due_day is meaningless and stays null (leases_monthly_needs_due_day only
  -- bites monthly leases).
  insert into ceedo_collections.leases
    (stall_id, tenant_id, start_date, rate_amount, accrual_period, due_day, status)
  select st.id, tn.id, v_today - v_days, 120.00, 'daily', null, 'active'
  from ceedo_collections.stalls st
  join ceedo_collections.tenants tn on tn.full_name = v_tag || '#' || st.stall_no
  where st.section_id = v_section;

  -- One rental charge per lease per day. lease_periods() gives a daily period
  -- period_start = period_end = due_date, so that is what is reproduced here.
  insert into ceedo_collections.charges
    (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
     amount, surcharge_bps, source)
  select l.id, v_fee_type, 'rental', d.day, d.day, d.day, 120.00, 0, 'accrual'
  from ceedo_collections.leases l
  join ceedo_collections.stalls st on st.id = l.stall_id and st.section_id = v_section
  cross join lateral (
    select (v_today - v_days + g)::date as day from generate_series(0, v_days - 1) g
  ) d;

  if v_settled > 0 then
    -- Settlement goes through collections and allocations rather than condonations,
    -- because it is the allocations lateral -- the one that joins collections and checks
    -- for a cancellation -- that dominates charge_balances, and a ledger settled by
    -- condonation would leave it empty and flatter the measurement.
    insert into auth.users
      (id, instance_id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, is_sso_user, is_anonymous)
    values
      (v_auth_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(v_tag) || '@measure.invalid', now(),
       '{"provider": "google", "providers": ["google"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', false, false);

    insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
    values (v_auth_user, v_tag, 'Measurement Collector', 'collector', 'active');

    insert into ceedo_collections.devices (label) values ('Measurement Tablet ' || v_tag)
    returning id into v_device;

    -- A private serial prefix: booklets_no_serial_overlap only compares ranges within one
    -- (form_type, serial_prefix) pair, so this cannot collide with a fixture's booklet.
    insert into ceedo_collections.booklets
      (form_type_id, serial_prefix, start_no, end_no, received_date, status)
    values (v_form_type, v_tag, 1, 1000000, v_today, 'in_use')
    returning id into v_booklet;

    -- One collection per lease, settling that lease's v_settled oldest charges. Invariant
    -- #9's deferred trigger wants allocations plus lines to equal gross_amount, and there
    -- are no lines, so gross is exactly 120.00 * v_settled.
    insert into ceedo_collections.collections
      (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
       fee_type_id, lease_id, gross_amount)
    select gen_random_uuid(),
           (row_number() over (order by l.id))::int,
           v_booklet, v_auth_user, v_device, now(), v_today,
           v_fee_type, l.id, (120.00 * v_settled)::numeric(14,2)
    from ceedo_collections.leases l
    join ceedo_collections.stalls st on st.id = l.stall_id and st.section_id = v_section;

    insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
    select col.id, ranked.id, 120.00
    from (
      select c.id, c.lease_id,
             row_number() over (partition by c.lease_id order by c.due_date) as rn
      from ceedo_collections.charges c
      join ceedo_collections.leases l on l.id = c.lease_id
      join ceedo_collections.stalls st on st.id = l.stall_id and st.section_id = v_section
    ) ranked
    join ceedo_collections.collections col
      on col.lease_id = ranked.lease_id and col.booklet_id = v_booklet
    where ranked.rn <= v_settled;
  end if;
end;
$build$;

-- §3: EXPLAIN (ANALYZE, BUFFERS) "with ANALYZE ceedo_collections.charges run after index
-- creation". Run before as well: a plan chosen from default statistics on a table that just
-- grew by six figures is not a plan anyone will ever see in production.
analyze ceedo_collections.charges;
analyze ceedo_collections.collections;
analyze ceedo_collections.collection_allocations;
analyze ceedo_collections.leases;
analyze ceedo_collections.fee_types;

\echo ''
\echo '==================== SHAPE ===================='

-- §3: '"83k charges" means nothing without knowing how many leases, how many settled, and
-- how many overdue produced it.' This block is that sentence, as numbers.
select
  (select count(*) from ceedo_collections.leases)  as leases,
  (select count(*) from ceedo_collections.charges) as charges_total,
  (select count(*) from ceedo_collections.charges where charge_type = 'rental')
    as rental_charges,
  (select count(*) from ceedo_collections.charges where charge_type = 'surcharge')
    as surcharge_charges,
  (select count(*) from ceedo_collections.charges
     where charge_type = 'rental'
       and ceedo_collections.business_date() > (due_date + interval '1 month')::date)
    as month_overdue_rentals,
  (select count(*) from ceedo_collections.charge_balances b
     where b.charge_type = 'rental' and not b.is_settled)
    as unsettled_rentals,
  (select count(*) from ceedo_collections.charge_balances b
     where b.charge_type = 'rental'
       and not b.is_settled
       and ceedo_collections.business_date() > (b.due_date + interval '1 month')::date)
    as month_overdue_unsettled_rentals;

-- The fraction that decides everything. An index whose seek range covers most of the table
-- loses to a sequential scan, and this is that fraction.
select round(
         100.0 * (select count(*) from ceedo_collections.charges
                    where charge_type = 'rental'
                      and ceedo_collections.business_date() > (due_date + interval '1 month')::date)
         / nullif((select count(*) from ceedo_collections.charges where charge_type <> 'surcharge'), 0),
         2) as pct_of_indexed_rows_in_seek_range;

-- run_surcharge takes its date as a plpgsql variable, which reaches the planner as a
-- parameter. Pinning today's business date as a literal here is the same planning case and
-- avoids EXPLAIN-with-parameters plumbing; it also keeps the BEFORE and AFTER plans
-- comparing the same constant even if the clock rolls over mid-run.
select ceedo_collections.business_date()::text as bd \gset

\echo ''
\echo '==================== BEFORE (no index) ===================='

explain (analyze, buffers)
select b.id
from ceedo_collections.charge_balances b
join ceedo_collections.fee_types f on f.id = b.fee_type_id
where b.charge_type = 'rental'
  and f.surcharge_bps > 0
  and (round(b.amount * 100) * f.surcharge_bps + 5000) >= 10000
  and :'bd'::date > (b.due_date + interval '1 month')::date
  and not b.is_settled
  and not exists (
    select 1 from ceedo_collections.charges s
    where s.parent_charge_id = b.id and s.charge_type = 'surcharge'
  );

-- Byte-identical to the expression in run_surcharge's WHERE clause. That identity is the
-- whole safety argument; if this line and the function ever differ, the index is dead
-- weight and tests/db/surcharge-predicate.test.ts is what says so.
create index charges_surcharge_due_idx
  on ceedo_collections.charges (((due_date + interval '1 month')::date))
  where charge_type <> 'surcharge';

analyze ceedo_collections.charges;

\echo ''
\echo '==================== AFTER (with index) ===================='

explain (analyze, buffers)
select b.id
from ceedo_collections.charge_balances b
join ceedo_collections.fee_types f on f.id = b.fee_type_id
where b.charge_type = 'rental'
  and f.surcharge_bps > 0
  and (round(b.amount * 100) * f.surcharge_bps + 5000) >= 10000
  and :'bd'::date > (b.due_date + interval '1 month')::date
  and not b.is_settled
  and not exists (
    select 1 from ceedo_collections.charges s
    where s.parent_charge_id = b.id and s.charge_type = 'surcharge'
  );

\echo ''
\echo '==================== index size ===================='

select pg_size_pretty(pg_relation_size('ceedo_collections.charges_surcharge_due_idx'))
         as index_size,
       pg_size_pretty(pg_relation_size('ceedo_collections.charges')) as heap_size;

-- Everything above is discarded: the synthetic ledger, the index, the statistics and the
-- DROP INDEX at the top.
rollback;

\echo ''
\echo 'Rolled back. Nothing was left behind.'
```

- [ ] **Step 2: Verify the harness leaves nothing behind**

This is the harness's own correctness test and it runs before any measurement is trusted.

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm db:reset && eval $(supabase status -o env)
psql "$DB_URL" -tAc "select count(*) from ceedo_collections.charges"
psql "$DB_URL" -v leases=20 -v days=40 -v settled_pct=50 -f scripts/surcharge-scan-measure.sql
psql "$DB_URL" -tAc "select count(*) from ceedo_collections.charges"
psql "$DB_URL" -tAc "select count(*) from ceedo_collections.leases"
psql "$DB_URL" -tAc "select count(*) from auth.users"
psql "$DB_URL" -tAc "select indexname from pg_indexes where indexname = 'charges_surcharge_due_idx'"
```

Expected: the two `charges` counts are identical, `leases` and `auth.users` are what the reset left, and the last query prints nothing. The run itself prints a SHAPE block, a BEFORE plan, an AFTER plan and `Rolled back. Nothing was left behind.`

If any count moved, stop and fix the harness. A measurement tool that silently seeds the suite's database would poison every test run after it.

- [ ] **Step 3: Measure the three shapes**

Each run gets its own fresh database so shapes cannot contaminate one another.

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
mkdir -p /tmp/surcharge-measure

pnpm db:reset && eval $(supabase status -o env)
psql "$DB_URL" -v leases=500 -v days=45  -v settled_pct=20 \
  -f scripts/surcharge-scan-measure.sql 2>&1 | tee /tmp/surcharge-measure/shape-a-young.txt

pnpm db:reset && eval $(supabase status -o env)
psql "$DB_URL" -v leases=210 -v days=400 -v settled_pct=90 \
  -f scripts/surcharge-scan-measure.sql 2>&1 | tee /tmp/surcharge-measure/shape-b-dev.txt

pnpm db:reset && eval $(supabase status -o env)
psql "$DB_URL" -v leases=500 -v days=400 -v settled_pct=90 \
  -f scripts/surcharge-scan-measure.sql 2>&1 | tee /tmp/surcharge-measure/shape-c-projection.txt
```

What each one is:

- **Shape A — young ledger, ~22,500 charges, ~45 days deep.** Only about a third of the ledger is more than a month overdue. This is the shape the index is most likely to win on, and measuring it first tells you whether the expression is seekable *at all* before selectivity is allowed to muddy the answer. `settled_pct` is 20 here, not 90: the harness settles each lease's charges oldest first and "overdue" is also oldest first, so a settled share at or above the overdue share leaves *no* overdue-unsettled rows at all and the lateral joins go unexercised. At 45 days the overdue share is about a third, so the settled share has to sit below it.
- **Shape B — ~84,000 charges.** §1's development-database figure, rebuilt deliberately instead of accumulated accidentally. §1 reported "83,257 charges" without saying how many leases or how many settled produced it; this run states the shape it is comparing against.
- **Shape C — 200,000 charges, §8.1's one-year projection.** **This is the gate.** Shapes A and B are context.

Each run takes a few minutes: 200,000 charge inserts each fire the `bump_row_version` trigger, and the `EXPLAIN (ANALYZE)` runs execute the query for real. If a run takes more than about fifteen minutes, say so in the write-up rather than killing it silently.

- [ ] **Step 4: Read the three AFTER plans and decide the gate**

For each shape, find in the AFTER plan the node that scans `charges` and answer one question: does `(due_date + '1 mon'::interval)::date` appear on an `Index Cond:` line, or on a `Filter:` line?

- `Index Cond:` referencing `charges_surcharge_due_idx` → the index is being used to seek.
- `Filter:` → it is not, whatever index the plan names above it. This is the outcome the design probe saw, and §3 exists because of it.

**Gate: Shape C's AFTER plan must show `Index Cond`.** Shape A showing `Index Cond` while Shape C shows `Filter` is not a pass — it is the selectivity story, and it belongs in the write-up as the reason the index does not ship.

Do not re-run with `enable_seqscan = off` to get a different answer. If you want to know whether the planner *could* have used the index, that is a separate question and Task 3's test is where it is asked.

- [ ] **Step 5: Write up the measurement**

Create `docs/superpowers/measurements/2026-09-19-surcharge-scan.md`. Every number and every plan fragment is pasted from `/tmp/surcharge-measure/*.txt` — none is retyped from memory, and none is left blank.

````markdown
# Measurement — `run_surcharge` scan cost

**Date:** 2026-09-19
**Gate for:** `docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md` §3
**Harness:** `scripts/surcharge-scan-measure.sql`
**Postgres:** <paste `select version()` output>

Every figure below came from one of three runs of the harness against a freshly
`supabase db reset` database. Raw output is reproducible by re-running the commands in the
header of each section; nothing here was accumulated across test runs.

## Shape A — young ledger

**Command:** `psql "$DB_URL" -v leases=500 -v days=45 -v settled_pct=20 -f scripts/surcharge-scan-measure.sql`

| | |
| --- | --- |
| leases | <n> |
| charges total | <n> |
| rental charges | <n> |
| surcharge charges | <n> |
| month-overdue rentals | <n> |
| unsettled rentals | <n> |
| month-overdue unsettled rentals | <n> |
| % of indexed rows in the seek range | <n> |

**Before:**

```
<paste the BEFORE plan>
```

**After:**

```
<paste the AFTER plan>
```

Date test lands in: **`Index Cond` / `Filter`** — <pick one>.
Wall clock: <before> → <after>. Shared buffers hit+read: <before> → <after>.

## Shape B — the development-database figure, rebuilt

<same structure, `-v leases=210 -v days=400 -v settled_pct=90`>

## Shape C — §8.1's one-year projection (the gate)

<same structure, `-v leases=500 -v days=400 -v settled_pct=90`>

Index size: <n>. Heap size: <n>.

## What the numbers say

<Two or three paragraphs. State the overdue fraction at each shape and how the planner's
choice tracked it. If the index stopped paying somewhere between A and C, say where and
why.>

## Decision

**SHIP / DO NOT SHIP** — <one sentence naming Shape C's AFTER plan as the reason>.

<If DO NOT SHIP: state that spec §5's fallback — a stored generated column carrying
`(due_date + interval '1 month')::date`, indexed — has the same selectivity behaviour as the
expression index and so is not a way around this particular result; and that the finding
itself, plus §4's correction, is what this work delivers.>
````

- [ ] **Step 6: Commit**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git add scripts/surcharge-scan-measure.sql docs/superpowers/measurements/2026-09-19-surcharge-scan.md
git commit -m "$(cat <<'EOF'
perf: measure run_surcharge's scan cost at a stated ledger shape

A harness that builds a synthetic ledger of a parameterised shape,
EXPLAINs run_surcharge's candidate scan with and without the expression
index under consideration, and rolls the whole thing back -- the design
requires the synthetic ledger be discarded, and a measurement tool that
seeded the suite's database would poison every run after it.

Measured at three shapes: a young ledger, the 83k figure the design
quoted rebuilt deliberately, and the one-year projection. The shape
report states leases, settled and overdue counts alongside the totals,
because a charge count on its own says nothing about the selectivity the
index lives or dies by.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Ship the index — CONDITIONAL on Task 2's gate

**Do not start this task until `docs/superpowers/measurements/2026-09-19-surcharge-scan.md`'s Decision section reads SHIP.** If it reads DO NOT SHIP, skip to Task 4 and say plainly in the report that Task 3 was skipped and why.

Spec §2 and §6's first bullet.

**Files:**
- Create: `supabase/migrations/20260919000043_surcharge_due_idx.sql`
- Create: `tests/db/surcharge-scan-plan.test.ts`
- Read only (do not modify): `supabase/migrations/20260918000021_surcharge.sql`

**Interfaces:**
- Consumes: `POSTGRES_URL` from `tests/helpers/supabase.ts:38`; the drift guard in `tests/db/surcharge-predicate.test.ts` (Task 1), which is what holds the function side of the byte-identity.
- Produces: the index `ceedo_collections.charges_surcharge_due_idx`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/surcharge-scan-plan.test.ts` with exactly this content:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/**
 * run_surcharge's month-overdue predicate, with a literal standing in for the function's
 * `v_date`. The date is arbitrary and in the future; what is being asked is whether the
 * planner can turn this shape of expression into a range seek, not how many rows come back.
 *
 * Deliberately NOT the full run_surcharge query. On a freshly reset database `charges` is
 * nearly empty, and on an empty table the planner's choice between the two indexes on
 * `charges` is decided by rounding rather than by anything this test means to assert. A
 * test that flips with the row count is the kind Phase 3a learned to stop writing. Scoped
 * to `charges` alone, exactly one index can produce an Index Cond for this predicate, so
 * the assertion means one thing.
 *
 * The cost measurement -- the full query, at volume, with the planner unforced -- is the
 * harness's job: scripts/surcharge-scan-measure.sql and
 * docs/superpowers/measurements/2026-09-19-surcharge-scan.md.
 */
const SEEK_PROBE = `
  select id from ceedo_collections.charges
  where charge_type <> 'surcharge'
    and '2027-06-01'::date > (due_date + interval '1 month')::date
`;

async function explain(sql: string): Promise<string> {
  await db.query("begin");
  try {
    // SET LOCAL, so this dies with the transaction. Turning the sequential scan off asks a
    // different question from the one the measurement asked: not "does the planner pick
    // this index on a real ledger" -- that was measured once, at volume, and recorded --
    // but "is this predicate still seekable at all". The second question is the one that
    // has an answer on an empty table, and it is the one that catches an expression that
    // has quietly stopped matching.
    await db.query("set local enable_seqscan = off");
    const { rows } = await db.query(`explain (costs off) ${sql}`);
    return rows.map((r) => r["QUERY PLAN"] as string).join("\n");
  } finally {
    await db.query("rollback");
  }
}

describe("charges_surcharge_due_idx", () => {
  it("exists, over the expression run_surcharge actually tests", async () => {
    const { rows } = await db.query(
      "select indexdef from pg_indexes" +
        " where schemaname = 'ceedo_collections' and indexname = 'charges_surcharge_due_idx'",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("((due_date + '1 mon'::interval))::date");
    expect(rows[0].indexdef).toContain("charge_type <> 'surcharge'");
  });

  it("serves the month-overdue predicate as an Index Cond, not a Filter", async () => {
    const plan = await explain(SEEK_PROBE);

    expect(plan).toContain("charges_surcharge_due_idx");

    const indexConds = plan.split("\n").filter((line) => line.includes("Index Cond:"));
    expect(indexConds.join("\n")).toContain("due_date");

    // The failure this whole test exists for: the planner picks the index and then filters
    // on the date anyway, which is what the design probe saw and what §3 gated against.
    const filters = plan.split("\n").filter((line) => line.includes("Filter:"));
    expect(filters.join("\n")).not.toContain("1 mon");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections/tests
pnpm vitest run db/surcharge-scan-plan.test.ts
```

Expected: both tests FAIL. The first with `expected [] to have a length of 1` — the index does not exist yet. The second with the plan text not containing `charges_surcharge_due_idx`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260919000043_surcharge_due_idx.sql` with exactly this content:

```sql
-- Makes run_surcharge's one highly selective predicate seekable.
--
-- The measured problem was never that charge_balances is a view. It was that the date test
-- sat in Filter rather than Index Cond: charges_due_date_idx (migration 0011) serves only
-- its own partial predicate, so every non-surcharge charge in the database was read and then
-- discarded. See docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md §1, and
-- docs/superpowers/measurements/2026-09-19-surcharge-scan.md for the plans and numbers that
-- let this ship.
--
-- THE INDEXED EXPRESSION IS BYTE-IDENTICAL TO run_surcharge's WHERE CLAUSE TERM. That is the
-- entire safety argument for this migration: the function body does not change, so surcharge
-- behaviour cannot change. An index alters cost, never results -- there is no month-end edge
-- case to re-derive here and no new way for the nightly job to be wrong. If either side is
-- ever edited, tests/db/surcharge-predicate.test.ts and tests/db/surcharge-scan-plan.test.ts
-- are what say so.
--
-- The partial predicate mirrors charges_due_date_idx's, for the same reason: a surcharge is
-- never itself a surcharge candidate, so indexing those rows costs writes and buys nothing.
create index charges_surcharge_due_idx
  on ceedo_collections.charges (((due_date + interval '1 month')::date))
  where charge_type <> 'surcharge';

comment on index ceedo_collections.charges_surcharge_due_idx is
  'Serves run_surcharge''s month-overdue predicate. The expression must stay byte-identical '
  'to the one in the function body; surcharge-scan-plan.test.ts asserts the planner still '
  'seeks on it, and surcharge-predicate.test.ts asserts the function side has not drifted.';
```

- [ ] **Step 4: Apply the migration and run the test**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm db:reset && eval $(supabase status -o env)
cd tests && pnpm vitest run db/surcharge-scan-plan.test.ts
```

Expected: PASS, 2 tests.

If the first test fails on the `indexdef` text, Postgres normalised the expression differently from what is asserted. Print what it actually stored and use that text:

```bash
psql "$DB_URL" -tAc "select indexdef from pg_indexes where indexname = 'charges_surcharge_due_idx'"
```

Change only the assertion, never the migration — the migration's spelling is the one the design fixed, and the assertion's job is to match what Postgres made of it.

If the second test fails, paste the plan it produced into the task report before changing anything. A seekable expression that the planner refuses even with `enable_seqscan = off` means the expression does not match, which means Task 2's gate passed on something other than this index.

- [ ] **Step 5: Confirm surcharge behaviour did not move**

The `where` clause did not change, so the existing suite is the regression test (spec §6).

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections/tests
pnpm vitest run db/surcharge.test.ts db/surcharge-predicate.test.ts db/accrual.test.ts db/charge-balances.test.ts db/post-collection.test.ts db/condonation.test.ts db/reporting-views.test.ts
```

Expected: all pass, with `tests/db/surcharge.test.ts` contributing its 13 cases unchanged. If any of them moved, stop: an index changed a result, which means the expression is not what it claims to be.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
pnpm db:reset && pnpm test
pnpm typecheck --force
```

Expected: the whole suite passes; no type errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git add supabase/migrations/20260919000043_surcharge_due_idx.sql tests/db/surcharge-scan-plan.test.ts
git commit -m "$(cat <<'EOF'
perf: index the expression run_surcharge's overdue test evaluates

The date test sat in Filter, not Index Cond, so every non-surcharge
charge in the database was read and discarded on every nightly run. This
indexes `(due_date + interval '1 month')::date` byte-identically to the
function's predicate, under the same partial condition
charges_due_date_idx uses.

run_surcharge's WHERE clause is untouched, so surcharge behaviour cannot
change -- the existing suite is the regression test and it is unchanged.
The accompanying test asserts the predicate still produces an Index Cond
rather than a Filter, which is the only way to notice the index silently
falling out of use after a future edit.

Shipped against the gate in
docs/superpowers/measurements/2026-09-19-surcharge-scan.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Correct Phase 3a's §9

Spec §8. This ships whatever the gate decided; it is the half of the work that is worth doing on its own. Phase 2's handover carries the same claim and is deliberately **not** amended — it is a historical record, and spec §4 is the answer to it.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md` — the `run_surcharge` paragraph in §9, around line 690

**Interfaces:**
- Consumes: nothing.
- Produces: nothing executable.

- [ ] **Step 1: Read the paragraph as it stands**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
sed -n '685,700p' docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md
```

Expected: the paragraph beginning `**`run_surcharge` still scans `charge_balances` system-wide.**` and ending `…the named upgrade path remains a materialised `charge_balances` with a scheduled refresh.`

- [ ] **Step 2: Replace the last sentence**

Find this text:

```
Phase 3a does not
make it worse — nothing here is on the nightly path — but Phase 3b puts real devices behind
it and the named upgrade path remains a materialised `charge_balances` with a scheduled
refresh.
```

Replace it with:

```
Phase 3a does not
make it worse — nothing here is on the nightly path — but Phase 3b puts real devices behind
it.

**The upgrade path this section originally named — a materialised `charge_balances` with a
scheduled refresh — was wrong, and is superseded by
`docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md`.** Measured at 83,257
charges, the cost is a non-sargable date predicate, not the view's laterals: the month-overdue
test lands in `Filter` rather than `Index Cond`, so every non-surcharge charge is read and
discarded. Materialising the view is unsafe in two independent ways. `post_collection` reads
`charge_balances` twice — once through `unpaid_period_groups()` to compute the FIFO prefix,
and again after taking its row locks — and that second, transactionally current read is the
entire mechanism producing `stale_allocations`; against a snapshot both reads return the same
stale answer and the lock stops protecting anything. And a materialised view cannot be
`security_invoker`, so per-reader RLS on the underlying tables would stop applying on a
Supabase project whose `auth.users` is shared with unrelated systems. `condone_charge` and
`sync_pull` need the same currency for the same reason.

The reporting views — `aging_of_receivables`, `lease_balances`, `subsidiary_ledger` — remain
the only place a snapshot would be safe, since they tolerate staleness and never touch
settlement. None of them has been measured to need one.
```

Use the Edit tool with the old text above as `old_string` and the new text as `new_string`. Do not rewrap the surrounding paragraphs.

- [ ] **Step 3: Verify the edit landed and nothing else moved**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git diff --stat docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md
grep -n "materialised \`charge_balances\`" docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md
grep -c "2026-09-19-surcharge-scan-cost-design" docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md
```

Expected: exactly one file changed; the `grep -n` shows the phrase only inside the new corrective sentence; the count is 1.

- [ ] **Step 4: Confirm the handovers were left alone**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git status --short docs/superpowers/
```

Expected: `docs/superpowers/phase-2-handover.md` and `docs/superpowers/phase-3a-handover.md` do not appear. Spec §8 amends the Phase 3a design and nothing else.

- [ ] **Step 5: Commit**

```bash
cd /Users/berltreasurecampomanes/Documents/GithubBuilds/ceedo-collections
git add docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md
git commit -m "$(cat <<'EOF'
docs: correct the upgrade path Phase 3a §9 named for run_surcharge

§9 named a materialised charge_balances with a scheduled refresh. That is
unsafe twice over: post_collection's second, post-lock read of the view is
what produces stale_allocations, and against a snapshot both reads return
the same stale answer; and a matview cannot be security_invoker, so
per-reader RLS would stop applying on an instance whose auth.users is
shared with unrelated systems.

Points at the surcharge scan cost design instead, and records that the
reporting views are the only place a snapshot would be safe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## What this plan deliberately does not do

Each of these is a decision from the spec, recorded here so nobody re-opens it mid-execution.

- **No materialised view, of `charge_balances` or anything else.** Spec §4. Not even "just for the reporting views" — they tolerate staleness and would be safe, but none has been measured to need it, and §7 calls optimising them now speculative.
- **No sargable rewrite of the predicate.** Spec §5. It is not equivalent; Task 1 is the test that says so.
- **No generated column.** Spec §5 names it as the fallback *if* the expression index is measured to work and a schema change is later preferred. Nothing in this plan reaches for it, and Task 2's write-up notes why it is not an escape hatch from a failed gate.
- **No change to `run_surcharge`, `post_collection`, `unpaid_period_groups`, `condone_charge` or `sync_pull`.**
- **No timing assertion anywhere in the suite.** Spec §6: flaky under load and green when the index is dropped.
- **Nothing about the two accumulation ceilings.** `run_surcharge`'s cost growing across un-reset runs and PostgREST's 1000-row default breaking `membership-gate` on a fourth consecutive un-reset run both stay as Phase 3a's handover records them (spec §7).

## Risks

- **The gate may fail, and the reason may be structural.** See "The gate" above. The index's seek range is everything older than a month, which on a year-old ledger is most of the table. If Shape C comes back `Filter`, that is a real answer, not a botched measurement, and the spec anticipated it: "If it does not work, the finding is still worth having."
- **The harness writes to `auth.users`.** Inside the rolled-back transaction, and only because `app_users.id` has a foreign key to it and a collection needs a collector. Task 2 Step 2 verifies the count is unchanged afterwards. It runs as `postgres` and so bypasses RLS; run as any other role it will fail on the ledger tables.
- **`EXPLAIN (ANALYZE)` executes the query.** The BEFORE run at Shape C does the full system-wide scan the design is complaining about, twice over (once per plan). Expect minutes, not seconds.
- **`indexdef` normalisation.** Postgres rewrites `interval '1 month'` as `'1 mon'::interval` when it stores and prints an index definition. Task 3 Step 4 asserts the normalised form and tells the executor what to do if this Postgres prints something else.
