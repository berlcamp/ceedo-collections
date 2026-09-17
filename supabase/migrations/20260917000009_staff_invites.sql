-- Staff are invited by email before they have ever signed in.
--
-- app_users.id references auth.users(id), and that row does not exist until the person
-- completes Google sign-in — but the access gate refuses anyone without an app_users row.
-- An invite breaks that circle: an administrator records the intended staff member here,
-- and the trigger below converts it into a real app_users row the moment they first sign in.
--
-- `id` is a surrogate uuid primary key, not `email` itself: the generic admin resource
-- engine's save action (apps/web/lib/admin/actions.ts, untouched by this migration) always
-- does `.insert(...).select("id").single()` to read back the new row's id, matching every
-- other admin-writable table in this schema.
--
-- A leading/trailing-whitespace email would insert successfully but never match
-- `new.email` from a real sign-in (GoTrue does not send untrimmed addresses), leaving a
-- silently dead invite — so it is rejected at insert time instead.
create table ceedo_collections.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = btrim(email)),
  employee_no text not null unique,
  full_name   text not null,
  role        ceedo_collections.app_role not null,
  invited_by  uuid references ceedo_collections.app_users (id),
  invited_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

-- `email` is matched case-insensitively (see claim_staff_invite below), so uniqueness must
-- be too: a plain `unique` on `email` still lets 'a@x.com' and 'A@x.com' coexist, and the
-- trigger would then pick whichever row happens to match first — an arbitrary, silent
-- choice of which role gets granted. A unique index on lower(email) makes that a rejected
-- insert instead.
create unique index staff_invites_email_lower_key on ceedo_collections.staff_invites (lower(email));

-- apply_master_data_policies() also attaches the standard grants and the row-version
-- trigger, which this table needs like every other master-data table — call it first, then
-- immediately replace the read policy it installs (see below).
select ceedo_collections.apply_master_data_policies('staff_invites');

-- A pending invite is a claimable grant, not ordinary master data: anyone who can read one
-- learns an address that, until claimed, confers the role it names. The standard
-- apply_master_data_policies() read policy grants SELECT to every registered staff member
-- (correct for facilities, rates, booklets, ...) — that is exactly what let a collector
-- read a pending admin invite and self-register into it. Admins only.
drop policy staff_invites_read on ceedo_collections.staff_invites;

create policy staff_invites_read on ceedo_collections.staff_invites
  for select to authenticated
  using (ceedo_collections.is_admin());

-- Fires on the auth schema, so it must be security definer with a pinned search_path:
-- the signing-in user has no privileges in ceedo_collections at this moment.
create or replace function ceedo_collections.claim_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  invite ceedo_collections.staff_invites;
begin
  -- Only a Google identity may claim an invite.
  --
  -- Do NOT read this as "signup is disabled anyway". It is not: supabase/config.toml has
  -- [auth] enable_signup = true, deliberately. That setting maps to GOTRUE_DISABLE_SIGNUP,
  -- which GoTrue enforces provider-agnostically — turning it off also refuses Google
  -- account creation, which is every staff member's first sign-in, so onboarding stops
  -- entirely. tests/db/auth-signup-enabled.test.ts exists to keep it on.
  --
  -- Two layers close the escalation instead, and each one kills the chain on its own:
  --   1. staff_invites reads are admin-only (the read policy replaced above), so an
  --      attacker cannot learn which address carries which pending role.
  --   2. this provider gate: even a known invited address, signed up for with the anon key
  --      via email/password, is not a Google identity and claims nothing.
  -- In production the email provider is disabled in the Supabase dashboard, which removes
  -- the email-signup vector without touching OAuth — but that is an operational setting,
  -- not something this migration can assert, so the gate below does not depend on it.
  --
  -- Confirmed by inspection (local Supabase, GoTrue via the admin API) that
  -- raw_app_meta_data is a jsonb column shaped {"provider": <name>, "providers": [...]}
  -- for every provider — verified directly against a password-provider row, whose
  -- raw_app_meta_data was exactly {"provider": "email", "providers": ["email"]} — so the
  -- same ->> 'provider' lookup is expected to read "google" for a real Google sign-in.
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    return new;
  end if;

  select * into invite
  from ceedo_collections.staff_invites
  where lower(email) = lower(new.email);

  if not found then
    return new;
  end if;

  -- `do nothing` here was the only way an administrator could act on an existing staff
  -- member's role, and it did nothing: re-inviting a collector as admin consumed the
  -- invite (it is deleted unconditionally below), changed no row, and raised no error.
  -- An invite is an administrator's statement of what this person's access should be, so
  -- an existing row is brought into line with it.
  --
  -- `status` is deliberately absent from the update. Suspension is a deliberate act —
  -- typically over a cash irregularity — and a re-invite must never be a way to undo it,
  -- accidentally or otherwise. Reactivating someone stays a separate, explicit decision.
  insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
  values (new.id, invite.employee_no, invite.full_name, invite.role, 'active')
  on conflict (id) do update
    set employee_no = excluded.employee_no,
        full_name   = excluded.full_name,
        role        = excluded.role;

  delete from ceedo_collections.staff_invites where email = invite.email;
  return new;
exception
  when others then
    -- Never abort an auth.users insert: this table is shared with other applications on
    -- this Supabase project, and a bad invite (e.g. a duplicate employee_no colliding with
    -- an existing app_users row) must not stop anyone signing in. The invite is left in
    -- place for an administrator to correct; the person simply sees /no-access.
    return new;
end;
$$;

-- Fires on INSERT and on the metadata UPDATE because GoTrue populates raw_app_meta_data in
-- a separate statement from the row insert for at least some flows. Checking only on INSERT
-- would silently refuse every legitimate sign-in while still admitting nothing — the worst
-- possible outcome for a security check. Claiming is idempotent, so firing twice is safe.
create trigger on_auth_user_created_claim_invite
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function ceedo_collections.claim_staff_invite();
