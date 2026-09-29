-- Shortage settlements: a collector who closed a shift short pays the shortage back later.
--
-- The shift's variance is NEVER edited. It is what the drawer held against the receipts
-- that day (§6.5: "variance is recorded, not hidden"), and an audit must still be able to
-- see that the collector was short. A settlement is a separate record set against the
-- shift: the shortage stands, and what has been paid toward it sits beside it.
--
-- Same two-person rule as remittances (20260923000046): a SUPERVISOR records the
-- repayment and its reference (an office receipt or a deposit slip), and ACCOUNTING
-- verifies it. Only a verified settlement reduces what is outstanding. A wrong entry is
-- cancelled with a reason while still unverified; nothing is deleted.
--
-- Part payments are allowed -- a collector short ₱500 may pay ₱200 now and ₱300 next week
-- -- but the live settlements on a shift may never add up to more than its shortage.

create table ceedo_collections.variance_settlements (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references ceedo_collections.shifts (id),
  amount        numeric(14,2) not null check (amount > 0),
  reference     text not null check (length(trim(reference)) > 0),
  received_at   date not null,
  recorded_by   uuid not null references ceedo_collections.app_users (id),
  recorded_at   timestamptz not null default now(),
  verified_by   uuid references ceedo_collections.app_users (id),
  verified_at   timestamptz,
  cancelled_by  uuid references ceedo_collections.app_users (id),
  cancelled_at  timestamptz,
  cancel_reason text,
  row_version   bigint not null default 0,
  check ((verified_by is null) = (verified_at is null)),
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0),
  check (not (verified_at is not null and cancelled_at is not null))
);

create index variance_settlements_shift_idx
  on ceedo_collections.variance_settlements (shift_id);

create trigger variance_settlements_row_version
  before insert or update on ceedo_collections.variance_settlements
  for each row execute function ceedo_collections.bump_row_version();

select ceedo_collections.attach_audit('variance_settlements');

alter table ceedo_collections.variance_settlements enable row level security;

create policy variance_settlements_read on ceedo_collections.variance_settlements
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

revoke insert, update, delete on ceedo_collections.variance_settlements
  from anon, authenticated, service_role;
grant select on ceedo_collections.variance_settlements to authenticated, service_role;

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.record_variance_settlement(
  p_shift_id    uuid,
  p_amount      numeric,
  p_reference   text,
  p_received_at date
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift   ceedo_collections.shifts;
  v_settled numeric;
  v_id      uuid;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may record a shortage settlement'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount paid must be more than zero';
  end if;
  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'Enter the receipt or deposit slip number for this payment';
  end if;

  -- Locked, so two supervisors settling the same shift at once cannot both pass the
  -- "no more than the shortage" check below and together overpay it.
  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift: %', p_shift_id;
  end if;
  if v_shift.status not in ('closed', 'remitted') or v_shift.variance is null
     or v_shift.variance >= 0 then
    raise exception 'Only a closed shift that was short can be settled';
  end if;
  if p_received_at is null or p_received_at > ceedo_collections.business_date() then
    raise exception 'The payment date cannot be in the future';
  end if;
  if p_received_at < v_shift.business_date then
    raise exception 'The payment date cannot be before the shift it settles';
  end if;

  select coalesce(sum(amount), 0) into v_settled
    from ceedo_collections.variance_settlements
   where shift_id = p_shift_id and cancelled_at is null;

  if v_settled + p_amount > -v_shift.variance then
    raise exception 'That is more than is still owed on this shift (₱%)',
      to_char(-v_shift.variance - v_settled, 'FM999,999,990.00');
  end if;

  insert into ceedo_collections.variance_settlements
    (shift_id, amount, reference, received_at, recorded_by)
  values
    (p_shift_id, p_amount, trim(p_reference), p_received_at, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function ceedo_collections.verify_variance_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v ceedo_collections.variance_settlements;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may verify a shortage settlement'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v from ceedo_collections.variance_settlements
   where id = p_settlement_id for update;
  if not found then
    raise exception 'No such settlement: %', p_settlement_id;
  end if;
  if v.cancelled_at is not null then
    raise exception 'This settlement was cancelled';
  end if;
  if v.verified_at is not null then
    raise exception 'This settlement is already verified';
  end if;
  if v.recorded_by = auth.uid() then
    raise exception 'The person who recorded a settlement may not also verify it'
      using errcode = 'insufficient_privilege';
  end if;

  update ceedo_collections.variance_settlements
     set verified_by = auth.uid(), verified_at = now()
   where id = p_settlement_id;
end;
$$;

create or replace function ceedo_collections.cancel_variance_settlement(
  p_settlement_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v ceedo_collections.variance_settlements;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may cancel a shortage settlement'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling a settlement needs a written reason';
  end if;

  select * into v from ceedo_collections.variance_settlements
   where id = p_settlement_id for update;
  if not found then
    raise exception 'No such settlement: %', p_settlement_id;
  end if;
  if v.verified_at is not null then
    raise exception 'A verified settlement cannot be cancelled';
  end if;
  if v.cancelled_at is not null then
    raise exception 'This settlement is already cancelled';
  end if;

  update ceedo_collections.variance_settlements
     set cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_settlement_id;
end;
$$;

revoke execute on function ceedo_collections.record_variance_settlement(uuid, numeric, text, date) from public;
revoke execute on function ceedo_collections.verify_variance_settlement(uuid) from public;
revoke execute on function ceedo_collections.cancel_variance_settlement(uuid, text) from public;
grant execute on function ceedo_collections.record_variance_settlement(uuid, numeric, text, date) to authenticated;
grant execute on function ceedo_collections.verify_variance_settlement(uuid) to authenticated;
grant execute on function ceedo_collections.cancel_variance_settlement(uuid, text) to authenticated;
