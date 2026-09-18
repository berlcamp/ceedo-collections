-- Fix: the collections-balance constraint trigger cannot run for the role that actually
-- fires it.
--
-- `collections_balance` (migration 20260918000017) is `deferrable initially deferred`, so
-- it runs at COMMIT rather than immediately after the INSERT it guards. `sync_push()`
-- (migration 20260918000035) is `security definer`, owned by `postgres`, so its own INSERT
-- into `collections` runs fine -- but a SECURITY DEFINER function's role elevation lasts
-- only for the duration of that function's execution. By the time a DEFERRED trigger
-- actually fires, at COMMIT, `sync_push()` has already returned and the session's role has
-- reverted to whatever called it -- for every real caller, `ceedo_app`, reached via
-- `authenticator` (migration 0026). `assert_collection_balances()` (the trigger function)
-- is plain `security invoker` and reads straight from `ceedo_collections.collections`,
-- `collection_allocations` and `collection_lines` -- tables `ceedo_app` holds no privilege
-- on by design (sync-privileges.test.ts: "holds no privilege on any table or view in the
-- schema"). Confirmed directly with a minimal reproduction (deferred constraint trigger +
-- SECURITY DEFINER wrapper insert, same shape as sync_push/collections):
--
--   as postgres (what all 642 SQL tests connect as):                 commits cleanly
--   as ceedo_app, reached the way every real device does:
--     ERROR:  permission denied for table collections
--     CONTEXT: SQL statement "select gross_amount from ceedo_collections.collections
--               where id = new.id"
--     PL/pgSQL function assert_collection_balances() line 6 at SQL statement
--
-- All 642 existing tests connect straight to Postgres as `postgres` (see
-- tests/helpers/supabase.ts, POSTGRES_URL) and call sync_push() directly, which never
-- exercises a COMMIT under `ceedo_app` -- the harness's implicit COMMIT (or lack of one,
-- inside a still-open transaction) happens as `postgres`. Nothing before Task 13's HTTP
-- suite ever posted a real collection through the deployed sync-push Edge Function, which
-- is the one path that authenticates as `ceedo_app` and genuinely commits.
--
-- The fix: make the trigger function `security definer` too, exactly like sync_push and
-- post_collection already are. A SECURITY DEFINER function's privilege elevation is
-- resolved at the time IT runs, not at the time its caller was invoked, so a deferred
-- trigger still runs with the definer's (postgres's) privileges no matter how much later
-- than the original statement it fires. Confirmed with the same reproduction: identical
-- setup, only this one function made SECURITY DEFINER, commits cleanly as `ceedo_app`.
--
-- `create or replace` here, exactly as migration 0037 did for sync_pull, so migration
-- 0017's applied history stays the record of what was originally reviewed and run; this
-- migration is the record of the fix. Diffed against 0017: adding the `security definer`
-- line is the only change -- everything else, including comments, is byte-identical.

create or replace function ceedo_collections.assert_collection_balances()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_gross numeric(14,2);
  v_parts numeric(14,2);
begin
  select gross_amount into v_gross
  from ceedo_collections.collections where id = new.id;

  -- The row may have been removed by a rollback between the insert and this check.
  if not found then
    return null;
  end if;

  select coalesce((select sum(amount) from ceedo_collections.collection_allocations
                    where collection_id = new.id), 0)
       + coalesce((select sum(amount) from ceedo_collections.collection_lines
                    where collection_id = new.id), 0)
    into v_parts;

  if v_parts <> v_gross then
    raise exception
      'Collection % does not balance: allocations plus lines total %, gross_amount is %',
      new.id, v_parts, v_gross
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;
