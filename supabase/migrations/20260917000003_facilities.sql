-- Reusable policy installer. Master data reads to any registered staff member,
-- writes to admins only. Used by every master-data table in Phase 1 so the gate
-- is applied identically rather than retyped and subtly varied.
create or replace function ceedo_collections.apply_master_data_policies(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format('alter table ceedo_collections.%I enable row level security', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for select to authenticated
       using (ceedo_collections.active_role() is not null)',
    table_name || '_read', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for all to authenticated
       using (ceedo_collections.is_admin())
       with check (ceedo_collections.is_admin())',
    table_name || '_admin_write', table_name);

  execute format(
    'grant select, insert, update, delete on ceedo_collections.%I to authenticated',
    table_name);

  execute format(
    'create trigger %I before insert or update on ceedo_collections.%I
       for each row execute function ceedo_collections.bump_row_version()',
    table_name || '_row_version', table_name);
end;
$$;

create type ceedo_collections.facility_type as enum
  ('market', 'terminal', 'parking', 'slaughterhouse');

create type ceedo_collections.accrual_period as enum ('daily', 'weekly', 'monthly');

create table ceedo_collections.facilities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  type        ceedo_collections.facility_type not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

-- Only market facilities have sections and stalls. The terminal, parking areas and
-- the slaughterhouse are collection points with no tenancies.
create table ceedo_collections.sections (
  id                     uuid primary key default gen_random_uuid(),
  facility_id            uuid not null references ceedo_collections.facilities (id),
  name                   text not null,
  default_accrual_period ceedo_collections.accrual_period not null,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  row_version            bigint not null default 0,
  unique (facility_id, name)
);

create or replace function ceedo_collections.assert_market_facility()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  facility_kind ceedo_collections.facility_type;
begin
  select type into facility_kind
  from ceedo_collections.facilities where id = new.facility_id;

  if facility_kind is distinct from 'market' then
    raise exception 'Sections may only belong to a market facility, not %', facility_kind
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sections_market_only
  before insert or update on ceedo_collections.sections
  for each row execute function ceedo_collections.assert_market_facility();

-- The other half of the "only markets have sections" invariant. sections_market_only
-- stops a section being attached to a non-market facility; this stops a market facility
-- being reclassified out from under sections that already exist. An orphaned section is a
-- stall tree hanging off a terminal, which corrupts collection reports and the Phase 3
-- sync scoping that keys off facility type.
create or replace function ceedo_collections.assert_facility_keeps_sections_valid()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.type = 'market'
     and new.type is distinct from 'market'
     and exists (select 1 from ceedo_collections.sections where facility_id = old.id)
  then
    raise exception
      'Cannot change facility % from market to % while it still has sections', old.code, new.type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger facilities_keep_sections_valid
  before update on ceedo_collections.facilities
  for each row execute function ceedo_collections.assert_facility_keeps_sections_valid();

create table ceedo_collections.stalls (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references ceedo_collections.sections (id),
  stall_no    text not null,
  area_sqm    numeric(8,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (section_id, stall_no)
);

create index sections_facility_idx on ceedo_collections.sections (facility_id);
create index stalls_section_idx on ceedo_collections.stalls (section_id);

select ceedo_collections.apply_master_data_policies('facilities');
select ceedo_collections.apply_master_data_policies('sections');
select ceedo_collections.apply_master_data_policies('stalls');
