import { ledgerClient } from "./queries";

/**
 * The supervisor's view of a rejected push.
 *
 * Parent spec §6.3 is why this screen exists: "By the time the server sees a problem, the
 * collector has handed a vendor a paper official receipt and taken their money. That serial
 * is spent." Everything here is in service of a person deciding what to do about cash that
 * already changed hands.
 */

// Covers both vocabularies a supervisor can be shown: REJECT_REASONS (post_collection's own,
// packages/shared/src/reason-codes.ts) and PUSH_REASONS' three sync_push-only codes
// (collector_not_on_device, unknown_entry_type, server_error -- packages/shared/src/
// sync-contract.ts). PUSH_REASONS is deliberately not a superset check import here: the two
// vocabularies are enumerated by different modules for different callers, and this map's
// completeness is what exceptions.test.ts's "every reason the server can return" case
// exists to pin down.
const REASON_TEXT: Record<string, string> = {
  booklet_not_assigned: "The booklet is not assigned to this collector",
  or_out_of_range: "The OR number is outside the booklet's range",
  or_already_used: "Another device already recorded this OR number",
  or_spoiled: "This OR number was marked spoiled",
  lease_not_found: "No such lease",
  allocation_not_prefix: "The periods paid are not the oldest unpaid ones",
  allocation_partial_period: "A period was paid in part; whole periods only",
  amount_mismatch: "The device's amount does not match the rate table",
  no_parts: "The entry settles nothing and charges nothing",
  rate_not_found: "No rate is in effect for that fee on that date",
  stale_allocations: "The unpaid periods changed while this was in flight",
  collector_not_on_device: "This collector is not cleared for this tablet",
  unknown_entry_type: "The device sent an entry type this server does not know",
  server_error: "The server failed while posting this entry",
};

export function describeReason(code: string): string {
  return REASON_TEXT[code] ?? `Unrecognised reason (${code})`;
}

export interface PayloadSummary {
  orNo: number | null;
  leaseId: string | null;
  collectedAt: string | null;
  periods: number;
}

/**
 * The pushed payload, rendered as the few facts a supervisor acts on. Never throws: the
 * payload is whatever the device sent, and a malformed one must be visible on this screen
 * rather than crash it -- this screen is how a malformed push gets noticed at all.
 */
export function summarisePayload(payload: Record<string, unknown>): PayloadSummary {
  const source = payload && typeof payload === "object" ? payload : {};
  const allocations = source["allocations"];
  return {
    orNo: typeof source["or_no"] === "number" ? (source["or_no"] as number) : null,
    leaseId: typeof source["lease_id"] === "string" ? (source["lease_id"] as string) : null,
    collectedAt:
      typeof source["collected_at"] === "string" ? (source["collected_at"] as string) : null,
    periods: Array.isArray(allocations) ? allocations.length : 0,
  };
}

export interface ExceptionRow {
  id: string;
  collectionUuid: string;
  reasonCode: string;
  reasonText: string;
  /** What the server said on the latest push, e.g. the database error behind a
   * server_error. Null on rows filed before sync_exceptions carried it. */
  detail: string | null;
  collectorName: string;
  deviceLabel: string;
  attempts: number;
  firstSeenAt: string;
  status: string;
  summary: PayloadSummary;
  payload: Record<string, unknown>;
}

export async function getOpenExceptions(): Promise<ExceptionRow[]> {
  const supabase = await ledgerClient();
  // A single string literal, not `+`-concatenated pieces: postgrest-js's embedded-resource
  // type parser works over the literal type of the string passed to `.select()`, and `+`
  // between string literals widens to plain `string` at the type level (even though the
  // runtime value is unchanged) -- that widening is what makes every embedded column below
  // resolve to `GenericStringError` instead of the real row shape.
  const { data, error } = await supabase
    .from("sync_exceptions")
    .select(
      "id, collection_uuid, reason_code, detail, attempts, first_seen_at, status, payload, collector:app_users!sync_exceptions_collector_id_fkey(full_name), device:devices!sync_exceptions_device_id_fkey(label)",
    )
    .neq("status", "resolved")
    // Oldest first. §11.3 surfaces exceptions older than three days to the Treasurer, so
    // the ones nearest that line must be the ones a supervisor sees first.
    .order("first_seen_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      collectionUuid: row.collection_uuid,
      reasonCode: row.reason_code,
      reasonText: describeReason(row.reason_code),
      detail: row.detail,
      collectorName: row.collector?.full_name ?? "Unknown collector",
      deviceLabel: row.device?.label ?? "Unknown device",
      attempts: row.attempts,
      firstSeenAt: row.first_seen_at,
      status: row.status,
      summary: summarisePayload(payload),
      payload,
    };
  });
}
