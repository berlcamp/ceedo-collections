-- sync_push: put the exception filing INSIDE a subtransaction, and never let a failed
-- filing lose the entry. Parent spec §6.3.
--
-- WHAT WAS WRONG. Migration 0035's per-entry `begin ... exception when others` CLOSED
-- before the exception-filing block ran. Dispatch was isolated; filing was not. The filing
-- INSERT therefore executed in the OUTER transaction, so any error it raised aborted the
-- whole `sync_push()` call — every entry in the batch, including the ones already
-- accepted. Three inputs a device can actually send do exactly that:
--
--   collector_id naming no app_users row -> sync_exceptions_collector_id_fkey
--   collector_id absent or null          -> sync_exceptions.collector_id NOT NULL
--   payload.id not a valid UUID          -> the nullif(...)::uuid cast
--
-- Observed over real HTTP as ceedo_app with a two-entry batch (one good receipt, one
-- naming a non-existent collector): 500 {"error":"sync_failed"}, and the GOOD receipt
-- never reached `collections`. Both entries lost, nothing filed, and because the device
-- keeps an unacked entry in its outbox it re-pushes the identical batch forever — a
-- permanent sync deadlock with the cash already taken. That is precisely the discard
-- failure §6.3 exists to prevent, and 0035's own header claimed it was proven impossible.
--
-- THE RULE THIS RESTORES. A rejected push must never mean a discarded record. So the
-- filing gets its own subtransaction, and when the filing itself fails the entry is still
-- REPORTED as rejected, with the filing failure appended to `detail` rather than swallowed:
-- a supervisor who cannot find the exception in the queue still has the device's answer
-- saying why. Losing the exception row is bad; losing the whole round is unrecoverable.
--
-- AND THE RESOLVED-ROW GUARD (`where ... status <> 'resolved'`). §6.4 keeps a rejected
-- entry visible on the device until it is dealt with, so a device re-pushes it every sync
-- — including after a supervisor has already resolved it as `spoiled` or `corrected`.
-- Without this predicate, that re-push overwrites `reason_code` on the resolved row and
-- bumps `attempts`, destroying the record of why the exception was filed in the first
-- place. A resolved exception is history and must stop moving.
--
-- Everything else below is migration 0035's body verbatim.

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
begin
  if not exists (select 1 from ceedo_collections.devices where id = p_device_id and active) then
    raise exception 'No such device, or the device is inactive';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_index := v_index + 1;
    v_type := v_entry ->> 'type';
    v_payload := coalesce(v_entry -> 'payload', '{}'::jsonb);

    begin
      -- Every path that names a collector checks this first. post_collection() then checks
      -- the BOOKLET, which §11.5 says is the actual security boundary -- but a collector
      -- who is not cleared for this tablet is a scoping error worth its own answer.
      v_collector := nullif(v_payload ->> 'collector_id', '')::uuid;
      if v_type in ('collection', 'spoiled_form', 'shift_open')
         and not ceedo_collections.can_collector_use_device(v_collector, p_device_id) then
        v_one := jsonb_build_object('status', 'rejected',
                                    'reason', 'collector_not_on_device');

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
        -- ITS OWN SUBTRANSACTION. See this migration's header: without it, a filing that
        -- raises takes the entire batch down with it.
        begin
          v_uuid := nullif(v_payload ->> 'id', '')::uuid;
          if v_uuid is not null then
            insert into ceedo_collections.sync_exceptions
              (collection_uuid, device_id, collector_id, reason_code, payload)
            values (v_uuid, p_device_id, v_collector, v_reason, v_payload)
            on conflict (collection_uuid) do update
              set attempts     = ceedo_collections.sync_exceptions.attempts + 1,
                  last_seen_at = now(),
                  reason_code  = excluded.reason_code
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
