-- Collection reports phase 3: keyed amounts and payment mode reach the ledger.
--
-- post_collection: migration 0043's body verbatim but for (a) keyed lines take their amount
-- from the payload instead of the rate table, and (b) the INSERT writes payment_mode and the
-- check fields. No new reason code (tablets parse a strict enum): a bad keyed amount is
-- `amount_mismatch`, already in the vocabulary.
--
-- sync_push: migration 0059's body verbatim but for one branch refusing a non-cash receipt.
-- Field collectors take cash; the database refuses a check with a tablet anyway
-- (collections_check_only_from_office), and this turns that into a sentence.

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
  v_mode         text;
  v_unit         numeric(14,2);
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

  -- Lines. A rate fee: the quantity from the caller, the unit rate from the rate table as of
  -- the collection date -- a modified client can claim twelve hogs, not a price. A keyed fee
  -- (electricity, certification, occupancy...): one line of quantity 1 at the typed amount.
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    select amount_mode into v_mode
      from ceedo_collections.fee_types where id = (v_line ->> 'fee_type_id')::uuid;

    if v_mode = 'keyed' then
      if coalesce((v_line ->> 'quantity')::integer, 0) <> 1
         or coalesce(nullif(v_line ->> 'amount', '')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'rejected', 'reason', 'amount_mismatch',
          'detail', 'A keyed fee is one line of quantity 1 with an amount above zero');
      end if;
      v_unit := round((v_line ->> 'amount')::numeric, 2);
    else
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
      v_unit := v_rate.amount;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'fee_type_id', v_line ->> 'fee_type_id',
      'rate_class', coalesce(v_line ->> 'rate_class', ''),
      'quantity', (v_line ->> 'quantity')::integer,
      'unit_rate', v_unit));

    v_gross := v_gross + ((v_line ->> 'quantity')::integer * v_unit);
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
      fee_type_id, lease_id, payer_ref, notes, shift_id, gross_amount, synced_at, posted_by,
      payment_mode, check_no, bank, check_date
    )
    values (
      v_id, v_or_no, v_booklet_id, v_collector_id, v_device_id, v_collected_at, v_business,
      v_fee_type_id, v_lease_id, p_payload ->> 'payer_ref', p_payload ->> 'notes',
      v_shift_id, v_gross, now(), auth.uid(),
      coalesce(nullif(p_payload ->> 'payment_mode', ''), 'cash'),
      nullif(trim(p_payload ->> 'check_no'), ''),
      nullif(trim(p_payload ->> 'bank'), ''),
      nullif(p_payload ->> 'check_date', '')::date
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

create or replace function ceedo_collections.sync_push(
  p_device_id uuid,
  p_entries   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_results   jsonb := '[]'::jsonb;
  v_entry     jsonb;
  v_index     integer := -1;
  v_type      text;
  v_payload   jsonb;
  v_one       jsonb;
  v_collector uuid;
  v_uuid      uuid;
  v_reason    text;
  v_retryable boolean;
  v_shift     uuid;
begin
  if not exists (select 1 from ceedo_collections.devices where id = p_device_id and active) then
    raise exception 'No such device, or the device is inactive';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_index := v_index + 1;
    v_type := v_entry ->> 'type';
    v_payload := coalesce(v_entry -> 'payload', '{}'::jsonb);
    -- See migration 0042's header: without this, a failed cast leaves the PREVIOUS entry's
    -- collector in scope and the filing below blames them.
    v_collector := null;

    begin
      -- Every path that names a collector checks this first. post_collection() then checks
      -- the BOOKLET, which §11.5 says is the actual security boundary -- but a collector
      -- who is not cleared for this tablet is a scoping error worth its own answer.
      v_collector := nullif(v_payload ->> 'collector_id', '')::uuid;
      v_shift := nullif(v_payload ->> 'shift_id', '')::uuid;
      if v_type in ('collection', 'spoiled_form', 'shift_open')
         and not ceedo_collections.can_collector_use_device(v_collector, p_device_id) then
        v_one := jsonb_build_object('status', 'rejected',
                                    'reason', 'collector_not_on_device');

      elsif v_type = 'collection'
            and v_shift is not null
            and not exists (select 1 from ceedo_collections.shifts where id = v_shift) then
        -- Still `server_error` -- see this migration's header on why no new code. The
        -- receipt is sound; its shift is what is missing, almost always because that
        -- shift's own shift_open was refused earlier in this push or a previous one.
        v_one := jsonb_build_object('status', 'rejected', 'reason', 'server_error',
          'detail', format('Shift %s was never opened on the server, so this receipt has '
                           'no shift to belong to. Its shift_open was refused -- usually '
                           'because an earlier shift on this tablet is still open there.',
                           v_shift));

      elsif v_type = 'collection'
            and coalesce(nullif(v_payload ->> 'payment_mode', ''), 'cash') <> 'cash' then
        -- Still `server_error` (no new codes; see 0059). A tablet has no check field, so this
        -- is a modified or broken client; the paper receipt still needs a supervisor.
        v_one := jsonb_build_object('status', 'rejected', 'reason', 'server_error',
          'detail', 'Checks are accepted at the office only; a tablet receipt must be cash.');

      elsif v_type = 'collection' then
        -- device_id is OVERRIDDEN from the authenticated credential, never read from the
        -- payload (invariant 21). A device may claim any collector_id -- the PIN was
        -- verified offline, so that claim is unverifiable by construction and §11.5 accepts
        -- it -- but it must not be able to claim to be a different tablet.
        v_one := ceedo_collections.post_collection(
                   (v_payload - 'check_no' - 'bank' - 'check_date')
                   || jsonb_build_object('device_id', p_device_id, 'payment_mode', 'cash'));

      elsif v_type = 'spoiled_form' then
        v_one := ceedo_collections.record_spoiled_form(
                   p_device_id, v_collector, v_payload);

      elsif v_type = 'shift_open' then
        v_one := ceedo_collections.open_shift(p_device_id, v_collector, v_payload);

      elsif v_type = 'shift_close' then
        v_one := ceedo_collections.close_shift(
                   (v_payload ->> 'id')::uuid,
                   p_device_id,
                   (v_payload ->> 'declared_total')::numeric,
                   (v_payload ->> 'device_count')::integer,
                   (v_payload ->> 'device_total')::numeric);

      else
        -- Never silently skipped. A skipped entry is a lost receipt, and an unknown type
        -- means the device and the server disagree about the protocol -- which a person
        -- must learn about. `cancellation` lands here deliberately: spec D4 removed it,
        -- because a collector who can cancel their own receipts can make a shortfall
        -- disappear.
        v_one := jsonb_build_object('status', 'rejected', 'reason', 'unknown_entry_type');
      end if;

    exception when others then
      -- The subtransaction rolls back to here and the loop continues. Only THIS entry is
      -- lost; its neighbours are untouched.
      v_one := jsonb_build_object('status', 'rejected', 'reason', 'server_error',
                                  'detail', sqlerrm);
    end;

    -- Exception filing, for collections only. A spoiled form or a shift has no paper
    -- receipt behind it and nothing for a supervisor to reconcile.
    if v_type = 'collection' and v_one ->> 'status' = 'rejected' then
      v_reason := v_one ->> 'reason';
      -- Exactly one reason is retryable (invariant 24). The device re-pulls and re-pushes
      -- on its own; filing an exception would put a supervisor in front of a race that
      -- resolves itself.
      v_retryable := v_reason = 'stale_allocations';
      v_one := v_one || jsonb_build_object('retryable', v_retryable);

      if not v_retryable then
        -- ITS OWN SUBTRANSACTION. See migration 0039's header: without it, a filing that
        -- raises takes the entire batch down with it.
        begin
          v_uuid := nullif(v_payload ->> 'id', '')::uuid;
          if v_uuid is not null then
            insert into ceedo_collections.sync_exceptions
              (collection_uuid, device_id, collector_id, reason_code, payload, detail)
            values (v_uuid, p_device_id, v_collector, v_reason, v_payload,
                    v_one ->> 'detail')
            on conflict (collection_uuid) do update
              set attempts     = ceedo_collections.sync_exceptions.attempts + 1,
                  last_seen_at = now(),
                  reason_code  = excluded.reason_code,
                  detail       = excluded.detail
              where ceedo_collections.sync_exceptions.status <> 'resolved';
          end if;
        exception when others then
          -- The entry is still reported as rejected. The device keeps it in its outbox and
          -- a person is told why the queue has no row for it.
          v_one := v_one || jsonb_build_object('detail',
                     'rejected, and the exception could not be filed: ' || sqlerrm);
        end;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      v_one || jsonb_build_object('index', v_index, 'type', v_type));
  end loop;

  return v_results;
end;
$$;

revoke execute on function ceedo_collections.sync_push(uuid, jsonb) from public;
grant execute on function ceedo_collections.sync_push(uuid, jsonb) to ceedo_app;

-- post_collection's reason codes, as sentences for the admin holding the stub.
create or replace function ceedo_collections.recovery_refusal(p_result jsonb)
returns text
language sql
immutable
set search_path = ceedo_collections, pg_temp
as $$
  select case p_result ->> 'reason'
    when 'booklet_not_assigned'  then 'That booklet was not held by this collector on that day'
    when 'or_out_of_range'       then 'That serial is outside the booklet''s range'
    when 'or_already_used'       then 'That serial has already been used (it may have synced before the tablet was wiped)'
    when 'or_spoiled'            then 'That serial was recorded as spoiled'
    when 'no_parts'              then 'Tick at least one month, or add a fee line'
    when 'lease_not_found'       then 'No such lease'
    when 'allocation_not_prefix' then 'The months ticked are not the oldest unpaid ones. Enter the receipt that paid the earlier month first'
    when 'rate_not_found'        then 'No rate is in effect for that fee on that date'
    when 'stale_allocations'     then 'The unpaid months changed while this was saving. Try again'
    when 'amount_mismatch'       then 'Enter an amount above zero for that fee'
    else 'The receipt was refused (' || coalesce(p_result ->> 'reason', p_result ->> 'status') || ')'
  end;
$$;

revoke execute on function ceedo_collections.recovery_refusal(jsonb) from public;
