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
  v_open    ceedo_collections.shifts;
  v_id      uuid;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
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
    raise exception 'That tablet already has an open shift from % for another collector or day. Recover and close that one first.',
      to_char(v_open.business_date, 'Mon DD, YYYY');
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
