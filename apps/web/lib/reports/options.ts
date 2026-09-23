import { getServerClient } from "@/lib/supabase/server";

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
