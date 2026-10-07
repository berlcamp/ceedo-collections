--
-- The two reads behind the Monthly tenant payments grid (spec report 2). Both are
-- security invoker: RLS on leases/collections gates them.

-- Leases the grid must show for a range: every lease whose term overlaps it, plus any
-- lease that took money in it (an ended lease paying arrears must keep its row, or the
-- grid's total would fall short of the month's receipts).
create or replace function ceedo_collections.leases_active_between(p_from date, p_to date)
returns table (
  lease_id       uuid,
  facility_id    uuid,
  facility_name  text,
  section_id     uuid,
  section_name   text,
  stall_no       text,
  tenant_name    text,
  rate_amount    numeric(14,2),
  accrual_period ceedo_collections.accrual_period
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select l.id, f.id, f.name, s.id, s.name, st.stall_no, t.full_name, l.rate_amount, l.accrual_period
  from ceedo_collections.leases l
  join ceedo_collections.stalls     st on st.id = l.stall_id
  join ceedo_collections.sections   s  on s.id = st.section_id
  join ceedo_collections.facilities f  on f.id = s.facility_id
  join ceedo_collections.tenants    t  on t.id = l.tenant_id
  -- A lease marked ended/terminated with no end_date has no term to place in a range, so
  -- only the paid-in-range branch can bring it in.
  where (l.start_date <= p_to and (l.end_date is null or l.end_date >= p_from)
         and (l.status = 'active' or l.end_date is not null))
     or exists (
       select 1 from ceedo_collections.collections c
       where c.lease_id = l.id and c.business_date between p_from and p_to
     );
$$;

-- Money received per lease per business day. Surcharge is what the receipt allocated
-- to surcharge charges; base is the rest of the receipt. Receipts under a standing
-- cancellation are excluded; a reinstated one counts again.
create or replace function ceedo_collections.lease_receipts_by_day(p_from date, p_to date)
returns table (
  lease_id      uuid,
  business_date date,
  base          numeric(14,2),
  surcharge     numeric(14,2)
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select
    col.lease_id,
    col.business_date,
    sum(col.gross_amount - coalesce(sur.amount, 0))::numeric(14,2),
    sum(coalesce(sur.amount, 0))::numeric(14,2)
  from ceedo_collections.collections col
  left join lateral (
    select sum(a.amount) as amount
    from ceedo_collections.collection_allocations a
    join ceedo_collections.charges ch on ch.id = a.charge_id
    where a.collection_id = col.id and ch.charge_type = 'surcharge'
  ) sur on true
  where col.lease_id is not null
    and col.business_date between p_from and p_to
    and not exists (
      select 1 from ceedo_collections.standing_cancellations x where x.collection_id = col.id
    )
  group by col.lease_id, col.business_date;
$$;

create index if not exists collections_business_date_idx
  on ceedo_collections.collections (business_date);

revoke execute on function ceedo_collections.leases_active_between(date, date) from public;
revoke execute on function ceedo_collections.lease_receipts_by_day(date, date) from public;
grant execute on function ceedo_collections.leases_active_between(date, date) to authenticated;
grant execute on function ceedo_collections.lease_receipts_by_day(date, date) to authenticated;
