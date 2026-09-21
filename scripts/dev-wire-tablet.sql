-- Wires a development tablet up to the point where it can be enrolled and signed into.
--
-- WHY THIS EXISTS. `supabase db reset` reseeds the whole database, and the seed creates
-- facilities, stalls, leases, booklets and devices -- but NO `device_assignments`, no
-- `collector_assignments` and no collector PINs. Without all three a tablet that enrols
-- perfectly still pulls an empty collector list and cannot be signed into, and there is no
-- web UI for the first two (they are not in `apps/web/lib/admin/registry.ts`). So every
-- reset otherwise costs a round of hand-written SQL, rediscovered each time.
--
-- This is DEVELOPMENT ONLY and is deliberately not part of `supabase/seed.sql`: it names a
-- particular tablet and puts a known PIN on a real collector, neither of which belongs in a
-- seed that a hosted environment might ever run.
--
-- Usage, from the repo root:
--
--   psql "$DB_URL" -v label="'llejo android'" -v pin="'123456'" \
--        -f scripts/dev-wire-tablet.sql
--
-- Then: issue a credential for that tablet on /devices, and scan the QR.
--
-- Idempotent. Run it after every `supabase db reset`.

\set ON_ERROR_STOP on

begin;

-- 1. The device. Created here only if the web admin has not already made it, so re-running
--    after creating it by hand is safe.
insert into ceedo_collections.devices (label, active)
select :label, true
where not exists (
  select 1 from ceedo_collections.devices where label = :label
);

-- 2. The device -> a facility. `section_id` null means the whole facility.
--
--    This is the row whose absence is invisible until sign-in: `sync_pull` scopes every
--    collector by the device's facility, so without it a clean sync returns an empty
--    `collectors` array and the tablet reports `not_assigned`.
insert into ceedo_collections.device_assignments (device_id, facility_id, active)
select d.id, f.id, true
  from ceedo_collections.devices d, ceedo_collections.facilities f
 where d.label = :label
   and f.code = 'CPM'
   and not exists (
     select 1 from ceedo_collections.device_assignments da
      where da.device_id = d.id and da.facility_id = f.id);

-- Re-activates a previously deactivated assignment, and ONLY then. The guard is not
-- cosmetic: a write here fires `bump_assignment_epoch`, and a bumped epoch makes the tablet
-- throw away its cached world and re-pull from cursor 0 (D7). An "idempotent" script that
-- silently costs a full re-sync on every run is not idempotent in the way that matters.
update ceedo_collections.device_assignments da
   set active = true
  from ceedo_collections.devices d, ceedo_collections.facilities f
 where da.device_id = d.id and da.facility_id = f.id
   and d.label = :label and f.code = 'CPM'
   and da.active is distinct from true;

-- 3. A collector -> the same facility, and a PIN.
--
--    `set_collector_pin` cannot be called from here: it is SECURITY DEFINER behind an
--    is_admin() check, and `auth.uid()` is NULL on a psql connection. The hash is written
--    directly with the SAME expression that function uses -- crypt() at cost 12 -- so what
--    lands is byte-for-byte what the admin screen would have produced. Spec D3 makes cost
--    the PIN's only mitigation, so a dev shortcut at a lower cost would quietly measure
--    something the real system never does.
with chosen as (
  select a.id
    from ceedo_collections.app_users a
   where a.role = 'collector' and a.status = 'active'
   order by a.employee_no
   limit 2
)
insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
select c.id, f.id, true
  from chosen c, ceedo_collections.facilities f
 where f.code = 'CPM'
   and not exists (
     select 1 from ceedo_collections.collector_assignments ca
      where ca.collector_id = c.id and ca.facility_id = f.id);

update ceedo_collections.app_users a
   set pin_hash = extensions.crypt(:pin, extensions.gen_salt('bf', 12))
 where a.id in (
   select ca.collector_id
     from ceedo_collections.collector_assignments ca
     join ceedo_collections.facilities f on f.id = ca.facility_id
    where f.code = 'CPM' and ca.active);

commit;

-- What the tablet will see after its next sync.
select d.label as tablet,
       f.name as facility,
       d.assignment_epoch,
       (select count(*)
          from ceedo_collections.collector_assignments ca
          join ceedo_collections.app_users a on a.id = ca.collector_id
         where ca.facility_id = f.id and ca.active and a.pin_hash is not null)
         as collectors_with_a_pin
  from ceedo_collections.devices d
  join ceedo_collections.device_assignments da on da.device_id = d.id and da.active
  join ceedo_collections.facilities f on f.id = da.facility_id
 where d.label = :label;
