-- Tablets now carry every receipt of every collector who can sign in on them, so the
-- collector's history screen shows their on-the-spot fees (no lease) and the receipts they
-- took on other tablets.
--
-- A receipt is sent for its lease (as before) or for its collector, under the same gate as
-- booklets: an active collector with an active collection area. A delta pull cannot reach
-- receipts older than the cursor, so every device gets one assignment_epoch bump and
-- re-pulls once.
--
-- The collectors in scope are materialised once, like the leases, and so are the receipts
-- whose lease or collector is fresh. Each receipt array is then two disjoint halves -- the
-- fresh receipts, and rows new since the cursor whose receipt is in scope but not fresh --
-- so a delta pull reads collections_row_version_idx and the children's foreign-key indexes
-- instead of probing every receipt in the system. No new index: collector_id lookups use
-- collections_collector_date_idx (collector_id, business_date).

create or replace function ceedo_collections.sync_pull(
  p_device_id uuid,
  p_cursor bigint
)
returns jsonb
language plpgsql
security definer
-- NOT `stable`: it creates and writes the _scope_* and _fresh_receipts temp tables.
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

  -- The collectors whose receipts are in scope (migration 0061): every active collector
  -- with an active collection area, i.e. anyone who can sign in on this tablet. `fresh`:
  -- the collector, or any of their areas, changed since the cursor -- the gate booklets
  -- use -- which sends a newly assigned collector's history whole.
  create temporary table if not exists _scope_collectors (
    id uuid primary key, fresh boolean not null
  ) on commit drop;
  truncate _scope_collectors;

  insert into _scope_collectors (id, fresh)
  select u.id,
         u.row_version > p_cursor
         or exists (select 1 from ceedo_collections.collector_assignments ca
                     where ca.collector_id = u.id and ca.row_version > p_cursor)
    from ceedo_collections.app_users u
   where u.role = 'collector'
     and u.status = 'active'
     and exists (select 1 from ceedo_collections.collector_assignments ca
                  where ca.collector_id = u.id and ca.active);

  analyze _scope_collectors;

  -- The receipts sent whole, with every cancellation, reinstatement and allocation: those
  -- of a fresh lease in scope or of a fresh collector in scope. Found through
  -- collections_lease_idx and collections_collector_date_idx, so a delta pull with nothing
  -- fresh reads nothing here. The receipt arrays below send these, plus rows new since the
  -- cursor whose receipt is in scope and NOT in this table; the two halves are disjoint, so
  -- every row is sent once.
  create temporary table if not exists _fresh_receipts (
    id uuid primary key
  ) on commit drop;
  truncate _fresh_receipts;

  insert into _fresh_receipts (id)
  select c.id from ceedo_collections.collections c
    join _scope_leases sl on sl.id = c.lease_id
   where sl.fresh
  union
  select c.id from ceedo_collections.collections c
    join _scope_collectors sc on sc.id = c.collector_id
   where sc.fresh;

  analyze _fresh_receipts;

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

    -- Migration 0061: a receipt is sent for its lease (as before) OR for its collector, and
    -- whole when either is fresh. Each array is _fresh_receipts' rows plus rows new since the
    -- cursor whose receipt is in scope but not fresh -- the same set as "in scope and (new or
    -- fresh)", split so each half can use an index. Disjoint halves: no row is sent twice.
    'collections', coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select c.* from ceedo_collections.collections c
          join _fresh_receipts fr on fr.id = c.id
        union all
        select c.* from ceedo_collections.collections c
         where c.row_version > p_cursor
           and not exists (select 1 from _fresh_receipts fr where fr.id = c.id)
           and (exists (select 1 from _scope_leases sl where sl.id = c.lease_id)
                    or exists (select 1 from _scope_collectors sc where sc.id = c.collector_id))
      ) c), '[]'::jsonb),

    'collection_allocations', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select a.* from ceedo_collections.collection_allocations a
          join _fresh_receipts fr on fr.id = a.collection_id
        union all
        select a.* from ceedo_collections.collection_allocations a
          join ceedo_collections.collections c on c.id = a.collection_id
         where a.row_version > p_cursor
           and not exists (select 1 from _fresh_receipts fr where fr.id = c.id)
           and (exists (select 1 from _scope_leases sl where sl.id = c.lease_id)
                    or exists (select 1 from _scope_collectors sc where sc.id = c.collector_id))
      ) a), '[]'::jsonb),

    'collection_cancellations', coalesce((
      select jsonb_agg(to_jsonb(cc)) from (
        select cc.* from ceedo_collections.collection_cancellations cc
          join _fresh_receipts fr on fr.id = cc.collection_id
        union all
        select cc.* from ceedo_collections.collection_cancellations cc
          join ceedo_collections.collections c on c.id = cc.collection_id
         where cc.row_version > p_cursor
           and not exists (select 1 from _fresh_receipts fr where fr.id = c.id)
           and (exists (select 1 from _scope_leases sl where sl.id = c.lease_id)
                    or exists (select 1 from _scope_collectors sc where sc.id = c.collector_id))
      ) cc), '[]'::jsonb),

    'collection_reinstatements', coalesce((
      select jsonb_agg(to_jsonb(cr)) from (
        select cr.* from ceedo_collections.collection_reinstatements cr
          join ceedo_collections.collection_cancellations cc on cc.id = cr.cancellation_id
          join _fresh_receipts fr on fr.id = cc.collection_id
        union all
        select cr.* from ceedo_collections.collection_reinstatements cr
          join ceedo_collections.collection_cancellations cc on cc.id = cr.cancellation_id
          join ceedo_collections.collections c on c.id = cc.collection_id
         where cr.row_version > p_cursor
           and not exists (select 1 from _fresh_receipts fr where fr.id = c.id)
           and (exists (select 1 from _scope_leases sl where sl.id = c.lease_id)
                    or exists (select 1 from _scope_collectors sc where sc.id = c.collector_id))
      ) cr), '[]'::jsonb),

    'charge_condonations', coalesce((
      select jsonb_agg(to_jsonb(cd)) from ceedo_collections.charge_condonations cd
       join ceedo_collections.charges ch on ch.id = cd.charge_id
       join _scope_leases sl on sl.id = ch.lease_id
       where cd.row_version > p_cursor or sl.fresh), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- One full re-pull per tablet, so each receives the history a delta pull cannot reach.
-- Device-authored receipts and the outbox are untouched (see migration 0056).
update ceedo_collections.devices set assignment_epoch = assignment_epoch + 1 where true;
