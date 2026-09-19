-- shift_id on collections, so closeout scopes to the shift being closed instead of
-- inferring it from (collector_id, business_date).
--
-- WHY THIS WAS DEFERRED, AND WHAT IT FIXES. close_shift (migration 0034) sums every
-- collection for the closing shift's collector and business date. That is spec §6.5 step 3
-- taken literally, and it assumes one collector, one device, one shift per date. Two real
-- cases break it: a collector working two tablets the same day, and a second shift opened
-- on the same device later the same day (shifts_one_open_per_device forbids only
-- SIMULTANEOUSLY open shifts, and deliberately permits the sequence).
--
-- Both failed SAFE -- the server's figures are a superset of what the closing device knows,
-- so its count falls short and the mismatch branch returns before any write. Never a
-- correctness bug; always an honest closeout refused, needing a supervisor.
--
-- NULLABLE, AND THAT IS CORRECT RATHER THAN CONVENIENT. Every collection posted before this
-- migration, and every collection a supervisor posts from the web, belongs to no device
-- shift. There is nothing to backfill: a null shift_id is a true statement about those rows.

alter table ceedo_collections.collections
  add column shift_id uuid references ceedo_collections.shifts(id);

comment on column ceedo_collections.collections.shift_id is
  'The device shift this receipt was collected during. Null for collections posted before '
  'Phase 3b-i and for any posted from the web, which belong to no device shift.';

-- Closeout reads this, and reads it filtered by shift. Without the index that scan is
-- seq-scan-per-closeout on the largest table in the schema.
create index collections_shift_id_idx
  on ceedo_collections.collections (shift_id)
  where shift_id is not null;

-- post_collection: carry shift_id from the payload onto the row.
--
-- Only the declaration and the INSERT change. The function is otherwise migration 0032's
-- verbatim, and is reproduced in full because `create or replace` replaces the whole body --
-- there is no partial form, and an abbreviated copy here would silently drop every branch
-- it omitted.

