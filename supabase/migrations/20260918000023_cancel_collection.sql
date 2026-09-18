-- Voids a posted receipt (§11.3). Supervisor or admin.
--
-- Nothing on the collection changes -- it cannot, there is no UPDATE privilege. The
-- cancellation row is the correction, both rows stay visible, and charge_balances stops
-- counting the allocations. This is how the paper system works and what COA expects.
create or replace function ceedo_collections.cancel_collection(
  p_collection_id uuid,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may cancel a collection'
      using errcode = 'insufficient_privilege';
  end if;

  -- A written reason is mandatory on every resolution (§11.3). Enforced here as well as
  -- by the table constraint so the error names the rule rather than the constraint.
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A cancellation needs a written reason';
  end if;

  if not exists (select 1 from ceedo_collections.collections where id = p_collection_id) then
    raise exception 'No such collection: %', p_collection_id;
  end if;

  insert into ceedo_collections.collection_cancellations
    (collection_id, reason, cancelled_by)
  values (p_collection_id, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Collection % is already cancelled', p_collection_id
      using errcode = 'unique_violation';
end;
$$;

revoke execute on function ceedo_collections.cancel_collection(uuid, text) from public;
grant execute on function ceedo_collections.cancel_collection(uuid, text) to authenticated;
