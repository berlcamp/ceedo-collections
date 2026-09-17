create table ceedo_collections.charge_condonations (
  id            uuid primary key default gen_random_uuid(),
  charge_id     uuid not null references ceedo_collections.charges (id),
  amount        numeric(14,2) not null check (amount > 0),
  -- The ordinance. A write-off with no authority behind it is a missing record rather
  -- than a decision, so this is not nullable and not blankable.
  authority_ref text not null check (length(trim(authority_ref)) > 0),
  reason        text not null check (length(trim(reason)) > 0),
  condoned_by   uuid not null references ceedo_collections.app_users (id),
  condoned_at   timestamptz not null default now(),
  row_version   bigint not null default 0
);

create index charge_condonations_charge_idx
  on ceedo_collections.charge_condonations (charge_id);

select ceedo_collections.apply_ledger_policies('charge_condonations');

-- §11.4 names condoning a charge explicitly. Unlike the ledger proper -- already
-- immutable and actor-stamped -- this is a discretionary act, and who authorised it is
-- the question asked afterwards.
select ceedo_collections.attach_audit('charge_condonations');
