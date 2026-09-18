-- Transactions up. Parent spec §6.2.
--
-- A DISPATCHER, NOT AN ENGINE. §6.2 steps 1-6 are post_collection()'s job and were proven
-- in Phase 2; reimplementing any of them here would be the second implementation migration
-- 0022's comment warns about -- "a tenant would get a different balance depending on which
-- door they paid at."
--
-- PER-ENTRY ISOLATION -- AND THIS CLAIM WAS HALF TRUE UNTIL MIGRATION 0039. The block
-- below isolates DISPATCH. It closes before the exception-filing block that follows, so
-- filing ran in the OUTER transaction and any error it raised aborted the whole call --
-- every entry in the batch, accepted ones included. 0039 gives the filing its own
-- subtransaction and supersedes this function. Read that migration's header before
-- trusting the paragraph below.
--
-- Each entry runs in its own BEGIN/EXCEPTION block, which in PL/pgSQL
-- is a real subtransaction. A push carries a whole round -- potentially a hundred receipts
-- -- and one permanently-rejectable entry must cost its own receipt, never the round's.
-- One transaction per batch would block every other receipt in that round forever, which is
-- the discard failure §6.3 exists to prevent arriving by a different road.
--
-- Documented caveat: a 200-entry push opens 200 subtransactions. Well within Postgres's
-- tolerance at this scale. If a round ever grows large enough for this to matter, the
-- fallback is chunking the batch in the Edge Function, not removing the isolation.

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
        v_uuid := nullif(v_payload ->> 'id', '')::uuid;
        if v_uuid is not null then
          insert into ceedo_collections.sync_exceptions
            (collection_uuid, device_id, collector_id, reason_code, payload)
          values (v_uuid, p_device_id, v_collector, v_reason, v_payload)
          on conflict (collection_uuid) do update
            set attempts     = ceedo_collections.sync_exceptions.attempts + 1,
                last_seen_at = now(),
                reason_code  = excluded.reason_code;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      v_one || jsonb_build_object('index', v_index, 'type', v_type));
  end loop;

  return v_results;
end;
$$;

-- Helpers, kept out of the loop body so it reads as a dispatcher.

create or replace function ceedo_collections.record_spoiled_form(
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
  v_booklet uuid := (p_payload ->> 'booklet_id')::uuid;
  v_or_no   integer := (p_payload ->> 'or_no')::integer;
begin
  -- Idempotent on (booklet_id, or_no), the table's own unique constraint. A re-pushed
  -- spoiled form is the same fact stated twice, not a second spoiled serial.
  insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
  values (v_booklet, v_or_no, p_payload ->> 'reason', p_collector)
  on conflict (booklet_id, or_no) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate');
  end if;
  return jsonb_build_object('status', 'accepted');
end;
$$;

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
  v_id uuid := (p_payload ->> 'id')::uuid;
begin
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

revoke execute on function ceedo_collections.record_spoiled_form(uuid, uuid, jsonb) from public;
revoke execute on function ceedo_collections.open_shift(uuid, uuid, jsonb) from public;
-- Neither is granted to any role. They are reachable only from sync_push(), which is
-- SECURITY DEFINER and therefore calls them as its owner.

revoke execute on function ceedo_collections.sync_push(uuid, jsonb) from public;
grant execute on function ceedo_collections.sync_push(uuid, jsonb) to ceedo_app;

-- post_collection is now reachable ONLY through the sync path.
--
-- Phase 2's handover asks for it to be granted to ceedo_app and revoked from service_role.
-- The first half turns out to be unnecessary: sync_push is SECURITY DEFINER, so it reaches
-- post_collection as its owner and ceedo_app needs no grant of its own. Granting none at
-- all is strictly stronger and is what invariant 20 asked for -- Phase 2 could not deliver
-- it because no sync path existed yet.
revoke execute on function ceedo_collections.post_collection(jsonb) from service_role;
