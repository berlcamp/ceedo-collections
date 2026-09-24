-- Claim a staff invite at sign-in, for an account that already existed.
--
-- claim_staff_invite() (migration 0009) runs as a trigger on auth.users INSERT, and on an
-- UPDATE of raw_app_meta_data. On a SHARED project that misses the common case: someone
-- who already has an Asenso account is invited to CEEDO, signs in with the same Google
-- account, and GoTrue inserts nothing, so the invite waits forever and they land on
-- /no-access. Found on the first production sign-in (2026-09-24).
--
-- The web app calls this whenever a signed-in user has no app_users row. It applies the
-- trigger's rules to the CALLER only:
--   - a Google identity for this account must carry the invite's email, the same provider
--     gate as the trigger, so an email/password account with a matching address claims
--     nothing (see 0009's comment on why that gate matters);
--   - role, employee_no and full_name come from the invite; status is never touched, so a
--     suspended member stays suspended.
--
-- Returns true when the caller has an app_users row afterwards.

create or replace function ceedo_collections.claim_my_invite()
returns boolean
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_invite ceedo_collections.staff_invites;
begin
  if v_uid is null then
    return false;
  end if;

  select i.* into v_invite
    from ceedo_collections.staff_invites i
   where exists (
     select 1 from auth.identities g
      where g.user_id = v_uid
        and g.provider = 'google'
        and lower(g.identity_data ->> 'email') = lower(i.email)
   )
   limit 1;

  if found then
    insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
    values (v_uid, v_invite.employee_no, v_invite.full_name, v_invite.role, 'active')
    on conflict (id) do update
      set employee_no = excluded.employee_no,
          full_name   = excluded.full_name,
          role        = excluded.role;

    delete from ceedo_collections.staff_invites where email = v_invite.email;
  end if;

  return exists (select 1 from ceedo_collections.app_users where id = v_uid);
end;
$$;

revoke execute on function ceedo_collections.claim_my_invite() from public, anon;
grant execute on function ceedo_collections.claim_my_invite() to authenticated;
