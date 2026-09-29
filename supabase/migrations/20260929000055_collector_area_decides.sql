-- The collector's collection area decides where they collect. The tablet's own assignment
-- no longer does.
--
-- Tablets are shared and change hands, and two assignments that had to overlap (the
-- tablet's and the collector's) refused sign-in whenever they disagreed. Now:
--
--   * Every active tablet pulls every facility, section and stall, and the leases (with
--     their tenants, charges and receipts) of every area some collector is assigned to:
--     a lease nobody collects needs no tablet. device_assignments is no longer read by
--     sync_pull or sign-in; the table stays for its history.
--   * sync_pull ships collector_assignments, so the tablet knows each collector's area. It
--     scopes the fee screen, the stall search and the card scan to the signed-in
--     collector's area, and names the site from it.
--   * can_collector_use_device() asks only whether the device is active and the person is
--     an active collector with an active collection area.
--
-- sync_pull is migration 0053's body with the device-assignment scope replaced by the
-- union of active collection areas, the collector-scoped gates written as EXISTS (a
-- collector with areas in two facilities must not send a row twice), and the new
-- collector_assignments key.
--
-- A lease whose area was assigned since the device's cursor is sent whole, like a
-- collector given an area (migration 0050): _scope_leases.fresh opens every row gate for
-- it, so a delta pull delivers its older charges and receipts without an epoch reset.

create or replace function ceedo_collections.can_collector_use_device(
  collector uuid,
  device uuid
)
returns boolean
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select exists (
    select 1
    from ceedo_collections.devices d
    join ceedo_collections.app_users u on u.id = collector
    where d.id = device
      and d.active
      and u.role = 'collector'
      and u.status = 'active'
      and exists (
        select 1 from ceedo_collections.collector_assignments ca
         where ca.collector_id = collector and ca.active)
  );
$$;

create or replace function ceedo_collections.sync_pull(
  p_device_id uuid,
  p_cursor bigint
)
returns jsonb
language plpgsql
security definer
-- NOT `stable`: it creates and writes the _scope_leases temp table.
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_epoch     integer;
  v_cursor    bigint;
  v_result    jsonb;
