-- The synthetic-ledger builder shared by the two surcharge-scan harnesses:
--
--   scripts/surcharge-scan-measure.sql      -- BEFORE/AFTER, one shape, one pair of plans
--   scripts/surcharge-scan-alternating.sql  -- A/B/A/B/A/B against one ledger
--
-- It is a single DO block and nothing else. It is NOT runnable on its own: the caller must
-- already be inside a transaction and must have created and populated
--
--   create temporary table measure_params (leases int, days int, settled_pct int, steady_state int)
--     on commit drop;
--
-- with exactly one row. Everything this block writes is undone by the caller's ROLLBACK.
--
-- It lives in its own file so the two harnesses build the *same* ledger by construction. They
-- were copies of each other once, and a divergence between them would have made the two logs
-- in .superpowers/sdd/laterals/ incomparable without anyone noticing.
--
-- DEVELOPMENT ONLY. This writes six figures of rows. Never point a caller at production.
--
-- See scripts/surcharge-scan-measure.sql's header for what `leases`, `days`, `settled_pct`
-- and `steady_state` mean.

do $build$
declare
  v_leases       integer;
  v_days         integer;
  v_settled_pct  integer;
  v_settled      integer;
  v_steady_state integer;
  v_raised       integer;
  v_today        date := ceedo_collections.business_date();
  v_fee_type     uuid;
  v_form_type    uuid;
  v_facility     uuid;
  v_section      uuid;
  v_auth_user    uuid := gen_random_uuid();
  v_booklet      uuid;
  v_device       uuid;
  v_tag          text := 'MSR' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  select leases, days, settled_pct, steady_state
    into v_leases, v_days, v_settled_pct, v_steady_state
    from measure_params;
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

  -- Steady state: run the REAL nightly job once, so the measurement the caller takes is
  -- against a ledger that already carries surcharges. Calling run_surcharge itself rather
  -- than seeding surcharge rows by hand is deliberate -- a hand-rolled imitation could raise
  -- a different set than the function does, and then the anti-join being measured would be
  -- answering a question the production job never asks.
  --
  -- v_today is NOT advanced afterwards, so what the caller measures is a second run of the
  -- same night, not night two. See scripts/surcharge-scan-measure.sql's header.
  if v_steady_state = 1 then
    v_raised := ceedo_collections.run_surcharge(v_today);
    raise notice 'steady_state: run_surcharge raised % surcharges on the first night', v_raised;
  end if;
end;
$build$;
