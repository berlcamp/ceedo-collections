-- Collectors no longer need a web login.
--
-- app_users.id referenced auth.users, so EVERY staff member had to exist in GoTrue, and
-- the only way in was a Google sign-in claiming an invite. That fits supervisors,
-- accounting and admins, who use the web app. It does not fit collectors: they never sign
-- in to the web; they sign in to a tablet with an employee number and a PIN (§11.5). The
-- office found it could not add a collector at all without asking them to sign in with
-- Google once, on the web, for nothing.
--
-- On a SHARED project the obvious workaround, inserting a placeholder into auth.users, is
-- the wrong one: that table belongs to every system on the project, and another system's
-- own triggers on it (profiles, welcome emails) would fire for a fake CEEDO collector.
--
-- So the foreign key is replaced by a narrower rule, enforced by trigger:
--   a supervisor, accounting or admin row MUST be an auth.users id (a real login);
--   a collector row need not be.
-- A PIN-only collector therefore cannot be promoted to a web role without a real login:
-- the same trigger refuses the role change, and the remedy is an invite.

alter table ceedo_collections.app_users drop constraint if exists app_users_id_fkey;
alter table ceedo_collections.app_users alter column id set default gen_random_uuid();

create or replace function ceedo_collections.assert_web_staff_have_login()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if new.role <> 'collector' and not exists (select 1 from auth.users where id = new.id) then
    -- check_violation, not foreign_key_violation: the web's save-result shows a 23514
    -- trigger message verbatim, but would turn a 23503 into "A referenced record does not
    -- exist", which tells the admin nothing about inviting them.
    raise exception 'A % needs a Google sign-in. Invite them from Staff invitations instead.', new.role
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger app_users_web_staff_have_login
  before insert or update of id, role on ceedo_collections.app_users
  for each row execute function ceedo_collections.assert_web_staff_have_login();

-- Adds a collector who signs in to tablets only. Admin only, like every other write to
-- app_users. The PIN is set afterwards with set_collector_pin, as for any collector.
create or replace function ceedo_collections.create_collector(
  p_employee_no text,
  p_full_name   text
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
  if length(trim(coalesce(p_employee_no, ''))) = 0 then
    raise exception 'Enter the employee number';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Enter the full name';
  end if;

  insert into ceedo_collections.app_users (employee_no, full_name, role, status)
  values (trim(p_employee_no), trim(p_full_name), 'collector', 'active')
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
