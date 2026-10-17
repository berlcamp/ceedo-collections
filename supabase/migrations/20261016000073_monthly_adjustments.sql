-- Collection reports phase 5 (spec "monthly_adjustments", "monthly_control_totals").
--   * monthly_adjustments: lines no receipt produces (withholding tax, disapproved leave,
--     prior-period adjustments, over-deposit), entered by accounting per account and month.
--     Append-only: a mistake is cancelled with a reason, never deleted or edited.
--   * monthly_control_totals: the cashier's figure for a month. Every entry is kept; the
--     latest per month is the one in force.
--   * report_signatories rows for the monthly summary, seeded without names.

create table ceedo_collections.monthly_adjustments (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references ceedo_collections.collection_accounts (id),
  month         date not null check (month = date_trunc('month', month)::date),
  amount        numeric(14,2) not null check (amount <> 0),
  note          text not null check (length(trim(note)) > 0),
  entered_by    uuid not null references ceedo_collections.app_users (id),
  entered_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references ceedo_collections.app_users (id),
  cancel_reason text,
  row_version   bigint not null default 0,
  check ((cancelled_by is null) = (cancelled_at is null)),
  check (cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) > 0)
);

create index monthly_adjustments_month_idx on ceedo_collections.monthly_adjustments (month);

create trigger monthly_adjustments_row_version
  before insert or update on ceedo_collections.monthly_adjustments
  for each row execute function ceedo_collections.bump_row_version();
select ceedo_collections.attach_audit('monthly_adjustments');

create table ceedo_collections.monthly_control_totals (
  id         uuid primary key default gen_random_uuid(),
  month      date not null check (month = date_trunc('month', month)::date),
  amount     numeric(14,2) not null check (amount >= 0),
  note       text,
  entered_by uuid not null references ceedo_collections.app_users (id),
  entered_at timestamptz not null default now()
);

create index monthly_control_totals_month_idx on ceedo_collections.monthly_control_totals (month, entered_at);
select ceedo_collections.attach_audit('monthly_control_totals');

alter table ceedo_collections.monthly_adjustments enable row level security;
alter table ceedo_collections.monthly_control_totals enable row level security;
create policy monthly_adjustments_read on ceedo_collections.monthly_adjustments
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
create policy monthly_control_totals_read on ceedo_collections.monthly_control_totals
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
revoke insert, update, delete on ceedo_collections.monthly_adjustments from anon, authenticated, service_role;
revoke insert, update, delete on ceedo_collections.monthly_control_totals from anon, authenticated, service_role;
grant select on ceedo_collections.monthly_adjustments, ceedo_collections.monthly_control_totals
  to authenticated, service_role;

-- A month is "started" once its first day has come in Manila. Months before the cutover
-- (October 2026) are refused too: they belong to the office's earlier records.
create or replace function ceedo_collections.assert_month_started(p_month date)
returns date
language plpgsql
stable
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month date;
begin
  if p_month is null then
    raise exception 'Choose the month';
  end if;
  v_month := date_trunc('month', p_month)::date;
  if v_month > date_trunc('month', now() at time zone 'Asia/Manila')::date then
    raise exception '% has not started yet', to_char(v_month, 'FMMonth YYYY');
  end if;
  if v_month < date '2026-10-01' then
    raise exception 'The system starts in October 2026; % is kept in the office''s earlier records', to_char(v_month, 'FMMonth YYYY');
  end if;
  return v_month;
end;
$$;
revoke execute on function ceedo_collections.assert_month_started(date) from public;

create or replace function ceedo_collections.record_monthly_adjustment(
  p_account_id uuid,
  p_month      date,
  p_amount     numeric,
  p_note       text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month   date;
  v_account ceedo_collections.collection_accounts;
  v_id      uuid;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may enter monthly adjustments'
      using errcode = 'insufficient_privilege';
  end if;
  v_month := ceedo_collections.assert_month_started(p_month);
  if p_amount is null or p_amount = 0 then
    raise exception 'The amount cannot be zero';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Explain the adjustment in the note';
  end if;

  select * into v_account from ceedo_collections.collection_accounts where id = p_account_id;
  if not found then
    raise exception 'No such account';
  end if;
  if v_account.code = 'UNCLASSIFIED' then
    raise exception 'Adjust a real account, not Unclassified. Money on Unclassified is moved by an account rule';
  end if;
  if not v_account.active then
    raise exception 'That account is inactive; choose an active account';
  end if;

  insert into ceedo_collections.monthly_adjustments (account_id, month, amount, note, entered_by)
  values (p_account_id, v_month, p_amount, trim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function ceedo_collections.cancel_monthly_adjustment(
  p_adjustment_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_row ceedo_collections.monthly_adjustments;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may cancel monthly adjustments'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Cancelling an adjustment needs a written reason';
  end if;

  select * into v_row from ceedo_collections.monthly_adjustments where id = p_adjustment_id for update;
  if not found then
    raise exception 'No such adjustment';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'This adjustment is already cancelled';
  end if;

  update ceedo_collections.monthly_adjustments
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_adjustment_id;
end;
$$;

create or replace function ceedo_collections.record_monthly_control_total(
  p_month  date,
  p_amount numeric,
  p_note   text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_month date;
  v_id    uuid;
begin
  if not ceedo_collections.has_role('accounting', 'admin') then
    raise exception 'Only accounting or an administrator may enter the control total'
      using errcode = 'insufficient_privilege';
  end if;
  v_month := ceedo_collections.assert_month_started(p_month);
  if p_amount is null or p_amount < 0 then
    raise exception 'The control total cannot be negative';
  end if;

  insert into ceedo_collections.monthly_control_totals (month, amount, note, entered_by)
  values (v_month, p_amount, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.record_monthly_adjustment(uuid, date, numeric, text) from public;
revoke execute on function ceedo_collections.cancel_monthly_adjustment(uuid, text) from public;
revoke execute on function ceedo_collections.record_monthly_control_total(date, numeric, text) from public;
grant execute on function ceedo_collections.record_monthly_adjustment(uuid, date, numeric, text) to authenticated;
grant execute on function ceedo_collections.cancel_monthly_adjustment(uuid, text) to authenticated;
grant execute on function ceedo_collections.record_monthly_control_total(date, numeric, text) to authenticated;

insert into ceedo_collections.report_signatories (report_key, label, sort_order) values
  ('monthly-summary', 'Prepared by', 10),
  ('monthly-summary', 'Noted by',    20)
on conflict (report_key, label) do nothing;
