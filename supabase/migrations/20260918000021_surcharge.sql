-- Raises one 3% surcharge against each rental charge that has passed a calendar month
-- past due while still unpaid.
--
-- "Unpaid" means what charge_balances says it means, which includes condonations: a debt
-- written off under an amnesty ordinance must not then grow a penalty.
create or replace function ceedo_collections.run_surcharge(
  p_business_date date default null,
  p_run_id        uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_date   date;
  v_raised integer := 0;
begin
  v_date := coalesce(p_business_date, ceedo_collections.business_date());

  insert into ceedo_collections.charges (
    lease_id, fee_type_id, charge_type, parent_charge_id,
    period_start, period_end, due_date, amount, surcharge_bps, source
  )
  select
    b.lease_id, b.fee_type_id, 'surcharge', b.id,
    -- The surcharge shares its parent's period and due date, so the pair behaves as one
    -- period group in FIFO and buckets together in aging. A penalty is never owed on a
    -- different date than the rent it penalises.
    b.period_start, b.period_end, b.due_date,
    -- Integer basis points on centavos, then back to pesos. A float rate misrounds exact
    -- half-centavo results: 0.03 * 8350 is 250.49999999999997 in IEEE 754 and floors to
    -- 250 where half-up gives 251.
    floor((round(b.amount * 100) * f.surcharge_bps + 5000) / 10000) / 100,
    -- Stamped, not looked up later. A future ordinance changing the rate must not alter a
    -- receipt already issued (invariant #6).
    f.surcharge_bps,
    'accrual'
  from ceedo_collections.charge_balances b
  join ceedo_collections.fee_types f on f.id = b.fee_type_id
  where b.charge_type = 'rental'
    and f.surcharge_bps > 0
    -- Calendar-month arithmetic, not 30 days: a 31 January charge becomes delinquent on
    -- 28 February, which is what the parent spec §8.2 requires and what the office
    -- reckons. Strictly greater than, so the anniversary day itself is not yet late.
    and v_date > (b.due_date + interval '1 month')::date
    and not b.is_settled
    and not exists (
      select 1 from ceedo_collections.charges s
      where s.parent_charge_id = b.id and s.charge_type = 'surcharge'
    )
  on conflict do nothing;

  get diagnostics v_raised = row_count;

  if p_run_id is not null then
    update ceedo_collections.accrual_runs
       set surcharges_raised = surcharges_raised + v_raised
     where id = p_run_id;
  end if;

  return v_raised;
end;
$$;

revoke execute on function ceedo_collections.run_surcharge(date, uuid) from public;
grant execute on function ceedo_collections.run_surcharge(date, uuid) to service_role;
