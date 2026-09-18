-- Two operational tables, deliberately outside the append-only ledger regime built in
-- migration 0011. `settings` holds the one date that decides what the accrual job will and
-- will not raise; `accrual_runs` is how anyone answers "did last Tuesday run?" after an
-- outage. apply_ledger_policies() is never called here -- both tables are legitimately
-- mutable, and calling the ledger installer on them would withhold UPDATE they actually need.

-- Exactly one row, enforced by an index rather than by a trigger or by convention: the
-- indexed expression `(true)` is constant, so a second row always collides with the first
-- on that expression -- two cutover dates are therefore unrepresentable, so no code needs
-- to decide which one applies. A uuid id (rather than the boolean the single-row trick
-- usually uses) is what lets Phase 1's write_audit() audit this table completely
-- unmodified: it casts every audited row's id to uuid, and a real uuid here just works.
create table ceedo_collections.settings (
  id           uuid primary key default gen_random_uuid(),
  cutover_date date not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references ceedo_collections.app_users (id),
  row_version  bigint not null default 0
);

create unique index settings_singleton on ceedo_collections.settings ((true));

comment on column ceedo_collections.settings.cutover_date is
  'The accrual job raises no charge whose period begins before this date. Arrears older '
  'than this enter as one opening_balance charge per lease. Moving it after go-live '
  'changes what the nightly job will raise, which is why this table is audited.';

alter table ceedo_collections.settings enable row level security;

create policy settings_read on ceedo_collections.settings
  for select to authenticated
  using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));

create policy settings_admin_write on ceedo_collections.settings
  for all to authenticated
  using (ceedo_collections.is_admin())
  with check (ceedo_collections.is_admin());

grant select, insert, update on ceedo_collections.settings to authenticated;
grant update on ceedo_collections.settings to service_role;

create trigger settings_row_version
  before insert or update on ceedo_collections.settings
  for each row execute function ceedo_collections.bump_row_version();

create trigger settings_touch
  before update on ceedo_collections.settings
  for each row execute function ceedo_collections.touch_updated_at();

-- Moving the cutover date is a decision someone makes, with consequences for what gets
-- billed. Who and when is exactly what gets asked later. This is the shared installer,
-- unmodified: settings' uuid id (see above) is exactly what lets write_audit() (migration
-- 0010) audit this table like any other, rather than needing a table-specific trigger.
select ceedo_collections.attach_audit('settings');

-- Reads the cutover date, or fails loudly. A missing settings row means the system was
-- never configured; returning null instead would let run_accrual() compare every period
-- against null, match nothing, and raise no charges at all -- a silent no-op that looks
-- exactly like a quiet night.
create or replace function ceedo_collections.cutover_date()
returns date
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
declare
  d date;
begin
  -- No `where` clause needed: settings_singleton guarantees at most one row exists.
  select cutover_date into d from ceedo_collections.settings limit 1;
  if d is null then
    raise exception 'No cutover date configured. Insert the ceedo_collections.settings row before running accrual.'
      using errcode = 'no_data_found';
  end if;
  return d;
end;
$$;

revoke execute on function ceedo_collections.cutover_date() from public;
grant execute on function ceedo_collections.cutover_date() to authenticated, service_role;

create table ceedo_collections.accrual_runs (
  id                uuid primary key default gen_random_uuid(),
  business_date     date not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  charges_raised    integer not null default 0,
  surcharges_raised integer not null default 0,
  status            text not null default 'running'
                      check (status in ('running', 'succeeded', 'failed')),
  error             text,
  unique (business_date, started_at)
);

create index accrual_runs_business_date_idx
  on ceedo_collections.accrual_runs (business_date desc);

-- NOT a ledger table. The job updates its own row to record completion, so UPDATE is
-- granted here where it is withheld everywhere else in Phase 2. Nothing in this table is
-- a cash fact -- it records that a job ran, not that money moved.
alter table ceedo_collections.accrual_runs enable row level security;

create policy accrual_runs_read on ceedo_collections.accrual_runs
  for select to authenticated
  using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));

grant select on ceedo_collections.accrual_runs to authenticated;
grant update on ceedo_collections.accrual_runs to service_role;
