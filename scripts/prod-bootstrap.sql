-- CEEDO Collections: the one-time rows a hosted project needs after the first-install
-- bundle (scripts/bundle-migrations.mjs). Run it ONCE, after the bundle, as one transaction.
--
-- NOT supabase/seed.sql: that file is local sample data (a fake market, stalls, rates) and
-- must never reach production. The office enters its real markets, stalls, tenants, leases,
-- fee types and rates through the web app.
--
-- EDIT THE TWO VALUES MARKED `EDIT` BELOW. The guard refuses to run while either is still
-- its placeholder.

begin;

do $check$
begin
  if '__CUTOVER_DATE__' like '\_\_%' or '__ADMIN_EMAIL__' like '\_\_%' then
    raise exception 'Edit the cutover date and the admin email in this file first. Nothing was changed.';
  end if;
end
$check$;

-- The standard COA Official Receipt. Other accountable forms can be added on the web.
insert into ceedo_collections.form_types (code, name)
select 'OR51', 'Official Receipt (Accountable Form 51)'
where not exists (select 1 from ceedo_collections.form_types where code = 'OR51');

-- THE CUTOVER DATE -- EDIT. The first day this system bills. The nightly job raises
-- charges from this date on; anything owed before it is entered as an opening balance.
-- It is the office's decision, and changing it after billing starts is not a small thing.
insert into ceedo_collections.settings (cutover_date)
select '__CUTOVER_DATE__'::date  -- EDIT, e.g. '2026-11-01'
where not exists (select 1 from ceedo_collections.settings);

-- The first administrator -- EDIT. An invite, because app_users rows only come into being
-- when that Google account first signs in (the claim trigger turns this into the account).
insert into ceedo_collections.staff_invites (email, employee_no, full_name, role)
values ('__ADMIN_EMAIL__', 'ADMIN-001', 'System Administrator', 'admin');  -- EDIT

commit;
