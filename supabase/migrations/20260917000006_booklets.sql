create type ceedo_collections.booklet_status as enum
  ('received', 'assigned', 'in_use', 'returned', 'exhausted');

create table ceedo_collections.form_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.booklets (
  id            uuid primary key default gen_random_uuid(),
  form_type_id  uuid not null references ceedo_collections.form_types (id),
  serial_prefix text not null,
  start_no      integer not null check (start_no > 0),
  end_no        integer not null,
  received_date date not null,
  -- Clerk-maintained, not authoritative: no trigger syncs this with
  -- booklet_assignments or spoiled_forms, so it can drift from reality. Reporting
  -- must derive a booklet's true state from booklet_assignments and spoiled_forms,
  -- never from this column alone.
  status        ceedo_collections.booklet_status not null default 'received',
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0,

  constraint booklets_range_ordered check (end_no >= start_no),

  -- Two booklets covering the same serial would make an OR number ambiguous,
  -- and the whole accountability chain rests on a serial identifying one receipt.
  constraint booklets_no_serial_overlap
    exclude using gist (
      form_type_id with =,
      serial_prefix with =,
      int4range(start_no, end_no, '[]') with &&
    )
);

create table ceedo_collections.booklet_assignments (
  id           uuid primary key default gen_random_uuid(),
  booklet_id   uuid not null references ceedo_collections.booklets (id),
  collector_id uuid not null references ceedo_collections.app_users (id),
  assigned_at  date not null,
  returned_at  date,
  created_at   timestamptz not null default now(),
  row_version  bigint not null default 0,

  constraint booklet_assignment_dates check (returned_at is null or returned_at >= assigned_at),

  -- A booklet is in exactly one collector's hands at a time.
  constraint booklet_one_holder
    exclude using gist (
      booklet_id with =,
      daterange(assigned_at, returned_at, '[]') with &&
    )
);

create table ceedo_collections.spoiled_forms (
  id          uuid primary key default gen_random_uuid(),
  booklet_id  uuid not null references ceedo_collections.booklets (id),
  or_no       integer not null,
  reason      text not null check (length(trim(reason)) > 0),
  recorded_by uuid not null references ceedo_collections.app_users (id),
  recorded_at timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (booklet_id, or_no)
);

create or replace function ceedo_collections.assert_assignee_is_collector()
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
    raise exception 'Booklets may only be assigned to a collector, not %', assignee_role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger booklet_assignments_collector_only
  before insert or update on ceedo_collections.booklet_assignments
  for each row execute function ceedo_collections.assert_assignee_is_collector();

create index booklet_assignments_collector_idx
  on ceedo_collections.booklet_assignments (collector_id) where returned_at is null;

-- The other half of the accountability binding. assert_assignee_is_collector stops a
-- booklet reaching a non-collector; this stops a collector being reclassified while still
-- holding one. Without it, a promoted collector keeps custody of accountable forms while
-- gaining oversight of the collections they are accountable for.
create or replace function ceedo_collections.assert_no_held_booklets_on_role_change()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.role = 'collector' and new.role is distinct from 'collector'
     and exists (
       select 1 from ceedo_collections.booklet_assignments
       where collector_id = old.id and returned_at is null
     )
  then
    raise exception
      'Cannot change % from collector to %: they still hold unreturned booklets', old.employee_no, new.role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger app_users_no_held_booklets_on_role_change
  before update on ceedo_collections.app_users
  for each row execute function ceedo_collections.assert_no_held_booklets_on_role_change();

select ceedo_collections.apply_master_data_policies('form_types');
select ceedo_collections.apply_master_data_policies('booklets');
select ceedo_collections.apply_master_data_policies('booklet_assignments');
select ceedo_collections.apply_master_data_policies('spoiled_forms');
