import { z } from "zod";
import { REJECT_REASONS, type RejectReason } from "./reason-codes";

/**
 * The reasons that can cross the WIRE, which is a superset of post_collection()'s.
 *
 * REJECT_REASONS is documented as "the vocabulary post_collection() answers with" and that
 * comment must stay true, so the three reasons sync_push() raises on its own -- before or
 * instead of calling the engine -- are added here rather than there. Two functions, two
 * vocabularies; collapsing them would make reason-codes.ts lie about itself.
 */
export const PUSH_REASONS = [
  ...REJECT_REASONS,
  // sync_push rejects the entry before post_collection is reached.
  "collector_not_on_device",
  // The device sent a type this server does not know -- including `cancellation`, which
  // spec D4 removed. Never silently skipped: a skipped entry is a lost receipt.
  "unknown_entry_type",
  // An entry's subtransaction raised. Its neighbours are unaffected (spec D8).
  "server_error",
] as const;

export type PushReason = (typeof PUSH_REASONS)[number];

/**
 * The wire contract, validated identically on both ends.
 *
 * The collector app validates outgoing entries against these schemas and the server's tests
 * validate responses against them, so a contract drift is a type error in both apps rather
 * than a runtime surprise in one.
 *
 * Two fields are REFUSED rather than merely ignored, and both refusals are load-bearing:
 *
 *   gross_amount  -- invariant 3. The device proposes WHICH periods and HOW MANY units; the
 *                    server decides what that costs. A schema that tolerated an amount would
 *                    invite a client to send one and a future handler to read it.
 *   device_id     -- invariant 21. It comes from the authenticated credential. A payload
 *                    carrying one is either a confused client or a hostile one.
 */

const uuid = z.string().uuid();
/** numeric(14,2) crosses the wire as a string; see the spec's note on PostgREST. */
const money = z.string().regex(/^-?\d+\.\d{2}$/);

const forbidden = {
  gross_amount: z.never().optional(),
  device_id: z.never().optional(),
};

export const CollectionPayload = z
  .object({
    id: uuid,
    or_no: z.number().int().positive(),
    booklet_id: uuid,
    collector_id: uuid,
    collected_at: z.string().datetime({ offset: true }),
    fee_type_id: uuid,
    lease_id: uuid.nullable().optional(),
    payer_ref: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    allocations: z.array(z.object({ group_rank: z.number().int().positive() })),
    lines: z.array(
      z.object({
        fee_type_id: uuid,
        rate_class: z.string().optional(),
        quantity: z.number().int().positive(),
      }),
    ),
    ...forbidden,
  })
  .strict();

export const SpoiledFormPayload = z
  .object({
    booklet_id: uuid,
    or_no: z.number().int().positive(),
    collector_id: uuid,
    reason: z.string().trim().min(1),
  })
  .strict();

export const ShiftOpenPayload = z
  .object({
    id: uuid,
    collector_id: uuid,
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    opened_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const ShiftClosePayload = z
  .object({
    id: uuid,
    declared_total: money,
    device_count: z.number().int().nonnegative(),
    device_total: money,
  })
  .strict();

/**
 * Four types. `cancellation` appears in parent spec §6.2 and is deliberately absent here:
 * spec D4 rules that a collector who writes a wrong receipt marks the form spoiled and
 * issues a new one, as the paper process already does. Cancelling a POSTED collection stays
 * a supervisor act on the web, because a collector who can cancel their own receipts can
 * make a shortfall disappear.
 */
export const PushEntry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("collection"), payload: CollectionPayload }),
  z.object({ type: z.literal("spoiled_form"), payload: SpoiledFormPayload }),
  z.object({ type: z.literal("shift_open"), payload: ShiftOpenPayload }),
  z.object({ type: z.literal("shift_close"), payload: ShiftClosePayload }),
]);

export const PushResult = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.string(),
    status: z.enum(["accepted", "duplicate", "rejected", "mismatch", "already_closed"]),
    reason: z.enum(PUSH_REASONS as unknown as [string, ...string[]]).optional(),
    retryable: z.boolean().optional(),
    detail: z.string().optional(),
    collection_id: uuid.optional(),
    shift_id: uuid.optional(),
    device_count: z.number().int().optional(),
    device_total: money.optional(),
    system_count: z.number().int().optional(),
    system_total: money.optional(),
    variance: money.optional(),
  })
  .passthrough();

export const PushRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  entries: z.array(PushEntry),
});

export const PullRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  cursor: z.number().int().nonnegative().default(0),
  epoch: z.number().int().nonnegative().optional(),
});

export const CloseoutRequest = z.object({
  credential_id: z.string().min(1),
  secret: z.string().min(1),
  shift_id: uuid,
  declared_total: money,
  device_count: z.number().int().nonnegative(),
  device_total: money,
});

export type PushEntry = z.infer<typeof PushEntry>;
export type { RejectReason };
export type PushResult = z.infer<typeof PushResult>;
export type PushRequest = z.infer<typeof PushRequest>;
export type PullRequest = z.infer<typeof PullRequest>;
export type CloseoutRequest = z.infer<typeof CloseoutRequest>;
