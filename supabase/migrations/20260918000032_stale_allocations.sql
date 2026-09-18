-- post_collection(), amended: the lost-FIFO-race branch gets its own reason code.
--
-- The engine is unchanged in every other respect. This migration exists because Postgres
-- cannot patch one branch of a function, so the whole body is reproduced from migration
-- 0022. Diff the two files before reviewing: exactly one `return` differs.
--
-- Phase 2's handover names the gap this closes:
--
--   "A lost race returns allocation_not_prefix, which misleads. The behaviour is correct
--    -- rejected, nothing written -- but the name points at a data problem. The right
--    device response to a lost race is re-sync and retry automatically, not raise a
--    supervisor exception. Phase 3 should add a distinct retryable reason code to
--    REJECT_REASONS when it builds the outbox, and have post_collection return it on the
--    re-read mismatch branch."
--
-- This matters more in Phase 3 than it did in Phase 2, because Phase 3 is the first time
-- multiple tablets push concurrently against one lease. §3 notes collectors rotate across
-- shared tablets; two devices holding the same lease is routine, not an edge case.
--
-- Payload shape:
--   {
--     "id": uuid,                  -- CLIENT-GENERATED. Idempotency key.
--     "or_no": integer,
--     "booklet_id": uuid,
--     "collector_id": uuid,
--     "device_id": uuid,
--     "collected_at": timestamptz,
--     "fee_type_id": uuid,
--     "lease_id": uuid | null,
--     "payer_ref": text | null,
--     "notes": text | null,
--     "allocations": [{ "group_rank": integer }],        -- settles charges
--     "lines": [{ "fee_type_id": uuid, "rate_class": text, "quantity": integer }]
--   }
--
-- Note what the payload does NOT carry: amounts. The device proposes WHICH periods and
-- HOW MANY units; the server decides what that costs. Invariant #3 -- the device's figure
-- is a claim to be checked, never truth -- is enforced by never accepting the figure at
-- all.
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
      fee_type_id, lease_id, payer_ref, notes, gross_amount, synced_at, posted_by
    )
    values (
      v_id, v_or_no, v_booklet_id, v_collector_id, v_device_id, v_collected_at, v_business,
      v_fee_type_id, v_lease_id, p_payload ->> 'payer_ref', p_payload ->> 'notes',
      v_gross, now(), auth.uid()
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
-- Task 9 moves this to the sync path. Until then, unchanged from migration 0022.
grant execute on function ceedo_collections.post_collection(jsonb) to service_role;
