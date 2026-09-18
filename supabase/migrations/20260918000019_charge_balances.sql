-- What is actually owed on each charge.
--
-- There is no status column on charges, by design: a charge is a fact, and whether it is
-- settled is a conclusion drawn from the rows pointing at it. This view is that
-- conclusion, and it is the ONLY place the conclusion is drawn.
--
-- security_invoker = true so RLS on the underlying tables applies to whoever queries the
-- view, not to its owner. Without it this view is a hole straight through the app_users
-- membership gate -- and auth.users is shared with unrelated systems on this project.
create view ceedo_collections.charge_balances
with (security_invoker = true)
as
select
  c.id,
  c.lease_id,
  c.fee_type_id,
  c.charge_type,
  c.parent_charge_id,
  c.period_start,
  c.period_end,
  c.due_date,
  c.amount,
  c.surcharge_bps,
  c.created_at,
  coalesce(alloc.allocated, 0)::numeric(14,2) as allocated,
  coalesce(cond.condoned, 0)::numeric(14,2)  as condoned,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0))::numeric(14,2)
    as outstanding,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0)) <= 0
    as is_settled,
  greatest(0, (ceedo_collections.business_date() - c.due_date))::integer as days_overdue
from ceedo_collections.charges c
left join lateral (
  select sum(a.amount) as allocated
  from ceedo_collections.collection_allocations a
  join ceedo_collections.collections col on col.id = a.collection_id
  where a.charge_id = c.id
    -- A cancelled collection's allocations stop counting. Omitting this is the easiest
    -- mistake in the phase to make and the hardest to notice: the ledger would report
    -- voided money as received, and every downstream report would agree with it.
    and not exists (
      select 1 from ceedo_collections.collection_cancellations x
      where x.collection_id = col.id
    )
) alloc on true
left join lateral (
  select sum(k.amount) as condoned
  from ceedo_collections.charge_condonations k
  where k.charge_id = c.id
) cond on true;

grant select on ceedo_collections.charge_balances to authenticated;

comment on view ceedo_collections.charge_balances is
  'The single definition of what is owed. Aging, delinquency, the subsidiary ledger and '
  'FIFO all read this view so they cannot drift apart.';

-- The FIFO-ordered groups of what a lease still owes. A group is one period's rental
-- charge together with its surcharge, or a standalone opening balance.
--
-- Ordering is (due_date, period_start) ascending. An opening balance carries the real
-- oldest-unpaid date from the paper record, which places it before every accrued period
-- with no special case. Ordering by created_at would put it LAST, and a tenant would
-- settle this month's rent while two years of arrears sat untouched.
create or replace function ceedo_collections.unpaid_period_groups(p_lease_id uuid)
returns table (
  group_rank   integer,
  due_date     date,
  period_start date,
  period_end   date,
  charge_ids   uuid[],
  outstanding  numeric(14,2)
)
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  with groups as (
    select
      b.due_date      as g_due,
      b.period_start  as g_start,
      b.period_end    as g_end,
      array_agg(b.id order by b.charge_type) as ids,
      sum(b.outstanding)::numeric(14,2)      as amt
    from ceedo_collections.charge_balances b
    where b.lease_id = p_lease_id
      and not b.is_settled
    group by b.due_date, b.period_start, b.period_end
  )
  select
    (row_number() over (order by g_due, g_start))::integer,
    g_due, g_start, g_end, ids, amt
  from groups
  order by g_due, g_start;
$$;

revoke execute on function ceedo_collections.unpaid_period_groups(uuid) from public;
grant execute on function ceedo_collections.unpaid_period_groups(uuid)
  to authenticated, service_role;
