/**
 * The vocabulary post_collection() answers with, shared so the collector app can render a
 * rejection the collector can act on rather than a Postgres error string.
 *
 * A rejected entry is never discarded (parent spec §6.3): by the time the server sees a
 * problem the collector has handed over a paper receipt and taken the money, so the code
 * tells a supervisor what to resolve, not the device what to throw away.
 */
export const REJECT_REASONS = [
  "booklet_not_assigned",
  "or_out_of_range",
  "or_already_used",
  "or_spoiled",
  "lease_not_found",
  "allocation_not_prefix",
  "allocation_partial_period",
  "amount_mismatch",
  "no_parts",
  "rate_not_found",
  "stale_allocations",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

/**
 * The rejections a device retries on its own, versus the ones that need a person.
 *
 * Exactly one reason is retryable, and Phase 2's handover explains why this one had to be
 * split out of `allocation_not_prefix`:
 *
 *   "A lost race returns allocation_not_prefix, which misleads. The behaviour is correct
 *    -- rejected, nothing written -- but the name points at a data problem. The right
 *    device response to a lost race is re-sync and retry automatically, not raise a
 *    supervisor exception."
 *
 * The status has a concrete consequence in sync_push: a retryable rejection files NO
 * sync_exceptions row. Every other reason means a paper receipt exists that a supervisor
 * must reconcile.
 *
 * Callers branch on membership of this set, never on the literal. Adding a retryable
 * reason later must not mean finding every `if` that named this one.
 */
export const RETRYABLE_REASONS: ReadonlySet<RejectReason> = new Set<RejectReason>([
  "stale_allocations",
]);

export function isRetryable(reason: RejectReason): boolean {
  return RETRYABLE_REASONS.has(reason);
}

export type PostResult =
  | { status: "accepted"; collectionId: string }
  | { status: "duplicate"; collectionId: string }
  | { status: "rejected"; reason: RejectReason; detail: string };
