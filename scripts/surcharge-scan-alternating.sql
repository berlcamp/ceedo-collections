-- Interleaved A/B/A/B/... timing of run_surcharge's candidate scan, with and without
-- charges_surcharge_due_idx, against ONE steady-state ledger inside ONE transaction.
--
-- This is the run the revert of migration 20260919000043 rests on. Its raw output is kept at
-- .superpowers/sdd/laterals/alternating-out.txt and decomposed in
-- docs/superpowers/measurements/2026-09-19-surcharge-scan.md, "Follow-up".
--
-- WHY INTERLEAVED. scripts/surcharge-scan-measure.sql runs BEFORE once and then AFTER once,
-- so AFTER always executes against a warmer cache and a longer-lived backend. That ordering
-- cannot distinguish a real effect from drift: at the steady-state shape it made an
-- at-most-4% effect read as 29%. Here each condition is measured `rounds` times, alternating,
-- with the index created and dropped between, so drift hits both conditions equally.
--
-- WHAT THIS RUN ACTUALLY SHOWED -- and it is not what it was built to look for. It was set up
-- expecting the index to save CPU, on the theory that the scan reads
-- (due_date + interval '1 month')::date precomputed from the index instead of evaluating it
-- per row. The log refutes that. Over three rounds at 500 leases x 400 days:
--
--   * the `charges` scan -- the one node where a precomputed expression could possibly show
--     up -- was SLOWER with the index in all three rounds (mean 49.60 ms against 40.34 ms);
--   * the `Hash Join` immediately above it was slower too (110.67 ms against 103.67 ms);
--   * the whole 141 ms mean difference in Execution Time sat in the lateral
--     `Nested Loop Left Join`, which runs loops=184500 in BOTH conditions and reports
--     bit-identical buffers in every run (shared hit=1633500 and shared hit=369000).
--
-- An index on `charges` cannot speed up a node doing the same probes against the same pages
-- of collection_allocations, collections and charge_condonations. There is no I/O mechanism
-- either -- the index adds 83 net buffer touches at this shape, it removes none. What is left
-- is session drift, and it is big enough to swamp the question: the no-index condition alone
-- spanned 890-1134 ms across three runs with read=0 throughout.
--
-- A KNOWN CONFOUND, LEFT IN ON PURPOSE. Strict alternation ties condition to position parity:
-- no-index takes every odd execution, with-index every even one. This run diagnosed one
-- ordering bias and replaced it with a different one. It is still far better than
-- BEFORE-then-AFTER, and the node decomposition above does not depend on the timings at all
-- -- but a decision-grade re-run should randomise the order, or use A/B/B/A, and use more
-- than three rounds. That is what `-v rounds=N` is for.
--
-- DEVELOPMENT ONLY. This takes ACCESS EXCLUSIVE on `charges` for the length of the run, calls
-- the real ceedo_collections.run_surcharge(), writes six figures of rows, and creates and
-- drops an index `rounds` times. Never point it at production. Everything is inside one
-- transaction that ends in ROLLBACK, including the index DDL and the ANALYZEs.
--
-- Usage, from the repo root with the local stack up:
--
--   eval $(supabase status -o env)
--   psql "$DB_URL" -v leases=500 -v days=400 -v settled_pct=90 -v rounds=3 \
--     -f scripts/surcharge-scan-alternating.sql
--
-- `leases`, `days` and `settled_pct` mean what they mean in
-- scripts/surcharge-scan-measure.sql's header, and the ledger is built by the same file
-- (scripts/surcharge-scan-build.sql) so the two harnesses cannot drift apart. `rounds` is how
-- many A/B pairs to run; the published log used 3. The full 500 x 400 shape takes a couple of
-- minutes to build before it measures anything -- try a small shape first if you only want to
-- check the script runs.
--
-- `steady_state` is not a knob here: it is always 1. The steady state -- a ledger that has
-- already been surcharged once, so the anti-join answers against real surcharge rows -- is
-- the case production runs every night after the first, and it is the case this comparison
-- was built to settle. Use the other harness for night one.

\set ON_ERROR_STOP on
\timing off

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
\if :{?rounds}
\else
  \set rounds 3
\endif

\echo ''
\echo '============ surcharge scan: alternating A/B timing ============'
\echo 'leases       :' :leases
\echo 'days         :' :days
\echo 'settled_pct  :' :settled_pct
\echo 'rounds       :' :rounds
\echo 'steady_state : 1 (fixed)'
\echo ''

begin;

-- Measure the no-index condition for real whether or not some future migration ships this
-- index again. Undone by the ROLLBACK like everything else.
drop index if exists ceedo_collections.charges_surcharge_due_idx;

\echo '-- building the steady-state ledger; this is the slow part --'

-- psql does not interpolate variables inside dollar-quoted strings, so the parameters reach
-- the build block through a table rather than through :leases.
create temporary table measure_params (leases int, days int, settled_pct int, steady_state int)
  on commit drop;
insert into measure_params values (:leases, :days, :settled_pct, 1);

-- The same ledger scripts/surcharge-scan-measure.sql builds, from the same file. `\ir`
-- resolves relative to this script, so this works from any working directory.
\ir surcharge-scan-build.sql

analyze ceedo_collections.charges;
analyze ceedo_collections.collections;
analyze ceedo_collections.collection_allocations;
analyze ceedo_collections.leases;
analyze ceedo_collections.fee_types;

\echo ''
select version();

-- run_surcharge takes its date as a plpgsql variable, which reaches the planner as a
-- parameter. Pinning today's business date as a literal is the same planning case, and keeps
-- every execution below comparing the same constant even if the clock rolls over mid-run.
select ceedo_collections.business_date()::text as bd \gset

-- The measured statement -- run_surcharge's candidate scan, byte for byte the same WHERE
-- clause. As a prepared statement so the text is written once and cannot drift between the
-- 2 * :rounds executions.
prepare candidate_scan as
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
\echo '============ rounds ============'

-- psql has no loop, so the round schedule is generated as SQL text and executed with \gexec.
-- The VALUES list below IS the recipe for one round, read top to bottom; generate_series
-- repeats it :rounds times and the ORDER BY keeps the alternation strict. Each round is:
--
--   marker, measure (no index), create index, analyze,
--   marker, measure (with index), drop index, analyze
--
-- so the two conditions alternate and every execution sees freshly ANALYZEd statistics. The
-- trailing drop leaves the next round's no-index execution correctly unindexed, and the last
-- one leaves the transaction as it found it (the ROLLBACK would anyway).
select s.stmt
from generate_series(1, :rounds) as r
cross join lateral (
  values
    (1, format('select %L as round', '########## ROUND ' || r || ' -- NO INDEX ##########')),
    (2, 'explain (analyze, buffers, timing on, costs off, summary on) execute candidate_scan'),
    (3, 'create index charges_surcharge_due_idx'
        || ' on ceedo_collections.charges (((due_date + interval ''1 month'')::date))'
        || ' where charge_type <> ''surcharge'''),
    (4, 'analyze ceedo_collections.charges'),
    (5, format('select %L as round', '########## ROUND ' || r || ' -- WITH INDEX ##########')),
    (6, 'explain (analyze, buffers, timing on, costs off, summary on) execute candidate_scan'),
    (7, 'drop index ceedo_collections.charges_surcharge_due_idx'),
    (8, 'analyze ceedo_collections.charges')
) as s(seq, stmt)
order by r, s.seq
\gexec

-- The synthetic ledger, every index created above, and the statistics all go away here.
rollback;

\echo ''
\echo 'Rolled back. Nothing was left behind.'
