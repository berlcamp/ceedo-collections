// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run `pnpm edge:contract` to regenerate from packages/shared/src/sync-contract.ts, which
// is the only source of truth for this contract. tests/http/contract-validation.test.ts
// fails if this copy is stale.
import { z } from "npm:zod@4";
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
type RejectReason = (typeof REJECT_REASONS)[number];

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

// z.guid(), not z.uuid(): Postgres accepts any 8-4-4-4-12 hex value as a uuid, and the
// test data's ids (md5(...)::uuid) carry no RFC version bits, which z.uuid() refuses.
const uuid = z.guid();

/**
 * numeric(14,2) on the wire — TWO shapes, and conflating them is what broke this schema.
 *
 *   OUTBOUND (device -> server): a decimal STRING. A base-10 string is the only shape that
 *     carries pesos and centavos without a binary float somewhere in the middle, and the
 *     device is the end that chooses the representation.
 *
 *   INBOUND (server -> device): a bare JSON NUMBER. Every money field in a sync response is
 *     assembled by `jsonb_build_object` inside a PL/pgSQL function, and a `numeric` written
 *     into jsonb becomes a JSON number. PostgREST's habit of quoting numeric COLUMNS does
 *     not apply here: it forwards the function's jsonb text verbatim — the same mechanism
 *     documented on `PullResponse.cursor` below. Captured from live `sync-push` and
 *     `closeout` responses, not assumed.
 *
 * `money` was used for both, so `PushResult` — which is `.strict()` — rejected every real
 * `system_total`, `device_total` and `variance` the server has ever returned. Hence a
 * second name rather than one permissive definition: widening `money` itself would have
 * fixed the inbound side by quietly abandoning the outbound discipline as well.
 */
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const wireMoney = z.union([z.number(), money]);

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
    /**
     * The device shift this receipt was collected in. Nullable and optional: a collection
     * posted from the web belongs to no device shift, and pre-3b-i devices sent none.
     *
     * Unlike `gross_amount` and `device_id`, this is NOT a forbidden field. The device is
     * the only party that knows which shift a receipt was taken during -- the server cannot
     * derive it, because a shift's time window deliberately does not bound its collections
     * (a receipt queued before the shift_open push is acked can carry
     * collected_at < opened_at). So it is a claim the server accepts, and the constraint
     * that keeps it honest is the foreign key plus close_shift's own arithmetic.
     */
    shift_id: uuid.nullable().optional(),
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

/**
 * What the server answers with, one object per pushed entry.
 *
 * `.strict()` is the point of this schema: a field the server sends and this object does
 * not name is a contract drift, and a Phase 3b device that validates its responses must be
 * told about it. That only works if every field the server ACTUALLY sends is named here.
 * Two were missing, and both were captured live before being added:
 *
 *   gross_amount  -- on EVERY accepted collection. post_collection() recomputes the amount
 *                   (invariant 3) and reports what it charged, which is the figure the
 *                   device shows the vendor. Absent here, `.strict()` failed every
 *                   successful push — i.e. a validating device would have treated a settled
 *                   receipt as a protocol error and, following §6.4, kept re-pushing it.
 *                   Note this is the response direction: `CollectionPayload` still REFUSES
 *                   an inbound gross_amount, and must.
 *   shift_status  -- on close_shift()'s `already_closed` answer, naming the status it found.
 *
 * The lesson is in the test, not here: `sync-contract.test.ts` validated hand-written
 * literals, which can only ever prove the schema agrees with whoever wrote them. The
 * response shape is now parsed from a real HTTP call in `tests/http/functions.test.ts`.
 */
export const PushResult = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.string(),
    // `closed` was missing too, and for the same reason as the two fields below: nothing
    // ever parsed a real response. close_shift() answers a SUCCESSFUL closeout with it, so
    // `.strict()` rejected every completed shift as well as every accepted collection.
    status: z.enum([
      "accepted",
      "duplicate",
      "rejected",
      "mismatch",
      "closed",
      "already_closed",
    ]),
    reason: z.enum(PUSH_REASONS as unknown as [string, ...string[]]).optional(),
    retryable: z.boolean().optional(),
    detail: z.string().optional(),
    collection_id: uuid.optional(),
    gross_amount: wireMoney.optional(),
    shift_id: uuid.optional(),
    shift_status: z.string().optional(),
    device_count: z.number().int().optional(),
    device_total: wireMoney.optional(),
    system_count: z.number().int().optional(),
    system_total: wireMoney.optional(),
    variance: wireMoney.optional(),
  })
  .strict();

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

/**
 * The pull envelope. Deliberately does NOT enumerate the 17 table arrays: their row shapes
 * are already generated into `db.types.ts` from the live schema and cannot drift there, so a
 * second hand-written definition would be a drift hazard with no payoff. The device inserts
 * rows against its own SQLite schema, so a renamed column breaks nothing this would catch --
 * whereas a malformed `cursor` or `epoch` breaks the sync loop itself.
 *
 * Both fields verified against `sync_pull.sql`, not assumed:
 *
 *   cursor -- `v_cursor` is read from `row_version_seq` (bigint) and placed into the jsonb
 *             result via `jsonb_build_object`. Confirmed on a live call that this crosses as
 *             a bare JSON number, not a PostgREST-quoted string: the string-quoting behaviour
 *             PostgREST applies to bigint/numeric *columns* in a REST response does not apply
 *             here, because the whole envelope is jsonb assembled inside the function, and
 *             PostgREST forwards that jsonb text verbatim.
 *
 *   epoch  -- Task 11's brief (and an earlier draft of this one) claimed this is nullable,
 *             reasoning that `v_epoch` comes through the `left join` to `device_assignments`.
 *             That is NOT what the SQL does: `v_epoch` is bound to `d.assignment_epoch`, a
 *             column on `devices` itself (`integer not null default 0`, migration
 *             20260918000031_assignment_epoch.sql) that is selected regardless of whether the
 *             left join finds an active assignment row -- only `facility_id`/`section_id`
 *             (bound from the joined table) can be null. A device with no active assignment
 *             still reports `epoch: 0`. Confirmed against a live call as well.
 */
export const PullResponse = z
  .object({
    cursor: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
  })
  .passthrough();

export type PullResponse = z.infer<typeof PullResponse>;

export type PushEntry = z.infer<typeof PushEntry>;
export type { RejectReason };
export type PushResult = z.infer<typeof PushResult>;
export type PushRequest = z.infer<typeof PushRequest>;
export type PullRequest = z.infer<typeof PullRequest>;
export type CloseoutRequest = z.infer<typeof CloseoutRequest>;
