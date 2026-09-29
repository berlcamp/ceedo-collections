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
 * The facilities the signed-in collector works at, from their active collection areas: one
 * entry per facility, in name order. Empty before the first sync, or for a collector with
 * no active area. Screens that need a single site (the title, the payer prompt) treat more
 * than one as no single site.
 */
export async function collectorSites(
  driver: SqliteDriver,
  collectorId: string,
): Promise<CollectorSite[]> {
  return driver.select<CollectorSite>(
    `select distinct f.name, f.type
       from collector_assignments ca
       join facilities f on f.id = ca.facility_id
      where ca.collector_id = ? and ca.active = 1 and f.active = 1
      order by f.name`,
    [collectorId],
  );
}

export interface FeeChoice {
  fee_type_id: string;
  fee_name: string;
  rate_class: string | null;
}

/**
 * The on-the-spot fees the collector may collect: one entry per fee type and rate class.
 *
 * Non-accruing only: an accruing fee raises charges and belongs on a lease. Only fees
 * collected at a kind of facility the collector is assigned to (fee_types.facility_type,
 * migration 0045), so a terminal collector is offered bus and jeepney fees, not the
 * slaughterhouse's hog rate. A fee with no facility type is offered nowhere: the web form
 * requires one for an on-the-spot fee. No types, no fees.
 */
export async function feeChoices(
  driver: SqliteDriver,
  facilityTypes: readonly FacilityType[],
): Promise<FeeChoice[]> {
  if (facilityTypes.length === 0) return [];
  // fee_types.accrues / .active are integer-mode booleans in SQLite, hence `= 0` / `= 1`.
  return driver.select<FeeChoice>(
    `select distinct f.id as fee_type_id, f.name as fee_name, r.rate_class
       from fee_types f
       join rates r on r.fee_type_id = f.id
      where f.accrues = 0 and f.active = 1
        and f.facility_type in (${facilityTypes.map(() => "?").join(", ")})
      order by f.name, r.rate_class`,
    [...facilityTypes],
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
