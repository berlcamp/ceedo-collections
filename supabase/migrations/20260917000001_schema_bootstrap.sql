-- Schema, shared row-version sequence, common triggers, restricted app role.
-- Global constraint: every function sets search_path explicitly. Unqualified names
-- on a multi-schema instance are a search-path injection vector.

create schema if not exists ceedo_collections;

create extension if not exists btree_gist with schema extensions;

-- The sync cursor. A single sequence across every synced table, never a timestamp:
-- timestamps break on clock skew and same-millisecond writes, and the failure mode
-- is a silently skipped row.
create sequence if not exists ceedo_collections.row_version_seq as bigint;

create or replace function ceedo_collections.bump_row_version()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  new.row_version := nextval('ceedo_collections.row_version_seq');
  return new;
end;
$$;

create or replace function ceedo_collections.touch_updated_at()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Restricted role for Phase 3 Edge Functions. service_role bypasses RLS across
-- EVERY schema on this shared instance, so a bug in the sync function could reach
-- another project's tables. This role can only see ours.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ceedo_app') then
    create role ceedo_app nologin;
  end if;
end;
$$;

grant usage on schema ceedo_collections to ceedo_app, anon, authenticated, service_role;

-- No default SELECT for anon or authenticated. This schema's security model is explicit
-- denial, and an implicit table-level grant silently subsumes any narrower column-level
-- grant written later — which is exactly how pin_hash stayed readable. Every table grants
-- what it means to grant, explicitly. apply_master_data_policies() does this for master
-- data; app_users does it by hand.
alter default privileges in schema ceedo_collections
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema ceedo_collections
  grant usage, select on sequences to anon, authenticated, service_role, ceedo_app;

-- ALTER DEFAULT PRIVILEGES above only governs sequences created after this point.
-- row_version_seq already exists (created earlier in this migration), so grant on
-- it explicitly, mirroring the default-privileges intent above.
grant usage, select on ceedo_collections.row_version_seq
  to anon, authenticated, service_role, ceedo_app;

-- Exposed so tests and Phase 3 sync can read the cursor without direct sequence access.
create or replace function ceedo_collections.next_row_version()
returns bigint
language sql
volatile
set search_path = ceedo_collections, pg_temp
as $$
  select nextval('ceedo_collections.row_version_seq');
$$;

grant execute on function ceedo_collections.next_row_version() to service_role;
