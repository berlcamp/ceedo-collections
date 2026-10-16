-- Evaluate RLS role gates once per statement, not once per row.
--
-- has_role / is_admin / is_super_admin carry SET search_path, so the planner cannot
-- inline them: a bare call in a policy runs for EVERY row scanned (24s to count 197k
-- charges as a supervisor). Wrapped as (select ...), the call is an InitPlan, run once.
-- The expressions, and so the audiences, are unchanged. (Supabase lint auth_rls_initplan.)

-- 1. Policies that are nothing but one gate call: wrap the whole expression.
do $$
declare
  p    record;
  gate constant text := '^ceedo_collections\.(has_role|is_admin|is_super_admin)\(.*\)$';
  bool constant text := '\s(AND|OR)\s';
begin
  for p in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'ceedo_collections'
  loop
    if p.qual ~ gate and p.qual !~ bool then
      execute format('alter policy %I on ceedo_collections.%I using ((select %s))',
                     p.policyname, p.tablename, p.qual);
    end if;
    if p.with_check ~ gate and p.with_check !~ bool then
      execute format('alter policy %I on ceedo_collections.%I with check ((select %s))',
                     p.policyname, p.tablename, p.with_check);
    end if;
  end loop;
end;
$$;

-- 2. The two composite policies, rewritten by hand with the same logic.
alter policy app_users_read_self on ceedo_collections.app_users
  using (id = (select auth.uid()) and status = 'active');

alter policy audit_log_read on ceedo_collections.audit_log
  using (
    (select ceedo_collections.is_admin())
    or (entity <> all (array['app_users', 'staff_invites'])
        and (select ceedo_collections.has_role('supervisor', 'accounting')))
  );

-- 3. The installer for master-data tables (from 0003) creates wrapped policies from now on.
--    Body copied verbatim from 20260917000003_facilities.sql; only the two policy
--    expressions change.
create or replace function ceedo_collections.apply_master_data_policies(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format('alter table ceedo_collections.%I enable row level security', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for select to authenticated
       using ((select ceedo_collections.has_role(''supervisor'', ''accounting'', ''admin'')))',
    table_name || '_read', table_name);

  execute format(
    'create policy %I on ceedo_collections.%I for all to authenticated
       using ((select ceedo_collections.is_admin()))
       with check ((select ceedo_collections.is_admin()))',
    table_name || '_admin_write', table_name);

  execute format(
    'grant select, insert, update, delete on ceedo_collections.%I to authenticated',
    table_name);

  -- Migration 0001's default privileges give service_role SELECT and INSERT only, so that
  -- append-only tables (audit_log now, the Phase 2 ledger later) get no more by simply
  -- never asking. Master data is the opposite case: it is legitimately mutable, and both
  -- the Phase 3 Edge Functions and this suite's fixtures write it as service_role. Every
  -- table that opts into this installer opts into being editable.
  execute format(
    'grant update, delete on ceedo_collections.%I to service_role',
    table_name);

  execute format(
    'create trigger %I before insert or update on ceedo_collections.%I
       for each row execute function ceedo_collections.bump_row_version()',
    table_name || '_row_version', table_name);
end;
$$;

revoke execute on function ceedo_collections.apply_master_data_policies(text) from public;
