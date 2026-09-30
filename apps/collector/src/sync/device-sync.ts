import { drizzle } from "drizzle-orm/expo-sqlite";
import { liftPinLocks, singleFlight, sync, type SyncOutcome } from "@ceedo/sync-engine";
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
 *
 * ONE RUN AT A TIME (singleFlight). A "Sync now" tapped while an automatic sync is going
 * joins it and hears its outcome, instead of pushing the same outbox rows a second time.
 */
const syncShared: () => Promise<SyncOutcome> = singleFlight(async () => {
  try {
    const credential = await loadCredential();
    if (!credential) throw new NotEnrolledError();
    const outcome = await runSync(credential.credentialId, credential.secret);
    settled({ ok: true });
    return outcome;
  } catch (error) {
    settled({ ok: false, error });
    throw error;
  }
});

/**
 * The sync behind every "Sync now" button: the shared run, then the PIN lock lifted.
 *
 * ONLY HERE, NEVER IN syncSoon. Parent §11.5 locks a tablet "until it next syncs", and with
 * the timer syncing every two minutes an automatic lift would make five wrong PINs cost a
 * guesser two minutes. A collector locked out asks the office, the office resets the PIN,
 * and a person taps Sync now.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const outcome = await syncShared();
  await liftPinLocks(deviceDriver());
  return outcome;
}

/**
 * How the last sync ended, whoever started it.
 *
 * THE SCREENS LISTEN RATHER THAN ASK. A sync can now start without the screen that is
 * showing (the timer, the app returning to the foreground), and a count of unsent receipts
 * that only refreshed after its own screen's button would go stale in front of the
 * collector it exists to warn.
 */
export type SyncSettled = { ok: true } | { ok: false; error: unknown };

const listeners = new Set<(result: SyncSettled) => void>();
let last: SyncSettled | null = null;

function settled(result: SyncSettled): void {
  last = result;
  for (const listener of listeners) listener(result);
}

/** Subscribes to every sync's ending. Returns the unsubscribe. */
export function onSyncSettled(listener: (result: SyncSettled) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last sync's ending in this process, or null before the first. */
export function lastSync(): SyncSettled | null {
  return last;
}

/**
 * THE ENTRY SCREENS HOLD THE AUTOMATIC SYNC OFF WHILE THEY ARE OPEN. A sync pulls as well as
 * pushes, and a pull can move the balances and period groups a collector is part-way through
 * choosing on the lease screen. The server would catch it (`stale_allocations`), but only
 * after the vendor has been told a figure. So the timer and the foreground trigger wait, and
 * the screen asks for its own sync once the receipt is saved (`syncSoon({ even: "paused" })`).
 *
 * A COUNT, NOT A FLAG, so two screens on the stack cannot release each other's hold.
 */
let holds = 0;

export function holdAutoSync(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/**
 * A sync nobody is waiting on: the timer, the foreground, the moment after a receipt is
 * saved. Failures are silent -- no signal is the normal state of a market round, and the
 * screens hear about it through `onSyncSettled` like any other ending.
 */
export function syncSoon(options: { even?: "paused" } = {}): void {
  if (holds > 0 && options.even !== "paused") return;
  syncShared().catch(() => {
    // Deliberately silent -- see above.
  });
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
