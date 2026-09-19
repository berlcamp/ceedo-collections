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
