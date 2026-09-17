-- Tablets are shared between collectors on different days, so there is deliberately
-- NO collector_id here. Accountability is anchored to the booklet, not the device.
create table ceedo_collections.devices (
  id            uuid primary key default gen_random_uuid(),
  label         text not null unique,
  -- Opaque identifier for the long-lived credential issued at registration.
  -- The secret itself is never stored here.
  credential_id text unique,
  registered_at timestamptz,
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0
);

-- Referenced by the composite foreign keys below. A section's facility is part of its
-- identity as far as assignments are concerned.
alter table ceedo_collections.sections
  add constraint sections_id_facility_key unique (id, facility_id);

-- Determines WHAT SYNCS to the tablet. Scoping to the device rather than the
-- collector keeps the payload stable as collectors rotate through it.
create table ceedo_collections.device_assignments (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references ceedo_collections.devices (id),
  facility_id uuid not null references ceedo_collections.facilities (id),
  section_id  uuid references ceedo_collections.sections (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0,
  -- A section named here must actually belong to the facility named here. MATCH SIMPLE
  -- means a NULL section_id (facility-wide assignment) skips this check, which is the
  -- intended behaviour.
  constraint device_assignments_section_in_facility
    foreign key (section_id, facility_id)
    references ceedo_collections.sections (id, facility_id)
);

create unique index device_assignments_one_active
  on ceedo_collections.device_assignments (device_id) where active;

-- Determines WHERE A PERSON MAY COLLECT. A null section means the whole facility.
create table ceedo_collections.collector_assignments (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid not null references ceedo_collections.app_users (id),
  facility_id  uuid not null references ceedo_collections.facilities (id),
  section_id   uuid references ceedo_collections.sections (id),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  row_version  bigint not null default 0,
  -- A section named here must actually belong to the facility named here. MATCH SIMPLE
  -- means a NULL section_id (facility-wide assignment) skips this check, which is the
  -- intended behaviour.
  constraint collector_assignments_section_in_facility
    foreign key (section_id, facility_id)
    references ceedo_collections.sections (id, facility_id)
);

create index collector_assignments_collector_idx
  on ceedo_collections.collector_assignments (collector_id) where active;

-- The same pair of guards booklet_assignments carries (migration 0006), for the same
-- reason and in the same shape: one stops the wrong person being named, the other stops a
-- named person being reclassified out from under the row.
--
-- can_collector_use_device() below re-checks u.role at read time, so neither hole is
-- exploitable through that function today. Phase 3's sync scoping keys off these rows
-- directly and does not re-check, so a supervisor named in collector_assignments, or a
-- collector promoted while still assigned, becomes a real scoping fault there. An
-- invariant enforced in one reader and not in the table is not an invariant.
create or replace function ceedo_collections.assert_assignment_target_is_collector()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  assignee_role ceedo_collections.app_role;
begin
  select role into assignee_role
  from ceedo_collections.app_users where id = new.collector_id;

  if assignee_role is distinct from 'collector' then
    raise exception 'Collection areas may only be assigned to a collector, not %', assignee_role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger collector_assignments_collector_only
  before insert or update on ceedo_collections.collector_assignments
  for each row execute function ceedo_collections.assert_assignment_target_is_collector();

-- The other half. Mirrors assert_no_held_booklets_on_role_change: a collector with an
-- active area assignment must be unassigned before they can be promoted, so the change of
-- role is a deliberate act with a visible prerequisite rather than a silent orphaning.
create or replace function ceedo_collections.assert_no_active_assignments_on_role_change()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.role = 'collector' and new.role is distinct from 'collector'
     and exists (
       select 1 from ceedo_collections.collector_assignments
       where collector_id = old.id and active
     )
  then
    raise exception
      'Cannot change % from collector to %: they still hold active collection assignments',
      old.employee_no, new.role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger app_users_no_active_assignments_on_role_change
  before update on ceedo_collections.app_users
  for each row execute function ceedo_collections.assert_no_active_assignments_on_role_change();

/**
 * Whether a collector may sign in to a device: the two assignments must overlap,
 * the device must be active, and the person must actually be a collector.
 *
 * A collector assigned facility-wide (section_id null) may use any device at that
 * facility. A collector assigned to one section may only use a device scoped to
 * that same section, or to the facility as a whole.
 */
create or replace function ceedo_collections.can_collector_use_device(
  collector uuid,
  device uuid
)
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select exists (
    select 1
    from ceedo_collections.device_assignments da
    join ceedo_collections.devices d on d.id = da.device_id
    join ceedo_collections.collector_assignments ca
      on ca.facility_id = da.facility_id
    join ceedo_collections.app_users u on u.id = ca.collector_id
    where da.device_id = device
      and da.active
      and d.active
      and ca.collector_id = collector
      and ca.active
      and u.role = 'collector'
      and u.status = 'active'
      and (ca.section_id is null or da.section_id is null or ca.section_id = da.section_id)
  );
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC implicitly. Carry forward the hygiene
-- migration 0002 established on the gate functions: revoke the implicit grant, then name
-- the roles that may call it. Otherwise anon — and every future role on this shared
-- instance — can probe which collectors are cleared for which tablets.
revoke execute on function ceedo_collections.can_collector_use_device(uuid, uuid) from public;
grant execute on function ceedo_collections.can_collector_use_device(uuid, uuid)
  to authenticated, service_role;

select ceedo_collections.apply_master_data_policies('devices');
select ceedo_collections.apply_master_data_policies('device_assignments');
select ceedo_collections.apply_master_data_policies('collector_assignments');
