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
