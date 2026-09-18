-- Shifts. Parent spec §5.5 and §6.5.
--
-- Deliberately OUTSIDE the append-only regime: a shift has a lifecycle -- it opens, it
-- closes, it is later remitted -- unlike anything in §5.4. Phase 2 drew the same
-- distinction for `settings` and `accrual_runs` and stated it rather than leaving it to be
-- inferred; this restates it so a future reader does not mistake this for a ledger table.

create table ceedo_collections.shifts (
  -- NO DEFAULT, for the same reason collections.id has none. A shift opens offline, before
  -- the device has ever spoken to the server about it, so the client generates the UUID
  -- and that is what makes a retried `shift_open` push idempotent. A server default would
  -- mint a second shift on every retry over a bad connection.
  id             uuid primary key,
  collector_id   uuid not null references ceedo_collections.app_users (id),
  device_id      uuid not null references ceedo_collections.devices (id),
  business_date  date not null,
  opened_at      timestamptz not null,
  closed_at      timestamptz,
  declared_total numeric(14,2),
  system_total   numeric(14,2),
  system_count   integer,
  -- declared_total - system_total. Signed: over and short are different problems.
  variance       numeric(14,2),
  -- 'remitted' is unreachable in Phase 3a -- remittance is Phase 6 -- but naming it now
  -- costs nothing and avoids a constraint migration later.
  status         text not null
                   check (status in ('open','closed','closed_unsynced','remitted')),
  row_version    bigint not null default 0
);

-- §6.5: "A device permits only one open shift at a time... Without this rule a shared
-- tablet accumulates overlapping open shifts and the cash accountability cannot be
-- untangled afterwards."
--
-- The device enforces this locally too, because it must work offline. That copy is a
-- convenience; this one is the guarantee.
create unique index shifts_one_open_per_device
  on ceedo_collections.shifts (device_id) where status = 'open';

create index shifts_collector_date_idx
  on ceedo_collections.shifts (collector_id, business_date);
create index shifts_row_version_idx on ceedo_collections.shifts (row_version);

create trigger shifts_row_version
  before insert or update on ceedo_collections.shifts
  for each row execute function ceedo_collections.bump_row_version();

alter table ceedo_collections.shifts enable row level security;

-- Staff read. Supervisors verify shifts, accounting reconciles them, admins see
-- everything. Collectors have no web access at all (§11.1), so they are not named.
create policy shifts_read on ceedo_collections.shifts
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Every write goes through close_shift() or sync_push(), both SECURITY DEFINER. No client
-- role holds INSERT or UPDATE directly. The revoke is not decorative: migration 0001's
-- ALTER DEFAULT PRIVILEGES granted service_role select+insert on this table the moment it
-- was created.
revoke insert, update, delete on ceedo_collections.shifts
  from anon, authenticated, service_role;
grant select on ceedo_collections.shifts to authenticated, service_role;
