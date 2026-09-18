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
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type PostResult =
  | { status: "accepted"; collectionId: string }
  | { status: "duplicate"; collectionId: string }
  | { status: "rejected"; reason: RejectReason; detail: string };
