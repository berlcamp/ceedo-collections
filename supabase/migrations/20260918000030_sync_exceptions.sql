-- The exceptions queue. Parent spec §6.3 and §11.3.
--
-- §6.3 is the whole reason this table exists: "A server rejection must never mean 'discard
-- the record.' By the time the server sees a problem, the collector has handed a vendor a
-- paper official receipt and taken their money. That serial is spent. If the device drops
-- the entry, cash exists with no record -- exactly the variance an audit will find."
--
-- Outside the append-only regime, like `shifts`: an exception has a lifecycle.

create table ceedo_collections.sync_exceptions (
  id                uuid primary key default gen_random_uuid(),
  -- UNIQUE, and load-bearing. §6.4: a rejected entry remains visible on the device as
  -- unresolved, which means the device re-pushes it on EVERY sync. Without this, one
  -- permanently-rejected receipt breeds a row per sync attempt and buries the queue. A
  -- re-push bumps `attempts` instead, which is also the honest signal of how long a
  -- receipt has been stuck.
  collection_uuid   uuid not null unique,
  device_id         uuid not null references ceedo_collections.devices (id),
  collector_id      uuid not null references ceedo_collections.app_users (id),
  reason_code       text not null,
  -- The entry exactly as the device sent it. A supervisor correcting this needs to see
  -- what was claimed, and an investigation needs it unaltered.
  payload           jsonb not null,
  attempts          integer not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  status            text not null default 'open'
                      check (status in ('open','escalated','resolved')),
  resolution        text
                      constraint sync_exceptions_resolution_check
                      check (resolution in ('corrected','spoiled')),
  resolution_reason text,
  resolved_by       uuid references ceedo_collections.app_users (id),
  resolved_at       timestamptz,
  row_version       bigint not null default 0,

  -- §11.3: "A written reason is mandatory on every resolution." Enforced here rather than
  -- in the form, because the form is one caller and the RPC is another.
  --
  -- 'escalated' is a STATUS, not a resolution: §11.3's third action is "escalate for
  -- investigation", which is not a terminus. An escalated exception is still unresolved
  -- and still counts against the collector at closeout. Modelling it as a resolution would
  -- let an exception be closed by declaring it interesting.
  constraint sync_exceptions_lifecycle check (
    case status
      when 'open' then
        resolution is null and resolved_by is null and resolved_at is null
      when 'escalated' then
        resolution is null and resolved_by is null and resolved_at is null
        and resolution_reason is not null
      when 'resolved' then
        resolution is not null and resolved_by is not null and resolved_at is not null
        and resolution_reason is not null
    end
  )
);

create index sync_exceptions_open_idx
  on ceedo_collections.sync_exceptions (first_seen_at)
  where status <> 'resolved';
create index sync_exceptions_collector_idx
  on ceedo_collections.sync_exceptions (collector_id);
create index sync_exceptions_row_version_idx
  on ceedo_collections.sync_exceptions (row_version);

create trigger sync_exceptions_row_version
  before insert or update on ceedo_collections.sync_exceptions
  for each row execute function ceedo_collections.bump_row_version();

alter table ceedo_collections.sync_exceptions enable row level security;

create policy sync_exceptions_read on ceedo_collections.sync_exceptions
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Written by sync_push() and the three resolve_exception_* functions, all SECURITY
-- DEFINER. No client role writes directly, and the revoke is what makes that true given
-- migration 0001's default privileges.
revoke insert, update, delete on ceedo_collections.sync_exceptions
  from anon, authenticated, service_role;
grant select on ceedo_collections.sync_exceptions to authenticated, service_role;
