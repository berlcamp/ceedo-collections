-- The supervisor's three actions. Parent spec §11.3.
--
-- §11.3 names the three -- "accept with correction", "mark spoiled", "escalate for
-- investigation" -- but not what they write. Against an append-only ledger that needs
-- deciding, and the decision is:
--
-- CORRECTION RE-POSTS THE ORIGINAL CLIENT UUID. A rejected entry wrote nothing, so its
-- UUID is still free. Re-using it keeps the device's outbox coherent: the tablet still
-- holds that UUID as unresolved, and when it re-pushes, post_collection returns `duplicate`
-- against the now-posted row and the entry settles. A correction under a fresh UUID would
-- leave the device re-pushing a ghost that nothing recognises.
--
-- THE SUPERVISOR MAY EDIT CLAIMS, NEVER AMOUNTS. post_collection's payload carries no
-- amounts at all (see migration 0022's header), so this is enforced by construction rather
-- than by filtering: whatever the supervisor sends, the server prices it. Invariant 3
-- holds for supervisors exactly as for devices.
--
-- Note on the stored payload: sync_push (migration 0035) files the exception with the
-- entry's payload BEFORE device_id is merged in for post_collection -- device_id lives on
-- sync_exceptions as its own column, not inside payload. The re-assertion below is what
-- supplies it back, not merely a defensive re-check.

create or replace function ceedo_collections.assert_can_resolve_exceptions(p_reason text)
returns void
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.has_role('admin', 'supervisor') then
    raise exception 'Only a supervisor or administrator may resolve a sync exception';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A written reason is required';
  end if;
end;
$$;

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

  -- The device's original claims, with the supervisor's edits on top. `id` and `device_id`
  -- are re-asserted AFTER the merge so a correction cannot change which receipt or which
  -- tablet this is -- those are facts about the push, not claims open to correction.
  v_merged := v_ex.payload || coalesce(p_payload, '{}'::jsonb)
              || jsonb_build_object('id', v_ex.collection_uuid,
                                    'device_id', v_ex.device_id);

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

create or replace function ceedo_collections.resolve_exception_spoiled(
  p_exception_id uuid,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex      ceedo_collections.sync_exceptions%rowtype;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
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

  -- The serial is spent either way -- that is §6.3's whole point -- so it is recorded as
  -- spoiled rather than left looking unused. No collection is posted.
  insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
  values ((v_ex.payload ->> 'booklet_id')::uuid,
          (v_ex.payload ->> 'or_no')::integer,
          p_reason,
          v_ex.collector_id)
  on conflict (booklet_id, or_no) do nothing;

  update ceedo_collections.sync_exceptions
     set status            = 'resolved',
         resolution        = 'spoiled',
         resolution_reason = p_reason,
         resolved_by       = auth.uid(),
         resolved_at       = now()
   where id = p_exception_id;

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'resolve_exception_spoiled', 'sync_exceptions',
          p_exception_id, to_jsonb(v_ex), jsonb_build_object('reason', p_reason));

  return jsonb_build_object('status', 'resolved', 'resolution', 'spoiled');
end;
$$;

create or replace function ceedo_collections.escalate_exception(
  p_exception_id uuid,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_ex      ceedo_collections.sync_exceptions%rowtype;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
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

  -- A STATUS, not a resolution. An escalated exception is still unresolved and still counts
  -- against the collector at closeout; §11.3 says exceptions older than three days surface
  -- on the Treasurer's dashboard, which only works if escalation does not close them.
  update ceedo_collections.sync_exceptions
     set status = 'escalated', resolution_reason = p_reason
   where id = p_exception_id;

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'escalate_exception', 'sync_exceptions',
          p_exception_id, to_jsonb(v_ex), jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function ceedo_collections.assert_can_resolve_exceptions(text) from public;
revoke execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  from public;
grant execute on function ceedo_collections.resolve_exception_corrected(uuid, jsonb, text)
  to authenticated;
revoke execute on function ceedo_collections.resolve_exception_spoiled(uuid, text) from public;
grant execute on function ceedo_collections.resolve_exception_spoiled(uuid, text)
  to authenticated;
revoke execute on function ceedo_collections.escalate_exception(uuid, text) from public;
grant execute on function ceedo_collections.escalate_exception(uuid, text) to authenticated;
