import { getServerClient } from "@/lib/supabase/server";
import { allPages } from "./data";

export interface LeaseOption {
  id: string;
  label: string;
}

/** Every lease, ended ones included: a ledger is still asked for after a tenant leaves. */
export async function getLeaseOptions(): Promise<LeaseOption[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("leases")
    .select("id, status, stalls(stall_no), tenants(full_name)")
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((l) => ({
      id: l.id,
      label: `${l.stalls.stall_no} · ${l.tenants.full_name}${l.status === "active" ? "" : ` (${l.status})`}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}

export interface FacilityOption {
  id: string;
  label: string;
}

/** Every facility, by name: the hub's facility filter. */
export async function getFacilityOptions(): Promise<FacilityOption[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase.from("facilities").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ id: f.id, label: f.name }));
}

/** A facility's name for a report's scope line; null for "all facilities". */
export async function facilityLabel(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await getFacilityOptions()).find((f) => f.id === id)?.label ?? null;
}

export interface AccountOption {
  id: string;
  label: string;
}

/** Active accounts, plus UNCLASSIFIED, in chart order: the hub's account filter. */
export async function getAccountOptions(): Promise<AccountOption[]> {
  const supabase = await getServerClient();
  const rows = await allPages((a, b) =>
    supabase.from("collection_accounts").select("id, code, name, active").order("sort_order").order("id").range(a, b),
  );
  return rows.filter((r) => r.active || r.code === "UNCLASSIFIED").map((r) => ({ id: r.id, label: r.name }));
}

export interface TenantOption {
  id: string;
  label: string;
}

/** Every tenant, by name: the hub's tenant filter. */
export async function getTenantOptions(): Promise<TenantOption[]> {
  const supabase = await getServerClient();
  const rows = await allPages((a, b) =>
    supabase.from("tenants").select("id, full_name").order("full_name").order("id").range(a, b),
  );
  return rows.map((r) => ({ id: r.id, label: r.full_name }));
}
