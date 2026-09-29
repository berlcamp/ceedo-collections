import type { SqliteDriver } from "./driver";

export type FacilityType = "market" | "terminal" | "parking" | "slaughterhouse";

export interface CollectorSite {
  name: string;
  type: FacilityType;
}

/**
 * SQL condition: the section aliased `sec` lies in the collection area of the collector
 * bound to its one `?`. A null section on the assignment covers the whole facility.
 *
 * Every tablet holds every facility (server migration 20260929000055), so this is what
 * keeps a collector to their own stalls: the stall search and the card scan both apply it.
 */
export const IN_COLLECTOR_AREA = `exists (
  select 1 from collector_assignments ca
   where ca.collector_id = ? and ca.active = 1
     and ca.facility_id = sec.facility_id
     and (ca.section_id is null or ca.section_id = sec.id))`;

/**
 * The facility the signed-in collector works at, from their collection area. Null when
 * there is no single one: before the first sync, or a collector whose areas span several
 * facilities. An unknown site falls back to the market round and every on-the-spot fee.
 */
export async function collectorSite(
  driver: SqliteDriver,
  collectorId: string,
): Promise<CollectorSite | null> {
  const rows = await driver.select<{ name: string; type: FacilityType }>(
    `select distinct f.name, f.type
       from collector_assignments ca
       join facilities f on f.id = ca.facility_id
      where ca.collector_id = ? and ca.active = 1 and f.active = 1
      limit 2`,
    [collectorId],
  );
  return rows.length === 1 ? rows[0]! : null;
}

export interface FeeChoice {
  fee_type_id: string;
  fee_name: string;
  rate_class: string | null;
}

/**
 * The on-the-spot fees this tablet may collect: one entry per fee type and rate class.
 *
 * Non-accruing only: an accruing fee raises charges and belongs on a lease. Scoped to the
 * collector's facility type (migration 0045), so the terminal tablet offers bus and jeepney
 * fees, not the slaughterhouse's hog rate. A fee with no facility type is offered
 * everywhere, and so is everything when the site is not yet known, which keeps an
 * unclassified fee or an unsynced tablet from showing an empty list.
 */
export async function feeChoices(
  driver: SqliteDriver,
  facilityType: FacilityType | null,
): Promise<FeeChoice[]> {
  // fee_types.accrues / .active are integer-mode booleans in SQLite, hence `= 0` / `= 1`.
  return driver.select<FeeChoice>(
    `select distinct f.id as fee_type_id, f.name as fee_name, r.rate_class
       from fee_types f
       join rates r on r.fee_type_id = f.id
      where f.accrues = 0 and f.active = 1
        and (? is null or f.facility_type is null or f.facility_type = ?)
      order by f.name, r.rate_class`,
    [facilityType, facilityType],
  );
}

/**
 * What the optional payer reference is called at each kind of site. It lands in
 * `collections.payer_ref`: the plate that entered the terminal, the owner who brought the
 * animals, the vendor who paid. Optional everywhere, because a queue of jeepneys will not
 * wait while each plate is typed.
 */
export function payerPrompt(type: FacilityType | null): string {
  switch (type) {
    case "terminal":
    case "parking":
      return "Plate number";
    case "slaughterhouse":
      return "Owner's name";
    default:
      return "Vendor's name";
  }
}
