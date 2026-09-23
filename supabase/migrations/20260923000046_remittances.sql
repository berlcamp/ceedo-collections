-- Phase 6: remittances. Parent spec §5.5 and §10's Remittance reconciliation.
--
-- A collector deposits the day's cash at the bank. A SUPERVISOR records the deposit slip and
-- the closed shifts it covers; ACCOUNTING verifies it against the bank, which is what moves
-- those shifts to 'remitted' (spec §5.5: open -> closed -> remitted). Two people, by rule:
-- the one who records a slip may not verify it (separation of duties, and the reason the
-- office chose this split).
--
-- A slip's amount is NOT required to equal the shifts' cash. A short or over deposit is a
-- finding for the reconciliation report to show, not something to refuse at the counter.
--
-- Nothing is deleted. A wrong entry is cancelled with a reason while still unverified,
-- which releases its shifts so a corrected slip can claim them.

create table ceedo_collections.remittances (
  id               uuid primary key default gen_random_uuid(),
  collector_id     uuid not null references ceedo_collections.app_users (id),
  deposit_slip_no  text not null check (length(trim(deposit_slip_no)) > 0),
  bank             text not null check (length(trim(bank)) > 0),
  amount           numeric(14,2) not null check (amount > 0),
  deposited_at     date not null,
  recorded_by      uuid not null references ceedo_collections.app_users (id),
  recorded_at      timestamptz not null default now(),
  verified_by      uuid references ceedo_collections.app_users (id),
  verified_at      timestamptz,
  cancelled_by     uuid references ceedo_collections.app_users (id),
  cancelled_at     timestamptz,
  cancel_reason    text,
  row_version      bigint not null default 0,
  check ((verified_by is null) = (verified_at is null)),
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0),
  check (not (verified_at is not null and cancelled_at is not null))
);

-- One live slip per bank and number: the same slip recorded twice would count its cash twice.
create unique index remittances_slip_live
  on ceedo_collections.remittances (lower(trim(bank)), trim(deposit_slip_no))
  where cancelled_at is null;
create index remittances_collector_date_idx
  on ceedo_collections.remittances (collector_id, deposited_at);

create trigger remittances_row_version
  before insert or update on ceedo_collections.remittances
  for each row execute function ceedo_collections.bump_row_version();

select ceedo_collections.attach_audit('remittances');

alter table ceedo_collections.remittances enable row level security;

create policy remittances_read on ceedo_collections.remittances
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

revoke insert, update, delete on ceedo_collections.remittances
  from anon, authenticated, service_role;
grant select on ceedo_collections.remittances to authenticated, service_role;

-- The slip a closed shift's cash went out on. Null until a supervisor records one.
alter table ceedo_collections.shifts
  add column remittance_id uuid references ceedo_collections.remittances (id);
create index shifts_remittance_idx on ceedo_collections.shifts (remittance_id);

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.record_remittance(
  p_collector_id    uuid,
  p_deposit_slip_no text,
  p_bank            text,
  p_amount          numeric,
  p_deposited_at    date,
  p_shift_ids       uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_id    uuid;
  v_found integer;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may record a deposit'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_shift_ids, 1), 0) = 0 then
    raise exception 'Choose the shifts this deposit covers';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The deposit amount must be more than zero';
  end if;
  if p_deposited_at is null or p_deposited_at > ceedo_collections.business_date() then
    raise exception 'The deposit date cannot be in the future';
  end if;

  -- Every shift must be this collector's, CLOSED (not open, and not closed_unsynced, whose
  -- receipts the server may not all have yet), and not already on a live slip. Locked so
  -- two supervisors cannot put one shift on two slips at once.
  select count(*) into v_found
    from ceedo_collections.shifts s
   where s.id = any(p_shift_ids)
     and s.collector_id = p_collector_id
     and s.status = 'closed'
     and s.remittance_id is null;
  perform 1 from ceedo_collections.shifts where id = any(p_shift_ids) for update;

  if v_found <> (select count(distinct x) from unnest(p_shift_ids) as x) then
    raise exception 'Every shift must be a closed, not yet deposited shift of this collector';
  end if;

  insert into ceedo_collections.remittances
    (collector_id, deposit_slip_no, bank, amount, deposited_at, recorded_by)
  values
    (p_collector_id, trim(p_deposit_slip_no), trim(p_bank), p_amount, p_deposited_at, auth.uid())
  returning id into v_id;

  update ceedo_collections.shifts set remittance_id = v_id where id = any(p_shift_ids);
  return v_id;
exception
  when unique_violation then
    raise exception 'Deposit slip % at % is already recorded', p_deposit_slip_no, p_bank
      using errcode = 'unique_violation';
end;
$$;

create or replace function ceedo_collections.verify_remittance(p_remittance_id uuid)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v ceedo_collections.remittances;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may verify a deposit'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v from ceedo_collections.remittances where id = p_remittance_id for update;
  if not found then
    raise exception 'No such deposit: %', p_remittance_id;
  end if;
  if v.cancelled_at is not null then
    raise exception 'This deposit was cancelled';
  end if;
  if v.verified_at is not null then
    raise exception 'This deposit is already verified';
  end if;
  if v.recorded_by = auth.uid() then
    raise exception 'The person who recorded a deposit may not also verify it'
      using errcode = 'insufficient_privilege';
  end if;

  update ceedo_collections.remittances
     set verified_by = auth.uid(), verified_at = now()
   where id = p_remittance_id;

  update ceedo_collections.shifts
     set status = 'remitted'
   where remittance_id = p_remittance_id;
end;
$$;

create or replace function ceedo_collections.cancel_remittance(
  p_remittance_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v ceedo_collections.remittances;
begin
  if not ceedo_collections.has_role('supervisor', 'admin') then
    raise exception 'Only a supervisor or administrator may cancel a deposit'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling a deposit needs a written reason';
  end if;

  select * into v from ceedo_collections.remittances where id = p_remittance_id for update;
  if not found then
    raise exception 'No such deposit: %', p_remittance_id;
  end if;
  if v.verified_at is not null then
    raise exception 'A verified deposit cannot be cancelled';
  end if;
  if v.cancelled_at is not null then
    raise exception 'This deposit is already cancelled';
  end if;

  update ceedo_collections.remittances
     set cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_remittance_id;

  -- Release the shifts, so a corrected slip can claim them.
  update ceedo_collections.shifts set remittance_id = null where remittance_id = p_remittance_id;
end;
$$;

revoke execute on function ceedo_collections.record_remittance(uuid, text, text, numeric, date, uuid[]) from public;
revoke execute on function ceedo_collections.verify_remittance(uuid) from public;
revoke execute on function ceedo_collections.cancel_remittance(uuid, text) from public;
grant execute on function ceedo_collections.record_remittance(uuid, text, text, numeric, date, uuid[]) to authenticated;
grant execute on function ceedo_collections.verify_remittance(uuid) to authenticated;
grant execute on function ceedo_collections.cancel_remittance(uuid, text) to authenticated;
