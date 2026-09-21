import type { Collector } from "./types";

let current: Collector | null = null;

export function signedIn(): Collector | null {
  return current;
}

export function setSession(collector: Collector): void {
  current = collector;
}

/**
 * SIGNING OUT CLEARS A SESSION, NEVER DATA. Parent §6.4, and it is not a nicety: on a
 * shared tablet the next collector must never see the previous one's unsynced receipts
 * disappear or be re-attributed. Nothing in this function touches SQLite.
 *
 * The session is in memory only, and that is the same statement from the other direction:
 * there is no persisted session to clear, so closing the app signs the collector out and
 * leaves every receipt they took exactly where it was.
 */
export function signOut(): void {
  current = null;
}
