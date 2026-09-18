-- NULL-safety for the two role-gate helpers.
--
-- active_role() (migration 0002) is:
--
--   select role from ceedo_collections.app_users where id = auth.uid() and status = 'active';
--
-- For an `authenticated` caller signed in against this shared Supabase project but with no
-- app_users row -- exactly the population "THE GATE"'s own comment in migration 0002 says
-- to expect, since auth.users is shared with unrelated systems -- this returns SQL NULL,
-- not an app_role. has_role() and is_admin() then compute:
--
--   NULL = any(roles)   -- NULL
--   NULL = 'admin'       -- NULL
--
-- Three-valued logic makes both of those NULL, never boolean false, whenever active_role()
-- is NULL.
--
-- In a `USING`/`WITH CHECK` clause this was always safe: Postgres treats a NULL policy
-- expression identically to FALSE -- the row is excluded either way. That is the context
-- has_role()/is_admin() were introduced for, and it is why this bug passed review twice.
-- It is also the trap: the same two functions are called a second, imperative way, in
-- `if not ceedo_collections.is_admin() then raise exception ... end if;` guards inside
-- SECURITY DEFINER functions (record_opening_balance, condone_charge, cancel_collection,
-- issue_device_credential, revoke_device_credential, set_collector_pin). PL/pgSQL's IF
-- does not treat NULL as FALSE the way a policy scan does: `NOT NULL` is NULL, and
-- `IF NULL THEN ... END IF` skips the branch exactly as `IF FALSE` would -- confirmed
-- directly:
--
--   NOTICE:  IF NOT NULL -> branch SKIPPED (guard silently no-ops)
--
-- So every one of those six guards silently no-ops, not raises, for a caller with no
-- app_users row: the exact caller migration 0002 says this schema must expect. A function
-- meant to require an admin instead runs to completion for anyone merely signed in.
--
-- The fix is coalescing at the source, in the two shared helpers, rather than teaching
-- every call site to guard against NULL individually -- one place matches how the bug
-- reached six call sites through one shared assumption. `create or replace` here rather
-- than editing migration 0002 in place, so the applied-migration history for 0002 stays
-- exactly what was reviewed and run; this migration is the record of the fix.
--
-- RLS policies using these functions are unaffected by this change: coalescing NULL to
-- false changes nothing where NULL already behaved as false.

create or replace function ceedo_collections.has_role(variadic roles ceedo_collections.app_role[])
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select coalesce(ceedo_collections.active_role() = any(roles), false);
$$;

create or replace function ceedo_collections.is_admin()
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select coalesce(ceedo_collections.active_role() = 'admin', false);
$$;
