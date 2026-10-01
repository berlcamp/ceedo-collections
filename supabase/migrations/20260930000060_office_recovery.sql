-- Office recovery of receipts lost with a wiped tablet (spec 2026-09-30-office-recovery).
--
-- A NARROW EXCEPTION TO D7 ("no web payment path at all"). A receipt lives only in the
-- tablet's outbox until a sync, and clearing the app's data before that sync destroys the
-- only copy but the paper stub. An admin re-enters it here, into that collector's still-open
-- shift, and closes the shift against the cash handed over. Every receipt goes through
-- post_collection -- the booklet, serial, oldest-months-first and rate rules are the
-- tablet's own, not a second copy of them.

create table ceedo_collections.collection_recoveries (
  collection_id uuid primary key references ceedo_collections.collections (id),
  reason        text not null check (length(trim(reason)) > 0),
  recorded_by   uuid not null references ceedo_collections.app_users (id),
  recorded_at   timestamptz not null default now()
);

select ceedo_collections.attach_audit('collection_recoveries');

alter table ceedo_collections.collection_recoveries enable row level security;

create policy collection_recoveries_read on ceedo_collections.collection_recoveries
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

revoke insert, update, delete on ceedo_collections.collection_recoveries
  from anon, authenticated, service_role;
grant select on ceedo_collections.collection_recoveries to authenticated, service_role;

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.assert_recovery_admin(p_reason text)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may recover lost receipts'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Recovering receipts needs a written reason';
  end if;
end;
$$;

