-- A DAILY lease with a long run of unpaid days, so the tablet's month grouping (parent
-- §9.3) has something to group. Rosalinda's monthly lease from dev-seed-round.sql has one
-- period per month and renders flat.
--
-- DEVELOPMENT ONLY. Run after dev-seed-round.sql, which it does not depend on beyond the
-- seed's Central Public Market stalls:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:56322/postgres" -f scripts/dev-seed-daily-lease.sql
--
-- Then sync the tablet and search "Dry Goods-02". Idempotent.

\set ON_ERROR_STOP on

begin;

insert into ceedo_collections.tenants (id, full_name, contact_no)
values ('66666666-6666-4666-8666-666666666666', 'Ernesto Dizon', '0917 000 2002')
on conflict (id) do nothing;

insert into ceedo_collections.leases (id, stall_id, tenant_id, start_date, rate_amount,
                                      accrual_period, due_day, status)
select '77777777-7777-4777-8777-777777777777', s.id,
       '66666666-6666-4666-8666-666666666666', '2026-07-01', 50.00, 'daily', null, 'active'
  from ceedo_collections.stalls s
  join ceedo_collections.sections sec on sec.id = s.section_id
  join ceedo_collections.facilities f on f.id = sec.facility_id
 where f.code = 'CPM' and s.stall_no = 'Dry Goods-02'
on conflict (id) do nothing;

-- Every day from 1 July to 15 September unpaid: two full months and half of a third.
-- Inserted directly for the same reason dev-seed-round.sql gives: run_accrual() is global.
insert into ceedo_collections.charges (lease_id, fee_type_id, charge_type, period_start,
                                       period_end, due_date, amount, source)
select '77777777-7777-4777-8777-777777777777', ft.id, 'rental', d::date, d::date, d::date,
       50.00, 'manual'
  from ceedo_collections.fee_types ft,
       generate_series(date '2026-07-01', date '2026-09-15', interval '1 day') as d
 where ft.code = 'MKT_DAILY'
   and not exists (
     select 1 from ceedo_collections.charges c
      where c.lease_id = '77777777-7777-4777-8777-777777777777'
        and c.period_start = d::date and c.charge_type = 'rental');

commit;

select st.stall_no as stall, t.full_name as tenant, count(c.*) as unpaid_days,
       sum(c.amount) as owed
  from ceedo_collections.leases l
  join ceedo_collections.stalls st on st.id = l.stall_id
  join ceedo_collections.tenants t on t.id = l.tenant_id
  left join ceedo_collections.charges c on c.lease_id = l.id
 where l.id = '77777777-7777-4777-8777-777777777777'
 group by st.stall_no, t.full_name;
