-- sync_push: clear v_collector between entries, so a rejected receipt is never filed
-- against the previous entry's collector. Parent spec §11.3.
--
-- WHAT WAS WRONG (pre-existing since migration 0035; migration 0039 neither introduced it
-- nor touched it). `v_collector` is declared at FUNCTION scope and was assigned only as the
-- first statement of each entry's dispatch block. PL/pgSQL variables are not rolled back by
-- a subtransaction -- only DATABASE state is. So when an entry's
-- `nullif(v_payload ->> 'collector_id', '')::uuid` raises, the dispatch handler catches it,
-- `v_collector` still holds whatever the LAST entry that got that far put there, and the
-- exception-filing block below then files this entry's exception against that collector.
--
-- Demonstrated live, one batch, two entries:
--
--   entry 0: collector_id = a835224d...    -> rejected, collector_not_on_device
--   entry 1: collector_id = "not-a-uuid"   -> rejected, server_error
--
--   sync_exceptions:
--     1111...  collector_id a835224d...  collector_not_on_device
--     2222...  collector_id a835224d...  server_error      <-- entry 1, entry 0's collector
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. `sync_exceptions` is indexed and read BY COLLECTOR,
-- and §11.3 has an unresolved exception counting against that collector at closeout. So this
-- is not a cosmetic mislabel: it attaches a failed receipt to a person who had nothing to do
-- with it, in the queue a supervisor uses to decide whether someone is short. And it
-- SUCCEEDS -- the row is written, the foreign key is satisfied, nothing is raised and nothing
-- is logged. A silent wrong answer is worse than a loud failure, which is the whole argument
-- for fixing it before Phase 3b rather than carrying it.
--
-- THE FIX, and why this shape. `v_collector := null;` at the top of the loop body, rather
-- than re-deriving the id inside the filing block. Two reasons: it fixes the stale-variable
-- fault itself rather than one symptom of it, so any future reader of `v_collector` after
-- the dispatch block is safe by construction; and re-deriving would put a second copy of the
-- same cast expression in the function, which is how the two copies drift apart later. The
-- cost is that an entry whose collector_id cannot be parsed now files NO exception at all --
-- correctly, because there is no collector to file it against -- and says so in `detail`, by
-- way of migration 0039's filing subtransaction.
--
-- NO OTHER VARIABLE NEEDS THIS, and that was checked rather than assumed:
--
--   v_one       -- assigned on every dispatch path, including the exception handler.
--   v_reason    -- assigned from v_one at the top of the filing block.
--   v_retryable -- assigned from v_reason immediately after.
--   v_uuid      -- assigned inside the filing block, and the only statement that reads it is
--                  the `if v_uuid is not null` on the very next line. If its cast raises,
--                  control leaves for the handler without reaching that read, so a stale
--                  value can never be used.
--   v_type, v_payload, v_index -- assigned unconditionally at the top of the loop body.
--
-- Everything else below is migration 0039's body verbatim.

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
    -- THE FIX. See this migration's header: without this, a failed cast leaves the
    -- PREVIOUS entry's collector in scope and the filing below blames them.
    v_collector := null;

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
