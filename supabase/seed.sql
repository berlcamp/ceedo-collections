-- Local development seed. Never applied to production.
insert into ceedo_collections.facilities (code, name, type) values
  ('CPM',  'Central Public Market',          'market'),
  ('IBJT', 'Integrated Bus & Jeepney Terminal', 'terminal'),
  ('SLH',  'City Slaughterhouse',            'slaughterhouse'),
  ('PRK',  'City Hall Parking',              'parking');

insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
select id, section_name, 'daily'::ceedo_collections.accrual_period
from ceedo_collections.facilities,
     (values ('Fish'), ('Meat'), ('Vegetable')) as s(section_name)
where code = 'CPM';

insert into ceedo_collections.sections (facility_id, name, default_accrual_period)
select id, 'Dry Goods', 'monthly' from ceedo_collections.facilities where code = 'CPM';

insert into ceedo_collections.stalls (section_id, stall_no)
select s.id, s.name || '-' || lpad(n::text, 2, '0')
from ceedo_collections.sections s, generate_series(1, 20) n
where s.facility_id = (select id from ceedo_collections.facilities where code = 'CPM');

insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps) values
  ('MKT_DAILY',  'Market stall rental (daily)',   true,  300),
  ('MKT_MONTHLY','Market stall rental (monthly)', true,  300),
  ('AMBULANT',   'Ambulant vendor fee',           false, 0),
  ('PARKING',    'Parking fee',                   false, 0),
  ('TERMINAL',   'Terminal fee',                  false, 0),
  ('SLAUGHTER',  'Slaughter fee',                 false, 0);

-- The first branch casts the date and enum literals explicitly: through a UNION, Postgres
-- resolves an untyped literal to `text` (no per-column target context survives the union),
-- and text does not implicitly cast to `date` or to a custom enum on insert. Typing the
-- first branch fixes the whole column once, rather than repeating the cast on every branch.
insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
select id, '', '2026-01-01'::date, 120.00, 'per_day'::ceedo_collections.rate_basis from ceedo_collections.fee_types where code = 'MKT_DAILY'
union all
select id, '', '2026-01-01', 3000.00, 'per_month' from ceedo_collections.fee_types where code = 'MKT_MONTHLY'
union all
select id, '', '2026-01-01', 20.00, 'per_day' from ceedo_collections.fee_types where code = 'AMBULANT'
union all
select id, '', '2026-01-01', 20.00, 'per_entry' from ceedo_collections.fee_types where code = 'PARKING'
union all
select id, 'bus', '2026-01-01', 30.00, 'per_entry' from ceedo_collections.fee_types where code = 'TERMINAL'
union all
select id, 'jeepney', '2026-01-01', 15.00, 'per_entry' from ceedo_collections.fee_types where code = 'TERMINAL'
union all
select id, 'hog', '2026-01-01', 85.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER'
union all
select id, 'cattle', '2026-01-01', 250.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER'
union all
select id, 'goat', '2026-01-01', 45.00, 'per_head' from ceedo_collections.fee_types where code = 'SLAUGHTER';

insert into ceedo_collections.form_types (code, name) values
  ('OR51', 'Official Receipt (Accountable Form 51)');
