-- Super-admin tools: wipe every record except the people, and load a test world.
--
-- WHY. Testing the web and the tablets end to end needs a market full of stalls, tenants,
-- leases and arrears, and a way back to a clean slate afterwards, on a hosted project
-- where nobody has psql. scripts/dev-seed-*.sql only ever served local development.
--
-- WHO. Not every admin: an administrator whose Google email is on super_admins. The
-- allowlist is in the database, not the web app, so the gate holds for a direct RPC call
-- as much as for the page. It is edited by hand in SQL, deliberately -- a screen for
-- granting the power to wipe the ledger would be one more way to get it.
--
-- WHAT SURVIVES A WIPE. app_users (the people, with their roles and PINs), settings (the
-- cutover date) and super_admins. Everything else in the schema is truncated, including
-- the audit log, tablets and staff invites -- except deployed_migrations, which exists only
-- on a hosted project (scripts/bundle-migrations.mjs records each bundle there, and its
-- guard refuses the next bundle without it).

create table ceedo_collections.super_admins (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- No policies and no grants: only the SECURITY DEFINER functions below read it. The
-- INSERT migration 0001's default privileges hand service_role is taken back, so the list
-- changes only from the SQL editor.
alter table ceedo_collections.super_admins enable row level security;
revoke insert on ceedo_collections.super_admins from service_role;

insert into ceedo_collections.super_admins (email) values ('berlcamp@gmail.com');

create or replace function ceedo_collections.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ceedo_collections, pg_temp
as $$
  select ceedo_collections.is_admin()
     and exists (
       select 1
         from auth.users u
         join ceedo_collections.super_admins s on s.email = lower(u.email)
        where u.id = auth.uid()
     );
$$;

revoke execute on function ceedo_collections.is_super_admin() from public, anon;
grant execute on function ceedo_collections.is_super_admin() to authenticated;

-- Truncates every table in the schema except the kept ones. The list is read from the
-- catalogue rather than written down, so a table added by a later migration is wiped too
-- instead of quietly surviving with rows that point at nothing.
--
-- No CASCADE: if a kept table ever gains a foreign key into a wiped one, TRUNCATE refuses
-- and nothing is lost, rather than CASCADE silently emptying the kept table as well.
create or replace function ceedo_collections.clear_all_data()
returns integer
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_tables text;
  v_count  integer;
begin
  if not ceedo_collections.is_super_admin() then
    raise exception 'Only a super administrator may clear the data'
      using errcode = 'insufficient_privilege';
  end if;

  select string_agg(format('ceedo_collections.%I', c.relname), ', '), count(*)
    into v_tables, v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ceedo_collections'
     and c.relkind in ('r', 'p')
     and c.relname not in ('app_users', 'settings', 'super_admins', 'deployed_migrations');

  if v_tables is not null then
    execute 'truncate ' || v_tables || ' restart identity';
  end if;

  return v_count;
end;
$$;

revoke execute on function ceedo_collections.clear_all_data() from public, anon;
grant execute on function ceedo_collections.clear_all_data() to authenticated;

-- A test market to collect from, on the web and on a tablet.
--
-- Idempotent: every row is keyed by a natural key or a fixed id, so running it twice adds
-- only what is missing (a day's worth of new charges, say). Dates are relative to today's
-- business date, so the arrears are always current whenever it is run.
--
-- Arrears follow the real model around the cutover date: per-period rentals from the
-- cutover on (source 'accrual', exactly what the nightly job would have raised), and before
-- it either per-period 'manual' rentals, as scripts/dev-seed-*.sql do, or one opening
-- balance per lease. Both kinds appear, so both can be tested.
create or replace function ceedo_collections.seed_test_data()
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, extensions, pg_temp
as $$
declare
  v_today    date;
  v_cutover  date;
  v_cpm      uuid;
  v_ibjt     uuid;
  v_form     uuid;
  v_lease    record;
  v_ob_total numeric;
  v_ob_first date;
  v_names    text[] := array[
    'Rosalinda Bautista', 'Ernesto Dizon', 'Marites Garcia', 'Rogelio Mendoza',
    'Luzviminda Reyes', 'Danilo Santos', 'Corazon Villanueva', 'Eduardo Ramos',
    'Josefina Aquino', 'Rodrigo Castillo', 'Imelda Fernandez', 'Arnel Navarro',
    'Teresita Pascual', 'Romeo Salazar', 'Leonora Domingo', 'Ferdinand Lim',
    'Milagros Torres', 'Reynaldo Cruz', 'Estrella Manalo', 'Virgilio Soriano',
    'Perla Gonzales', 'Nestor Del Rosario', 'Remedios Uy', 'Alfredo Tan',
    'Gloria Mercado', 'Benjamin Ocampo'];
  v_streets  text[] := array['Rizal St.', 'Mabini St.', 'Bonifacio Ave.', 'Luna St.',
                             'Burgos St.', 'Quezon Blvd.'];
begin
  if not ceedo_collections.is_super_admin() then
    raise exception 'Only a super administrator may load test data'
      using errcode = 'insufficient_privilege';
  end if;

  v_today   := ceedo_collections.business_date();
  v_cutover := ceedo_collections.cutover_date();

  -- Facilities, sections, stalls ---------------------------------------------------------
  insert into facilities (code, name, type) values
    ('CPM',  'Central Public Market',             'market'),
    ('IBJT', 'Integrated Bus & Jeepney Terminal', 'terminal'),
    ('SLH',  'City Slaughterhouse',               'slaughterhouse'),
    ('PRK',  'City Hall Parking',                 'parking')
  on conflict (code) do nothing;

  select id into v_cpm from facilities where code = 'CPM';
  select id into v_ibjt from facilities where code = 'IBJT';

  insert into sections (facility_id, name, default_accrual_period) values
    (v_cpm, 'Fish',      'daily'),
    (v_cpm, 'Meat',      'daily'),
    (v_cpm, 'Vegetable', 'weekly'),
    (v_cpm, 'Dry Goods', 'monthly')
  on conflict (facility_id, name) do nothing;

  insert into stalls (section_id, stall_no, area_sqm, active)
  select s.id, n::text, 4 + (n % 3) * 2, not (s.name = 'Dry Goods' and n = 10)
    from sections s, generate_series(1, 10) n
   where s.facility_id = v_cpm
     and s.name in ('Fish', 'Meat', 'Vegetable', 'Dry Goods')
  on conflict (section_id, stall_no) do nothing;

  -- Fees, rates, accountable forms --------------------------------------------------------
  insert into fee_types (code, name, accrues, surcharge_bps, facility_type) values
    ('MKT_DAILY',   'Market stall rental (daily)',   true,  300, 'market'),
    ('MKT_WEEKLY',  'Market stall rental (weekly)',  true,  300, 'market'),
    ('MKT_MONTHLY', 'Market stall rental (monthly)', true,  300, 'market'),
    ('AMBULANT',    'Ambulant vendor fee',           false, 0,   'market'),
    ('PARKING',     'Parking fee',                   false, 0,   'parking'),
    ('TERMINAL',    'Terminal fee',                  false, 0,   'terminal'),
    ('SLAUGHTER',   'Slaughter fee',                 false, 0,   'slaughterhouse')
  on conflict (code) do nothing;

  insert into rates (fee_type_id, rate_class, effective_from, amount, basis)
  select f.id, r.rate_class, date '2026-01-01', r.amount, r.basis::rate_basis
    from (values
      ('MKT_DAILY',   '',        120.00, 'per_day'),
      ('MKT_WEEKLY',  '',        800.00, 'per_week'),
      ('MKT_MONTHLY', '',       3000.00, 'per_month'),
      ('AMBULANT',    '',         20.00, 'per_day'),
      ('PARKING',     '',         20.00, 'per_entry'),
      ('TERMINAL',    'bus',      30.00, 'per_entry'),
      ('TERMINAL',    'jeepney',  15.00, 'per_entry'),
      ('SLAUGHTER',   'hog',      85.00, 'per_head'),
      ('SLAUGHTER',   'cattle',  250.00, 'per_head'),
      ('SLAUGHTER',   'goat',     45.00, 'per_head')
    ) as r(code, rate_class, amount, basis)
    join fee_types f on f.code = r.code
  -- Any existing rate for the class, whatever its dates, is left alone: an overlapping
  -- one would be refused by rates_no_overlap anyway.
   where not exists (
     select 1 from rates x where x.fee_type_id = f.id and x.rate_class = r.rate_class);

  insert into form_types (code, name) values
    ('OR51', 'Official Receipt (Accountable Form 51)')
  on conflict (code) do nothing;

  -- Tenants -------------------------------------------------------------------------------
  -- Fixed ids (md5 of a label) make a rerun find the same people instead of doubling them.
  insert into tenants (id, full_name, address, contact_no, active)
  select md5('ceedo-test:tenant:' || i)::uuid,
         v_names[i],
         (10 + i * 7) || ' ' || v_streets[1 + (i % array_length(v_streets, 1))] || ', Poblacion',
         '0917 ' || lpad((100 + i)::text, 3, '0') || ' ' || lpad((1000 + i * 37)::text, 4, '0'),
         i <> array_length(v_names, 1)  -- the last one is inactive
    from generate_series(1, array_length(v_names, 1)) i
  on conflict (id) do nothing;

  -- Leases --------------------------------------------------------------------------------
  -- Stalls 1-8 of each section are let. The lease's age sets its arrears profile:
  --   n % 4 = 1: started today, nothing owed yet
  --   n % 4 = 2: about three weeks behind
  --   n % 4 = 3: about two months behind
  --   n % 4 = 0: about five months behind, the part before the cutover as an opening balance
  -- Stall 9 has a future lease (Reserved) in Fish and Meat and an ended one elsewhere.
  -- Stall 10 stays vacant; Dry Goods 10 is inactive. Tenants 25 and 26 hold no stall.
  insert into leases (id, stall_id, tenant_id, start_date, end_date, rate_amount,
                      accrual_period, due_day, status)
  select md5('ceedo-test:lease:' || s.name || ':' || st.stall_no)::uuid,
         st.id,
         md5('ceedo-test:tenant:' || (1 + (sec_no * 8 + n - 1) % 24))::uuid,
         case when n > 8 and s.name in ('Fish', 'Meat') then v_today + 14
              when n > 8 then v_today - 400
              -- A monthly lease bills whole months only, so it starts on the 1st;
              -- otherwise "two months behind" would show a single charge.
              when s.default_accrual_period = 'monthly' and n % 4 <> 1 then
                date_trunc('month', v_today - case n % 4 when 2 then 21 when 3 then 62
                                                         else 150 end)::date
              else v_today - case n % 4 when 1 then 0 when 2 then 21
                                        when 3 then 62 else 150 end end,
         case when n = 9 and s.name not in ('Fish', 'Meat') then v_today - 200 end,
         case s.name when 'Fish'      then 60 + n * 5
                     when 'Meat'      then 90 + n * 5
                     when 'Vegetable' then 350 + n * 25
                     else 1500 + n * 150 end,
         s.default_accrual_period,
         case when s.default_accrual_period = 'monthly' then 5 end,
         case when n = 9 and s.name not in ('Fish', 'Meat') then 'ended'
              else 'active' end::lease_status
    from sections s
    join (values ('Fish', 0), ('Meat', 1), ('Vegetable', 2), ('Dry Goods', 3)) as o(name, sec_no)
      on o.name = s.name
    join stalls st on st.section_id = s.id
    -- Guarded cast: a section can also hold stalls numbered some other way ("Fish-01").
    cross join lateral (
      select case when st.stall_no ~ '^\d+$' then st.stall_no::int end as n) nn
   where s.facility_id = v_cpm
     and nn.n <= 9
  -- Without a target, this also skips a stall that already has an overlapping active lease.
  on conflict do nothing;

  -- Arrears -------------------------------------------------------------------------------
  for v_lease in
    select l.*, case when st.stall_no ~ '^\d+$' then st.stall_no::int end as n
      from leases l
      join stalls st on st.id = l.stall_id
     where l.id in (
       select md5('ceedo-test:lease:' || s.name || ':' || x.stall_no)::uuid
         from sections s join stalls x on x.section_id = s.id
        where s.facility_id = v_cpm)
       and l.status = 'active'
       and l.start_date <= v_today
  loop
    v_ob_total := 0;

    -- The oldest leases carry their pre-cutover debt as one opening balance.
    if v_lease.n % 4 = 0 and v_lease.start_date < v_cutover then
      select sum(v_lease.rate_amount), min(p.period_start)
        into v_ob_total, v_ob_first
        from lease_periods(v_lease.accrual_period, v_lease.start_date, v_lease.end_date,
                           v_lease.start_date, least(v_today, v_cutover - 1), v_lease.due_day) p;

      if coalesce(v_ob_total, 0) > 0 then
        insert into charges (lease_id, fee_type_id, charge_type, period_start, period_end,
                             due_date, amount, surcharge_bps, source, created_by)
        values (v_lease.id, rental_fee_type(v_lease.accrual_period), 'opening_balance',
                v_ob_first, v_cutover - 1, v_ob_first, v_ob_total, 0, 'opening_balance',
                auth.uid())
        on conflict do nothing;
      end if;
    end if;

    insert into charges (lease_id, fee_type_id, charge_type, period_start, period_end,
                         due_date, amount, surcharge_bps, source)
    select v_lease.id, rental_fee_type(v_lease.accrual_period), 'rental',
           p.period_start, p.period_end, p.due_date, v_lease.rate_amount, 0,
           (case when p.period_start >= v_cutover then 'accrual' else 'manual' end)::charge_source
      from lease_periods(v_lease.accrual_period, v_lease.start_date, v_lease.end_date,
                         v_lease.start_date, v_today, v_lease.due_day) p
     -- Periods an opening balance already covers are not billed twice.
     where not (coalesce(v_ob_total, 0) > 0 and p.period_start < v_cutover)
    on conflict do nothing;
  end loop;

  -- Surcharges on rent more than a month overdue, as the nightly job would add.
  perform run_surcharge(v_today, null);

  -- Collectors, booklets, a tablet --------------------------------------------------------
  -- Collectors are people, so a wipe keeps them; a rerun finds them by employee number.
  insert into app_users (employee_no, full_name, role, status) values
    ('TEST-C01', 'Juan Dela Cruz',  'collector', 'active'),
    ('TEST-C02', 'Ana Villanueva',  'collector', 'active')
  on conflict (employee_no) do nothing;

  -- A known PIN, 123456, so a tablet can be signed into straight away. Hashed with the
  -- same expression set_collector_pin() uses. Only these two test accounts are touched.
  update app_users
     set pin_hash = crypt('123456', gen_salt('bf', 12))
   where employee_no in ('TEST-C01', 'TEST-C02')
     and role = 'collector'
     and pin_hash is null;

  insert into collector_assignments (collector_id, facility_id, active)
  select a.id, f.id, true
    from app_users a
    join facilities f on f.code = case a.employee_no when 'TEST-C01' then 'CPM' else 'IBJT' end
   where a.employee_no in ('TEST-C01', 'TEST-C02') and a.role = 'collector'
     and not exists (
       select 1 from collector_assignments ca
        where ca.collector_id = a.id and ca.facility_id = f.id and ca.active);

  select id into v_form from form_types where code = 'OR51';

  insert into booklets (id, form_type_id, serial_prefix, start_no, end_no, received_date, status)
  values
    (md5('ceedo-test:booklet:1')::uuid, v_form, 'TEST', 1001, 1050, v_today, 'assigned'),
    (md5('ceedo-test:booklet:2')::uuid, v_form, 'TEST', 1051, 1100, v_today, 'assigned'),
    (md5('ceedo-test:booklet:3')::uuid, v_form, 'TEST', 1101, 1150, v_today, 'received')
  on conflict do nothing;

  insert into booklet_assignments (booklet_id, collector_id, assigned_at)
  select b.id, a.id, v_today
    from (values (md5('ceedo-test:booklet:1')::uuid, 'TEST-C01'),
                 (md5('ceedo-test:booklet:2')::uuid, 'TEST-C02')) as x(booklet_id, employee_no)
    join booklets b on b.id = x.booklet_id
    join app_users a on a.employee_no = x.employee_no and a.role = 'collector'
   where not exists (select 1 from booklet_assignments ba where ba.booklet_id = b.id);

  -- Tablets still need a credential issued on the Devices screen before they can enrol.
  insert into devices (label, active) values
    ('Test tablet - Market', true),
    ('Test tablet - Terminal', true)
  on conflict (label) do nothing;

  insert into device_assignments (device_id, facility_id, active)
  select d.id, f.id, true
    from devices d
    join facilities f on f.code = case d.label when 'Test tablet - Market' then 'CPM' else 'IBJT' end
   where d.label in ('Test tablet - Market', 'Test tablet - Terminal')
     and not exists (select 1 from device_assignments da where da.device_id = d.id and da.active);

  return jsonb_build_object(
    'facilities', (select count(*) from facilities),
    'stalls',     (select count(*) from stalls),
    'tenants',    (select count(*) from tenants),
    'leases',     (select count(*) from leases),
    'charges',    (select count(*) from charges),
    'owed',       (select coalesce(sum(amount), 0) from charges)
  );
end;
$$;

revoke execute on function ceedo_collections.seed_test_data() from public, anon;
grant execute on function ceedo_collections.seed_test_data() to authenticated;
