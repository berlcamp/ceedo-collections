-- Refuse an invite whose employee number already belongs to someone else.
--
-- app_users.employee_no is unique. An invite carrying a number that is already taken can
-- never be claimed: the insert in claim_staff_invite() / claim_my_invite() fails on the
-- unique index, the trigger swallows it (0009) and the RPC's error is only logged, so the
-- invited person simply lands on /no-access with nothing to say why. Found in production
-- 2026-09-25: an admin invite was given 2211, the inviting admin's own number.
--
-- The one legitimate reuse is a re-invite of an existing member (to change their role),
-- whose own row keeps its number: that row's id is the auth account with the invited email.

create or replace function ceedo_collections.assert_invite_employee_no_free()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_holder ceedo_collections.app_users;
begin
  select a.* into v_holder
    from ceedo_collections.app_users a
   where a.employee_no = new.employee_no
     and not exists (
       select 1 from auth.users u
        where u.id = a.id and lower(u.email) = lower(new.email)
     );

  if found then
    -- check_violation: the web's save-result shows a 23514 message verbatim (see 0048).
    raise exception 'Employee number % already belongs to %.', new.employee_no, v_holder.full_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger staff_invites_employee_no_free
  before insert or update of employee_no, email on ceedo_collections.staff_invites
  for each row execute function ceedo_collections.assert_invite_employee_no_free();
