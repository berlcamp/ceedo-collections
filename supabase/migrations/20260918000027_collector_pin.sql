-- Writing app_users.pin_hash.
--
-- Migration 0002 withholds pin_hash from every web grant -- `authenticated` holds
-- update(role, status) and a column-list SELECT that omits it -- and its comment says
-- "Phase 3 writes pin_hash through an Edge Function, not as `authenticated`."
--
-- The requirement is right; the mechanism named is wrong for this caller. An admin sets a
-- PIN from the web admin screen, and parent spec §4 is explicit that the web talks to
-- Supabase directly while Edge Functions exist for the device. Routing an admin form
-- through an Edge Function inverts that split for no gain. A SECURITY DEFINER RPC -- the
-- pattern condone_charge(), cancel_collection() and record_opening_balance() already use
-- -- satisfies what 0002 actually cared about: pin_hash is never writable through a plain
-- PostgREST UPDATE and never readable by any client role.
--
-- bcrypt, not SHA-256, and this is the opposite call from migration 0026's. A 6-digit PIN
-- is ~20 bits: 10^6 candidates, exhaustible in seconds against a fast digest. Cost IS the
-- mitigation. Cost 12 puts a full sweep at roughly four days.
--
-- §11.5 specifies argon2. Postgres has no argon2 without an extension this project does
-- not install; pgcrypto's bcrypt is what is available and the substitution is recorded
-- rather than made silently.

create or replace function ceedo_collections.set_collector_pin(
  p_collector_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_role ceedo_collections.app_role;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may set a collector PIN';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'A PIN must be exactly six digits';
  end if;

  select role into v_role from ceedo_collections.app_users where id = p_collector_id;
  if not found then
    raise exception 'No such staff member';
  end if;
  if v_role <> 'collector' then
    raise exception 'Only a collector has a PIN; % is a %', p_collector_id, v_role;
  end if;

  update ceedo_collections.app_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12))
   where id = p_collector_id;
end;
$$;

revoke execute on function ceedo_collections.set_collector_pin(uuid, text) from public;
grant execute on function ceedo_collections.set_collector_pin(uuid, text) to authenticated;

-- The hole 0002's comment believed didn't need closing: migration 0001's default
-- privileges gave service_role table-level SELECT and INSERT, and 0002 itself grants
-- service_role table-level UPDATE (its own comment enumerates the columns that need
-- updating -- role correction, suspension, "the Phase 3 Edge Function writing pin_hash" --
-- but the grant it wrote has no column list, so it covers pin_hash too). Both predate this
-- migration and both were written when pin_hash's writer was assumed to be an Edge
-- Function invoked with the service key, which needed exactly this access. It no longer
-- is: set_collector_pin() above is SECURITY DEFINER and checks is_admin() itself, so
-- service_role has no remaining reason to touch the column directly, and every reason not
-- to -- a service key that can read or overwrite pin_hash makes this RPC decorative.
-- Narrowed to a column list, not just moved from table-level to table-level, on all three
-- privileges INSERT included: Postgres checks INSERT's column privilege only against
-- columns actually named in the statement's target list, and nothing that inserts into
-- this table (fixtures included) ever names pin_hash, so excluding it from the grant
-- changes nothing any caller currently does -- it just stops a service key from being able
-- to plant a plaintext or otherwise non-bcrypt value in a *new* row the way the narrowed
-- UPDATE grant already stops it from doing to an existing one.
revoke select, insert, update on ceedo_collections.app_users from service_role;
grant select (id, employee_no, full_name, role, status, created_at, updated_at, row_version)
  on ceedo_collections.app_users to service_role;
grant insert (id, employee_no, full_name, role, status, created_at, updated_at, row_version)
  on ceedo_collections.app_users to service_role;
grant update (id, employee_no, full_name, role, status, created_at, updated_at, row_version)
  on ceedo_collections.app_users to service_role;
