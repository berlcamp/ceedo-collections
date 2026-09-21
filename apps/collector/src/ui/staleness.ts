import { ledgerStaleness } from "@ceedo/sync-engine";
import type { SqliteDriver } from "@ceedo/sync-engine";

export interface Freshness {
  state: "fresh" | "stale" | "never";
  /** The short form for the masthead register. */
  short: string;
  /** The full sentence, with the queued-entry clause appended when there is one. */
  full: string;
  pendingCount: number;
}

/**
 * ONE DEFINITION OF "HOW OLD ARE THESE FIGURES", used by every screen that shows a
 * device-local figure.
 *
 * It lived on the lease screen alone, so `shift`, `closeout` and `leases` all presented
 * device-local numbers with no statement of their age -- and closeout is *decided* on
 * those numbers. Product principle 5 says state staleness rather than implying freshness,
 * and a screen that simply omits the disclosure is implying freshness.
 *
 * "ENTRIES", NEVER "RECEIPTS": `ledgerStaleness` counts every outbox row in pending or
 * in_flight -- shift_open, shift_close and spoiled_form as well as collection -- so
 * calling them receipts names something no screen has checked.
 */
export async function freshness(
  driver: SqliteDriver,
  today: string,
): Promise<Freshness> {
  const { lastFullSyncDate, pendingCount } = await ledgerStaleness(driver);
  const state =
    lastFullSyncDate === null ? "never" : lastFullSyncDate === today ? "fresh" : "stale";

  const queued =
    pendingCount > 0
      ? ` ${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} still queued to send.`
      : "";

  const short =
    state === "fresh" ? "Synced today" : state === "never" ? "Never synced" : `Last sync ${lastFullSyncDate}`;

  const full =
    state === "never"
      ? `This tablet has never completed a full sync. These figures may be wrong.${queued}`
      : state === "stale"
        ? `Last full sync ${lastFullSyncDate}. Another tablet may have collected since.${queued}`
        : `Synced today.${queued}`;

  return { state, short, full, pendingCount };
}
