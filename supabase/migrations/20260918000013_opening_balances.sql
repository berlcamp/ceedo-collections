-- Records reconciled paper arrears as a single charge per lease. This is the only path by
-- which a charge dated before the cutover can exist, and it is admin-only.

-- Resolves the accruing market fee type for a lease's own accrual period. The seed defines
-- MKT_DAILY, MKT_WEEKLY and MKT_MONTHLY (all accrues = true) rather than one generic
-- 'market_rental' code, so both this function and Task 5's accrual job need a mapping from
-- accrual_period to the matching fee_types row -- this is that mapping, kept in one place
-- rather than duplicated. Raises rather than returning null so a missing seed row fails
-- loudly at the call site instead of surfacing later as a foreign-key violation.
create or replace function ceedo_collections.rental_fee_type(
  p_accrual_period ceedo_collections.accrual_period
)
returns uuid
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_code text;
  v_id   uuid;
begin
  v_code := case p_accrual_period
    when 'daily'   then 'MKT_DAILY'
    when 'weekly'  then 'MKT_WEEKLY'
    when 'monthly' then 'MKT_MONTHLY'
  end;

  select id into v_id
  from ceedo_collections.fee_types
  where code = v_code and accrues;

  if v_id is null then
    raise exception 'No accruing fee type with code % for accrual period %; seed it first',
      v_code, p_accrual_period;
  end if;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.rental_fee_type(ceedo_collections.accrual_period) from public;
grant execute on function ceedo_collections.rental_fee_type(ceedo_collections.accrual_period)
  to authenticated, service_role;

-- SECURITY DEFINER because no client role holds INSERT on charges (migration 0011). The
-- function is the only way in, and it validates before it writes.
create or replace function ceedo_collections.record_opening_balance(
  p_lease_id            uuid,
  p_amount              numeric,
  p_oldest_unpaid_date  date,
  p_authority_ref       text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_cutover     date;
  v_fee_type_id uuid;
  v_lease       ceedo_collections.leases%rowtype;
  v_charge_id   uuid;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may record an opening balance'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Opening balance must be a positive amount';
  end if;

  if p_authority_ref is null or length(trim(p_authority_ref)) = 0 then
    raise exception 'Opening balance needs an authority reference naming the reconciled paper record';
  end if;

  v_cutover := ceedo_collections.cutover_date();

  select * into v_lease from ceedo_collections.leases where id = p_lease_id;
  if not found then
    raise exception 'No such lease: %', p_lease_id;
  end if;

  -- The whole point of the opening balance is that it predates the cutover. One dated on
  -- or after it would overlap the periods run_accrual() is about to raise, and the tenant
  -- would be billed twice for the same days.
  if p_oldest_unpaid_date >= v_cutover then
    raise exception
      'Opening balance oldest-unpaid date (%) must precede the cutover date (%). Periods from the cutover onward are raised by the accrual job.',
      p_oldest_unpaid_date, v_cutover;
  end if;

  -- Market rental, resolved from the lease's own accrual period (Ruling 1 -- there is no
  -- single generic 'market_rental' code; MKT_DAILY / MKT_WEEKLY / MKT_MONTHLY are the
  -- accruing streams. Parking, terminal and slaughterhouse are cash-only and carry no
  -- receivable to bring forward, so a lease on one of those has no accrual_period mapping
  -- and rental_fee_type() raises for it.
  v_fee_type_id := ceedo_collections.rental_fee_type(v_lease.accrual_period);

  insert into ceedo_collections.charges (
    lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
    amount, surcharge_bps, source, created_by
  )
  values (
    p_lease_id, v_fee_type_id, 'opening_balance',
    p_oldest_unpaid_date,
    v_cutover - 1,
    -- due_date is the REAL oldest unpaid date, not the cutover. This is what makes aging
    -- honest: two-year-old debt buckets as two years old, and FIFO sorts it first.
    p_oldest_unpaid_date,
    p_amount, 0, 'opening_balance', auth.uid()
  )
  returning id into v_charge_id;

  return v_charge_id;
exception
  when unique_violation then
    raise exception 'Lease % already has an opening balance', p_lease_id
      using errcode = 'unique_violation';
end;
$$;

revoke execute on function ceedo_collections.record_opening_balance(uuid, numeric, date, text) from public;
grant execute on function ceedo_collections.record_opening_balance(uuid, numeric, date, text)
  to authenticated;
