-- Undo a cancelled receipt without deleting anything.
--
-- The ledger is append-only, so a reinstatement is its own row pointing at the
-- cancellation it lifts, with who, when and why -- the same shape as the cancellation
-- itself. Both stay on the record. A receipt counts as cancelled while it has a
-- cancellation that no reinstatement answers; `standing_cancellations` is that rule, and
-- every reader that used to ask "is there a cancellation?" now asks it instead.
--
-- A reinstated receipt can be cancelled again, so a collection may now carry several
-- cancellations over its life. At most one of them stands at a time. A partial unique
-- index cannot see the reinstatements table, so a trigger holds that line instead, under
-- a lock on the collection so two concurrent cancellations cannot both pass it.

create table ceedo_collections.collection_reinstatements (
  id              uuid primary key default gen_random_uuid(),
  -- Unique: a cancellation is lifted once. Cancelling again writes a new cancellation.
  cancellation_id uuid not null unique references ceedo_collections.collection_cancellations (id),
  reason          text not null check (length(trim(reason)) > 0),
  reinstated_by   uuid not null references ceedo_collections.app_users (id),
  reinstated_at   timestamptz not null default now(),
  row_version     bigint not null default 0
);

select ceedo_collections.apply_ledger_policies('collection_reinstatements');
select ceedo_collections.attach_audit('collection_reinstatements');

alter table ceedo_collections.collection_cancellations
  drop constraint collection_cancellations_collection_id_key;

create index collection_cancellations_collection_idx
  on ceedo_collections.collection_cancellations (collection_id);


-- The cancellations still in force. security_invoker, like charge_balances, so the
-- ledger read policy on both tables applies to whoever asks.
create view ceedo_collections.standing_cancellations
with (security_invoker = true)
as
select cc.*
from ceedo_collections.collection_cancellations cc
where not exists (
  select 1 from ceedo_collections.collection_reinstatements r
  where r.cancellation_id = cc.id
);

grant select on ceedo_collections.standing_cancellations to authenticated;

-- What the dropped unique constraint used to say, for as long as a cancellation stands.
create or replace function ceedo_collections.assert_one_standing_cancellation()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  perform 1 from ceedo_collections.collections where id = new.collection_id for update;

  if exists (
    select 1 from ceedo_collections.standing_cancellations where collection_id = new.collection_id
  ) then
    raise exception 'Collection % is already cancelled', new.collection_id
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger collection_cancellations_one_standing
  before insert on ceedo_collections.collection_cancellations
  for each row execute function ceedo_collections.assert_one_standing_cancellation();

-- A trigger fires regardless of EXECUTE; nobody needs to call it directly.
revoke execute on function ceedo_collections.assert_one_standing_cancellation() from public;

