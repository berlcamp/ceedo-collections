-- Device authentication, and the role the Edge Functions run as.
--
-- Parent spec §11.5 rules out OAuth for the collector app because it "needs a round trip
-- at exactly the moment a collector may have no signal". That argument does not stop at
-- OAuth: ANY credential with an expiry reintroduces the same failure one step removed, so
-- this credential is long-lived and revocation is devices.active = false.
--
-- The secret is 256 random bits, so it gets SHA-256 and not a slow KDF. A cost factor
-- defends a LOW-entropy secret against enumeration; there is nothing to enumerate here.
-- The collector PIN is the opposite case and gets bcrypt -- see migration 0027.
--
-- Also closes a PUBLIC-EXECUTE gap on 14 pre-existing Phase 1 functions that ceedo_app
-- inherited through PUBLIC; see the block at the end of this file for the list and why
-- revoking it is safe.

create extension if not exists pgcrypto with schema extensions;

create table ceedo_collections.device_credentials (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references ceedo_collections.devices (id),
  -- The digest, never the secret. The `stores no plaintext` test asserts this against the
  -- whole row rather than against this column, so adding a plaintext column later fails.
  secret_hash bytea not null,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references ceedo_collections.app_users (id),
  revoked_at  timestamptz,
  revoked_by  uuid references ceedo_collections.app_users (id),
  row_version bigint not null default 0
);

create unique index device_credentials_one_live
  on ceedo_collections.device_credentials (device_id) where revoked_at is null;

create trigger device_credentials_row_version
  before insert or update on ceedo_collections.device_credentials
  for each row execute function ceedo_collections.bump_row_version();

-- NOT apply_master_data_policies(): that grants SELECT to staff roles, and this table
-- holds a secret's digest. RLS is on and NO policy is created, so every client role reads
-- nothing regardless of privilege. The revokes below make that true twice over, because
-- migration 0001's ALTER DEFAULT PRIVILEGES already handed service_role select+insert on
-- every future table in this schema and inheriting that here would be the whole hole.
alter table ceedo_collections.device_credentials enable row level security;
revoke all on ceedo_collections.device_credentials from anon, authenticated, service_role;

