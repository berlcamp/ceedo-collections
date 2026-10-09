-- supabase/migrations/20261008000069_cash_tickets.sql
-- Cash-ticket sales (spec "cash_ticket_sales"): comfort-room tickets and the like, sold for
-- cash the collector remits but written on no OR. A supervisor or accounting enters the
-- lump per collector per day against the collector's shift, until the shift is remitted.
--
-- A shift's system_total is now receipts PLUS live cash tickets. The collector's declared
-- cash already includes the ticket money, so until it is entered the shift reads as an
-- overage. Entering or cancelling a sale on a CLOSED shift recomputes its system_total and
-- variance; an open shift's close (close_shift / office_close_shift / close_office_shift)
-- adds them in. close_shift still compares the DEVICE's count and total with receipts only:
-- the tablet knows nothing of cash tickets.

create table ceedo_collections.cash_ticket_sales (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references ceedo_collections.shifts (id),
  collector_id  uuid not null references ceedo_collections.app_users (id),
  business_date date not null,
  fee_type_id   uuid not null references ceedo_collections.fee_types (id),
  amount        numeric(14,2) not null check (amount > 0),
  ticket_from   integer,
  ticket_to     integer,
  note          text,
  entered_by    uuid not null references ceedo_collections.app_users (id),
  entered_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references ceedo_collections.app_users (id),
  cancel_reason text,
  row_version   bigint not null default 0,
  check ((ticket_from is null) = (ticket_to is null)),
  check (ticket_to is null or ticket_to >= ticket_from),
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0)
);

create index cash_ticket_sales_shift_idx on ceedo_collections.cash_ticket_sales (shift_id);
create index cash_ticket_sales_date_idx on ceedo_collections.cash_ticket_sales (business_date);

create trigger cash_ticket_sales_row_version
  before insert or update on ceedo_collections.cash_ticket_sales
  for each row execute function ceedo_collections.bump_row_version();
select ceedo_collections.attach_audit('cash_ticket_sales');

alter table ceedo_collections.cash_ticket_sales enable row level security;
create policy cash_ticket_sales_read on ceedo_collections.cash_ticket_sales
  for select to authenticated using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));
revoke insert, update, delete on ceedo_collections.cash_ticket_sales from anon, authenticated, service_role;
grant select on ceedo_collections.cash_ticket_sales to authenticated, service_role;

