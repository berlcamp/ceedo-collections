/**
 * Whether a stall is free to lease, read from its leases' status and dates.
 *
 * Mirrors the database's `leases_no_active_overlap`: only an `active` lease holds a stall,
 * and only over its own date range. An active lease whose end date has passed no longer
 * blocks anyone, and one starting later holds the stall ahead of time.
 */
export interface StallLease {
  status: string;
  start_date: string;
  end_date: string | null;
  tenants: { full_name: string } | null;
}

/** An active lease whose dates cover today: the tenant holds the stall right now. */
export function isCurrentLease(
  lease: Pick<StallLease, "status" | "start_date" | "end_date">,
  today: string,
): boolean {
  return (
    lease.status === "active" &&
    lease.start_date <= today &&
    (lease.end_date === null || lease.end_date >= today)
  );
}

export type Occupancy =
  | { state: "inactive" }
  | { state: "vacant" }
  | { state: "occupied"; tenant: string; until: string | null }
  | { state: "reserved"; tenant: string; from: string };

export function stallOccupancy(
  stallActive: boolean,
  leases: readonly StallLease[],
  today: string,
): Occupancy {
  if (!stallActive) return { state: "inactive" };
  const holding = leases.filter(
    (lease) => lease.status === "active" && (lease.end_date === null || lease.end_date >= today),
  );
  const current = holding.find((lease) => isCurrentLease(lease, today));
  if (current) {
    return {
      state: "occupied",
      tenant: current.tenants?.full_name ?? "Unknown tenant",
      until: current.end_date,
    };
  }
  const next = [...holding].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (next) {
    return { state: "reserved", tenant: next.tenants?.full_name ?? "Unknown tenant", from: next.start_date };
  }
  return { state: "vacant" };
}

export const OCCUPANCY_LABEL: Record<Occupancy["state"], string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  reserved: "Reserved",
  inactive: "Inactive",
};

/** "Occupied by Juan Dela Cruz until 2026-12-31", as a dropdown or cell reads it. */
export function occupancyText(occupancy: Occupancy): string {
  switch (occupancy.state) {
    case "occupied":
      return `Occupied by ${occupancy.tenant}${occupancy.until ? ` until ${occupancy.until}` : ""}`;
    case "reserved":
      return `Reserved for ${occupancy.tenant} from ${occupancy.from}`;
    default:
      return OCCUPANCY_LABEL[occupancy.state];
  }
}
