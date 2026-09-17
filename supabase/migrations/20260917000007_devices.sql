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

grant execute on function ceedo_collections.can_collector_use_device(uuid, uuid)
  to authenticated, service_role;

select ceedo_collections.apply_master_data_policies('devices');
select ceedo_collections.apply_master_data_policies('device_assignments');
select ceedo_collections.apply_master_data_policies('collector_assignments');
