-- Phase 5: which kind of facility a fee type is collected at.
--
-- Fee types and rates are global (§6.1 sends every tablet "the rate table"), so a tablet at
-- the bus terminal was offering the slaughterhouse's hog and cattle rates, and a market
-- tablet the terminal's bus fee. The tablet now offers only the fees whose facility_type
-- matches its own facility's type.
--
-- NULLABLE, AND NULL MEANS "ANYWHERE". A fee the office has not classified stays visible
-- everywhere, as before, rather than silently vanishing from every tablet.
--
-- Accruing fee types (market rentals) are billed through leases, never picked on the
-- on-the-spot screen, so their value only documents where they belong.

alter table ceedo_collections.fee_types
  add column facility_type ceedo_collections.facility_type;

comment on column ceedo_collections.fee_types.facility_type is
  'Where this fee is collected. Null: offered at every facility.';

-- Backfill the fee types the seed creates. Harmless where a code is absent. The update
-- bumps row_version through the existing trigger, so every tablet receives the new value
-- on its next pull.
update ceedo_collections.fee_types set facility_type = 'market'
 where code in ('MKT_DAILY', 'MKT_WEEKLY', 'MKT_MONTHLY', 'AMBULANT');
update ceedo_collections.fee_types set facility_type = 'parking' where code = 'PARKING';
update ceedo_collections.fee_types set facility_type = 'terminal' where code = 'TERMINAL';
update ceedo_collections.fee_types set facility_type = 'slaughterhouse' where code = 'SLAUGHTER';
