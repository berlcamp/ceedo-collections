-- Two operational tables, deliberately outside the append-only ledger regime built in
-- migration 0011. `settings` holds the one date that decides what the accrual job will and
-- will not raise; `accrual_runs` is how anyone answers "did last Tuesday run?" after an
-- outage. apply_ledger_policies() is never called here -- both tables are legitimately
-- mutable, and calling the ledger installer on them would withhold UPDATE they actually need.

-- One row, enforced by the type system rather than by a trigger or by convention.
-- `id boolean primary key default true` with `check (id)` admits exactly one row: the
-- only permitted value is true, and the primary key stops it appearing twice. Two cutover
-- dates are therefore unrepresentable, so no code needs to decide which one applies.
create table ceedo_collections.settings (
  id           boolean primary key default true check (id),
  cutover_date date not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references ceedo_collections.app_users (id),
  row_version  bigint not null default 0
);

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
-- billed. Who and when is exactly what gets asked later.
--
-- NOT attach_audit(): that installer's write_audit() (migration 0010) computes entity_id
-- as `(to_jsonb(row) ->> 'id')::uuid`, which assumes a uuid id -- true of every table it
-- has been attached to so far. settings.id is boolean by design (see above), and casting
-- 'true'/'false' to uuid raises. write_audit()'s own exception handler already anticipated
-- an id that "is not uuid-castable" (see its comment in migration 0010), and its documented,
-- deliberate response to that is to swallow the failure into an 'audit_failed' marker
-- rather than record the real change -- confirmed by direct observation against the local
-- stack (attaching it here made every settings write log as 'audit_failed', never
-- 'update', which is exactly the outcome migration 0010's own regression test
-- (audit-log.test.ts, "a forced audit failure produces an audit_failed marker") asserts is
-- correct for a table whose id genuinely cannot be identified). That is the right behaviour
-- for an accidental non-uuid id; it is the wrong one for settings, where the point of this
-- comment is that the change itself must be logged. So settings gets its own small trigger
-- instead of the shared one, rather than changing write_audit()'s well-tested behaviour for
-- every other table. entity_id is always null here: the single row has no identity beyond
-- the fact that it is the row, which "settings" as the entity name already says.
create or replace function ceedo_collections.write_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  caller_role text;
begin
  caller_role := coalesce(nullif(current_setting('role', true), 'none'), session_user);

  begin
    insert into ceedo_collections.audit_log
      (actor_id, pg_role, action, entity, entity_id, before, after)
    values (
      auth.uid(),
      caller_role,
      lower(tg_op),
      'settings',
      null,
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    );
  exception
    when others then
      -- Same posture as write_audit(): a secondary, observational effect must never abort
      -- the primary operation it is attached to.
      raise warning 'write_settings_audit failed for %: %', tg_op, sqlerrm;

      begin
        insert into ceedo_collections.audit_log
          (actor_id, pg_role, action, entity, entity_id, note)
        values (auth.uid(), caller_role, 'audit_failed', 'settings', null, sqlerrm);
      exception
        when others then
          raise warning 'write_settings_audit failure marker also failed for %: %', tg_op, sqlerrm;
      end;
  end;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger settings_audit
  after insert or update or delete on ceedo_collections.settings
  for each row execute function ceedo_collections.write_settings_audit();

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
  select cutover_date into d from ceedo_collections.settings where id;
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