begin
  select d.assignment_epoch into v_epoch
    from ceedo_collections.devices d
   where d.id = p_device_id and d.active;

  if not found then
    raise exception 'No such device, or the device is inactive';
  end if;

  -- The high-water mark for this response. Read ONCE, before the selects below, and
  -- returned as the device's next cursor. Taking it afterwards would hand back a value
  -- covering rows written during the read, which the device would then never receive.
  v_cursor := last_value from ceedo_collections.row_version_seq;

  -- The leases in scope, materialised once: most of the selects below join it. In scope:
  -- covered by an active area of an active collector. `fresh`: that area, or its
  -- collector, changed since the cursor, so send the lease whole.
  create temporary table if not exists _scope_leases (
    id uuid primary key, fresh boolean not null
  ) on commit drop;
  truncate _scope_leases;

  insert into _scope_leases (id, fresh)
  select l.id, bool_or(ca.row_version > p_cursor or u.row_version > p_cursor)
    from ceedo_collections.leases l
    join ceedo_collections.stalls st on st.id = l.stall_id
    join ceedo_collections.sections sec on sec.id = st.section_id
    join ceedo_collections.collector_assignments ca
      on ca.active
     and ca.facility_id = sec.facility_id
     and (ca.section_id is null or ca.section_id = sec.id)
    join ceedo_collections.app_users u
      on u.id = ca.collector_id and u.role = 'collector' and u.status = 'active'
   group by l.id;

  -- Without statistics the planner guesses the temp table is large and computes
  -- charge_balances for every charge in the system before joining: measured 3.2 s against
  -- 32 ms with this, for 17 leases in a database of 422,000 charges.
  analyze _scope_leases;

  select jsonb_build_object(
    'cursor', v_cursor,
    'epoch', v_epoch,

    'facilities', coalesce((
      select jsonb_agg(to_jsonb(f)) from ceedo_collections.facilities f
       where f.row_version > p_cursor), '[]'::jsonb),

    'sections', coalesce((
      select jsonb_agg(to_jsonb(sec)) from ceedo_collections.sections sec
       where sec.row_version > p_cursor), '[]'::jsonb),

    'stalls', coalesce((
      select jsonb_agg(to_jsonb(st)) from ceedo_collections.stalls st
       where st.row_version > p_cursor), '[]'::jsonb),

    'tenants', coalesce((
      select jsonb_agg(to_jsonb(t)) from ceedo_collections.tenants t
       where exists (
               select 1 from ceedo_collections.leases l
                 join _scope_leases sl on sl.id = l.id
                where l.tenant_id = t.id
                  and (t.row_version > p_cursor or sl.fresh))
      ), '[]'::jsonb),

    'leases', coalesce((
      select jsonb_agg(to_jsonb(l)) from ceedo_collections.leases l
       join _scope_leases sl on sl.id = l.id
       where l.row_version > p_cursor or sl.fresh), '[]'::jsonb),

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
    -- Every active collector with an active collection area. The ca.row_version gate is
    -- migration 0050's fix: a collector given an area after the tablet last pulled.
    'collectors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'employee_no', u.employee_no, 'full_name', u.full_name,
               'pin_hash', u.pin_hash, 'status', u.status, 'row_version', u.row_version))
        from ceedo_collections.app_users u
       where u.role = 'collector'
         and u.status = 'active'
         and exists (select 1 from ceedo_collections.collector_assignments ca
                      where ca.collector_id = u.id and ca.active)
         and (u.row_version > p_cursor
              or exists (select 1 from ceedo_collections.collector_assignments ca
                          where ca.collector_id = u.id and ca.row_version > p_cursor))
      ), '[]'::jsonb),

    -- Every collector's areas, inactive rows included, so a withdrawn area reaches the
    -- tablet as active = false rather than lingering.
    'collector_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'collector_id', ca.collector_id, 'facility_id', ca.facility_id,
               'section_id', ca.section_id, 'active', ca.active,
               'row_version', ca.row_version))
        from ceedo_collections.collector_assignments ca
       where ca.row_version > p_cursor), '[]'::jsonb),

    'booklets', coalesce((
      select jsonb_agg(to_jsonb(b)) from ceedo_collections.booklets b
       where exists (
               select 1 from ceedo_collections.booklet_assignments ba
                 join ceedo_collections.app_users u on u.id = ba.collector_id
                where ba.booklet_id = b.id
                  and ba.returned_at is null
                  and u.role = 'collector' and u.status = 'active'
                  and exists (select 1 from ceedo_collections.collector_assignments ca
                               where ca.collector_id = ba.collector_id and ca.active)
                  and (b.row_version > p_cursor
                       or exists (select 1 from ceedo_collections.collector_assignments ca
                                   where ca.collector_id = ba.collector_id
                                     and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    'booklet_assignments', coalesce((
      select jsonb_agg(to_jsonb(ba)) from ceedo_collections.booklet_assignments ba
        join ceedo_collections.app_users u on u.id = ba.collector_id
       where u.role = 'collector' and u.status = 'active'
         and exists (select 1 from ceedo_collections.collector_assignments ca
                      where ca.collector_id = ba.collector_id and ca.active)
         and (ba.row_version > p_cursor
              or exists (select 1 from ceedo_collections.collector_assignments ca
                          where ca.collector_id = ba.collector_id
                            and ca.row_version > p_cursor))
      ), '[]'::jsonb),

    -- §7.1: the device refuses a spent OR offline. It can only do that if it knows which
    -- serials are gone, and the authoritative answer is the collections table.
    'consumed_serials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booklet_id', c.booklet_id, 'or_no', c.or_no))
        from ceedo_collections.collections c
       where exists (
               select 1 from ceedo_collections.booklet_assignments ba
                where ba.booklet_id = c.booklet_id
                  and exists (select 1 from ceedo_collections.collector_assignments ca
                               where ca.collector_id = ba.collector_id and ca.active)
                  and (c.row_version > p_cursor
                       or exists (select 1 from ceedo_collections.collector_assignments ca
                                   where ca.collector_id = ba.collector_id
                                     and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    'spoiled_forms', coalesce((
      select jsonb_agg(to_jsonb(sf)) from ceedo_collections.spoiled_forms sf
       where exists (
               select 1 from ceedo_collections.booklet_assignments ba
                where ba.booklet_id = sf.booklet_id
                  and exists (select 1 from ceedo_collections.collector_assignments ca
                               where ca.collector_id = ba.collector_id and ca.active)
                  and (sf.row_version > p_cursor
                       or exists (select 1 from ceedo_collections.collector_assignments ca
                                   where ca.collector_id = ba.collector_id
                                     and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    -- §6.1: unpaid charges, plus paid ones from the last 90 days for the history view.
    -- Sending them all would grow without bound on a two-year delinquency.
    'charges', coalesce((
      select jsonb_agg(to_jsonb(ch)) from ceedo_collections.charges ch
       join _scope_leases sl on sl.id = ch.lease_id
       where (ch.row_version > p_cursor or sl.fresh)
         and (ch.period_start >= (ceedo_collections.business_date() - 90)
              or exists (select 1 from ceedo_collections.charge_balances cb
                          where cb.id = ch.id and not cb.is_settled))
      ), '[]'::jsonb),

    'collections', coalesce((
      select jsonb_agg(to_jsonb(c)) from ceedo_collections.collections c
       join _scope_leases sl on sl.id = c.lease_id
       where c.row_version > p_cursor or sl.fresh), '[]'::jsonb),

    'collection_allocations', coalesce((
      select jsonb_agg(to_jsonb(a)) from ceedo_collections.collection_allocations a
       join ceedo_collections.collections c on c.id = a.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where a.row_version > p_cursor or sl.fresh), '[]'::jsonb),

    'collection_cancellations', coalesce((
      select jsonb_agg(to_jsonb(cc)) from ceedo_collections.collection_cancellations cc
       join ceedo_collections.collections c on c.id = cc.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where cc.row_version > p_cursor or sl.fresh), '[]'::jsonb),

    'collection_reinstatements', coalesce((
      select jsonb_agg(to_jsonb(cr)) from ceedo_collections.collection_reinstatements cr
       join ceedo_collections.collection_cancellations cc on cc.id = cr.cancellation_id
       join ceedo_collections.collections c on c.id = cc.collection_id
       join _scope_leases sl on sl.id = c.lease_id
       where cr.row_version > p_cursor or sl.fresh), '[]'::jsonb),

    'charge_condonations', coalesce((
      select jsonb_agg(to_jsonb(cd)) from ceedo_collections.charge_condonations cd
       join ceedo_collections.charges ch on ch.id = cd.charge_id
       join _scope_leases sl on sl.id = ch.lease_id
       where cd.row_version > p_cursor or sl.fresh), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function ceedo_collections.sync_pull(uuid, bigint) from public;
grant execute on function ceedo_collections.sync_pull(uuid, bigint) to ceedo_app;

-- Every tablet's scope just widened to all facilities, and it has pulled past the rows it
-- was never sent. One epoch bump makes each device empty its pulled tables and pull from
-- cursor 0 (migration 0031); device-authored receipts and the outbox are untouched.
update ceedo_collections.devices
   set assignment_epoch = assignment_epoch + 1
 where true;
