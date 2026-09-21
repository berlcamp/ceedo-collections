import { drizzle } from "drizzle-orm/expo-sqlite";
import { sync, type SyncOutcome } from "@ceedo/sync-engine";
import { deviceDriver } from "../db/driver";
import { httpTransport } from "./transport";
import { apiConfig } from "./config";
import { loadCredential } from "../auth/credential-store";

export { drizzle };

/**
 * The business date this tablet believes it is, `YYYY-MM-DD` in Asia/Manila.
 *
 * ASIA/MANILA EXPLICITLY, never the device's own locale formatting. The server derives
 * business_date the same way (`(collected_at at time zone 'Asia/Manila')::date` in
 * post_collection), and a tablet whose timezone was nudged would otherwise disagree with
 * the server about which day a receipt belongs to -- which shows up as a closeout that
 * cannot balance, on a device nobody suspects.
 */
export function businessDate(now = new Date()): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, which is the format the wire and SQLite both use.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class NotEnrolledError extends Error {
  constructor() {
    super("This tablet has no credential. Enrol it before syncing.");
    this.name = "NotEnrolledError";
  }
}

/**
 * One sync with this tablet's own credential, driver and transport.
 *
 * Every screen goes through here rather than assembling `sync()`'s dependencies itself, so
 * there is one place that knows which credential is current and one place that decides what
 * "today" means.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const credential = await loadCredential();
  if (!credential) throw new NotEnrolledError();
  return runSync(credential.credentialId, credential.secret);
}

/**
 * The same sync, with a credential passed in rather than read from the Keystore.
 *
 * Enrollment needs this: it must sync with the credential it has just accepted, and a read
 * back through SecureStore would be testing the store rather than the credential.
 */
export async function runSync(
  credentialId: string,
  secret: string,
): Promise<SyncOutcome> {
  const config = apiConfig();
  return sync({
    // The memoized driver (ruling R11), not a fresh `expoSqliteDriver(openDeviceDb())`.
    // This was the one call site the sweep missed. Harmless here -- it is not a render
    // body, so the new object identity could not restart an effect -- but R11 was meant to
    // be all of them, and one survivor is how the pattern comes back.
    driver: deviceDriver(),
    transport: httpTransport(config),
    credentialId,
    secret,
    businessDate: businessDate(),
  });
}
