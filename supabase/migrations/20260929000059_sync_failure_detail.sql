-- A rejected push says WHY, on the server as well as the tablet. Parent spec §6.3, §11.3.
--
-- WHAT WENT WRONG IN PRODUCTION. A tablet's shift_close was refused while the tablet, as
-- designed, closed the shift locally anyway (closed_unsynced) so the collector was not held
-- at the screen. The server's shift stayed open. The next sign-in queued a shift_open, which
-- shifts_one_open_per_device refused; the three receipts collected under that new shift then
-- each broke collections_shift_id_fkey. All four failures became `server_error`, and the
-- exceptions screen showed three identical rows reading "The server failed while posting
-- this entry" -- because sqlerrm went back to the tablet in `detail` and nowhere else.
-- Nothing on the server said which shift, or why.
--
-- THREE CHANGES, none of them a new reason code. PushResult.reason is a strict enum on the
-- tablet (packages/shared sync-contract.ts), and tablets already in the field would refuse
-- to parse a response carrying a code they do not know -- failing the WHOLE sync, not one
-- entry. So every failure below is still `server_error`; what changes is that its `detail`
-- names the cause, and that the detail is kept.
--
--   1. sync_exceptions.detail -- the rejection's own words, stored with the exception and
--      refreshed on every re-push, so the supervisor reads the cause instead of a code.
--   2. sync_push checks a collection's shift before posting it. The foreign-key message
--      names a constraint; this names the shift and what to do about it.
--   3. open_shift refuses a second open shift on a device by NAMING the one still open,
--      instead of letting the unique index raise an index name.

alter table ceedo_collections.sync_exceptions add column detail text;

comment on column ceedo_collections.sync_exceptions.detail is
  'The rejection''s detail as sync_push reported it on the latest push, e.g. the database '
  'error behind a server_error. Null for rows filed before migration 0059.';

create or replace function ceedo_collections.open_shift(
  p_device_id uuid,
  p_collector uuid,
  p_payload   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id    uuid := (p_payload ->> 'id')::uuid;
  v_other ceedo_collections.shifts%rowtype;
begin
  -- Checked before the insert so the refusal names the shift that is in the way. The
  -- unique index still holds the rule; this only words it. `id <> v_id` keeps a retried
  -- push of THIS shift answering `duplicate` below rather than tripping over itself.
  select * into v_other
    from ceedo_collections.shifts
   where device_id = p_device_id and status = 'open' and id <> v_id;
  if found then
    raise exception 'Shift % (opened %) is still open on the server for this tablet. '
                    'A supervisor must close it before shift % can open.',
      v_other.id, to_char(v_other.opened_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'),
      v_id;
  end if;

  -- The client generated this id offline (see migration 0028's comment on shifts.id), so a
  -- retried push carries the same one and must not mint a second shift.
  insert into ceedo_collections.shifts
    (id, collector_id, device_id, business_date, opened_at, status)
  values (v_id, p_collector, p_device_id,
          (p_payload ->> 'business_date')::date,
          (p_payload ->> 'opened_at')::timestamptz,
          'open')
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'shift_id', v_id);
  end if;
  return jsonb_build_object('status', 'accepted', 'shift_id', v_id);
end;
$$;

revoke execute on function ceedo_collections.open_shift(uuid, uuid, jsonb) from public;

-- sync_push: migration 0042's body verbatim but for the shift check in the collection
-- branch and `detail` in the exception filing.

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

      elsif v_type = 'collection' then
        -- device_id is OVERRIDDEN from the authenticated credential, never read from the
        -- payload (invariant 21). A device may claim any collector_id -- the PIN was
        -- verified offline, so that claim is unverifiable by construction and §11.5 accepts
        -- it -- but it must not be able to claim to be a different tablet.
        v_one := ceedo_collections.post_collection(
                   v_payload || jsonb_build_object('device_id', p_device_id));

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
