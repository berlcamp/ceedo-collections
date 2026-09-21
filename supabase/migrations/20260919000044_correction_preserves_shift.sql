-- Spec E3: a correction re-posts the original shift_id, not just the original UUID.
--
-- Phase 3a's D9 rules that "accept with correction" re-runs post_collection with the
-- rejected entry's original UUID, so the device's outbox stays coherent and settles on
-- `duplicate`. resolve_exception_corrected (migration 0036) implements that by merging the
-- supervisor's edits over the device's stored payload and then RE-ASSERTING `id` and
-- `device_id` on top -- "facts about the push, not claims open to correction", as its own
-- comment puts it.
--
-- Once collections carry shift_id (migration 0043), it is a third fact of exactly that kind,
-- and it was not in that list. A corrected receipt is cash that was physically in that
-- collector's drawer during that shift. A correction that dropped the shift_id, or took the
-- supervisor's current context instead, would silently move that money out of the shift it
-- belonged to -- and a closeout that had already balanced would stop balancing, with nothing
-- pointing at why.
--
-- Read from v_ex.payload, NOT from p_payload: the device's original claim is the one that is
-- true. An exception whose payload has no shift_id yields a JSON null here, which
-- nullif()::uuid in post_collection turns into a SQL NULL -- correct for a pre-3b-i entry
-- that genuinely belonged to no shift.
--
-- Migration 0036's body verbatim but for that one expression and the comment above it.
-- resolve_exception_spoiled, escalate_exception and assert_can_resolve_exceptions are NOT
-- reproduced here: they are unchanged, nothing in this migration touches them, and a second
-- verbatim copy is one more body a future reader has to diff. This follows migration 0040,
-- which replaced close_shift alone out of 0034's file.

create or replace function ceedo_collections.resolve_exception_corrected(
  p_exception_id uuid,
  p_payload      jsonb,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex       ceedo_collections.sync_exceptions%rowtype;
  v_merged   jsonb;
  v_result   jsonb;
  v_pg_role  text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_can_resolve_exceptions(p_reason);

  select * into v_ex from ceedo_collections.sync_exceptions where id = p_exception_id
    for update;
  if not found then
    raise exception 'No such exception';
  end if;
  if v_ex.status = 'resolved' then
    raise exception 'Exception % is already resolved', p_exception_id;
  end if;

  -- The device's original claims, with the supervisor's edits on top. `id`, `device_id`
  -- and `shift_id` are re-asserted AFTER the merge so a correction cannot change which
  -- receipt, which tablet or which shift this is -- those are facts about the push, not
  -- claims open to correction.
  v_merged := v_ex.payload || coalesce(p_payload, '{}'::jsonb)
              || jsonb_build_object('id', v_ex.collection_uuid,
                                    'device_id', v_ex.device_id,
                                    'shift_id', v_ex.payload ->> 'shift_id');

  v_result := ceedo_collections.post_collection(v_merged);

  if v_result ->> 'status' in ('accepted', 'duplicate') then
    update ceedo_collections.sync_exceptions
       set status            = 'resolved',
           resolution        = 'corrected',
           resolution_reason = p_reason,
           resolved_by       = auth.uid(),
           resolved_at       = now(),
           payload           = v_merged
     where id = p_exception_id;

    insert into ceedo_collections.audit_log
      (actor_id, pg_role, action, entity, entity_id, before, after)
    values (auth.uid(), v_pg_role, 'resolve_exception_corrected', 'sync_exceptions',
            p_exception_id, to_jsonb(v_ex),
            jsonb_build_object('reason', p_reason, 'result', v_result));
  else
    -- Rejected again. The exception stays open and records the new reason, so a supervisor
    -- sees what their correction actually hit rather than the original complaint.
    update ceedo_collections.sync_exceptions
       set reason_code  = v_result ->> 'reason',
           last_seen_at = now()
     where id = p_exception_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  from public;
grant execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  to authenticated;
