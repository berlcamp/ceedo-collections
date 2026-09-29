-- Employee number becomes optional.
--
-- The web app no longer asks for it when inviting staff or adding a collector. Nothing
-- keys on it: the tablet signs a collector in by picking their name and entering a PIN,
-- and already treats employee_no as nullable. The unique constraints stay -- Postgres
-- admits any number of nulls under them, and a number that IS recorded must still be
-- unique.

alter table ceedo_collections.app_users alter column employee_no drop not null;
alter table ceedo_collections.staff_invites alter column employee_no drop not null;

-- Adding a collector no longer requires a number. The parameter keeps its position so
-- existing callers still resolve; it now defaults to null.
drop function ceedo_collections.create_collector(text, text);

create function ceedo_collections.create_collector(
  p_full_name   text,
  p_employee_no text default null
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id uuid;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may add a collector'
      using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Enter the full name';
  end if;

  insert into ceedo_collections.app_users (employee_no, full_name, role, status)
  values (nullif(trim(p_employee_no), ''), trim(p_full_name), 'collector', 'active')
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Employee number % is already in use', trim(p_employee_no)
      using errcode = 'unique_violation';
end;
$$;

revoke execute on function ceedo_collections.create_collector(text, text) from public, anon;
grant execute on function ceedo_collections.create_collector(text, text) to authenticated;

-- Claiming an invite. Unchanged from 0009 except that an invite without a number keeps
-- the member's existing one: a re-invite to change someone's role must not erase it.
create or replace function ceedo_collections.claim_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  invite ceedo_collections.staff_invites;
begin
  -- Only a Google identity may claim an invite. See 0009 for why this gate must stay.
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    return new;
  end if;

  select * into invite
  from ceedo_collections.staff_invites
  where lower(email) = lower(new.email);

  if not found then
    return new;
  end if;

  -- `status` is deliberately absent from the update: a re-invite must never undo a
  -- suspension (see 0009).
  insert into ceedo_collections.app_users (id, employee_no, full_name, role, status)
  values (new.id, invite.employee_no, invite.full_name, invite.role, 'active')
  on conflict (id) do update
    set employee_no = coalesce(excluded.employee_no, app_users.employee_no),
        full_name   = excluded.full_name,
        role        = excluded.role;

  delete from ceedo_collections.staff_invites where email = invite.email;
  return new;
exception
  when others then
    -- Never abort an auth.users insert: this table is shared with other applications on
    -- this Supabase project. The invite is left in place for an administrator to correct.
    return new;
end;
$$;

-- Same change for the sign-in RPC from 0047.
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
      set employee_no = coalesce(excluded.employee_no, app_users.employee_no),
          full_name   = excluded.full_name,
          role        = excluded.role;

    delete from ceedo_collections.staff_invites where email = v_invite.email;
  end if;

  return exists (select 1 from ceedo_collections.app_users where id = v_uid);
end;
$$;

-- The refusals below named the person by employee number, which may now be null. They
-- name them by full name instead.
create or replace function ceedo_collections.assert_admin_remains()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  losing_admin boolean;
begin
  losing_admin := case tg_op
    when 'DELETE' then true
    else new.role is distinct from 'admin' or new.status is distinct from 'active'
  end;

  if old.role = 'admin' and old.status = 'active' and losing_admin
     and not exists (
       select 1 from ceedo_collections.app_users
       where role = 'admin' and status = 'active' and id <> old.id
     )
  then
    raise exception
      'Cannot remove the last active administrator (%): appoint another first', old.full_name
      using errcode = '23514';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create or replace function ceedo_collections.assert_no_held_booklets_on_role_change()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.role = 'collector' and new.role is distinct from 'collector'
     and exists (
       select 1 from ceedo_collections.booklet_assignments
       where collector_id = old.id and returned_at is null
     )
  then
    raise exception
      'Cannot change % from collector to %: they still hold unreturned booklets', old.full_name, new.role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function ceedo_collections.assert_no_active_assignments_on_role_change()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.role = 'collector' and new.role is distinct from 'collector'
     and exists (
       select 1 from ceedo_collections.collector_assignments
       where collector_id = old.id and active
     )
  then
    raise exception
      'Cannot change % from collector to %: they still hold active collection assignments',
      old.full_name, new.role
      using errcode = '23514';
  end if;
  return new;
end;
$$;
