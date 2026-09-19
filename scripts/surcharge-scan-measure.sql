-- The §3 measurement gate for
-- docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md.
--
-- Builds a synthetic ledger of a stated shape, prints that shape, EXPLAINs run_surcharge's
-- candidate scan without the index and then with it, and rolls the whole thing back.
--
-- THE INDEX THIS CREATES IS NOT IN THE SCHEMA. It was shipped as migration
-- 20260919000043 and then reverted, because its measured effect is at most ~4% in both the
-- first-night and steady-state regimes -- inside run-to-run variance -- and a per-node
-- decomposition of the interleaved run found no mechanism for even that: the charges scan
-- and the Hash Join above it both ran SLOWER with the index, and the lateral subtree holding
-- the whole difference reports bit-identical buffers in both conditions. Against nothing, it
-- cost a byte-identity obligation against run_surcharge's WHERE clause that a human had to
-- maintain by hand. What this script creates is a hypothesis being tested inside a
-- transaction, not something being re-applied. Keep it: the comparison is still the question
-- anyone asks here.
--
-- MEASUREMENT ORDER IS A BIAS. This script runs BEFORE first and AFTER second, so the whole
-- first-execution warm-up lands on the no-index side. At the steady-state shape that made an
-- at-most-4% effect read as 29%. For any comparison that will decide something, do not
-- trust a single BEFORE/AFTER pair from this script: use
-- scripts/surcharge-scan-alternating.sql, which interleaves the two conditions against one
-- ledger inside one transaction.
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
--
-- `steady_state` (0 or 1, default 0) decides WHICH LEDGER STATE is being measured, and it is
-- the difference between a worst case and the case production actually runs against.
--
--   0 -- the first night run_surcharge has ever run against this ledger. No surcharge rows
--        exist, so the `not exists (... charge_type = 'surcharge')` anti-join removes
--        nothing and every month-overdue unsettled rental is still a candidate.
--   1 -- a ledger that has already been surcharged once. run_surcharge itself is called
--        (the real function, not an imitation of it), raising the surcharges a real nightly
--        job would have raised, and the measurement is then taken on the run that follows.
--
--        THE BUSINESS DATE IS NOT ADVANCED. What gets measured is a second run of the SAME
--        night, which is why `tonights_candidates` prints 0: re-running one night raises
--        nothing, by idempotence. A real night two is not that. On it the business date
--        moves forward and a further day's cohort of rentals crosses the month line -- one
--        charge per lease, so ~500 on a 500-lease ledger. Read `steady_state=1` as "the
--        anti-join is now answering against 4,500 existing surcharge rows instead of an
--        empty set", which is the thing under measurement, and not as "night two raises
--        nothing".
--
-- The original measurement only ever ran shape 0 and its write-up names that as the largest
-- realism gap. This parameter is how that gap gets closed.

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
\if :{?steady_state}
\else
  \set steady_state 0
\endif

\echo ''
\echo '==================== surcharge scan measurement ===================='
\echo 'leases       :' :leases
\echo 'days         :' :days
\echo 'settled_pct  :' :settled_pct
\echo 'steady_state :' :steady_state
\echo ''

begin;

-- psql does not interpolate variables inside dollar-quoted strings, so the parameters
-- reach the DO block through a table rather than through :leases.
create temporary table measure_params (leases int, days int, settled_pct int, steady_state int)
  on commit drop;
insert into measure_params values (:leases, :days, :settled_pct, :steady_state);

-- The BEFORE plan has to be measured without the index whether or not the migration that
-- ships it has been applied, so that re-running this script after the fact still produces a
-- real comparison rather than two identical plans. Undone by the ROLLBACK.
drop index if exists ceedo_collections.charges_surcharge_due_idx;

-- The ledger itself. Shared verbatim with scripts/surcharge-scan-alternating.sql, which is
-- the interleaved harness the revert decision actually rests on -- both must build the same
-- ledger or their logs are not comparable. `\ir` resolves relative to this file, so this
-- works from any working directory.
\ir surcharge-scan-build.sql

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

-- Provenance for the write-up's "Postgres:" line: pin the exact server this shape was
-- measured against in the same raw log the plans came from, instead of asking a reader to
-- trust a value typed in separately.
select version();

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
    as month_overdue_unsettled_rentals,
  -- What a run for TODAY would actually raise: run_surcharge's WHERE clause, all five
  -- predicates of it. This is the same numerator/denominator discipline applied to
  -- pct_of_indexed_rows_in_seek_range just below -- a column named for what the job
  -- raises has to range over the job's own predicate set, or it silently counts rows the job
  -- would skip. An earlier version carried only charge_type / is_settled / the date test and
  -- the anti-join, omitting `f.surcharge_bps > 0` and the half-up rounding guard, and so
  -- overstated the candidate count on any ledger with a zero-rate fee type or a charge small
  -- enough that its surcharge rounds to nothing. On every shape published in
  -- docs/superpowers/measurements/2026-09-19-surcharge-scan.md the fee type is MKT_DAILY at
  -- 300 bps and every charge is 120.00, so both added predicates pass for every row and the
  -- recorded figures are unaffected by this correction.
  --
  -- Because of those two extra predicates this column is NOT simply the column to its left
  -- minus the already-surcharged parents; the gap between them is the anti-join's
  -- selectivity plus whatever the rate and rounding guards remove.
  --
  -- On a database that `supabase db reset` has just returned to zero, steady_state=0 makes
  -- this column equal month_overdue_unsettled_rentals: nothing has surcharged anything yet.
  -- That equality is a property of the freshly-reset database, not of steady_state=0 -- run
  -- this against a database the suite has already left rows in and the anti-join will remove
  -- whatever those runs raised.
  --
  -- NOTE: this counts candidates for ceedo_collections.business_date() -- at steady_state=1,
  -- the very night the build block has already run run_surcharge for. It is not a forecast
  -- for the NEXT night, on which a further day's cohort of rentals crosses the month line.
  (select count(*) from ceedo_collections.charge_balances b
     join ceedo_collections.fee_types f on f.id = b.fee_type_id
     where b.charge_type = 'rental'
       and f.surcharge_bps > 0
       and (round(b.amount * 100) * f.surcharge_bps + 5000) >= 10000
       and not b.is_settled
       and ceedo_collections.business_date() > (b.due_date + interval '1 month')::date
       and not exists (
         select 1 from ceedo_collections.charges s
         where s.parent_charge_id = b.id and s.charge_type = 'surcharge'))
    as tonights_candidates;

-- The fraction that decides everything. This is not a fraction the planner ever sees: its
-- row estimate for the charges scan is a flat one-third at every shape below, regardless of
-- what this number actually is (see the write-up's "What the numbers say"). It is, however,
-- the fraction a human deciding whether to ship the index needs -- and, empirically on this
-- harness's date-correlated heap, a seek range this large did not stop the planner from
-- choosing the index anyway.
--
-- Numerator and denominator both range over charge_type <> 'surcharge' -- the index's own
-- partial predicate, which is what "indexed rows" in this metric's name means. They must
-- agree: an earlier version took the numerator over charge_type = 'rental' instead, which
-- coincides only on a ledger whose sole non-surcharge type is 'rental'. On a mixed ledger
-- that mismatch would silently understate the seek range. Every shape published in
-- docs/superpowers/measurements/2026-09-19-surcharge-scan.md had zero surcharge charges and
-- only rental charges, so the figures recorded there are unaffected by this correction.
select round(
         100.0 * (select count(*) from ceedo_collections.charges
                    where charge_type <> 'surcharge'
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
