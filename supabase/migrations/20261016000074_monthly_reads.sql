-- supabase/migrations/20261016000074_monthly_reads.sql
-- Collection reports phase 5: reads for the Monthly summary and the re-keyed tenant grid.
-- Each groups receipt_account_lines (070), the single classifier; none classifies anew,
-- except lease_home_accounts, which places a lease that PAID nothing (so it has no portion
-- to read a placement from) by the same rule order.
-- Cancelled receipts (status as of now) are left out of every sum.

create or replace function ceedo_collections.monthly_account_totals(p_from date, p_to date)
returns table (month date, account_id uuid, amount numeric(14,2))
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select date_trunc('month', r.business_date)::date, r.account_id, sum(r.amount)::numeric(14,2)
    from ceedo_collections.receipt_account_lines(p_from, p_to) r
   where not r.cancelled
   group by 1, 2;
$$;

-- Per lease (rent, surcharge, occupancy) or, without a lease, per payer name.
create or replace function ceedo_collections.tenant_payment_portions(p_from date, p_to date)
returns table (
  lease_id      uuid,
  payer_ref     text,
  account_id    uuid,
  portion       text,
  business_date date,
  amount        numeric(14,2)
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select r.lease_id,
         case when r.lease_id is null then nullif(trim(r.payer_ref), '') end,
         r.account_id, r.portion, r.business_date, sum(r.amount)::numeric(14,2)
    from ceedo_collections.receipt_account_lines(p_from, p_to) r
   where not r.cancelled
   group by 1, 2, 3, 4, 5;
$$;

-- The rent account a lease belongs to, for the grid's block of a lease that paid nothing.
-- Fee type: that of the lease's latest rental charge due by p_to; with none, the market
-- rental fee for its accrual period (as opening balances choose it, migration 0013).
-- Rule: the base rule in force on p_to, section > facility > fee type, no rate class (a
-- lease receipt carries none); its largest share. No rule: UNCLASSIFIED.
create or replace function ceedo_collections.lease_home_accounts(p_from date, p_to date)
returns table (lease_id uuid, account_id uuid)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with active as (
    select a.lease_id, a.facility_id, a.section_id
      from ceedo_collections.leases_active_between(p_from, p_to) a
  ),
  fee as (
    select a.*, coalesce(
      (select ch.fee_type_id
         from ceedo_collections.charges ch
        where ch.lease_id = a.lease_id and ch.charge_type = 'rental' and ch.due_date <= p_to
        order by ch.due_date desc, ch.id
        limit 1),
      (select ft.id
         from ceedo_collections.leases l
         join ceedo_collections.fee_types ft
           on ft.code = case l.accrual_period when 'daily' then 'MKT_DAILY'
                                              when 'weekly' then 'MKT_WEEKLY'
                                              else 'MKT_MONTHLY' end
        where l.id = a.lease_id)
    ) as fee_type_id
      from active a
  )
  select f.lease_id, coalesce(
    (select sh.account_id
       from ceedo_collections.account_rules r
       join ceedo_collections.account_rule_shares sh on sh.rule_id = r.id
      where r.fee_type_id = f.fee_type_id
        and r.portion = 'base'
        and r.rate_class is null
        and (r.facility_id is null or r.facility_id = f.facility_id)
        and (r.section_id is null or r.section_id = f.section_id)
        and p_to >= r.effective_from
        and (r.effective_to is null or p_to <= r.effective_to)
      order by (r.section_id is not null) desc, (r.facility_id is not null) desc,
               sh.share_bps desc, sh.account_id
      limit 1),
    (select id from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED')
  )
    from fee f;
$$;

revoke execute on function ceedo_collections.monthly_account_totals(date, date) from public;
revoke execute on function ceedo_collections.tenant_payment_portions(date, date) from public;
revoke execute on function ceedo_collections.lease_home_accounts(date, date) from public;
grant execute on function ceedo_collections.monthly_account_totals(date, date) to authenticated;
grant execute on function ceedo_collections.tenant_payment_portions(date, date) to authenticated;
grant execute on function ceedo_collections.lease_home_accounts(date, date) to authenticated;
