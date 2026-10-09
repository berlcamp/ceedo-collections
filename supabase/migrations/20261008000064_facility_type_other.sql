-- City Gym, Cotta, Public Cemetery, Night Market, IBJT Tabo, Unitop: places the office
-- collects at that are neither markets, terminals, parking nor the slaughterhouse.
--
-- ALONE IN ITS FILE AND ITS BUNDLE. Postgres refuses to use an enum value in the transaction
-- that added it ("unsafe use of new value"), and a production bundle is one transaction. Deploy
-- with `--through 20261008000064` first; everything after it goes in the next bundle.
alter type ceedo_collections.facility_type add value if not exists 'other';