-- Voids a posted receipt (§11.3). Supervisor or admin. As in migration 0023, except that
-- "already cancelled" now comes from the trigger above rather than a unique_violation on
-- the dropped constraint, so there is no exception handler to translate it.
create or replace function ceedo_collections.cancel_collection(
  p_collection_id uuid,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may cancel a collection'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A cancellation needs a written reason';
  end if;

  if not exists (select 1 from ceedo_collections.collections where id = p_collection_id) then
    raise exception 'No such collection: %', p_collection_id;
  end if;

  insert into ceedo_collections.collection_cancellations
    (collection_id, reason, cancelled_by)
  values (p_collection_id, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.cancel_collection(uuid, text) from public;
grant execute on function ceedo_collections.cancel_collection(uuid, text) to authenticated;

-- Lifts a receipt's standing cancellation. Supervisor or admin, with a written reason --
-- the same bar as cancelling, since undoing a void puts money back on the books.
create or replace function ceedo_collections.reinstate_collection(
  p_collection_id uuid,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_cancellation uuid;
  v_id           uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may undo a cancellation'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Undoing a cancellation needs a written reason';
  end if;

  perform 1 from ceedo_collections.collections where id = p_collection_id for update;
  if not found then
    raise exception 'No such collection: %', p_collection_id;
  end if;

  select id into v_cancellation
    from ceedo_collections.standing_cancellations
   where collection_id = p_collection_id;
  if v_cancellation is null then
    raise exception 'Collection % is not cancelled', p_collection_id;
  end if;

  insert into ceedo_collections.collection_reinstatements
    (cancellation_id, reason, reinstated_by)
  values (v_cancellation, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.reinstate_collection(uuid, text) from public;
grant execute on function ceedo_collections.reinstate_collection(uuid, text) to authenticated;

-- The readers of "is this receipt cancelled?", redefined over standing_cancellations.
-- Bodies are otherwise exactly as last defined (0019, 0024, 0043, 0050).

create or replace view ceedo_collections.charge_balances
with (security_invoker = true)
as
select
  c.id,
  c.lease_id,
  c.fee_type_id,
  c.charge_type,
  c.parent_charge_id,
  c.period_start,
  c.period_end,
  c.due_date,
  c.amount,
  c.surcharge_bps,
  c.created_at,
  coalesce(alloc.allocated, 0)::numeric(14,2) as allocated,
  coalesce(cond.condoned, 0)::numeric(14,2)  as condoned,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0))::numeric(14,2)
    as outstanding,
  (c.amount - coalesce(alloc.allocated, 0) - coalesce(cond.condoned, 0)) <= 0
    as is_settled,
  greatest(0, (ceedo_collections.business_date() - c.due_date))::integer as days_overdue
from ceedo_collections.charges c
left join lateral (
  select sum(a.amount) as allocated
  from ceedo_collections.collection_allocations a
  join ceedo_collections.collections col on col.id = a.collection_id
  where a.charge_id = c.id
    -- A cancelled collection's allocations stop counting. Omitting this is the easiest
    -- mistake in the phase to make and the hardest to notice: the ledger would report
    -- voided money as received, and every downstream report would agree with it.
    and not exists (
      select 1 from ceedo_collections.standing_cancellations x
      where x.collection_id = col.id
    )
) alloc on true
left join lateral (
  select sum(k.amount) as condoned
  from ceedo_collections.charge_condonations k
  where k.charge_id = c.id
) cond on true;


create or replace view ceedo_collections.subsidiary_ledger
with (security_invoker = true)
as
with entries as (
  select
    b.lease_id,
    b.due_date                              as entry_date,
    'charge'::text                          as entry_type,
    b.charge_type::text                     as detail,
    b.period_start,
    b.period_end,
    b.amount                                as debit,
    0::numeric(14,2)                        as credit,
    null::integer                           as or_no,
    b.id                                    as source_id,
    false                                   as cancelled
  from ceedo_collections.charge_balances b

  union all

  select
    c.lease_id,
    c.business_date,
    'collection'::text,
    case when x.id is null then 'payment' else 'payment (cancelled)' end,
    null::date,
    null::date,
    0::numeric(14,2),
    case when x.id is null then c.gross_amount else 0::numeric(14,2) end,
    c.or_no,
    c.id,
    x.id is not null
  from ceedo_collections.collections c
  left join ceedo_collections.standing_cancellations x on x.collection_id = c.id
  where c.lease_id is not null

  union all

  -- The write-off. Dated by when it was granted, not by the charge's due date: the
  -- ordinance is an event in its own right, and dating it back would silently rewrite the
  -- balance the lease carried in the months before it was passed.
  --
  -- It carries the parent charge's period so the row says WHICH month was forgiven; the
  -- authority_ref is the detail because the ordinance is the only thing that makes a
  -- write-off a decision rather than a missing record.
  select
    k_charge.lease_id,
    k.condoned_at::date,
    'condonation'::text,
    k.authority_ref,
    k_charge.period_start,
    k_charge.period_end,
    0::numeric(14,2),
    k.amount,
    null::integer,
    k.id,
    false
  from ceedo_collections.charge_condonations k
  join ceedo_collections.charges k_charge on k_charge.id = k.charge_id
)
select
  lease_id, entry_date, entry_type, detail, period_start, period_end,
  debit, credit, or_no, source_id, cancelled,
  -- The tie-break is (entry_type, source_id), unchanged. entry_type is sorted as text, and
  -- 'charge' < 'collection' < 'condonation' already reads correctly for a single day: the
  -- charge is raised, then whatever was paid against it, then whatever was forgiven of the
  -- remainder. source_id keeps it total, so the window is deterministic. Consumers that
  -- print the rows must ORDER BY the same three columns -- apps/web/lib/ledger/queries.ts
  -- does -- because the outer SELECT carries no ORDER BY of its own.
  sum(debit - credit) over (
    partition by lease_id order by entry_date, entry_type, source_id
    rows between unbounded preceding and current row
  )::numeric(14,2) as running_balance
from entries;

create or replace function ceedo_collections.close_shift(
  p_shift_id       uuid,
  p_device_id      uuid,
  p_declared_total numeric,
  p_device_count   integer,
  p_device_total   numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts%rowtype;
  v_system_count integer;
  v_system_total numeric(14,2);
begin
  select * into v_shift from ceedo_collections.shifts where id = p_shift_id;
  if not found then
    raise exception 'No such shift';
  end if;

  if v_shift.device_id <> p_device_id then
    raise exception 'Shift % does not belong to this device', p_shift_id;
  end if;

  -- Idempotency. A push retried after a dropped ack must not rewrite the variance, so an
  -- already-closed shift reports itself and changes nothing.
  if v_shift.status <> 'open' then
    return jsonb_build_object('status', 'already_closed',
                              'shift_status', v_shift.status,
                              'system_count', v_shift.system_count,
                              'system_total', v_shift.system_total,
                              'variance', v_shift.variance);
  end if;

  -- §6.5 step 5: "Collector declares physical cash; variance is recorded, not hidden."
  -- An omitted declaration is refused outright rather than written as a null variance.
  if p_declared_total is null then
    raise exception 'A closeout must declare the physical cash total'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Net of cancellations. charge_balances already excludes cancelled collections from the
  -- ledger; the same exclusion applies here or a cancelled receipt inflates the figure the
  -- collector is asked to match and an honest closeout is refused.
  --
  -- SCOPE: the shift itself. Migration 0040 scoped this to (collector_id, business_date)
  -- and its comment named the two cases that broke -- a collector on two tablets the same
  -- day, and a second shift opened on one device later the same day -- and recorded that
  -- the real fix was shift_id on collections, deferred to Phase 3b. This is that fix.
  --
  -- The collector_id and business_date predicates are REMOVED rather than kept alongside.
  -- A shift's collections are identified by the shift; re-checking the collector would be
  -- a second, weaker statement of the same fact, and would resurrect the two-shift bug for
  -- any row whose collector was corrected.
  --
  -- Collections with a null shift_id -- everything posted before this migration, and
  -- everything a supervisor posts from the web -- belong to no device shift and so are
  -- counted by no closeout. That is the same statement as the column being nullable.
  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (
       select 1 from ceedo_collections.standing_cancellations cc
        where cc.collection_id = c.id);

  if p_device_count is distinct from v_system_count
     or p_device_total is distinct from v_system_total then
    -- Nothing is written. The shift stays open and the device shows the difference.
    return jsonb_build_object(
      'status', 'mismatch',
      'device_count', p_device_count,
      'device_total', p_device_total,
      'system_count', v_system_count,
      'system_total', v_system_total);
  end if;

  update ceedo_collections.shifts
     set status         = 'closed',
         closed_at      = now(),
         declared_total = p_declared_total,
         system_total   = v_system_total,
         system_count   = v_system_count,
         -- Signed, deliberately. Over and short are different problems and a supervisor
         -- reading an absolute value would not know which one they have.
         variance       = p_declared_total - v_system_total
   where id = p_shift_id;

  return jsonb_build_object(
    'status', 'closed',
    'system_count', v_system_count,
    'system_total', v_system_total,
    'variance', p_declared_total - v_system_total);
end;
$$;

-- A tablet mirrors both tables and applies the same rule (sync-engine ledger.ts), so
-- reinstatements travel with the cancellations they lift.
create or replace function ceedo_collections.sync_pull(
  p_device_id uuid,
  p_cursor bigint
)
returns jsonb
language plpgsql
security definer
-- NOT `stable`. A stable function may not create or write the temp table this one uses for
-- the lease scope, and `stable` buys nothing here: sync_pull is called once per request and
-- is never inlined into a surrounding query.
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_facility  uuid;
  v_section   uuid;
  v_epoch     integer;
  v_cursor    bigint;
  v_result    jsonb;
begin
  select da.facility_id, da.section_id, d.assignment_epoch
    into v_facility, v_section, v_epoch
    from ceedo_collections.devices d
    left join ceedo_collections.device_assignments da
      on da.device_id = d.id and da.active
   where d.id = p_device_id and d.active;

  if not found then
    raise exception 'No such device, or the device is inactive';
  end if;

  -- The high-water mark for this response. Read ONCE, before the selects below, and
  -- returned as the device's next cursor. Taking it afterwards would hand back a value
  -- covering rows written during the read, which the device would then never receive.
  v_cursor := last_value from ceedo_collections.row_version_seq;

  -- The leases in scope, materialised once: eight of the selects below join it.
  create temporary table if not exists _scope_leases (id uuid primary key) on commit drop;
  truncate _scope_leases;

  insert into _scope_leases (id)
  select l.id
    from ceedo_collections.leases l
    join ceedo_collections.stalls st on st.id = l.stall_id
    join ceedo_collections.sections sec on sec.id = st.section_id
   where v_facility is not null
     and sec.facility_id = v_facility
     and (v_section is null or sec.id = v_section);

  select jsonb_build_object(
    'cursor', v_cursor,
    'epoch', v_epoch,

    'facilities', coalesce((
      select jsonb_agg(to_jsonb(f)) from ceedo_collections.facilities f
       where f.id = v_facility and f.row_version > p_cursor), '[]'::jsonb),

    'sections', coalesce((
      select jsonb_agg(to_jsonb(sec)) from ceedo_collections.sections sec
       where sec.facility_id = v_facility
         and (v_section is null or sec.id = v_section)
         and sec.row_version > p_cursor), '[]'::jsonb),

    'stalls', coalesce((
      select jsonb_agg(to_jsonb(st)) from ceedo_collections.stalls st
       join ceedo_collections.sections sec on sec.id = st.section_id
       where sec.facility_id = v_facility
         and (v_section is null or sec.id = v_section)
         and st.row_version > p_cursor), '[]'::jsonb),

    'tenants', coalesce((
      select jsonb_agg(distinct to_jsonb(t)) from ceedo_collections.tenants t
       join ceedo_collections.leases l on l.tenant_id = t.id
       join _scope_leases sl on sl.id = l.id
       where t.row_version > p_cursor), '[]'::jsonb),

    'leases', coalesce((
      select jsonb_agg(to_jsonb(l)) from ceedo_collections.leases l
       join _scope_leases sl on sl.id = l.id
       where l.row_version > p_cursor), '[]'::jsonb),

    -- Rates and fee types are global, not scoped. A device must be able to price anything
    -- it is asked to collect, and §6.1 sends "the rate table" without qualification.
    'fee_types', coalesce((
      select jsonb_agg(to_jsonb(ft)) from ceedo_collections.fee_types ft
       where ft.row_version > p_cursor), '[]'::jsonb),

    'rates', coalesce((
      select jsonb_agg(to_jsonb(r)) from ceedo_collections.rates r
       where r.row_version > p_cursor), '[]'::jsonb),

    -- Offline sign-in. employee_no and pin_hash only -- never the auth.users email, which
    -- belongs to a shared GoTrue instance (§12.1) and has no business on a tablet.
    --
    -- The role and status predicates are the re-check migration 0007's comment asked for.
    -- The guard triggers make the table safe; this makes the reader safe independently.
    'collectors', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'id', u.id, 'employee_no', u.employee_no, 'full_name', u.full_name,
               'pin_hash', u.pin_hash, 'status', u.status, 'row_version', u.row_version))
        from ceedo_collections.app_users u
        join ceedo_collections.collector_assignments ca on ca.collector_id = u.id
       where ca.active
         and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and u.role = 'collector'
         and u.status = 'active'
         and (u.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    'booklets', coalesce((
      select jsonb_agg(distinct to_jsonb(b)) from ceedo_collections.booklets b
       join ceedo_collections.booklet_assignments ba on ba.booklet_id = b.id
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       join ceedo_collections.app_users u on u.id = ba.collector_id
       where ba.returned_at is null
         and ca.active and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and u.role = 'collector' and u.status = 'active'
         and (b.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    'booklet_assignments', coalesce((
      select jsonb_agg(to_jsonb(ba)) from ceedo_collections.booklet_assignments ba
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       join ceedo_collections.app_users u on u.id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and u.role = 'collector' and u.status = 'active'
         and (ba.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    -- §7.1: the device refuses a spent OR offline. It can only do that if it knows which
    -- serials are gone, and the authoritative answer is the collections table.
    'consumed_serials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booklet_id', c.booklet_id, 'or_no', c.or_no))
        from ceedo_collections.collections c
        join ceedo_collections.booklet_assignments ba on ba.booklet_id = c.booklet_id
        join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and (c.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    'spoiled_forms', coalesce((
      select jsonb_agg(to_jsonb(sf)) from ceedo_collections.spoiled_forms sf
       join ceedo_collections.booklet_assignments ba on ba.booklet_id = sf.booklet_id
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       where ca.active and ca.facility_id = v_facility
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and (sf.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    -- §6.1: unpaid charges, plus paid ones from the last 90 days for the history view.
    -- Sending them all would grow without bound on a two-year delinquency.
    'charges', coalesce((
      select jsonb_agg(to_jsonb(ch)) from ceedo_collections.charges ch
       join _scope_leases sl on sl.id = ch.lease_id
       where ch.row_version > p_cursor
         and (ch.period_start >= (ceedo_collections.business_date() - 90)
              or exists (select 1 from ceedo_collections.charge_balances cb
                          where cb.id = ch.id and not cb.is_settled))
      ), '[]'::jsonb),

    'collections', coalesce((
      select jsonb_agg(to_jsonb(c)) from ceedo_collections.collections c
       join _scope_leases sl on sl.id = c.lease_id
       where c.row_version > p_cursor), '[]'::jsonb),

    'collection_allocations', coalesce((
      select jsonb_agg(to_jsonb(a)) from ceedo_collections.collection_allocations a
       join ceedo_collections.collections c on c.id = a.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where a.row_version > p_cursor), '[]'::jsonb),

    'collection_cancellations', coalesce((
      select jsonb_agg(to_jsonb(cc)) from ceedo_collections.collection_cancellations cc
       join ceedo_collections.collections c on c.id = cc.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where cc.row_version > p_cursor), '[]'::jsonb),

    'collection_reinstatements', coalesce((
      select jsonb_agg(to_jsonb(cr)) from ceedo_collections.collection_reinstatements cr
       join ceedo_collections.collection_cancellations cc on cc.id = cr.cancellation_id
       join ceedo_collections.collections c on c.id = cc.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where cr.row_version > p_cursor), '[]'::jsonb),

    'charge_condonations', coalesce((
      select jsonb_agg(to_jsonb(cd)) from ceedo_collections.charge_condonations cd
       join ceedo_collections.charges ch on ch.id = cd.charge_id
       join _scope_leases sl on sl.id = ch.lease_id
       where cd.row_version > p_cursor), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

