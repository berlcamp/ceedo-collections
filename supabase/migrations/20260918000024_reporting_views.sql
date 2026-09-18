-- Every view here is security_invoker: RLS applies to the staff member running the
-- query, not to the view's owner. On a Supabase project shared with unrelated systems,
-- a definer-rights view over the ledger is a hole through the membership gate.

create view ceedo_collections.lease_balances
with (security_invoker = true)
as
select
  b.lease_id,
  sum(b.outstanding)::numeric(14,2)              as outstanding,
  min(b.due_date) filter (where not b.is_settled) as oldest_due_date,
  max(b.days_overdue) filter (where not b.is_settled) as days_overdue,
  count(*) filter (where not b.is_settled)::integer   as unpaid_charges
from ceedo_collections.charge_balances b
where not b.is_settled
group by b.lease_id;

grant select on ceedo_collections.lease_balances to authenticated;

-- Buckets by how long each charge has been overdue, not by how long the lease has been
-- in arrears. A tenant paying sporadically has charges in several buckets at once, and
-- collapsing that to one number per tenant is what makes an aging report useless.
create view ceedo_collections.aging_of_receivables
with (security_invoker = true)
as
select
  b.lease_id,
  l.stall_id,
  s.stall_no,
  t.full_name as tenant_name,
  sum(b.outstanding) filter (where b.days_overdue between 1 and 30)::numeric(14,2)  as bucket_1_30,
  sum(b.outstanding) filter (where b.days_overdue between 31 and 60)::numeric(14,2) as bucket_31_60,
  sum(b.outstanding) filter (where b.days_overdue between 61 and 90)::numeric(14,2) as bucket_61_90,
  sum(b.outstanding) filter (where b.days_overdue > 90)::numeric(14,2)              as bucket_over_90,
  sum(b.outstanding) filter (where b.days_overdue = 0)::numeric(14,2)               as not_yet_due,
  sum(b.outstanding)::numeric(14,2)                                                 as total
from ceedo_collections.charge_balances b
join ceedo_collections.leases  l on l.id = b.lease_id
join ceedo_collections.stalls  s on s.id = l.stall_id
join ceedo_collections.tenants t on t.id = l.tenant_id
where not b.is_settled
group by b.lease_id, l.stall_id, s.stall_no, t.full_name;

grant select on ceedo_collections.aging_of_receivables to authenticated;

-- Drives demand letters, so it carries the contact details that go on one.
create view ceedo_collections.delinquency_list
with (security_invoker = true)
as
select
  a.lease_id,
  a.stall_no,
  a.tenant_name,
  t.address,
  t.contact_no,
  lb.outstanding,
  lb.oldest_due_date,
  lb.days_overdue,
  lb.unpaid_charges
from ceedo_collections.aging_of_receivables a
join ceedo_collections.lease_balances lb on lb.lease_id = a.lease_id
join ceedo_collections.leases  l on l.id = a.lease_id
join ceedo_collections.tenants t on t.id = l.tenant_id
where lb.days_overdue > 30
order by lb.days_overdue desc, lb.outstanding desc;

grant select on ceedo_collections.delinquency_list to authenticated;

-- Charges, payments and condonations interleaved for one lease. The running balance is
-- computed here rather than in report code so every consumer gets the same number.
--
-- A cancelled collection appears with a zero amount and its cancellation noted, rather
-- than vanishing: the paper trail shows the receipt was issued and then voided, which is
-- what an auditor is looking for.
--
-- A condonation is a credit like a payment, because charge_balances.outstanding subtracts
-- it exactly as it subtracts an allocation. Omitting the branch does not merely lose a
-- row: the closing running_balance then disagrees with lease_balances.outstanding by the
-- whole condoned amount, and /ledger/leases/[id] renders BOTH figures on one screen
-- (apps/web/lib/ledger/queries.ts) -- two totals, and no row explaining the gap.
create view ceedo_collections.subsidiary_ledger
with (security_invoker = true)
as
with entries as (
  select
    b.lease_id,
    b.due_date                              as entry_date,
    'charge'::text                          as entry_type,
    b.charge_type::text                     as detail,
    b.period_start,
    b.period_end,
    b.amount                                as debit,
    0::numeric(14,2)                        as credit,
    null::integer                           as or_no,
    b.id                                    as source_id,
    false                                   as cancelled
  from ceedo_collections.charge_balances b

  union all

  select
    c.lease_id,
    c.business_date,
    'collection'::text,
    case when x.id is null then 'payment' else 'payment (cancelled)' end,
    null::date,
    null::date,
    0::numeric(14,2),
    case when x.id is null then c.gross_amount else 0::numeric(14,2) end,
    c.or_no,
    c.id,
    x.id is not null
  from ceedo_collections.collections c
  left join ceedo_collections.collection_cancellations x on x.collection_id = c.id
  where c.lease_id is not null

  union all

  -- The write-off. Dated by when it was granted, not by the charge's due date: the
  -- ordinance is an event in its own right, and dating it back would silently rewrite the
  -- balance the lease carried in the months before it was passed.
  --
  -- It carries the parent charge's period so the row says WHICH month was forgiven; the
  -- authority_ref is the detail because the ordinance is the only thing that makes a
  -- write-off a decision rather than a missing record.
  select
    k_charge.lease_id,
    k.condoned_at::date,
    'condonation'::text,
    k.authority_ref,
    k_charge.period_start,
    k_charge.period_end,
    0::numeric(14,2),
    k.amount,
    null::integer,
    k.id,
    false
  from ceedo_collections.charge_condonations k
  join ceedo_collections.charges k_charge on k_charge.id = k.charge_id
)
select
  lease_id, entry_date, entry_type, detail, period_start, period_end,
  debit, credit, or_no, source_id, cancelled,
  -- The tie-break is (entry_type, source_id), unchanged. entry_type is sorted as text, and
  -- 'charge' < 'collection' < 'condonation' already reads correctly for a single day: the
  -- charge is raised, then whatever was paid against it, then whatever was forgiven of the
  -- remainder. source_id keeps it total, so the window is deterministic. Consumers that
  -- print the rows must ORDER BY the same three columns -- apps/web/lib/ledger/queries.ts
  -- does -- because the outer SELECT carries no ORDER BY of its own.
  sum(debit - credit) over (
    partition by lease_id order by entry_date, entry_type, source_id
    rows between unbounded preceding and current row
  )::numeric(14,2) as running_balance
from entries;

grant select on ceedo_collections.subsidiary_ledger to authenticated;
