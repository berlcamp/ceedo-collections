-- Writes off part or all of a charge against an authorising ordinance (§8.4).
--
-- Admin only. The over-condonation check spans rows and so cannot be a table constraint;
-- it lives here, which is also the only way in, since no client role holds INSERT on
-- charge_condonations.
create or replace function ceedo_collections.condone_charge(
  p_charge_id     uuid,
  p_amount        numeric,
  p_authority_ref text,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_outstanding numeric(14,2);
  v_id          uuid;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may condone a charge'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Condoned amount must be positive';
  end if;

  -- SECURITY DEFINER means charge_balances is read as this function's owner, bypassing
  -- the view's security_invoker RLS. That is intended here: the admin check above is the
  -- gate, and the function must see the true outstanding figure to validate against it.
  select outstanding into v_outstanding
  from ceedo_collections.charge_balances
  where id = p_charge_id;

  if not found then
    raise exception 'No such charge: %', p_charge_id;
  end if;

  -- Condoning more than is owed drives the balance negative and makes the lease look
  -- like it is in credit, which it is not.
  if p_amount > v_outstanding then
    raise exception 'Cannot condone % against a charge with % outstanding',
      p_amount, v_outstanding
      using errcode = 'check_violation';
  end if;

  insert into ceedo_collections.charge_condonations
    (charge_id, amount, authority_ref, reason, condoned_by)
  values (p_charge_id, p_amount, p_authority_ref, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.condone_charge(uuid, numeric, text, text) from public;
grant execute on function ceedo_collections.condone_charge(uuid, numeric, text, text)
  to authenticated;
