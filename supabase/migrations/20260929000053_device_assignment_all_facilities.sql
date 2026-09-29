-- A tablet may be assigned to all facilities.
--
-- device_assignments.facility_id becomes nullable, and null means every facility: the
-- tablet pulls every section, stall, lease and collector, and any collector with an active
-- collection area may sign in on it. A section still needs its facility, so an
-- all-facilities assignment cannot name one.
--
-- Changed here: the column and its check, can_collector_use_device() (the sync_push
-- collector check goes through it), and sync_pull(). sync_pull is migration 0051's body
-- with only the facility predicates changed. Existing grants carry over on replace.

alter table ceedo_collections.device_assignments
  alter column facility_id drop not null,
  add constraint device_assignments_section_needs_facility
    check (facility_id is not null or section_id is null);

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
    from ceedo_collections.device_assignments da
    join ceedo_collections.devices d on d.id = da.device_id
    join ceedo_collections.collector_assignments ca
      on da.facility_id is null or ca.facility_id = da.facility_id
    join ceedo_collections.app_users u on u.id = ca.collector_id
    where da.device_id = device
      and da.active
      and d.active
      and ca.collector_id = collector
      and ca.active
      and u.role = 'collector'
      and u.status = 'active'
      and (ca.section_id is null or da.section_id is null or ca.section_id = da.section_id)
  );
$$;

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
  v_all       boolean;
  v_epoch     integer;
  v_cursor    bigint;
  v_result    jsonb;
begin
  -- v_all: an active assignment with no facility covers every facility. A null
  -- v_facility on its own cannot say that, since no assignment at all also reads as null.
  select da.facility_id, da.section_id, d.assignment_epoch,
         da.id is not null and da.facility_id is null
    into v_facility, v_section, v_epoch, v_all
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
   where (v_all or sec.facility_id = v_facility)
     and (v_section is null or sec.id = v_section);

  select jsonb_build_object(
    'cursor', v_cursor,
    'epoch', v_epoch,

    'facilities', coalesce((
      select jsonb_agg(to_jsonb(f)) from ceedo_collections.facilities f
       where (v_all or f.id = v_facility) and f.row_version > p_cursor), '[]'::jsonb),

    'sections', coalesce((
      select jsonb_agg(to_jsonb(sec)) from ceedo_collections.sections sec
       where (v_all or sec.facility_id = v_facility)
         and (v_section is null or sec.id = v_section)
         and sec.row_version > p_cursor), '[]'::jsonb),

    'stalls', coalesce((
      select jsonb_agg(to_jsonb(st)) from ceedo_collections.stalls st
       join ceedo_collections.sections sec on sec.id = st.section_id
       where (v_all or sec.facility_id = v_facility)
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
         and (v_all or ca.facility_id = v_facility)
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
         and ca.active and (v_all or ca.facility_id = v_facility)
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and u.role = 'collector' and u.status = 'active'
         and (b.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    'booklet_assignments', coalesce((
      select jsonb_agg(to_jsonb(ba)) from ceedo_collections.booklet_assignments ba
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       join ceedo_collections.app_users u on u.id = ba.collector_id
       where ca.active and (v_all or ca.facility_id = v_facility)
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
       where ca.active and (v_all or ca.facility_id = v_facility)
         and (ca.section_id is null or v_section is null or ca.section_id = v_section)
         and (c.row_version > p_cursor or ca.row_version > p_cursor)), '[]'::jsonb),

    'spoiled_forms', coalesce((
      select jsonb_agg(to_jsonb(sf)) from ceedo_collections.spoiled_forms sf
       join ceedo_collections.booklet_assignments ba on ba.booklet_id = sf.booklet_id
       join ceedo_collections.collector_assignments ca on ca.collector_id = ba.collector_id
       where ca.active and (v_all or ca.facility_id = v_facility)
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
