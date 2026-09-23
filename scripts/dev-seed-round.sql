-- Gives a freshly reset database something to collect: a collector, a tenant on a lease
-- with three overdue months, and an OR booklet assigned to that collector.
--
-- WHY THIS EXISTS. `supabase/seed.sql` carries facilities, stalls, fee types and rates but
-- no collector, tenant, lease, charge or booklet, so after a reset the tablet cannot get
-- past sign-in and every money screen is empty. A collector cannot be made through the web
-- UI either: `app_users.id` references `auth.users`, and only a Google sign-in creates one.
--
-- DEVELOPMENT ONLY, like dev-wire-tablet.sql, and for the same reason: it writes a fake
-- `auth.users` row and a known collector.
--
-- Usage, from the repo root, BEFORE dev-wire-tablet.sql (that script picks up the
-- collector made here and sets the PIN):
--
--   psql "postgresql://postgres:postgres@127.0.0.1:56322/postgres" -f scripts/dev-seed-round.sql
--
-- Charges are inserted directly, not through run_accrual(): that job is global and walks
-- every active lease. Idempotent.

\set ON_ERROR_STOP on

begin;

-- 1. The collector. The password is a literal bcrypt string and is never used: device
--    sign-in is by PIN, which dev-wire-tablet.sql sets.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'maria.santos@example.invalid',
        '$2a$10$abcdefghijklmnopqrstuuJ4n0mYZg2V4j0rjc3hFY7m7p2z5Zx9W',
        now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;

insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
values ('11111111-1111-4111-8111-111111111111', 'E-1042', 'Maria Santos', 'collector', 'active')
on conflict (id) do nothing;

-- 2. A tenant on a monthly stall, three months overdue.
insert into ceedo_collections.tenants (id, full_name, contact_no)
values ('22222222-2222-4222-8222-222222222222', 'Rosalinda Bautista', '0917 000 1042')
on conflict (id) do nothing;

insert into ceedo_collections.leases (id, stall_id, tenant_id, start_date, rate_amount,
                                      accrual_period, due_day, status)
select '33333333-3333-4333-8333-333333333333', s.id,
       '22222222-2222-4222-8222-222222222222', '2026-06-01', 1850.00, 'monthly', 5, 'active'
  from ceedo_collections.stalls s
  join ceedo_collections.sections sec on sec.id = s.section_id
  join ceedo_collections.facilities f on f.id = sec.facility_id
 where f.code = 'CPM'
 order by s.stall_no
 limit 1
on conflict (id) do nothing;

insert into ceedo_collections.charges (lease_id, fee_type_id, charge_type, period_start,
                                       period_end, due_date, amount, source)
select '33333333-3333-4333-8333-333333333333', ft.id, 'rental', m.start,
       (m.start + interval '1 month - 1 day')::date, (m.start + 4)::date, 1850.00, 'manual'
  from ceedo_collections.fee_types ft,
       (values (date '2026-06-01'), (date '2026-07-01'), (date '2026-08-01')) as m(start)
 where ft.code = 'MKT_MONTHLY'
   and not exists (
     select 1 from ceedo_collections.charges c
      where c.lease_id = '33333333-3333-4333-8333-333333333333'
        and c.period_start = m.start and c.charge_type = 'rental');

-- 3. An OR booklet, serials 1001-1050, assigned to her.
insert into ceedo_collections.booklets (id, form_type_id, serial_prefix, start_no, end_no,
                                        received_date, status)
select '44444444-4444-4444-8444-444444444444', ft.id, 'OR-2026', 1001, 1050, current_date,
       'assigned'
  from ceedo_collections.form_types ft
 where ft.code = 'OR51'
on conflict (id) do nothing;

insert into ceedo_collections.booklet_assignments (booklet_id, collector_id, assigned_at)
select '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
       current_date
 where not exists (
   select 1 from ceedo_collections.booklet_assignments
    where booklet_id = '44444444-4444-4444-8444-444444444444');

commit;

select a.full_name as collector, st.stall_no as stall, t.full_name as tenant,
       (select count(*) from ceedo_collections.charges c where c.lease_id = l.id) as charges,
       b.serial_prefix || ' ' || b.start_no || '-' || b.end_no as booklet
  from ceedo_collections.app_users a,
       ceedo_collections.leases l
  join ceedo_collections.stalls st on st.id = l.stall_id
  join ceedo_collections.tenants t on t.id = l.tenant_id,
       ceedo_collections.booklets b
 where a.id = '11111111-1111-4111-8111-111111111111'
   and l.id = '33333333-3333-4333-8333-333333333333'
   and b.id = '44444444-4444-4444-8444-444444444444';
