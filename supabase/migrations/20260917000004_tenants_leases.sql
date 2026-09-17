create type ceedo_collections.lease_status as enum ('active', 'ended', 'terminated');

create table ceedo_collections.tenants (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  address     text,
  contact_no  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.leases (
  id             uuid primary key default gen_random_uuid(),
  stall_id       uuid not null references ceedo_collections.stalls (id),
  tenant_id      uuid not null references ceedo_collections.tenants (id),
  start_date     date not null,
  end_date       date,
  rate_amount    numeric(14,2) not null check (rate_amount >= 0),
  accrual_period ceedo_collections.accrual_period not null,
  -- Day of month a monthly charge falls due. Meaningless for daily and weekly
  -- accrual; required for monthly, because the surcharge clock starts from it.
  due_day        smallint check (due_day between 1 and 28),
  status         ceedo_collections.lease_status not null default 'active',
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0,

  constraint leases_dates_ordered
    check (end_date is null or end_date >= start_date),

  constraint leases_monthly_needs_due_day
    check (accrual_period <> 'monthly' or due_day is not null),

  -- One active tenancy per stall at a time. A NULL end_date is already an unbounded
  -- upper bound in Postgres, which is exactly what an open-ended lease means.
  constraint leases_no_active_overlap
    exclude using gist (
      stall_id with =,
      daterange(start_date, end_date, '[]') with &&
    ) where (status = 'active')
);

create index leases_tenant_idx on ceedo_collections.leases (tenant_id);
create index leases_stall_active_idx on ceedo_collections.leases (stall_id) where status = 'active';

select ceedo_collections.apply_master_data_policies('tenants');
select ceedo_collections.apply_master_data_policies('leases');