create or replace function ceedo_collections.shift_cash_tickets(p_shift_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  select coalesce(sum(amount), 0)::numeric(14,2)
    from ceedo_collections.cash_ticket_sales
   where shift_id = p_shift_id and cancelled_at is null;
$$;
revoke execute on function ceedo_collections.shift_cash_tickets(uuid) from public;

-- After a sale changes on a closed shift: recompute, and refuse if live settlements would
-- then exceed what the shift is still short.
create or replace function ceedo_collections.restate_shift_for_tickets(p_shift ceedo_collections.shifts, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_total    numeric(14,2);
  v_variance numeric(14,2);
  v_settled  numeric(14,2);
begin
  if p_shift.system_total is null then
    return;  -- still open: its close counts the tickets
  end if;
  v_total := p_shift.system_total + p_delta;
  v_variance := p_shift.declared_total - v_total;

  select coalesce(sum(amount), 0) into v_settled
    from ceedo_collections.variance_settlements
   where shift_id = p_shift.id and cancelled_at is null;
  if v_settled > greatest(-v_variance, 0) then
    raise exception 'This shift already has ₱% settled against its shortage; after this change it would be short only ₱%. Cancel the settlement first',
      to_char(v_settled, 'FM999,999,990.00'), to_char(greatest(-v_variance, 0), 'FM999,999,990.00');
  end if;

  update ceedo_collections.shifts
     set system_total = v_total, variance = v_variance
   where id = p_shift.id;
end;
$$;
revoke execute on function ceedo_collections.restate_shift_for_tickets(ceedo_collections.shifts, numeric) from public;

create or replace function ceedo_collections.record_cash_ticket_sale(
  p_shift_id    uuid,
  p_fee_type_id uuid,
  p_amount      numeric,
  p_ticket_from integer,
  p_ticket_to   integer,
  p_note        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift ceedo_collections.shifts;
  v_id    uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'accounting', 'admin') then
    raise exception 'Only a supervisor, accounting or an administrator may enter cash tickets'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be more than zero';
  end if;
  if (p_ticket_from is null) <> (p_ticket_to is null) or p_ticket_to < p_ticket_from then
    raise exception 'Enter both ticket serials, the last no lower than the first, or neither';
  end if;
  if not exists (select 1 from ceedo_collections.fee_types
                  where id = p_fee_type_id and active and not accrues and amount_mode = 'keyed') then
    raise exception 'Choose a cash-ticket fee (an active fee with a typed amount)';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  if v_shift.status = 'remitted' then
    raise exception 'That shift is already remitted; its cash is final';
  end if;

  insert into ceedo_collections.cash_ticket_sales
    (shift_id, collector_id, business_date, fee_type_id, amount, ticket_from, ticket_to, note, entered_by)
  values
    (v_shift.id, v_shift.collector_id, v_shift.business_date, p_fee_type_id, p_amount,
     p_ticket_from, p_ticket_to, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  perform ceedo_collections.restate_shift_for_tickets(v_shift, p_amount);
  return v_id;
end;
$$;

create or replace function ceedo_collections.cancel_cash_ticket_sale(
  p_sale_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_sale  ceedo_collections.cash_ticket_sales;
  v_shift ceedo_collections.shifts;
begin
  if not ceedo_collections.has_role('supervisor', 'accounting', 'admin') then
    raise exception 'Only a supervisor, accounting or an administrator may cancel cash tickets'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling a cash-ticket entry needs a written reason';
  end if;

  select * into v_sale from ceedo_collections.cash_ticket_sales where id = p_sale_id for update;
  if not found then
    raise exception 'No such cash-ticket entry';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'This entry is already cancelled';
  end if;
  select * into v_shift from ceedo_collections.shifts where id = v_sale.shift_id for update;
  if v_shift.status = 'remitted' then
    raise exception 'That shift is already remitted; its cash is final';
  end if;

  update ceedo_collections.cash_ticket_sales
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_sale_id;

  perform ceedo_collections.restate_shift_for_tickets(v_shift, -v_sale.amount);
end;
$$;

revoke execute on function ceedo_collections.record_cash_ticket_sale(uuid, uuid, numeric, integer, integer, text) from public;
revoke execute on function ceedo_collections.cancel_cash_ticket_sale(uuid, text) from public;
grant execute on function ceedo_collections.record_cash_ticket_sale(uuid, uuid, numeric, integer, integer, text) to authenticated;
grant execute on function ceedo_collections.cancel_cash_ticket_sale(uuid, text) to authenticated;

-- close_shift (from 0051). Also: a null shifts.device_id (office shift) must not pass the
-- ownership check, so it uses is distinct from.
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
  -- Locked: record/cancel_cash_ticket_sale lock this row, so a ticket entered while the
  -- close runs either lands before the close's sum or sees the shift closed.
  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;

  if v_shift.device_id is distinct from p_device_id then
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
       select 1 from ceedo_collections.standing_cancellations cc
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

  -- Cash tickets: entered by the office, unknown to the tablet, part of the cash declared.
  v_system_total := v_system_total + ceedo_collections.shift_cash_tickets(p_shift_id);

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

-- office_close_shift (from 0060)
create or replace function ceedo_collections.office_close_shift(
  p_shift_id       uuid,
  p_declared_total numeric,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts;
  v_system_count integer;
  v_system_total numeric(14,2);
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash that was handed over for this shift';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That shift is not open (it is %)', v_shift.status;
  end if;

  -- Same scope and exclusion as close_shift (migration 0051).
  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (select 1 from ceedo_collections.standing_cancellations cc
                      where cc.collection_id = c.id);

  -- Cash tickets: entered by the office, unknown to the tablet, part of the cash declared.
  v_system_total := v_system_total + ceedo_collections.shift_cash_tickets(p_shift_id);

  update ceedo_collections.shifts
     set status = 'closed', closed_at = now(), declared_total = p_declared_total,
         system_total = v_system_total, system_count = v_system_count,
         variance = p_declared_total - v_system_total
   where id = p_shift_id;

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'office_close_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('reason', trim(p_reason), 'declared_total', p_declared_total,
                             'system_total', v_system_total, 'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

-- close_office_shift (from 0068)
create or replace function ceedo_collections.close_office_shift(
  p_shift_id       uuid,
  p_declared_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts;
  v_system_count integer;
  v_system_total numeric(14,2);
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_office_poster();
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash and checks handed over for this day';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found or v_shift.kind <> 'office' then
    raise exception 'No such office shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That office shift is not open (it is %)', v_shift.status;
  end if;

  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (select 1 from ceedo_collections.standing_cancellations cc
                      where cc.collection_id = c.id);

  -- Cash tickets: entered by the office, unknown to the tablet, part of the cash declared.
  v_system_total := v_system_total + ceedo_collections.shift_cash_tickets(p_shift_id);

  update ceedo_collections.shifts
     set status = 'closed', closed_at = now(), declared_total = p_declared_total,
         system_total = v_system_total, system_count = v_system_count,
         variance = p_declared_total - v_system_total
   where id = p_shift_id;

  insert into ceedo_collections.audit_log (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'close_office_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('declared_total', p_declared_total, 'system_total', v_system_total,
                             'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.office_close_shift(uuid, numeric, text) from public;
grant execute on function ceedo_collections.office_close_shift(uuid, numeric, text) to authenticated;
revoke execute on function ceedo_collections.close_office_shift(uuid, numeric) from public;
grant execute on function ceedo_collections.close_office_shift(uuid, numeric) to authenticated;
