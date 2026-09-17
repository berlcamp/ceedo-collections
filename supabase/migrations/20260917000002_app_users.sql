create type ceedo_collections.app_role as enum
  ('collector', 'supervisor', 'accounting', 'admin');

create type ceedo_collections.user_status as enum ('active', 'suspended');

create table ceedo_collections.app_users (
  id          uuid primary key references auth.users (id) on delete restrict,
  employee_no text not null unique,
  full_name   text not null,
  role        ceedo_collections.app_role not null,
  pin_hash    text,
  status      ceedo_collections.user_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create index app_users_role_idx on ceedo_collections.app_users (role) where status = 'active';

create trigger app_users_row_version
  before insert or update on ceedo_collections.app_users
  for each row execute function ceedo_collections.bump_row_version();

create trigger app_users_updated_at
  before update on ceedo_collections.app_users
  for each row execute function ceedo_collections.touch_updated_at();

-- THE GATE. Every policy in this schema routes through here. Note it never asks
-- whether the caller is authenticated — auth.users is shared with unrelated systems
-- on this Supabase project, so being signed in proves nothing about access here.
--
-- security definer because the function reads app_users while app_users' own policies
-- are being evaluated.
--
-- Depends on app_users NOT having FORCE ROW LEVEL SECURITY: this function is owned by the
-- table's owner and so bypasses RLS when reading it. Enabling force RLS here would make
-- the policies recurse through this function infinitely.
create or replace function ceedo_collections.active_role()
returns ceedo_collections.app_role
language sql
stable
security definer
set search_path = ceedo_collections, pg_temp
as $$
  select role
  from ceedo_collections.app_users
  where id = auth.uid() and status = 'active';
$$;

create or replace function ceedo_collections.has_role(variadic roles ceedo_collections.app_role[])
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select ceedo_collections.active_role() = any(roles);
$$;

create or replace function ceedo_collections.is_admin()
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select ceedo_collections.active_role() = 'admin';
$$;

alter table ceedo_collections.app_users enable row level security;

create policy app_users_read_self on ceedo_collections.app_users
  for select to authenticated
  using (id = auth.uid() and status = 'active');

create policy app_users_read_all on ceedo_collections.app_users
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

create policy app_users_admin_write on ceedo_collections.app_users
  for all to authenticated
  using (ceedo_collections.is_admin())
  with check (ceedo_collections.is_admin());

-- pin_hash is deliberately absent. PIN verification happens server-side in a Phase 3
-- Edge Function; no web client, at any role, has a reason to read the hash itself.
--
-- The revoke below is defensive, not decorative: with migration 0001 no longer granting
-- a default table-level SELECT, this table starts with none anyway, but making the
-- column grant the only SELECT path holds even if something upstream changes.
revoke select on ceedo_collections.app_users from authenticated;
grant select (id, employee_no, full_name, role, status, created_at, updated_at, row_version)
  on ceedo_collections.app_users to authenticated;
grant insert, update, delete on ceedo_collections.app_users to authenticated;

revoke execute on function ceedo_collections.active_role() from public;
revoke execute on function ceedo_collections.has_role(variadic ceedo_collections.app_role[]) from public;
revoke execute on function ceedo_collections.is_admin() from public;

grant execute on function ceedo_collections.active_role() to authenticated;
grant execute on function ceedo_collections.has_role(variadic ceedo_collections.app_role[]) to authenticated;
grant execute on function ceedo_collections.is_admin() to authenticated;

-- Nothing in this system is served to anonymous callers: the web app authenticates via
-- Google and the collector app goes through Edge Functions. Task 3's default-privileges
-- grant would otherwise make every future table (including the Phase 2 ledger) readable
-- by anon as soon as one policy omits an explicit role list.
alter default privileges in schema ceedo_collections revoke select on tables from anon;
revoke select on all tables in schema ceedo_collections from anon;
revoke usage on schema ceedo_collections from anon;
