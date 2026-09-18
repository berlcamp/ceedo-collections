-- The Phase 2 ledger begins here. Everything in this file exists to make a posted
-- charge unalterable by anyone, including whoever holds the dashboard password.

-- The ledger counterpart to apply_master_data_policies(). The difference is the whole
-- point: that installer grants UPDATE and DELETE to service_role because master data is
-- legitimately mutable. A ledger table is not. Calling the wrong installer on a ledger
-- table would silently hand away the guarantee, so this one exists to be called instead.
create or replace function ceedo_collections.apply_ledger_policies(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format('alter table ceedo_collections.%I enable row level security', table_name);

  -- Read is gated on app_users membership, never on `authenticated` alone: auth.users is
  -- shared with unrelated systems on this Supabase project, so `authenticated` includes
  -- every person who ever signed up for any of them.
  execute format(
    'create policy %I on ceedo_collections.%I for select to authenticated
       using (ceedo_collections.has_role(''supervisor'', ''accounting'', ''admin''))',
    table_name || '_read', table_name);

  -- SELECT only. No INSERT: every write goes through a SECURITY DEFINER function that
  -- validates first, so there is no way to create a row that skipped validation.
  execute format(
    'grant select on ceedo_collections.%I to authenticated', table_name);

  -- Migration 0001 set ALTER DEFAULT PRIVILEGES to grant service_role SELECT and INSERT
  -- on every table this schema will ever contain. For an append-only table that INSERT is
  -- a direct write path into the ledger for the break-glass key, so it is revoked here
  -- rather than inherited. UPDATE and DELETE were never in that default and so need no
  -- revoking -- the guarantee holds because nothing granted them, not because something
  -- took them away.
  execute format(
    'revoke insert on ceedo_collections.%I from service_role', table_name);

  execute format(
    'create trigger %I before insert or update on ceedo_collections.%I
       for each row execute function ceedo_collections.bump_row_version()',
    table_name || '_row_version', table_name);
end;
$$;

revoke execute on function ceedo_collections.apply_ledger_policies(text) from public;

create type ceedo_collections.charge_type as enum
  ('rental', 'surcharge', 'opening_balance');

create type ceedo_collections.charge_source as enum
  ('accrual', 'opening_balance', 'manual');

create table ceedo_collections.charges (
  id               uuid primary key default gen_random_uuid(),
  lease_id         uuid not null references ceedo_collections.leases (id),
  fee_type_id      uuid not null references ceedo_collections.fee_types (id),
  charge_type      ceedo_collections.charge_type not null,
  parent_charge_id uuid references ceedo_collections.charges (id),
  period_start     date not null,
  period_end       date not null,
  due_date         date not null,
  amount           numeric(14,2) not null check (amount > 0),
  surcharge_bps    integer not null default 0 check (surcharge_bps between 0 and 10000),
  source           ceedo_collections.charge_source not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references ceedo_collections.app_users (id),
  row_version      bigint not null default 0,

  constraint charges_period_ordered check (period_end >= period_start),

  -- A surcharge is meaningless without the rent it penalises, and a rental that points at
  -- a parent would make the period group a cycle rather than a pair.
  constraint charges_surcharge_has_parent
    check ((charge_type = 'surcharge') = (parent_charge_id is not null)),

  -- The paper figure an opening balance carries already includes accumulated penalties.
  -- Stamping a rate on it would invite a second one.
  constraint charges_opening_balance_no_surcharge
    check (charge_type <> 'opening_balance' or surcharge_bps = 0)
);

-- THIS INDEX IS THE ACCRUAL IDEMPOTENCY. run_accrual() does not check whether a period
-- has already been charged; it inserts and lets this index refuse the duplicate. Removing
-- it does not cause a test to fail loudly -- it causes a tenant to be billed twice after
-- the job is re-run following an outage, which is exactly when it will be re-run.
create unique index charges_one_rental_per_period
  on ceedo_collections.charges (lease_id, period_start)
  where charge_type = 'rental';

-- Invariant #6: a surcharge exists at most once per rental charge, ever.
create unique index charges_one_surcharge_per_parent
  on ceedo_collections.charges (parent_charge_id)
  where charge_type = 'surcharge';

-- Invariant #19: one opening balance per lease.
create unique index charges_one_opening_balance_per_lease
  on ceedo_collections.charges (lease_id)
  where charge_type = 'opening_balance';

create index charges_lease_due_idx
  on ceedo_collections.charges (lease_id, due_date);

create index charges_due_date_idx
  on ceedo_collections.charges (due_date)
  where charge_type <> 'surcharge';

select ceedo_collections.apply_ledger_policies('charges');

comment on table ceedo_collections.charges is
  'Append-only. No status column: settled state is derived in charge_balances from '
  'allocations and condonations. Nothing in this table is ever updated or deleted.';
