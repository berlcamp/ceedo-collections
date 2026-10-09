-- Collection reports phase 3 (spec 2026-10-07): the columns office receipts, keyed fees and
-- checks need. No behaviour changes here beyond constraints; the RPCs follow in 067-069.

-- 1. Sections may hang off a terminal or an 'other' facility too. IBJT rents Building 2,
--    Building 3, Kiosk and Rentables stalls; Wellness Park is a market. Parking and the
--    slaughterhouse stay without sections.
create or replace function ceedo_collections.assert_market_facility()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  facility_kind ceedo_collections.facility_type;
begin
  select type into facility_kind
  from ceedo_collections.facilities where id = new.facility_id;

  if facility_kind is null or facility_kind in ('parking', 'slaughterhouse') then
    raise exception 'Sections may not belong to a % facility', coalesce(facility_kind::text, 'missing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function ceedo_collections.assert_facility_keeps_sections_valid()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if new.type in ('parking', 'slaughterhouse')
     and old.type is distinct from new.type
     and exists (select 1 from ceedo_collections.sections where facility_id = old.id)
  then
    raise exception
      'Cannot change facility % to % while it still has sections', old.code, new.type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 2. Fee types: keyed amounts, and an optional home facility.
alter table ceedo_collections.fee_types
  add column amount_mode text not null default 'rate'
    constraint fee_types_amount_mode check (amount_mode in ('rate', 'keyed')),
  add column facility_id uuid references ceedo_collections.facilities (id);

comment on column ceedo_collections.fee_types.amount_mode is
  'rate: priced from the rates table. keyed: the amount is typed on the receipt (one line, quantity 1).';
comment on column ceedo_collections.fee_types.facility_id is
  'The one facility this fee belongs to (PM CR vs IBJT CR). Null: any facility of facility_type.';

-- Tablets filter on facility_type until phase 7, so a facility-specific fee keeps the type of
-- its facility rather than relying on two columns an admin must keep in step by hand.
create or replace function ceedo_collections.fee_type_follows_facility()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if new.facility_id is not null then
    select type into new.facility_type from ceedo_collections.facilities where id = new.facility_id;
  end if;
  return new;
end;
$$;

create trigger fee_types_follow_facility
  before insert or update of facility_id, facility_type on ceedo_collections.fee_types
  for each row execute function ceedo_collections.fee_type_follows_facility();
revoke execute on function ceedo_collections.fee_type_follows_facility() from public;

-- 3. Office shifts carry no tablet.
alter table ceedo_collections.shifts
  add column kind text not null default 'device'
    constraint shifts_kind check (kind in ('device', 'office')),
  alter column device_id drop not null,
  add constraint shifts_device_matches_kind check ((kind = 'device') = (device_id is not null));

-- One open office shift per officer per day; office_shift() (068) finds it or opens it.
create unique index shifts_one_open_office_shift
  on ceedo_collections.shifts (collector_id, business_date)
  where kind = 'office' and status = 'open';

-- 4. Receipts: payment mode, and no tablet on an office receipt.
alter table ceedo_collections.collections
  alter column device_id drop not null,
  add column payment_mode text not null default 'cash'
    constraint collections_payment_mode check (payment_mode in ('cash', 'check')),
  add column check_no   text,
  add column bank       text,
  add column check_date date,
  -- The three check fields exist exactly when the receipt is a check.
  add constraint collections_check_details check (
    (payment_mode = 'check') = (check_no is not null and bank is not null and check_date is not null)
    and (payment_mode = 'check' or (check_no is null and bank is null and check_date is null))
  ),
  -- Collectors in the field take cash. A check is accepted at the office only, and an office
  -- receipt is the only kind with no tablet.
  add constraint collections_check_only_from_office check (payment_mode = 'cash' or device_id is null);
