create type ceedo_collections.rate_basis as enum
  ('per_day', 'per_week', 'per_month', 'per_entry', 'per_head', 'per_sqm');

create table ceedo_collections.fee_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  -- Whether this fee raises a receivable. Market rentals do; parking, terminal
  -- and slaughter fees are cash on the spot and create no charges.
  accrues       boolean not null default false,
  -- Surcharge as INTEGER BASIS POINTS. 3% is 300. Never a float: the issue is rounding
  -- direction, not representation -- 0.03 * 8350 is exactly 250.5 in IEEE 754, and a
  -- float pipeline that floors misrounds that exact half-centavo result to 250 rather
  -- than the correct 251.
  surcharge_bps integer not null default 0 check (surcharge_bps between 0 and 10000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  row_version   bigint not null default 0
);

create table ceedo_collections.rates (
  id             uuid primary key default gen_random_uuid(),
  fee_type_id    uuid not null references ceedo_collections.fee_types (id),
  -- Vehicle class at the terminal, animal class at the slaughterhouse.
  -- NOT NULL with an empty default so the exclusion constraint compares it
  -- with '=' — NULL would never equal NULL and overlaps would slip through.
  rate_class     text not null default '',
  effective_from date not null,
  effective_to   date,
  amount         numeric(14,2) not null check (amount >= 0),
  basis          ceedo_collections.rate_basis not null,
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0,

  constraint rates_dates_ordered
    check (effective_to is null or effective_to >= effective_from),

  -- Rate rows are never updated in place; a new ordinance inserts a new row.
  -- Two rows covering the same day for the same fee and class would make the
  -- amount on a receipt ambiguous.
  constraint rates_no_overlap
    exclude using gist (
      fee_type_id with =,
      rate_class with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index rates_lookup_idx on ceedo_collections.rates (fee_type_id, rate_class);

select ceedo_collections.apply_master_data_policies('fee_types');
select ceedo_collections.apply_master_data_policies('rates');
