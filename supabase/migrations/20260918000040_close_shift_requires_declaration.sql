-- close_shift: a closeout must declare the physical cash. Parent spec §6.5 step 5.
--
-- WHAT WAS WRONG. `p_declared_total` was never NULL-checked. A device that omitted the
-- field closed the shift anyway, writing `declared_total = null` and — because
-- `null - v_system_total` is null — `variance = null`. Then the idempotency guard above
-- makes that permanent: the shift is no longer `open`, so a second, correct closeout is
-- answered `already_closed` and changes nothing. §6.5's "variance is recorded, not hidden"
-- is defeated not by a wrong number but by an absent one, and the shortfall it would have
-- recorded is gone for good.
--
-- A RAISE, not a `mismatch` return, and deliberately so. `mismatch` is the answer to a
-- device whose count/total disagrees with the server's — a real, reportable reconciliation
-- state the collector acts on. A missing declaration is not a reconciliation outcome at
-- all; it is a malformed request, and answering it with a reconciliation status would put
-- a protocol bug in front of a collector as if it were their cash problem. Through
-- `sync_push` the raise is caught by that entry's own subtransaction and comes back as a
-- `server_error` rejection for that entry alone (migration 0039); through the `closeout`
-- Edge Function it is a 500 with a redacted body. Neither writes the shift.
--
-- `p_device_count` and `p_device_total` need no such check: they are compared with
-- `is distinct from`, which treats NULL as a mismatch, so an omitted one already refuses
-- the closeout and leaves the shift open.
--
-- Everything else below is migration 0034's body verbatim.

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
  -- SCOPE: collector_id + business_date, not device_id and not the shift's time window.
  -- That is §6.5 step 3 taken literally -- "the device's count/total for the day" reads as
  -- the collector's, because the spec's model is one collector, one device, one shift per
  -- business date. Two cases break that assumption:
  --
  --   1. The same collector posts on a second tablet the same day (device_id would fix
  --      this, but is a trap on its own -- see case 2).
  --   2. The same collector opens a SECOND shift on the SAME device later the same day.
  --      shifts_one_open_per_device (see the shifts migration) only forbids two
  --      *simultaneously* open shifts on one device; it deliberately permits this
  --      sequence. Scoping by device_id alone would look fixed while leaving this, the
  --      more likely case, completely unaddressed.
  --
  -- Both fail SAFE, not silent. The server's figures for (collector_id, business_date) are
  -- a SUPERSET of what the closing device/shift actually knows, so the device's
  -- count/total falls short of this sum, the mismatch branch below returns before any
  -- write, and the shift stays open. There is no path where another shift's money is
  -- silently absorbed into this one's variance -- this is an availability bug (an honest
  -- closeout refused, needing a supervisor to sort out), never a correctness bug.
  --
  -- Scoping by the shift's opened_at/closed_at window was considered and rejected too: a
  -- collection queued on the device before its shift_open push is acked can carry
  -- collected_at < opened_at, and a time-window filter would drop it from this sum
  -- invisibly -- trading a safe over-block for an under-count that closes cleanly. Strictly
  -- the worse direction.
  --
  -- The real fix is shift_id on collections, set at post_collection time, so this query
  -- can scope to the one shift being closed instead of inferring it from collector and
  -- date. That needs a schema change and a post_collection payload change, so it belongs
  -- to Phase 3b, where the device-side closeout and the offline sync sequencing it depends
  -- on actually get built.
  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.collector_id = v_shift.collector_id
     and c.business_date = v_shift.business_date
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
