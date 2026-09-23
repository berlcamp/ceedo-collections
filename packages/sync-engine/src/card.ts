import { decodeLeaseCard } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

export type CardResolution =
  | { kind: "lease"; leaseId: string }
  /** Not one of our tenant cards: an enrolment code, a product barcode, a URL. */
  | { kind: "not_a_card" }
  /** A real card, but the pull never sent this lease: another market, or not yet synced. */
  | { kind: "not_on_tablet" }
  /** The lease is on the tablet but no longer active, so nothing may be collected on it. */
  | { kind: "ended"; stallNo: string };

/**
 * What a scanned QR resolves to, looked up in the device's own database. Parent §9.3.
 *
 * Local only, never the network: the card carries the lease id alone (§9.2) precisely so a
 * scan works at 5am in a market with no signal. Every failure case names what the
 * collector should do next, because each has a different remedy and search-by-stall-number
 * (§9.4) is always one of them.
 */
export async function resolveCard(driver: SqliteDriver, text: string): Promise<CardResolution> {
  const leaseId = decodeLeaseCard(text);
  if (!leaseId) return { kind: "not_a_card" };

  const rows = await driver.select<{ status: string | null; stall_no: string | null }>(
    `select l.status, s.stall_no
       from leases l
       left join stalls s on s.id = l.stall_id
      where l.id = ?`,
    [leaseId],
  );
  const lease = rows[0];
  if (!lease) return { kind: "not_on_tablet" };
  if (lease.status !== "active") return { kind: "ended", stallNo: lease.stall_no ?? "" };
  return { kind: "lease", leaseId };
}
