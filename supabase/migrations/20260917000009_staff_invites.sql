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
-- other admin-writable table in this schema. `email` stays `unique` and is what the claim
-- trigger and the deletion below key on.
create table ceedo_collections.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  employee_no text not null unique,
  full_name   text not null,
  role        ceedo_collections.app_role not null,
  invited_by  uuid references ceedo_collections.app_users (id),
  invited_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

select ceedo_collections.apply_master_data_policies('staff_invites');

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
  select * into invite
  from ceedo_collections.staff_invites
  where lower(email) = lower(new.email);

  if not found then
    return new;
  end if;

  insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
  values (new.id, invite.employee_no, invite.full_name, invite.role, 'active')
  on conflict (id) do nothing;

  delete from ceedo_collections.staff_invites where email = invite.email;
  return new;
end;
$$;

create trigger on_auth_user_created_claim_invite
  after insert on auth.users
  for each row execute function ceedo_collections.claim_staff_invite();
