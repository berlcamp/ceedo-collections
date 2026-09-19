-- Makes run_surcharge's month-overdue date expression seekable. It does not make the nightly
-- job faster, and it was not measured to.
--
-- The date test used to sit in Filter rather than Index Cond, because charges_due_date_idx
-- (migration 0011) serves only its own partial predicate. This index puts the expression in
-- Index Cond. That is all it does. docs/superpowers/measurements/2026-09-19-surcharge-scan.md
-- ran run_surcharge's query with and without it at three ledger shapes and found it neither
-- faster nor slower: at the 200,000-charge gate shape, 820.989 ms -> 790.965 ms on one sample
-- per condition, against a ~22.4 ms noise floor the write-up demonstrates in a subtree that
-- should not differ at all, with total buffer traffic moving 0.004%. So this index ships on
-- the plan-shape gate the design set -- the date test must read as Index Cond rather than
-- Filter (2026-09-19-surcharge-scan-cost-design.md §3) -- and not on a demonstrated speedup.
--
-- The real cost is somewhere this index does not reach. The date predicate is not selective
-- at one year's depth: 92.25% of charges matched it at the gate shape, so 184,500 of 200,000
-- rows still flow into charge_balances's per-row lateral joins, which must run for every one
-- of them before settlement status is known, to yield 4,500 rows. The charges scan is a small
-- slice of the whole: 38.174 ms of 820.989 ms before, 32.052 ms of 790.965 ms after. Anyone
-- looking for a real win on run_surcharge should start at the laterals, not here. §1 of the
-- design spec predicted the opposite and is wrong; the measurement is the correction.
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
--
-- Applying this locks writers out of charges while the index builds: create index without
-- concurrently takes a SHARE lock, which blocks inserts, updates and deletes for the duration
-- of the build -- sub-second at 200,000 rows, but proportional to the table, so a much larger
-- ledger should expect a correspondingly longer write stall. concurrently is not an option
-- here because Supabase runs each migration inside a transaction.
create index charges_surcharge_due_idx
  on ceedo_collections.charges (((due_date + interval '1 month')::date))
  where charge_type <> 'surcharge';

comment on index ceedo_collections.charges_surcharge_due_idx is
  'Serves run_surcharge''s month-overdue predicate. The expression must stay byte-identical '
  'to the one in the function body; surcharge-scan-plan.test.ts asserts the planner still '
  'seeks on it, and surcharge-predicate.test.ts asserts the function side has not drifted.';
