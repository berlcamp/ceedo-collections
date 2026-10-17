import type { SqliteDriver } from "./driver";

export type FacilityType = "market" | "terminal" | "parking" | "slaughterhouse" | "other";

export interface CollectorSite {
  id: string;
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
    `select distinct f.id, f.name, f.type
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
  /** Always null for a keyed fee: it is one choice, whatever rate rows exist. */
  rate_class: string | null;
  amount_mode: "rate" | "keyed";
}

/**
 * The on-the-spot fees the collector may collect: one entry per rate fee type and rate
 * class, and one per keyed fee type (its amount is typed at the receipt, so it has no
 * rates to join to).
 *
 * Non-accruing only: an accruing fee raises charges and belongs on a lease.
 *
 * WHICH FACILITY (spec: "The tablet offers only fee types for its own facility, or those
 * with no facility"). A fee with a facility_id ("PM CR", "IBJT certification") is offered
 * only to a collector with an active area at that facility. A fee without one is offered
 * by facility_type, as before migration 0007: a terminal collector gets bus and jeepney
 * fees, not the slaughterhouse's hog rate, and Citation (type 'other') reaches only a
 * collector at an 'other' facility. A fee with neither is offered nowhere.
 *
 * NEVER OFFERED, by code, because no flag marks them:
 *   - OCCUPANCY belongs to a lease; rules place it by the lease's section, and without one
 *     it would land on UNCLASSIFIED. The office posts it.
 *   - *_CR, the comfort-room cash tickets. The office enters those per collector per day
 *     (they are not ORs), so an OR for one would be counted twice.
 *
 * A row pulled before local migration 0007 has amount_mode and facility_id null until the
 * forced re-pull lands: it reads as a facility-less rate fee, which is what it was.
 */
export async function feeChoices(
  driver: SqliteDriver,
  sites: readonly CollectorSite[],
): Promise<FeeChoice[]> {
  if (sites.length === 0) return [];
  const ids = [...new Set(sites.map((s) => s.id))];
  const types = [...new Set(sites.map((s) => s.type))];
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
  // fee_types.accrues / .active are integer-mode booleans in SQLite, hence `= 0` / `= 1`.
  return driver.select<FeeChoice>(
    `select distinct f.id as fee_type_id, f.name as fee_name,
            case when coalesce(f.amount_mode, 'rate') = 'keyed' then null else r.rate_class end as rate_class,
            case when coalesce(f.amount_mode, 'rate') = 'keyed' then 'keyed' else 'rate' end as amount_mode
       from fee_types f
       left join rates r on r.fee_type_id = f.id
      where f.accrues = 0 and f.active = 1
        and (coalesce(f.amount_mode, 'rate') = 'keyed' or r.id is not null)
        and (f.facility_id in (${marks(ids.length)})
             or (f.facility_id is null and f.facility_type in (${marks(types.length)})))
        and coalesce(f.code, '') <> 'OCCUPANCY'
        and coalesce(f.code, '') not like '%\\_CR' escape '\\'
      order by f.name, rate_class`,
    [...ids, ...types],
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
