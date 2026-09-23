import type { SqliteDriver } from "./driver";

export type FacilityType = "market" | "terminal" | "parking" | "slaughterhouse";

export interface DeviceSite {
  name: string;
  type: FacilityType;
}

/**
 * The facility this tablet works at, or null before its first sync.
 *
 * sync_pull sends exactly one facility row, the device's assigned one (§6.1), so the local
 * table holds at most one live row. That makes it the answer, with no assignment table to
 * consult on the device.
 */
export async function deviceSite(driver: SqliteDriver): Promise<DeviceSite | null> {
  const rows = await driver.select<{ name: string; type: FacilityType }>(
    "select name, type from facilities where active = 1 order by row_version desc limit 1",
  );
  return rows[0] ?? null;
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
 * device's facility type (migration 0045), so the terminal tablet offers bus and jeepney
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