-- The shift a recovery goes into. A wiped tablet usually left its shift OPEN on the server
-- (the opening synced, the close never did), and sometimes left none at all (the wipe came
-- before the shift's first sync). A CLOSED SHIFT IS NEVER REOPENED: if none is open, a new
-- one is created even when the collector closed another that day -- the lost shift may be
-- the day's second.
create or replace function ceedo_collections.recovery_shift(
  p_collector_id  uuid,
  p_device_id     uuid,
  p_business_date date,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_open         ceedo_collections.shifts;
  v_id           uuid;
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
  v_other_name   text;
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);

  if not exists (select 1 from ceedo_collections.devices where id = p_device_id and active) then
    raise exception 'That tablet is not an active device';
  end if;
  if not exists (select 1 from ceedo_collections.app_users
                  where id = p_collector_id and role = 'collector') then
    raise exception 'That person is not a collector';
  end if;
  if p_business_date is null then
    raise exception 'The shift needs a business date';
  end if;

  select * into v_open from ceedo_collections.shifts
   where device_id = p_device_id and status = 'open'
   for update;
  if found then
    if v_open.collector_id = p_collector_id and v_open.business_date = p_business_date then
      return v_open.id;
    end if;
    -- Final-review Task 4 (spec §3.2 "names it"): an admin picking collector/device/date
    -- from the Step 1 pickers has no other way to tell whose shift is blocking theirs.
    select full_name into v_other_name
      from ceedo_collections.app_users where id = v_open.collector_id;
    raise exception 'That tablet already has an open shift from % for %. Recover and close that one first.',
      to_char(v_open.business_date, 'Mon DD, YYYY'), coalesce(v_other_name, 'another collector');
  end if;

  v_id := gen_random_uuid();
  insert into ceedo_collections.shifts
    (id, collector_id, device_id, business_date, opened_at, status)
  values
    (v_id, p_collector_id, p_device_id, p_business_date,
     p_business_date::timestamp at time zone 'Asia/Manila', 'open');

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'recovery_shift', 'shifts', v_id, null,
          jsonb_build_object('reason', trim(p_reason), 'collector_id', p_collector_id,
                             'device_id', p_device_id, 'business_date', p_business_date));
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.assert_recovery_admin(text) from public;
revoke execute on function ceedo_collections.recovery_shift(uuid, uuid, date, text) from public;
grant execute on function ceedo_collections.recovery_shift(uuid, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------

-- attach_audit()'s generic trigger (migration 0010) reads a row's identity from an `id`
-- column: every other audited table carries one, even alongside a unique FK to the thing
-- it is about (collection_cancellations, collection_reinstatements). collection_recoveries
-- does not -- its primary key IS collection_id, by design (a receipt is office-encoded at
-- most once) -- so the generic trigger finds no `id` key and logs every row here with
-- entity_id null. A dedicated trigger records the collection's own id instead, which is
-- what an operator searching the audit log for a receipt actually asks for.
drop trigger collection_recoveries_audit on ceedo_collections.collection_recoveries;

create or replace function ceedo_collections.write_collection_recovery_audit()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
  v_row_id  uuid := case tg_op when 'DELETE' then old.collection_id else new.collection_id end;
begin
  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (
    auth.uid(), v_pg_role, lower(tg_op), 'collection_recoveries', v_row_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return case tg_op when 'DELETE' then old else new end;
exception
  -- Same rule as write_audit(): a secondary, observational effect must never abort the
  -- recovery it is attached to.
  when others then
    raise warning 'write_collection_recovery_audit failed for % on collection_recoveries: %',
      tg_op, sqlerrm;
    return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger collection_recoveries_audit
  after insert or update or delete on ceedo_collections.collection_recoveries
  for each row execute function ceedo_collections.write_collection_recovery_audit();

-- A trigger function is invoked by the trigger, never called directly, so (same as
-- write_audit() in migration 0010) it needs no grant -- only the default PUBLIC execute
-- revoked, so it is not a function any role could reach, e.g. ceedo_app via its PUBLIC
-- membership (invariant 26, tests/db/sync-privileges.test.ts).
revoke execute on function ceedo_collections.write_collection_recovery_audit() from public;

-- ---------------------------------------------------------------------------------------

-- post_collection's reason codes, as sentences for the admin holding the stub.
create or replace function ceedo_collections.recovery_refusal(p_result jsonb)
returns text
language sql
immutable
set search_path = ceedo_collections, pg_temp
as $$
  select case p_result ->> 'reason'
    when 'booklet_not_assigned'  then 'That booklet was not held by this collector on that day'
    when 'or_out_of_range'       then 'That serial is outside the booklet''s range'
    when 'or_already_used'       then 'That serial has already been used (it may have synced before the tablet was wiped)'
    when 'or_spoiled'            then 'That serial was recorded as spoiled'
    when 'no_parts'              then 'Tick at least one month, or add a fee line'
    when 'lease_not_found'       then 'No such lease'
    when 'allocation_not_prefix' then 'The months ticked are not the oldest unpaid ones. Enter the receipt that paid the earlier month first'
    when 'rate_not_found'        then 'No rate is in effect for that fee on that date'
    when 'stale_allocations'     then 'The unpaid months changed while this was saving. Try again'
    else 'The receipt was refused (' || coalesce(p_result ->> 'reason', p_result ->> 'status') || ')'
  end;
$$;

create or replace function ceedo_collections.recover_collection(
  p_shift_id   uuid,
  p_receipt    jsonb,
  p_stub_total numeric,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift  ceedo_collections.shifts;
  v_result jsonb;
  v_id     uuid := gen_random_uuid();
  v_gross  numeric(14,2);
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  -- A closed shift's system_total and variance are frozen (close_shift), and a shortage may
  -- already be settled against them. A receipt added now would be counted by nothing.
  if v_shift.status <> 'open' then
    raise exception 'That shift is already closed. Its totals are frozen; a receipt cannot be added to it';
  end if;
  if ((p_receipt ->> 'collected_at')::timestamptz at time zone 'Asia/Manila')::date
     is distinct from v_shift.business_date then
    raise exception 'The receipt must be dated %, the shift''s day',
      to_char(v_shift.business_date, 'Mon DD, YYYY');
  end if;

  -- Which receipt, which collector, which tablet, which shift are facts of the recovery,
  -- not claims on the stub: applied AFTER the admin's input so none of them can be
  -- overridden. The same rule resolve_exception_corrected applies.
  v_result := ceedo_collections.post_collection(
    p_receipt || jsonb_build_object('id', v_id,
                                    'collector_id', v_shift.collector_id,
                                    'device_id', v_shift.device_id,
                                    'shift_id', v_shift.id));
  if v_result ->> 'status' <> 'accepted' then
    raise exception '%', ceedo_collections.recovery_refusal(v_result);
  end if;

  -- The stub is a cross-check, never the amount. A raise here rolls back the collection,
  -- its allocations and its lines with it.
  select gross_amount into v_gross from ceedo_collections.collections where id = v_id;
  if p_stub_total is null or p_stub_total <> v_gross then
    raise exception 'The stub says ₱%; what was ticked comes to ₱%. Check the months or quantities',
      to_char(coalesce(p_stub_total, 0), 'FM999,999,990.00'), to_char(v_gross, 'FM999,999,990.00');
  end if;

  insert into ceedo_collections.collection_recoveries (collection_id, reason, recorded_by)
  values (v_id, trim(p_reason), auth.uid());
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.recovery_refusal(jsonb) from public;
revoke execute on function ceedo_collections.recover_collection(uuid, jsonb, numeric, text) from public;
grant execute on function ceedo_collections.recover_collection(uuid, jsonb, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------

-- Closes a shift from the office. Written for recovery, and also the missing action
-- migration 0059 names ("a supervisor must close it") for any shift a tablet can no longer
-- close. The totals are the server's own, computed exactly as close_shift computes them;
-- there are no device figures to compare, so there is no `mismatch`. A short variance
-- enters the settlement flow (0058) like any other.
create or replace function ceedo_collections.office_close_shift(
  p_shift_id       uuid,
  p_declared_total numeric,
  p_reason         text
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
  perform ceedo_collections.assert_recovery_admin(p_reason);
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash that was handed over for this shift';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That shift is not open (it is %)', v_shift.status;
  end if;

  -- Same scope and exclusion as close_shift (migration 0051).
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

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'office_close_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('reason', trim(p_reason), 'declared_total', p_declared_total,
                             'system_total', v_system_total, 'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.office_close_shift(uuid, numeric, text) from public;
grant execute on function ceedo_collections.office_close_shift(uuid, numeric, text) to authenticated;