-- Issue. Admin only, checked internally the way condone_charge() and
-- record_opening_balance() check theirs, because the caller arrives as `authenticated`
-- and the function is SECURITY DEFINER.
create or replace function ceedo_collections.issue_device_credential(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_secret        text;
  v_credential_id text;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may issue a device credential';
  end if;

  if not exists (select 1 from ceedo_collections.devices where id = p_device_id) then
    raise exception 'No such device';
  end if;

  -- Re-issue revokes first, in this same transaction. Two live credentials for one device
  -- would mean a tablet that was replaced still works.
  update ceedo_collections.device_credentials
     set revoked_at = now(), revoked_by = auth.uid()
   where device_id = p_device_id and revoked_at is null;

  -- 32 bytes = 256 bits. encode(...,'base64') then made URL-safe, so the secret survives a
  -- QR code, a header and a JSON body without escaping.
  v_secret := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_credential_id := translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');

  insert into ceedo_collections.device_credentials (device_id, secret_hash, issued_by)
  values (p_device_id, extensions.digest(v_secret, 'sha256'), auth.uid());

  update ceedo_collections.devices
     set credential_id = v_credential_id
   where id = p_device_id;

  -- The only moment the secret exists outside the caller's hand. There is deliberately no
  -- way to read it back; see the web screen's copy in Task 15.
  return jsonb_build_object('credential_id', v_credential_id, 'secret', v_secret);
end;
$$;

create or replace function ceedo_collections.revoke_device_credential(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may revoke a device credential';
  end if;

  update ceedo_collections.device_credentials
     set revoked_at = now(), revoked_by = auth.uid()
   where device_id = p_device_id and revoked_at is null;
end;
$$;

-- The chicken-and-egg door. An Edge Function cannot verify a credential before it holds a
-- database role, and §12.5 forbids it holding service_role. So it holds ceedo_app, which
-- can execute this and nothing else.
create or replace function ceedo_collections.authenticate_device(
  p_credential_id text,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_device_id uuid;
  v_hash      bytea;
begin
  if p_credential_id is null or p_secret is null then
    return null;
  end if;

  select d.id, dc.secret_hash
    into v_device_id, v_hash
    from ceedo_collections.devices d
    join ceedo_collections.device_credentials dc
      on dc.device_id = d.id and dc.revoked_at is null
   where d.credential_id = p_credential_id
     and d.active;

  if v_device_id is null then
    return null;
  end if;

  -- Constant-time compare. At 256 bits a timing oracle is not a realistic attack, but the
  -- habit costs one function call and the alternative invites a reviewer to wonder.
  if not extensions.digest(p_secret, 'sha256') operator(pg_catalog.=) v_hash then
    return null;
  end if;

  -- Only on success. A failed attempt must not make a stolen tablet look alive on the
  -- device list a supervisor is reading to decide whether to deactivate it.
  update ceedo_collections.devices set last_seen_at = now() where id = v_device_id;

  return v_device_id;
end;
$$;

revoke execute on function ceedo_collections.issue_device_credential(uuid) from public;
grant execute on function ceedo_collections.issue_device_credential(uuid) to authenticated;
revoke execute on function ceedo_collections.revoke_device_credential(uuid) from public;
grant execute on function ceedo_collections.revoke_device_credential(uuid) to authenticated;

revoke execute on function ceedo_collections.authenticate_device(text, text) from public;
grant execute on function ceedo_collections.authenticate_device(text, text) to ceedo_app;

-- Without this, PostgREST cannot `set role ceedo_app` and a ceedo_app JWT is inert.
-- Phase 1 created the role and deliberately left this undone; its handover names it as a
-- Phase 3 obligation. §12.5 is the reason the role exists at all: an Edge Function that
-- used service_role would bypass RLS across every unrelated schema on this shared project.
grant ceedo_app to authenticator;

-- Migrations 0001-0025 never ran EXECUTE hygiene on their trigger functions and two DDL
-- helpers, because nothing before this task ever checked what ceedo_app could reach:
-- ceedo_app existed (migration 0001) but was granted to no login role until the line
-- above, so its function privileges were never a live question. `CREATE FUNCTION` grants
-- EXECUTE to PUBLIC unless revoked, and PUBLIC membership is universal, so ceedo_app
-- (and anon, and authenticated) has held EXECUTE on every one of these since the
-- migration that created it -- confirmed against a fresh `supabase db reset`, not assumed.
--
-- Revoking it here is safe: every function below is either `returns trigger` (fired by
-- the trigger mechanism on table TRIGGER privilege, never by a role's own EXECUTE) or a
-- `security invoker` DDL helper (apply_master_data_policies, attach_audit) that only ever
-- runs as the migration-applying superuser, which privilege checks do not bind. No role
-- was ever exercising this grant; only the ACL said otherwise. Not revoking it would leave
-- the "ceedo_app holds EXECUTE on authenticate_device and nothing else" invariant this
-- task establishes false on day one.
revoke execute on function ceedo_collections.bump_row_version() from public;
revoke execute on function ceedo_collections.touch_updated_at() from public;
revoke execute on function ceedo_collections.apply_master_data_policies(text) from public;
revoke execute on function ceedo_collections.assert_market_facility() from public;
revoke execute on function ceedo_collections.assert_facility_keeps_sections_valid() from public;
revoke execute on function ceedo_collections.assert_assignee_is_collector() from public;
revoke execute on function ceedo_collections.assert_no_held_booklets_on_role_change() from public;
revoke execute on function ceedo_collections.assert_assignment_target_is_collector() from public;
revoke execute on function ceedo_collections.assert_no_active_assignments_on_role_change() from public;
revoke execute on function ceedo_collections.write_audit() from public;
revoke execute on function ceedo_collections.attach_audit(text) from public;
revoke execute on function ceedo_collections.claim_staff_invite() from public;
revoke execute on function ceedo_collections.assert_admin_remains() from public;
revoke execute on function ceedo_collections.assert_collection_balances() from public;
