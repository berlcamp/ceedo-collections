/**
 * The text a tenant's QR card carries. Parent spec §9.2.
 *
 * `CEEDO:1:<lease-uuid>` -- the lease identifier and nothing else. No name, no balance: the
 * tablet already holds the synced data and looks everything up locally, and a card hanging
 * in a public market must say nothing about the tenant to whoever reads it. It also makes a
 * reprint byte-identical, so a lost card is a reprint, not a re-issue.
 *
 * In packages/shared for the reason enrollment-payload.ts is: the web encodes, the tablet
 * decodes, and two copies of one format drift apart silently.
 *
 * Deliberately distinct from the enrollment payload (`ceedo1:...`), so the enrol screen and
 * the scan screen each refuse the other's code instead of misreading it.
 */
const PREFIX = "CEEDO";
const VERSION = "1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeLeaseCard(leaseId: string): string {
  if (!UUID.test(leaseId)) throw new Error(`Not a lease id: ${leaseId}`);
  return `${PREFIX}:${VERSION}:${leaseId.toLowerCase()}`;
}

/** The lease id on a card, or null for anything that is not one of our cards. */
export function decodeLeaseCard(text: string): string | null {
  const [prefix, version, leaseId, ...rest] = text.trim().split(":");
  if (rest.length > 0 || !prefix || !version || !leaseId) return null;
  if (prefix.toUpperCase() !== PREFIX || version !== VERSION) return null;
  // Case-insensitive on read: some scanners upper-case QR text, and a uuid is the same uuid
  // either way. The tablet's SQLite compares ids as lower-case text, so normalise here.
  if (!UUID.test(leaseId)) return null;
  return leaseId.toLowerCase();
}
