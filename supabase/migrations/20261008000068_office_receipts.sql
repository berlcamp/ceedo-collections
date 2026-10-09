-- Office receipts (spec "Screens: /ledger/office-receipt"). The office issues ORs at the
-- counter -- including checks, which field collectors never take. The officer holding the
-- booklet is a collector-role person with no web login, so a supervisor or admin posts on
-- their behalf, into an OFFICE SHIFT in the officer's name: kind 'office', no tablet.
-- The shift closes and is deposited like any other, so remittances need no change.
--
-- Every receipt goes through post_collection: booklet, serial, oldest-months-first, rates
-- and keyed amounts are the tablet's own rules, not a copy of them.

create or replace function ceedo_collections.assert_office_poster()
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may post office receipts'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function ceedo_collections.assert_office_poster() from public;

create or replace function ceedo_collections.office_shift(
  p_collector_id  uuid,
  p_business_date date
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id      uuid;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_office_poster();
  if p_business_date is null or p_business_date > ceedo_collections.business_date() then
    raise exception 'Choose a business date that is not in the future';
  end if;
  if not exists (select 1 from ceedo_collections.app_users
                  where id = p_collector_id and role = 'collector' and status = 'active') then
    raise exception 'That person is not an active collector';
  end if;

  select id into v_id from ceedo_collections.shifts
   where collector_id = p_collector_id and business_date = p_business_date
     and kind = 'office' and status = 'open';
  if found then
    return v_id;
  end if;

  v_id := gen_random_uuid();
  insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
  values (v_id, p_collector_id, null, p_business_date, now(), 'open', 'office');

  insert into ceedo_collections.audit_log (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'office_shift', 'shifts', v_id, null,
          jsonb_build_object('collector_id', p_collector_id, 'business_date', p_business_date));
  return v_id;
exception
  -- Two supervisors opening the same officer's day at once: the loser takes the winner's.
  when unique_violation then
    select id into v_id from ceedo_collections.shifts
     where collector_id = p_collector_id and business_date = p_business_date
       and kind = 'office' and status = 'open';
    return v_id;
end;
$$;

create or replace function ceedo_collections.post_office_receipt(
  p_shift_id uuid,
  p_receipt  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift   ceedo_collections.shifts;
  v_mode    text := coalesce(nullif(p_receipt ->> 'payment_mode', ''), 'cash');
  v_payload jsonb := p_receipt;
  v_result  jsonb;
  v_id      uuid := gen_random_uuid();
begin
  perform ceedo_collections.assert_office_poster();

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found or v_shift.kind <> 'office' then
    raise exception 'No such office shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That office shift is not open (it is %); open the day again to add receipts', v_shift.status;
  end if;
  if ((p_receipt ->> 'collected_at')::timestamptz at time zone 'Asia/Manila')::date
     is distinct from v_shift.business_date then
    raise exception 'The receipt must be dated %, the shift''s day',
      to_char(v_shift.business_date, 'Mon DD, YYYY');
  end if;

  if v_mode not in ('cash', 'check') then
    raise exception 'Payment must be cash or check';
  end if;
  if v_mode = 'check' then
    if coalesce(trim(p_receipt ->> 'check_no'), '') = '' or coalesce(trim(p_receipt ->> 'bank'), '') = ''
       or coalesce(p_receipt ->> 'check_date', '') = '' then
      raise exception 'A check needs its check number, bank and check date';
    end if;
  else
    v_payload := v_payload - 'check_no' - 'bank' - 'check_date';
  end if;

  -- Identity, collector, tablet (none) and shift are facts of the office shift, applied
  -- after the caller's input so none of them can be overridden.
  v_result := ceedo_collections.post_collection(
    v_payload || jsonb_build_object('id', v_id, 'collector_id', v_shift.collector_id,
                                    'device_id', null, 'shift_id', v_shift.id,
                                    'payment_mode', v_mode));
  if v_result ->> 'status' <> 'accepted' then
    raise exception '%', ceedo_collections.recovery_refusal(v_result);
  end if;
  return v_id;
end;
$$;

create or replace function ceedo_collections.close_office_shift(
  p_shift_id       uuid,
  p_declared_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts;
  v_system_count integer;
  v_system_total numeric(14,2);
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_office_poster();
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash and checks handed over for this day';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found or v_shift.kind <> 'office' then
    raise exception 'No such office shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That office shift is not open (it is %)', v_shift.status;
  end if;

  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (select 1 from ceedo_collections.standing_cancellations cc
                      where cc.collection_id = c.id);

  update ceedo_collections.shifts
     set status = 'closed', closed_at = now(), declared_total = p_declared_total,
         system_total = v_system_total, system_count = v_system_count,
         variance = p_declared_total - v_system_total
   where id = p_shift_id;

  insert into ceedo_collections.audit_log (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'close_office_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('declared_total', p_declared_total, 'system_total', v_system_total,
                             'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.office_shift(uuid, date) from public;
revoke execute on function ceedo_collections.post_office_receipt(uuid, jsonb) from public;
revoke execute on function ceedo_collections.close_office_shift(uuid, numeric) from public;
grant execute on function ceedo_collections.office_shift(uuid, date) to authenticated;
grant execute on function ceedo_collections.post_office_receipt(uuid, jsonb) to authenticated;
grant execute on function ceedo_collections.close_office_shift(uuid, numeric) to authenticated;
