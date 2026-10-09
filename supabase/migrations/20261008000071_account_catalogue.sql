-- supabase/migrations/20261008000071_account_catalogue.sql
-- The office's account chart and fee catalogue (spec "Seed migration"), from the 2026
-- Monthly Summary of Collection Report. HELD BACK FROM PRODUCTION until the office has
-- reviewed the list: bundle the earlier migrations with `--through 20261008000070`.
--
-- Idempotent and re-runnable: clear_all_data() calls it again after wiping, so a test-data
-- reset does not leave the system without its chart. Every insert is keyed by a natural key
-- and skips what exists. Existing facilities keep their names (production's CPM is
-- "Central Public Market"; the office calls it City Public Mall -- an open question).
--
-- No rates. Rate-mode fees seeded here have no price until the office enters one on the
-- Rates screen; a tablet only offers a fee that has a rate, so none of these reach a tablet
-- before then.

create or replace function ceedo_collections.install_account_catalogue()
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  perform ceedo_collections.install_chart_builtins();

  -- Facilities ----------------------------------------------------------------------
  insert into facilities (code, name, type) values
    ('CPM',    'City Public Mall',                    'market'),
    ('IBJT',   'Integrated Bus and Jeepney Terminal', 'terminal'),
    ('WP',     'Wellness Park',                       'market'),
    ('SLH',    'Slaughterhouse',                      'slaughterhouse'),
    ('COTTA',  'Cotta (Fortress)',                    'other'),
    ('CEM',    'Public Cemetery',                     'other'),
    ('GYM',    'City Gym',                            'other'),
    ('NM',     'Night Market',                        'other'),
    ('TABO',   'IBJT Tabo',                           'other'),
    ('UNITOP', 'Unitop',                              'other')
  on conflict (code) do nothing;

  -- Sections ------------------------------------------------------------------------
  insert into sections (facility_id, name, default_accrual_period)
  select f.id, v.name, v.period::accrual_period
    from (values
      ('CPM', 'Bakery', 'daily'), ('CPM', 'Dressed Chicken', 'daily'), ('CPM', 'Dried Fish', 'daily'),
      ('CPM', 'Dry Goods', 'daily'), ('CPM', 'Flowers', 'daily'), ('CPM', 'Food Court', 'daily'),
      ('CPM', 'Fresh Fish', 'daily'), ('CPM', 'Fresh Meat', 'daily'), ('CPM', 'Fresh Vegetables', 'daily'),
      ('CPM', 'Fruits', 'daily'), ('CPM', 'Grains', 'daily'), ('CPM', 'Grinder', 'daily'),
      ('CPM', 'Mini-Grocery', 'daily'), ('CPM', 'Native Product', 'daily'),
      ('CPM', 'Parlor/Barber Shop', 'daily'), ('CPM', 'Tobacco', 'daily'), ('CPM', 'Ukay-Ukay', 'daily'),
      ('CPM', 'Rentable Space', 'monthly'), ('CPM', 'Semi-Rentable Space', 'monthly'),
      ('IBJT', 'Building 2', 'daily'), ('IBJT', 'Building 3', 'daily'),
      ('IBJT', 'Kiosk', 'daily'), ('IBJT', 'Rentables', 'daily'),
      ('WP', 'Food Court', 'daily'), ('WP', 'Kiosk', 'daily')
    ) as v(fc, name, period)
    join facilities f on f.code = v.fc
  on conflict (facility_id, name) do nothing;

  -- Fee types -----------------------------------------------------------------------
  -- The ones the seed and production already have, so a fresh database (where this runs
  -- before seed.sql) has them for the rules below. Same values as seed.sql.
  insert into fee_types (code, name, accrues, surcharge_bps, facility_type) values
    ('MKT_DAILY',   'Market stall rental (daily)',   true,  300, 'market'),
    ('MKT_WEEKLY',  'Market stall rental (weekly)',  true,  300, 'market'),
    ('MKT_MONTHLY', 'Market stall rental (monthly)', true,  300, 'market'),
    ('TERMINAL',    'Terminal fee',                  false, 0,   'terminal'),
    ('SLAUGHTER',   'Slaughter fee',                 false, 0,   'slaughterhouse')
  on conflict (code) do nothing;

  update fee_types ft set facility_id = f.id
    from facilities f
   where ft.facility_id is null
     and ((ft.code = 'TERMINAL' and f.code = 'IBJT') or (ft.code = 'SLAUGHTER' and f.code = 'SLH'));

  -- facility_type for a facility-specific fee is copied by fee_types_follow_facility; the
  -- value given here only matters for the facility-less ones (OCCUPANCY, CITATION).
  insert into fee_types (code, name, accrues, facility_id, facility_type, amount_mode)
  select v.code, v.name, false, f.id, v.ftype::facility_type, v.mode
    from (values
      ('OCCUPANCY',      'Occupancy fee',                         null,     'market', 'keyed'),
      ('CITATION',       'Citation ticket',                       null,     'other',  'keyed'),
      ('CPM_CR',         'Public Mall CR (cash ticket)',          'CPM',    null,     'keyed'),
      ('CPM_CERT',       'Public Mall certification',             'CPM',    null,     'keyed'),
      ('CPM_DELIVERY',   'Public Mall delivery fee',              'CPM',    null,     'rate'),
      ('CPM_MISC',       'Public Mall miscellaneous fee',         'CPM',    null,     'keyed'),
      ('CPM_PARKING',    'Public Mall parking fee',               'CPM',    null,     'rate'),
      ('CPM_STORAGE',    'Public Mall storage fee',               'CPM',    null,     'rate'),
      ('IBJT_CR',        'IBJT CR (cash ticket)',                 'IBJT',   null,     'keyed'),
      ('IBJT_CERT',      'IBJT certification',                    'IBJT',   null,     'keyed'),
      ('IBJT_MISC',      'IBJT miscellaneous fee',                'IBJT',   null,     'keyed'),
      ('IBJT_PARKING',   'IBJT parking fee',                      'IBJT',   null,     'rate'),
      ('WP_CR',          'Wellness Park CR (cash ticket)',        'WP',     null,     'keyed'),
      ('WP_CERT',        'Wellness Park certification',           'WP',     null,     'keyed'),
      ('WP_MISC',        'Wellness Park miscellaneous fee',       'WP',     null,     'keyed'),
      ('WP_PLAYGROUND',  'Wellness Park playground entrance',     'WP',     null,     'rate'),
      ('WP_FITNESS',     'Wellness Park fitness ground entrance', 'WP',     null,     'rate'),
      ('COTTA_ENTRANCE', 'Cotta entrance fee',                    'COTTA',  null,     'rate'),
      ('CEM_BURIAL',     'Burial fee (Brgy. Bongbong)',           'CEM',    null,     'rate'),
      ('GYM_RENTAL',     'City Gym rental',                       'GYM',    null,     'keyed'),
      ('NM_FEE',         'Night Market fee',                      'NM',     null,     'rate'),
      ('TABO_FEE',       'IBJT Tabo fee',                         'TABO',   null,     'rate'),
      ('SLH_ANTE',       'Ante-mortem fee',                       'SLH',    null,     'rate'),
      ('SLH_POST',       'Post-mortem fee',                       'SLH',    null,     'rate'),
      ('SLH_CORRAL',     'Corral fee',                            'SLH',    null,     'rate'),
      ('SLH_ENTRAILS',   'Entrails fee',                          'SLH',    null,     'rate'),
      ('SLH_PERMIT',     'Permit to slaughter fee',               'SLH',    null,     'rate'),
      ('SLH_REG',        'Registration fee',                      'SLH',    null,     'rate'),
      ('SLH_AF52',       'Form AF 52 (certificate of transfer)',  'SLH',    null,     'rate'),
      ('SLH_AF53',       'Form AF 53 (certificate of ownership)', 'SLH',    null,     'rate'),
      ('VET_FEE',        'Veterinary fee',                        'SLH',    null,     'rate'),
      ('ELEC_CPM',       'Electricity bill payment (Public Mall)',   'CPM',    null, 'keyed'),
      ('ELEC_IBJT',      'Electricity bill payment (IBJT)',          'IBJT',   null, 'keyed'),
      ('ELEC_WP',        'Electricity bill payment (Wellness Park)', 'WP',     null, 'keyed'),
      ('ELEC_UNITOP',    'Electricity bill payment (Unitop)',        'UNITOP', null, 'keyed'),
      ('ELEC_SUR_CPM',   'Electricity surcharge (Public Mall)',      'CPM',    null, 'keyed'),
      ('ELEC_SUR_IBJT',  'Electricity surcharge (IBJT)',             'IBJT',   null, 'keyed'),
      ('ELEC_SUR_WP',    'Electricity surcharge (Wellness Park)',    'WP',     null, 'keyed'),
      ('ELEC_SUR_UNITOP','Electricity surcharge (Unitop)',           'UNITOP', null, 'keyed')
    ) as v(code, name, fc, ftype, mode)
    left join facilities f on f.code = v.fc
  on conflict (code) do nothing;

  -- Treasurer lines and RCD columns (TL_OTHER / RC_OTHER are the built-ins) ------------
  insert into treasurer_lines (code, name, sort_order, subtotal_group) values
    ('TL_SLH',      'Slaughterhouse fees',                       10, 1),
    ('TL_PM',       'Public Mall stall rentals/misc',            20, 1),
    ('TL_PM_CR',    'Public Mall CR',                            30, 1),
    ('TL_IBJT',     'IBJT stall rentals/parking/misc',           40, 1),
    ('TL_IBJT_CR',  'IBJT CR',                                   50, 1),
    ('TL_COTTA',    'Cotta Fort entrance/misc',                  60, 1),
    ('TL_CEM',      'Public cemetery',                           70, 1),
    ('TL_WP',       'Wellness Park stall rentals/misc',          80, 1),
    ('TL_WP_CR',    'Wellness Park comfort rooms',               90, 1),
    ('TL_WP_PLAY',  'Wellness Park playground',                 100, 1),
    ('TL_NMIS',     'Ante/post-mortem fees',                    200, 2),
    ('TL_ELEC',     'Electricity bill payments',                210, 2),
    ('TL_ELEC_SUR', 'Surcharges on electricity bill payments',  220, 2)
  on conflict (code) do nothing;

  insert into rcd_columns (code, name, sort_order) values
    ('RC_PM',       'Public Mall',                 10),
    ('RC_SUR',      'Surcharges – stall rentals',  20),
    ('RC_SLH',      'Slaughterhouse',              30),
    ('RC_NMIS',     'Ante/post-mortems',           40),
    ('RC_IBJT',     'IBJT',                        50),
    ('RC_WP',       'Wellness Park',               60),
    ('RC_CEM',      'Public cemetery',             70),
    ('RC_COTTA',    'Cotta Fort',                  80),
    ('RC_CIT',      'Citation ticket',             90),
    ('RC_ELEC',     'Electricity bill payments',  100),
    ('RC_ELEC_SUR', 'Surcharges – electricity',   110)
  on conflict (code) do nothing;

  -- Accounts, in the monthly summary's order. Accounts whose Treasurer line or RCD column
  -- the office has not decided (City Gym, occupancy fees, rental surcharges' Treasurer
  -- line, citation's Treasurer line, Night Market, Tabo, veterinary, the adjustment-only
  -- lines) sit on TL_OTHER / RC_OTHER until it does.
  insert into collection_accounts
    (code, name, facility_id, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
  select v.code, v.name, f.id, v.grp, row_number() over (order by v.ord) * 10, v.kind, t.id, r.id
    from (values
      (  1, 'GYM-RENTAL',           'City Gym Rental',                          'GYM',   'City Gym',                     'income', 'TL_OTHER',   'RC_OTHER'),
      (  2, 'CPM-DR-BAKERY',        'Bakery Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  3, 'CPM-DR-DRESSEDCHICKEN','Dressed Chicken Section - Daily Rent',     'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  4, 'CPM-DR-DRIEDFISH',     'Dried Fish Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  5, 'CPM-DR-DRYGOODS',      'Dry Good Section - Daily Rent',            'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  6, 'CPM-DR-FLOWERS',       'Flowers Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  7, 'CPM-DR-FOODCOURT',     'Food Court Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  8, 'CPM-DR-FRESHFISH',     'Fresh Fish Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      (  9, 'CPM-DR-FRESHMEAT',     'Fresh Meat Section - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 10, 'CPM-DR-FRESHVEG',      'Fresh Vegetables Section - Daily Rent',    'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 11, 'CPM-DR-FRUITS',        'Fruits Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 12, 'CPM-DR-GRAINS',        'Grains Section - Daily Rent',              'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 13, 'CPM-DR-GRINDER',       'Grinder Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 14, 'CPM-DR-MINIGROCERY',   'Mini-Grocery Section - Daily Rent',        'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 15, 'CPM-DR-NATIVE',        'Native Product Section - Daily Rent',      'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 16, 'CPM-DR-PARLOR',        'Parlor/Barber Shop - Daily Rent',          'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 17, 'CPM-DR-TOBACCO',       'Tobacco Section - Daily Rent',             'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 18, 'CPM-DR-UKAY',          'Ukay-Ukay Section - Daily Rent',           'CPM',   'Stall Sections Daily Rent',    'income', 'TL_PM',      'RC_PM'),
      ( 19, 'CPM-MR-RENTABLE',      'Rentable Space - Monthly Rent',            'CPM',   'Rentable Space',               'income', 'TL_PM',      'RC_PM'),
      ( 20, 'CPM-MR-SEMI',          'Semi-Rentable Space - Monthly Rent',       'CPM',   'Rentable Space',               'income', 'TL_PM',      'RC_PM'),
      ( 21, 'CPM-OF-BAKERY',        'Bakery Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 22, 'CPM-OF-DRESSEDCHICKEN','Dressed Chicken Section - Occupancy Fee',  'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 23, 'CPM-OF-DRIEDFISH',     'Dried Fish Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 24, 'CPM-OF-DRYGOODS',      'Dry Good Section - Occupancy Fee',         'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 25, 'CPM-OF-FLOWERS',       'Flower Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 26, 'CPM-OF-FOODCOURT',     'Food Court Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 27, 'CPM-OF-FRESHFISH',     'Fresh Fish Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 28, 'CPM-OF-FRESHMEAT',     'Fresh Meat Section - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 29, 'CPM-OF-FRESHVEG',      'Fresh Vegetables Section - Occupancy Fee', 'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 30, 'CPM-OF-FRUITS',        'Fruits Section - Occupancy Fee',           'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 31, 'CPM-OF-GRINDER',       'Grinder Section - Occupancy Fee',          'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 32, 'CPM-OF-MINIGROCERY',   'Mini-Grocery Section - Occupancy Fee',     'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 33, 'CPM-OF-NATIVE',        'Native Product Section - Occupancy Fee',   'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 34, 'CPM-OF-PARLOR',        'Parlor/Barber Shop - Occupancy Fee',       'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 35, 'CPM-OF-TOBACCO',       'Tobacco Section - Occupancy Fee',          'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 36, 'CPM-OF-UKAY',          'Ukay-Ukay Section - Occupancy Fee',        'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 37, 'CPM-OF-RENTABLES',     'Rentables - Occupancy Fee',                'CPM',   'Stall Sections Occupancy Fee', 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 38, 'CPM-CR',               'City Public Mall CR',                      'CPM',   'Other Collections',            'income', 'TL_PM_CR',   'RC_PM'),
      ( 39, 'CPM-CERT',             'City Public Mall Certification',           'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 40, 'CPM-DELIVERY',         'City Public Mall Delivery Fee',            'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 41, 'CPM-MISC',             'City Public Mall Miscellaneous Fee',       'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 42, 'CPM-PARKING',          'City Public Mall Parking Fee',             'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 43, 'CPM-STORAGE',          'City Public Mall Storage Fee',             'CPM',   'Other Collections',            'income', 'TL_PM',      'RC_PM'),
      ( 44, 'CPM-OVERDEP',          'Over Deposit',                             'CPM',   'Other Collections',            'income', 'TL_OTHER',   'RC_OTHER'),
      ( 45, 'COTTA-ENTRANCE',       'Entrance Fee - Cotta (Fortress)',          'COTTA', 'Cotta (Fortress)',             'income', 'TL_COTTA',   'RC_COTTA'),
      ( 46, 'IBJT-DR-B2',           'Building 2 Rentals - IBJT',                'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 47, 'IBJT-DR-B3',           'Building 3 Rentals - IBJT',                'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 48, 'IBJT-DR-KIOSK',        'Kiosk Rentals - IBJT',                     'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 49, 'IBJT-DR-RENTABLES',    'Rentables - IBJT',                         'IBJT',  'IBJT Daily Rent',              'income', 'TL_IBJT',    'RC_IBJT'),
      ( 50, 'IBJT-OF-B2',           'IBJT Building 2 - Occupancy Fee',          'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 51, 'IBJT-OF-B3',           'IBJT Building 3 - Occupancy Fee',          'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 52, 'IBJT-OF-RENTABLES',    'IBJT Rentables - Occupancy Fee',           'IBJT',  'IBJT Sections Occupancy Fee',  'income', 'TL_OTHER',   'RC_OTHER'),
      ( 53, 'IBJT-CR',              'IBJT CR',                                  'IBJT',  'Other Collections',            'income', 'TL_IBJT_CR', 'RC_IBJT'),
      ( 54, 'IBJT-CERT',            'IBJT Certification',                       'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 55, 'IBJT-MISC',            'IBJT Miscellaneous Fee',                   'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 56, 'IBJT-PARKING',         'IBJT Parking Fee',                         'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 57, 'IBJT-TF-ASMO',         'Terminal Fee - ASMO',                      'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 58, 'IBJT-TF-LOTRADISCO',   'Terminal Fee - LOTRADISCO',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 59, 'IBJT-TF-OZORDITRANSCO','Terminal Fee - OZORDITRANSCO',             'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 60, 'IBJT-TF-RTMI',         'Terminal Fee - RTMI',                      'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 61, 'IBJT-TF-STAMARIA',     'Terminal Fee - STA. MARIA',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 62, 'IBJT-TF-SUPERFIVE',    'Terminal Fee - Super Five',                'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 63, 'IBJT-TF-TANGUB',       'Terminal Fee - Tangub Express',            'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 64, 'IBJT-TF-TUDELA',       'Terminal Fee - Tudela Liner',              'IBJT',  'Other Collections',            'income', 'TL_IBJT',    'RC_IBJT'),
      ( 65, 'CEM-BURIAL',           'Burial Fee - Brgy. Bongbong Cemetery',     'CEM',   'Public Cemetery',              'income', 'TL_CEM',     'RC_CEM'),
      ( 66, 'SLH-ANTE',             'Ante Mortem',                              'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 67, 'SLH-CORRAL',           'Corral Fee',                               'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 68, 'SLH-ENTRAILS',         'Entrails Fee',                             'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 69, 'SLH-AF52',             'Form AF 52 - Certificate of Transfer',     'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 70, 'SLH-AF53',             'Form AF 53 - Certificate of Ownership',    'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 71, 'SLH-PERMIT',           'Permit to Slaughter Fee',                  'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 72, 'SLH-POST',             'Post-Mortem',                              'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 73, 'SLH-REG',              'Registration Fee',                         'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 74, 'SLH-SLAUGHTER',        'Slaughter Fee',                            'SLH',   'Slaughterhouse',               'income', 'TL_SLH',     'RC_SLH'),
      ( 75, 'SUR-RENT-IBJT',        'IBJT Rental Surcharge',                    null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 76, 'SUR-RENT-CPM',         'Public Mall Rental Surcharge',             null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 77, 'SUR-RENT-WP',          'Wellness Park Rental Surcharge',           null,    'Rental Surcharge',             'income', 'TL_OTHER',   'RC_SUR'),
      ( 78, 'SUR-ELEC-IBJT',        'IBJT Electricity Surcharge',               null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 79, 'SUR-ELEC-CPM',         'Public Mall Electricity Surcharge',        null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 80, 'SUR-ELEC-WP',          'Wellness Park Electricity Surcharge',      null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 81, 'SUR-ELEC-UNITOP',      'Unitop Electricity Surcharge',             null,    'Electricity Surcharge',        'income', 'TL_ELEC_SUR','RC_ELEC_SUR'),
      ( 82, 'WP-DR-FOODCOURT',      'Food Court Daily Rent - WP',               'WP',    'Daily Rent',                   'income', 'TL_WP',      'RC_WP'),
      ( 83, 'WP-DR-KIOSK',          'Kiosk Daily Rent - WP',                    'WP',    'Daily Rent',                   'income', 'TL_WP',      'RC_WP'),
      ( 84, 'WP-OF-FOODCOURT',      'Food Court Occupancy Fee - WP',            'WP',    'Occupancy Fee',                'income', 'TL_OTHER',   'RC_OTHER'),
      ( 85, 'WP-OF-KIOSK',          'Kiosk Occupancy Fee - WP',                 'WP',    'Occupancy Fee',                'income', 'TL_OTHER',   'RC_OTHER'),
      ( 86, 'WP-CR',                'Wellness Park CR',                         'WP',    'Other Collections',            'income', 'TL_WP_CR',   'RC_WP'),
      ( 87, 'WP-CERT',              'Wellness Park Certification',              'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 88, 'WP-FITNESS',           'Entrance fee Adult''s Fitness Ground',     'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 89, 'WP-PLAYGROUND',        'Entrance Fee Children''s Playground',      'WP',    'Other Collections',            'income', 'TL_WP_PLAY', 'RC_WP'),
      ( 90, 'WP-MISC',              'Wellness Park Miscellaneous Fee',          'WP',    'Other Collections',            'income', 'TL_WP',      'RC_WP'),
      ( 91, 'NM-FEE',               'Night Market',                             'NM',    'Night Market',                 'income', 'TL_OTHER',   'RC_OTHER'),
      ( 92, 'TABO-FEE',             'IBJT Tabo',                                'TABO',  'IBJT Tabo',                    'income', 'TL_OTHER',   'RC_OTHER'),
      ( 93, 'NI-NMIS',              'Ante Mortem/Post-Mortem NMIS',             null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_NMIS',  'RC_NMIS'),
      ( 94, 'NI-CITATION',          'Citation Ticket',                          null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_CIT'),
      ( 95, 'NI-ELEC-IBJT',         'IBJT Electricity',                         null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 96, 'NI-ELEC-CPM',          'Public Mall Electricity',                  null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 97, 'NI-ELEC-WP',           'Wellness Park Electricity',                null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 98, 'NI-ELEC-UNITOP',       'Unitop Electricity',                       null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_ELEC',  'RC_ELEC'),
      ( 99, 'NI-PRIORADJ',          'Prior Period Cash Remittance Adjustments', null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (100, 'NI-VET',               'Veterinary Fee',                           null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (101, 'NI-LEAVE',             'Payment for Disapproved Leave',            null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER'),
      (102, 'NI-WTAX',              'Withholding Tax - Cash Advance',           null,    'Regulatory Collection (Non-Income)', 'non_income', 'TL_OTHER', 'RC_OTHER')
    ) as v(ord, code, name, fc, grp, kind, tl, rc)
    left join facilities f on f.code = v.fc
    join treasurer_lines t on t.code = v.tl
    join rcd_columns r on r.code = v.rc
  on conflict (code) do nothing;

  -- Rules ---------------------------------------------------------------------------
  -- (fee code, facility code, section name, rate class, portion, account code, share_bps).
  -- One temp table per call; a rule set is a distinct (fee, facility, section, class,
  -- portion), its shares the rows that share that key.
  create temporary table if not exists _seed_rule (
    fee text, fc text, sec text, rc text, portion text, acct text, bps integer
  ) on commit drop;
  truncate _seed_rule;

  -- Rent, by section, for each rental fee type.
  insert into _seed_rule
  select fee, v.fc, v.sec, null, 'base', v.acct, 10000
    from (values
      ('CPM', 'Bakery', 'CPM-DR-BAKERY'), ('CPM', 'Dressed Chicken', 'CPM-DR-DRESSEDCHICKEN'),
      ('CPM', 'Dried Fish', 'CPM-DR-DRIEDFISH'), ('CPM', 'Dry Goods', 'CPM-DR-DRYGOODS'),
      ('CPM', 'Flowers', 'CPM-DR-FLOWERS'), ('CPM', 'Food Court', 'CPM-DR-FOODCOURT'),
      ('CPM', 'Fresh Fish', 'CPM-DR-FRESHFISH'), ('CPM', 'Fresh Meat', 'CPM-DR-FRESHMEAT'),
      ('CPM', 'Fresh Vegetables', 'CPM-DR-FRESHVEG'), ('CPM', 'Fruits', 'CPM-DR-FRUITS'),
      ('CPM', 'Grains', 'CPM-DR-GRAINS'), ('CPM', 'Grinder', 'CPM-DR-GRINDER'),
      ('CPM', 'Mini-Grocery', 'CPM-DR-MINIGROCERY'), ('CPM', 'Native Product', 'CPM-DR-NATIVE'),
      ('CPM', 'Parlor/Barber Shop', 'CPM-DR-PARLOR'), ('CPM', 'Tobacco', 'CPM-DR-TOBACCO'),
      ('CPM', 'Ukay-Ukay', 'CPM-DR-UKAY'),
      ('CPM', 'Rentable Space', 'CPM-MR-RENTABLE'), ('CPM', 'Semi-Rentable Space', 'CPM-MR-SEMI'),
      ('IBJT', 'Building 2', 'IBJT-DR-B2'), ('IBJT', 'Building 3', 'IBJT-DR-B3'),
      ('IBJT', 'Kiosk', 'IBJT-DR-KIOSK'), ('IBJT', 'Rentables', 'IBJT-DR-RENTABLES'),
      ('WP', 'Food Court', 'WP-DR-FOODCOURT'), ('WP', 'Kiosk', 'WP-DR-KIOSK')
    ) as v(fc, sec, acct)
    cross join (values ('MKT_DAILY'), ('MKT_WEEKLY'), ('MKT_MONTHLY')) as r(fee);

  -- Rental surcharge portion, per facility.
  insert into _seed_rule
  select fee, v.fc, null, null, 'surcharge', v.acct, 10000
    from (values ('CPM', 'SUR-RENT-CPM'), ('IBJT', 'SUR-RENT-IBJT'), ('WP', 'SUR-RENT-WP')) as v(fc, acct)
    cross join (values ('MKT_DAILY'), ('MKT_WEEKLY'), ('MKT_MONTHLY')) as r(fee);

  -- Occupancy fee, by the paying lease's section.
  insert into _seed_rule
  select 'OCCUPANCY', v.fc, v.sec, null, 'base', v.acct, 10000
    from (values
      ('CPM', 'Bakery', 'CPM-OF-BAKERY'), ('CPM', 'Dressed Chicken', 'CPM-OF-DRESSEDCHICKEN'),
      ('CPM', 'Dried Fish', 'CPM-OF-DRIEDFISH'), ('CPM', 'Dry Goods', 'CPM-OF-DRYGOODS'),
      ('CPM', 'Flowers', 'CPM-OF-FLOWERS'), ('CPM', 'Food Court', 'CPM-OF-FOODCOURT'),
      ('CPM', 'Fresh Fish', 'CPM-OF-FRESHFISH'), ('CPM', 'Fresh Meat', 'CPM-OF-FRESHMEAT'),
      ('CPM', 'Fresh Vegetables', 'CPM-OF-FRESHVEG'), ('CPM', 'Fruits', 'CPM-OF-FRUITS'),
      ('CPM', 'Grinder', 'CPM-OF-GRINDER'), ('CPM', 'Mini-Grocery', 'CPM-OF-MINIGROCERY'),
      ('CPM', 'Native Product', 'CPM-OF-NATIVE'), ('CPM', 'Parlor/Barber Shop', 'CPM-OF-PARLOR'),
      ('CPM', 'Tobacco', 'CPM-OF-TOBACCO'), ('CPM', 'Ukay-Ukay', 'CPM-OF-UKAY'),
      ('CPM', 'Rentable Space', 'CPM-OF-RENTABLES'), ('CPM', 'Semi-Rentable Space', 'CPM-OF-RENTABLES'),
      ('IBJT', 'Building 2', 'IBJT-OF-B2'), ('IBJT', 'Building 3', 'IBJT-OF-B3'),
      ('IBJT', 'Rentables', 'IBJT-OF-RENTABLES'),
      ('WP', 'Food Court', 'WP-OF-FOODCOURT'), ('WP', 'Kiosk', 'WP-OF-KIOSK')
    ) as v(fc, sec, acct);

  -- Terminal fee, by bus company (the rate class).
  insert into _seed_rule
  select 'TERMINAL', null, null, v.rc, 'base', v.acct, 10000
    from (values
      ('ASMO', 'IBJT-TF-ASMO'), ('LOTRADISCO', 'IBJT-TF-LOTRADISCO'),
      ('OZORDITRANSCO', 'IBJT-TF-OZORDITRANSCO'), ('RTMI', 'IBJT-TF-RTMI'),
      ('STA. MARIA', 'IBJT-TF-STAMARIA'), ('Super Five', 'IBJT-TF-SUPERFIVE'),
      ('Tangub Express', 'IBJT-TF-TANGUB'), ('Tudela Liner', 'IBJT-TF-TUDELA')
    ) as v(rc, acct);

  -- One fee type, one account.
  insert into _seed_rule
  select v.fee, null, null, null, 'base', v.acct, 10000
    from (values
      ('CPM_CR', 'CPM-CR'), ('CPM_CERT', 'CPM-CERT'), ('CPM_DELIVERY', 'CPM-DELIVERY'),
      ('CPM_MISC', 'CPM-MISC'), ('CPM_PARKING', 'CPM-PARKING'), ('CPM_STORAGE', 'CPM-STORAGE'),
      ('IBJT_CR', 'IBJT-CR'), ('IBJT_CERT', 'IBJT-CERT'), ('IBJT_MISC', 'IBJT-MISC'),
      ('IBJT_PARKING', 'IBJT-PARKING'),
      ('WP_CR', 'WP-CR'), ('WP_CERT', 'WP-CERT'), ('WP_MISC', 'WP-MISC'),
      ('WP_PLAYGROUND', 'WP-PLAYGROUND'), ('WP_FITNESS', 'WP-FITNESS'),
      ('COTTA_ENTRANCE', 'COTTA-ENTRANCE'), ('CEM_BURIAL', 'CEM-BURIAL'), ('GYM_RENTAL', 'GYM-RENTAL'),
      ('NM_FEE', 'NM-FEE'), ('TABO_FEE', 'TABO-FEE'),
      ('SLAUGHTER', 'SLH-SLAUGHTER'), ('SLH_CORRAL', 'SLH-CORRAL'), ('SLH_ENTRAILS', 'SLH-ENTRAILS'),
      ('SLH_PERMIT', 'SLH-PERMIT'), ('SLH_REG', 'SLH-REG'), ('SLH_AF52', 'SLH-AF52'),
      ('SLH_AF53', 'SLH-AF53'), ('VET_FEE', 'NI-VET'), ('CITATION', 'NI-CITATION'),
      ('ELEC_CPM', 'NI-ELEC-CPM'), ('ELEC_IBJT', 'NI-ELEC-IBJT'),
      ('ELEC_WP', 'NI-ELEC-WP'), ('ELEC_UNITOP', 'NI-ELEC-UNITOP'),
      ('ELEC_SUR_CPM', 'SUR-ELEC-CPM'), ('ELEC_SUR_IBJT', 'SUR-ELEC-IBJT'),
      ('ELEC_SUR_WP', 'SUR-ELEC-WP'), ('ELEC_SUR_UNITOP', 'SUR-ELEC-UNITOP')
    ) as v(fee, acct);

  -- Ante- and post-mortem: 75% city income, 25% NMIS (spec decision; open question on the
  -- effective date).
  insert into _seed_rule values
    ('SLH_ANTE', null, null, null, 'base', 'SLH-ANTE', 7500),
    ('SLH_ANTE', null, null, null, 'base', 'NI-NMIS',  2500),
    ('SLH_POST', null, null, null, 'base', 'SLH-POST', 7500),
    ('SLH_POST', null, null, null, 'base', 'NI-NMIS',  2500);

  -- Resolve codes to ids. A key whose facility or section is missing is skipped, never
  -- widened into a broader rule.
  create temporary table if not exists _seed_rule_ids (
    fee_type_id uuid, facility_id uuid, section_id uuid, rate_class text, portion text,
    account_id uuid, bps integer
  ) on commit drop;
  truncate _seed_rule_ids;

  insert into _seed_rule_ids
  select ft.id, f.id, s.id, r.rc, r.portion, a.id, r.bps
    from _seed_rule r
    join fee_types ft on ft.code = r.fee
    join collection_accounts a on a.code = r.acct
    left join facilities f on f.code = r.fc
    left join sections s on s.facility_id = f.id and s.name = r.sec
   where (r.fc is null or f.id is not null)
     and (r.sec is null or s.id is not null);

  insert into account_rules (fee_type_id, facility_id, section_id, rate_class, portion, effective_from)
  select distinct k.fee_type_id, k.facility_id, k.section_id, k.rate_class, k.portion, date '2026-10-01'
    from _seed_rule_ids k
   where not exists (
     select 1 from account_rules x
      where x.fee_type_id = k.fee_type_id and x.portion = k.portion
        and x.facility_id is not distinct from k.facility_id
        and x.section_id is not distinct from k.section_id
        and x.rate_class is not distinct from k.rate_class);

  insert into account_rule_shares (rule_id, account_id, share_bps)
  select x.id, k.account_id, k.bps
    from _seed_rule_ids k
    join account_rules x
      on x.fee_type_id = k.fee_type_id and x.portion = k.portion
     and x.facility_id is not distinct from k.facility_id
     and x.section_id is not distinct from k.section_id
     and x.rate_class is not distinct from k.rate_class
     and x.effective_from = date '2026-10-01'
   where not exists (select 1 from account_rule_shares s where s.rule_id = x.id);
end;
$$;

revoke execute on function ceedo_collections.install_account_catalogue() from public;
select ceedo_collections.install_account_catalogue();

-- ---------------------------------------------------------------------------------------
-- clear_all_data (from 066) now reinstalls the whole catalogue after the wipe.

create or replace function ceedo_collections.clear_all_data()
returns integer
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_tables text;
  v_count  integer;
begin
  if not ceedo_collections.is_super_admin() then
    raise exception 'Only a super administrator may clear the data'
      using errcode = 'insufficient_privilege';
  end if;

  select string_agg(format('ceedo_collections.%I', c.relname), ', '), count(*)
    into v_tables, v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ceedo_collections'
     and c.relkind in ('r', 'p')
     and c.relname not in ('app_users', 'settings', 'super_admins', 'deployed_migrations');

  if v_tables is not null then
    execute 'truncate ' || v_tables || ' restart identity';
  end if;

  -- The chart and catalogue are configuration, not test data.
  perform ceedo_collections.install_account_catalogue();

  return v_count;
end;
$$;

revoke execute on function ceedo_collections.clear_all_data() from public, anon;
grant execute on function ceedo_collections.clear_all_data() to authenticated;
