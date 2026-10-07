--
-- What each lease owed at the end of a given business date. charge_balances answers
-- "as of now"; this answers "as of D", so a balance printed for 30 September reads the
-- same in December. security invoker: RLS on charges/collections/leases gates it exactly
-- as it gates charge_balances.
--
-- On D, a charge counts once the ledger held it -- the books as they stood that day:
--   * a rental once its period has ended (period_end <= D): run_accrual raises a period
--     only once it is over, so a monthly charge due on the 5th exists from month end;
--   * a surcharge once D > due_date + 1 month, the rule run_surcharge raises it by (it
--     carries its parent's due_date, so due_date alone would date it a month early);
--   * an opening balance once it fell due;
--   * a receipt counts if dated by D and not cancelled by D (a cancellation reinstated by
--     D does not count) -- so a receipt cancelled after D still paid on D;
--   * a condonation counts from the Manila date it was recorded.
-- Age is D - due_date; 0 or less is "not yet due", as in aging_of_receivables.

create or replace function ceedo_collections.lease_balances_as_of(p_date date)
returns table (
  lease_id        uuid,
  facility_id     uuid,
  facility_name   text,
  section_id      uuid,
  section_name    text,
  stall_no        text,
  tenant_name     text,
  rate_amount     numeric(14,2),
  accrual_period  ceedo_collections.accrual_period,
  outstanding     numeric(14,2),
  not_yet_due     numeric(14,2),
  bucket_1_30     numeric(14,2),
  bucket_31_60    numeric(14,2),
  bucket_61_90    numeric(14,2),
  bucket_over_90  numeric(14,2),
  oldest_due_date date,
  unpaid_charges  integer
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with counted as (
    select col.id
    from ceedo_collections.collections col
    where col.business_date <= p_date
      and not exists (
        select 1
        from ceedo_collections.collection_cancellations cc
        where cc.collection_id = col.id
          and (cc.cancelled_at at time zone 'Asia/Manila')::date <= p_date
          and not exists (
            select 1 from ceedo_collections.collection_reinstatements r
            where r.cancellation_id = cc.id
              and (r.reinstated_at at time zone 'Asia/Manila')::date <= p_date
          )
      )
  ),
  alloc as (
    select a.charge_id, sum(a.amount) as amount
    from ceedo_collections.collection_allocations a
    join counted k on k.id = a.collection_id
    group by a.charge_id
  ),
  cond as (
    select k.charge_id, sum(k.amount) as amount
    from ceedo_collections.charge_condonations k
    where (k.condoned_at at time zone 'Asia/Manila')::date <= p_date
    group by k.charge_id
  ),
  per_charge as (
    select
      c.lease_id,
      c.due_date,
      (p_date - c.due_date) as age,
      (c.amount - coalesce(al.amount, 0) - coalesce(co.amount, 0)) as outstanding
    from ceedo_collections.charges c
    left join alloc al on al.charge_id = c.id
    left join cond  co on co.charge_id = c.id
    where case c.charge_type
            when 'rental'    then c.period_end <= p_date
            when 'surcharge' then p_date > (c.due_date + interval '1 month')::date
            else c.due_date <= p_date
          end
  ),
  per_lease as (
    select
      pc.lease_id,
      sum(pc.outstanding) as outstanding,
      coalesce(sum(pc.outstanding) filter (where pc.age <= 0), 0)              as not_yet_due,
      coalesce(sum(pc.outstanding) filter (where pc.age between 1 and 30), 0)  as b1,
      coalesce(sum(pc.outstanding) filter (where pc.age between 31 and 60), 0) as b2,
      coalesce(sum(pc.outstanding) filter (where pc.age between 61 and 90), 0) as b3,
      coalesce(sum(pc.outstanding) filter (where pc.age > 90), 0)              as b4,
      min(pc.due_date) as oldest,
      count(*)::integer as unpaid
    from per_charge pc
    where pc.outstanding > 0
    group by pc.lease_id
  )
  select
    l.id, f.id, f.name, s.id, s.name, st.stall_no, t.full_name,
    l.rate_amount, l.accrual_period,
    pl.outstanding::numeric(14,2), pl.not_yet_due::numeric(14,2),
    pl.b1::numeric(14,2), pl.b2::numeric(14,2), pl.b3::numeric(14,2), pl.b4::numeric(14,2),
    pl.oldest, pl.unpaid
  from per_lease pl
  join ceedo_collections.leases     l  on l.id = pl.lease_id
  join ceedo_collections.stalls     st on st.id = l.stall_id
  join ceedo_collections.sections   s  on s.id = st.section_id
  join ceedo_collections.facilities f  on f.id = s.facility_id
  join ceedo_collections.tenants    t  on t.id = l.tenant_id;
$$;

revoke execute on function ceedo_collections.lease_balances_as_of(date) from public;
grant execute on function ceedo_collections.lease_balances_as_of(date) to authenticated;