create or replace function ceedo_collections.post_collection(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id           uuid := (p_payload ->> 'id')::uuid;
  v_or_no        integer := (p_payload ->> 'or_no')::integer;
  v_booklet_id   uuid := (p_payload ->> 'booklet_id')::uuid;
  v_collector_id uuid := (p_payload ->> 'collector_id')::uuid;
  v_device_id    uuid := (p_payload ->> 'device_id')::uuid;
  v_collected_at timestamptz := (p_payload ->> 'collected_at')::timestamptz;
  v_fee_type_id  uuid := (p_payload ->> 'fee_type_id')::uuid;
  v_lease_id     uuid := nullif(p_payload ->> 'lease_id', '')::uuid;
  v_shift_id     uuid := nullif(p_payload ->> 'shift_id', '')::uuid;
  v_business     date;
  v_booklet      ceedo_collections.booklets%rowtype;
  v_ranks        integer[];
  v_max_rank     integer;
  v_group        record;
  v_line         jsonb;
  v_rate         ceedo_collections.rates%rowtype;
  v_gross        numeric(14,2) := 0;
  v_existing     uuid;
  v_allocations  jsonb := '[]'::jsonb;
  v_alloc_rows   jsonb;
  v_lines        jsonb := '[]'::jsonb;
  v_matched      integer := 0;
  -- The charge rows this prefix named when it was first read, and the ones it names once
  -- the row locks are held. They are compared; see STEP 4b.
  v_locked_ids   uuid[];
  v_seen_ids     uuid[] := '{}'::uuid[];
  v_group_ids    uuid[];
  v_constraint   text;
begin
  -- STEP 1: IDEMPOTENCY. Before anything else, and by primary key.
  -- A retry after a dropped connection carries the same client-generated id and must
  -- return duplicate, not issue a second receipt (invariant #2).
  select id into v_existing from ceedo_collections.collections where id = v_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'collection_id', v_existing);
  end if;

  v_business := (v_collected_at at time zone 'Asia/Manila')::date;

  -- STEP 2: AUTHORIZE against the booklet. The booklet, not the PIN, is the security
  -- boundary (parent spec §11.5): a person who knows another collector's PIN still cannot
  -- post against a booklet they are not holding.
  select * into v_booklet from ceedo_collections.booklets where id = v_booklet_id;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'booklet_not_assigned',
                              'detail', 'No such booklet');
  end if;

  if not exists (
    select 1 from ceedo_collections.booklet_assignments a
    where a.booklet_id = v_booklet_id
      and a.collector_id = v_collector_id
      and a.assigned_at <= v_business
      and (a.returned_at is null or a.returned_at >= v_business)
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'booklet_not_assigned',
      'detail', format('Booklet %s was not assigned to collector %s on %s',
                       v_booklet_id, v_collector_id, v_business));
  end if;

  if v_or_no < v_booklet.start_no or v_or_no > v_booklet.end_no then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_out_of_range',
      'detail', format('OR %s is outside booklet range %s-%s',
                       v_or_no, v_booklet.start_no, v_booklet.end_no));
  end if;

  -- The same serial recorded on a second device reaches here, and this is the only place
  -- it can be caught -- neither tablet can see the other's outbox.
  if exists (
    select 1 from ceedo_collections.collections
    where booklet_id = v_booklet_id and or_no = v_or_no
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_already_used',
      'detail', format('OR %s in this booklet is already recorded', v_or_no));
  end if;

  if exists (
    select 1 from ceedo_collections.spoiled_forms
    where booklet_id = v_booklet_id and or_no = v_or_no
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'or_spoiled',
      'detail', format('OR %s was recorded spoiled', v_or_no));
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_payload -> 'lines', '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'no_parts',
      'detail', 'A collection must carry allocations or lines');
  end if;

  -- STEP 4: FIFO. Validated before any write, so a rejection leaves nothing behind.
  if jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) > 0 then
    if v_lease_id is null then
      return jsonb_build_object('status', 'rejected', 'reason', 'lease_not_found',
        'detail', 'Allocations need a lease');
    end if;

    select array_agg((a ->> 'group_rank')::integer)
      into v_ranks
      from jsonb_array_elements(p_payload -> 'allocations') a;

    select max(r) into v_max_rank from unnest(v_ranks) r;

    -- A contiguous oldest-first prefix is exactly the ranks 1..n, so checking the set
    -- against its own maximum is the whole rule. Distinct guards against a duplicated
    -- rank allocating twice against one period while still passing a length check.
    if array_length(v_ranks, 1) <> v_max_rank
       or array_length(array(select distinct unnest(v_ranks)), 1) <> v_max_rank then
      return jsonb_build_object('status', 'rejected', 'reason', 'allocation_not_prefix',
        'detail', 'Allocations must be a contiguous oldest-first prefix of unpaid periods');
    end if;
  end if;

  -- STEP 4b: LOCK the charge rows this prefix names, before anything is priced or written.
  --
  -- Without this, two shared tablets syncing the same lease at the same moment both read
  -- unpaid_period_groups, both see group_rank 1 unpaid, and both allocate against it.
  -- Nothing in the schema stops them: collection_allocations' unique (collection_id,
  -- charge_id) prevents ONE collection allocating twice to one charge, not two collections
  -- allocating to the same one. The result is two OR numbers and two tenants' money
  -- against one period, and because is_settled is `outstanding <= 0` the double payment
  -- reads as settled and looks entirely correct.
  --
  -- Ordered by id so two posts over overlapping prefixes queue rather than deadlock.
  if v_ranks is not null then
    select coalesce(array_agg(s.cid order by s.cid), '{}'::uuid[])
      into v_locked_ids
      from (
        select unnest(g.charge_ids) as cid
        from ceedo_collections.unpaid_period_groups(v_lease_id) g
        where g.group_rank = any(v_ranks)
      ) s;

    perform 1
    from ceedo_collections.charges c
    where c.id = any(v_locked_ids)
    order by c.id
    for update;
  end if;

  -- STEP 3: RECOMPUTE, into local structures. Nothing is written until the total is
  -- known, so the parent row is inserted once, correct, and never corrected -- which is
  -- the only shape compatible with having no UPDATE privilege on the table.
  --
  -- This re-reads unpaid_period_groups now that the locks are held: under READ COMMITTED
  -- a statement issued after a blocking transaction commits sees its effects, so these
  -- figures are the post-wait truth, not the ones read before the wait.
  if v_ranks is not null then
    for v_group in
      select * from ceedo_collections.unpaid_period_groups(v_lease_id)
      where group_rank = any(v_ranks)
      order by group_rank
    loop
      v_matched := v_matched + 1;

      -- A whole period group settles in full, never partially (§8.3). The amount comes
      -- from what is actually outstanding, not from anything the caller sent.
      select coalesce(jsonb_agg(jsonb_build_object('charge_id', b.id, 'amount', b.outstanding)), '[]'::jsonb),
             coalesce(array_agg(b.id), '{}'::uuid[])
        into v_alloc_rows, v_group_ids
        from ceedo_collections.charge_balances b
       where b.id = any(v_group.charge_ids) and b.outstanding > 0;

      v_allocations := v_allocations || v_alloc_rows;
      v_seen_ids := v_seen_ids || v_group_ids;
      v_gross := v_gross + v_group.outstanding;
    end loop;

    -- Fewer groups came back than were asked for: a rank pointed at a period that is
    -- already settled, or the lease has fewer unpaid periods than the caller believed.
    -- Either way the caller's view of this lease is stale and the post must not proceed.
    if v_matched <> v_max_rank then
      return jsonb_build_object('status', 'rejected', 'reason', 'allocation_not_prefix',
        'detail', format('Requested %s period groups but only %s are unpaid',
                         v_max_rank, v_matched));
    end if;

    -- The prefix names a different set of charge rows than the one that was locked: a
    -- concurrent post settled part of it while this one waited on the lock, and the ranks
    -- have shifted underneath. Allocating anyway would silently aim this tenant's money at
    -- a period they were not paying for, so the stale caller is told to re-read instead.
    if (select array_agg(x order by x) from unnest(v_seen_ids) x) is distinct from v_locked_ids then
      return jsonb_build_object('status', 'rejected', 'reason', 'stale_allocations',
        'detail', 'The unpaid periods changed while this post waited; re-read and retry');
    end if;
  end if;

  -- Lines: the quantity comes from the caller, the unit rate from the rate table as of
  -- the collection date. A modified client can claim twelve hogs; it cannot claim a price.
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    select * into v_rate
    from ceedo_collections.rates r
    where r.fee_type_id = (v_line ->> 'fee_type_id')::uuid
      and r.rate_class = coalesce(v_line ->> 'rate_class', '')
      and r.effective_from <= v_business
      and (r.effective_to is null or r.effective_to >= v_business);

    if not found then
      return jsonb_build_object('status', 'rejected', 'reason', 'rate_not_found',
        'detail', format('No rate for fee type %s class %s on %s',
                         v_line ->> 'fee_type_id', coalesce(v_line ->> 'rate_class', ''),
                         v_business));
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'fee_type_id', v_line ->> 'fee_type_id',
      'rate_class', coalesce(v_line ->> 'rate_class', ''),
      'quantity', (v_line ->> 'quantity')::integer,
      'unit_rate', v_rate.amount));

    v_gross := v_gross + ((v_line ->> 'quantity')::integer * v_rate.amount);
  end loop;

  -- STEP 5: WRITE. One transaction, parent first for the foreign keys, gross already
  -- final. The deferred balance trigger re-checks the total at commit regardless.
  --
  -- The parent and every one of its parts are written here, in this one transaction, and
  -- parts are never appended to an existing collection afterwards. The collections_balance
  -- trigger (migration 0017) fires on INSERT into `collections` only, so it checks the
  -- parts present in the transaction that created the parent. Parts added later would
  -- never be weighed against gross_amount at all, and invariant #9 would be silently
  -- unenforced for them.
  begin
    insert into ceedo_collections.collections (
      id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
      fee_type_id, lease_id, payer_ref, notes, shift_id, gross_amount, synced_at, posted_by
    )
    values (
      v_id, v_or_no, v_booklet_id, v_collector_id, v_device_id, v_collected_at, v_business,
      v_fee_type_id, v_lease_id, p_payload ->> 'payer_ref', p_payload ->> 'notes',
      v_shift_id, v_gross, now(), auth.uid()
    );
  exception
    -- The only place a raise is converted rather than returned. Two unique constraints can
    -- lose a race here and they mean opposite things, so the handler asks which one fired:
    --
    --   collections_pkey -- two concurrent posts of the same client id both passed the
    --   STEP 1 lookup. The primary key settles it, and the loser reports duplicate rather
    --   than failing, which is what a retrying device needs to hear.
    --
    --   collections_serial_spent_once -- two DIFFERENT collections claimed one serial and
    --   both passed the or_already_used check. That is not a retry and must not be reported
    --   as one: no row with this id exists, and a supervisor has to account for the serial.
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'collections_serial_spent_once' then
        return jsonb_build_object('status', 'rejected', 'reason', 'or_already_used',
          'detail', format('OR %s in this booklet is already recorded', v_or_no));
      elsif v_constraint = 'collections_pkey' then
        return jsonb_build_object('status', 'duplicate', 'collection_id', v_id);
      else
        raise;
      end if;
  end;

  insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
  select v_id, (a ->> 'charge_id')::uuid, (a ->> 'amount')::numeric
  from jsonb_array_elements(v_allocations) a;

  insert into ceedo_collections.collection_lines
    (collection_id, fee_type_id, rate_class, quantity, unit_rate)
  select v_id, (l ->> 'fee_type_id')::uuid, l ->> 'rate_class',
         (l ->> 'quantity')::integer, (l ->> 'unit_rate')::numeric
  from jsonb_array_elements(v_lines) l;

  -- STEP 6: respond.
  return jsonb_build_object('status', 'accepted', 'collection_id', v_id,
                            'gross_amount', v_gross);
end;
$$;

revoke execute on function ceedo_collections.post_collection(jsonb) from public;
-- NOT re-granted. Migration 0032 ended with a grant to service_role; migration 0035 revoked
-- it deliberately, because sync_push is SECURITY DEFINER and reaches post_collection as its
-- owner, so no role needs a grant at all. Copying 0032's trailer verbatim would have handed
-- that privilege back. The revoke is repeated here to state the intended end state.
revoke execute on function ceedo_collections.post_collection(jsonb) from service_role;

-- close_shift: scope by shift_id.
--
-- Migration 0040's body verbatim -- including its NULL check on p_declared_total, which
-- refuses a close carrying no cash declaration -- with one query rescoped.

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
       select 1 from ceedo_collections.collection_cancellations cc
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

revoke execute on function ceedo_collections.close_shift(uuid, uuid, numeric, integer, numeric)
  from public;
grant execute on function ceedo_collections.close_shift(uuid, uuid, numeric, integer, numeric)
  to ceedo_app;
