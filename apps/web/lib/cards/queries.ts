import { getServerClient } from "../supabase/server";
import { sortCards, type CardRow } from "./cards";

export interface CardFilter {
  facilityId?: string;
  sectionId?: string;
  leaseId?: string;
}

export interface FacilityOption {
  id: string;
  name: string;
  sections: { id: string; name: string }[];
}

/**
 * PostgREST returns at most 1000 rows per request, and a market's leases can exceed that.
 * Reading in pages stops a print run from being cut short without any error.
 */
const PAGE = 1000;

/** Active leases only: a card for a lease that has ended is a card nobody should scan. */
export async function getCards(filter: CardFilter): Promise<CardRow[]> {
  const supabase = await getServerClient();
  const rows: CardRow[] = [];

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("leases")
      .select(
        "id, tenants!inner(full_name), stalls!inner(stall_no, sections!inner(id, name, facility_id, facilities!inner(name)))",
      )
      .eq("status", "active")
      .order("id")
      .range(from, from + PAGE - 1);

    if (filter.leaseId) query = query.eq("id", filter.leaseId);
    if (filter.sectionId) query = query.eq("stalls.sections.id", filter.sectionId);
    if (filter.facilityId) query = query.eq("stalls.sections.facility_id", filter.facilityId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    for (const lease of data ?? []) {
      rows.push({
        leaseId: lease.id,
        stallNo: lease.stalls.stall_no,
        tenantName: lease.tenants.full_name,
        sectionName: lease.stalls.sections.name,
        facilityName: lease.stalls.sections.facilities.name,
      });
    }
    if (!data || data.length < PAGE) break;
  }

  return sortCards(rows);
}

export async function getFacilityOptions(): Promise<FacilityOption[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("facilities")
    .select("id, name, sections(id, name, active)")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);

  return (data ?? []).map((facility) => ({
    id: facility.id,
    name: facility.name,
    sections: facility.sections
      .filter((section) => section.active)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
