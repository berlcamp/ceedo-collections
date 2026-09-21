import type { Centavos, PeriodGroup } from "@ceedo/shared";
import type { DraftLine } from "@ceedo/sync-engine";

/**
 * The receipt in progress, held in memory between screens.
 *
 * NOT router params. A money figure and a group selection serialized through a URL is a
 * class of bug nobody needs to invent twice -- and centavos surviving a round trip through
 * a query string as a float is precisely the thing parent §5 forbids.
 *
 * Shaped like src/auth/session.ts: module-level, cleared explicitly, never persisted. An
 * abandoned draft dies with the screen, which is correct -- nothing has been collected.
 */

export interface LeaseDraft {
  kind: "lease";
  leaseId: string;
  feeTypeId: string;
  stallNo: string;
  tenantName: string;
  groups: PeriodGroup[];
  ranks: number[];
  allocations: { chargeId: string; amount: Centavos }[];
  grossAmount: Centavos;
  change: Centavos;
}

export interface LinesDraft {
  kind: "lines";
  feeTypeId: string;
  label: string;
  lines: DraftLine[];
  grossAmount: Centavos;
}

export type Draft = LeaseDraft | LinesDraft;

let current: Draft | null = null;

export function setDraft(next: Draft): void {
  current = next;
}

export function draft(): Draft | null {
  return current;
}

/** Called after a successful commit, and when a screen is abandoned. */
export function clearDraft(): void {
  current = null;
}
