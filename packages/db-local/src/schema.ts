import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * TYPE CONVENTIONS, AND WHY THEY ARE NOT NEGOTIABLE.
 *
 *   money      -> text. numeric(14,2) through a JS number is a float, and this is a cash
 *                 ledger. packages/shared/src/money.ts is the only thing that does
 *                 arithmetic on these, and it takes strings.
 *   timestamps -> text, ISO 8601 with offset. SQLite has no date type; a text ISO string
 *                 sorts correctly and round-trips to the wire unchanged.
 *   uuid       -> text.
 *   row_version-> integer. It is a bigint server-side, but it is a sequence counter, not
 *                 money -- Number.MAX_SAFE_INTEGER is nine quadrillion and this sequence
 *                 advances a few times per device call.
 *   booleans   -> integer with mode: "boolean".
 */

/**
 * One row, id always 1. Holds the sync cursor, the assignment epoch, and the business date
 * of the last full re-sync (spec E9).
 */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  cursor: integer("cursor").notNull().default(0),
  epoch: integer("epoch").notNull().default(0),
  // E9. A deleted stall is invisible to a cursor delta forever, so a full re-sync on the
  // first sync of each business date bounds any ghost row's life to one working day.
  lastFullSyncDate: text("last_full_sync_date"),
});

/**
 * The outbox. Parent spec §6.4.
 *
 * `collectorId` is on every row and is never derived from the current session: a shared
 * tablet's second collector must not see the first collector's unsynced receipts
 * disappear or be re-attributed. Signing out clears a session, never data.
 */
export const outbox = sqliteTable("outbox", {
  // The client-generated UUID. It is the idempotency key the server keys on, so it is the
  // primary key here too -- a re-push is safe precisely because this value never changes.
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["collection", "spoiled_form", "shift_open", "shift_close"],
  }).notNull(),
  payload: text("payload").notNull(),
  collectorId: text("collector_id").notNull(),
  createdAt: text("created_at").notNull(),
  // `in_flight` means "sent, outcome unknown". Spec E11: these are RE-PUSHED on the next
  // sync, never skipped. The server answers `duplicate` if the first push did commit.
  state: text("state", {
    enum: ["pending", "in_flight", "acked", "rejected"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  reasonCode: text("reason_code"),
  retryable: integer("retryable", { mode: "boolean" }),
  lastResult: text("last_result"),
  // Insertion order, so a shift_open is pushed before any collection carrying its
  // shift_id (migration 20260919000043 made collections.shift_id a foreign key).
  seq: integer("seq").notNull(),
});

/**
 * Shifts as the device knows them. Distinct from the mirrored server `shifts` rows,
 * because a `closed_unsynced` shift exists only here until it pushes.
 */
export const localShifts = sqliteTable("local_shifts", {
  id: text("id").primaryKey(),
  collectorId: text("collector_id").notNull(),
  businessDate: text("business_date").notNull(),
  openedAt: text("opened_at").notNull(),
  // Three states, and the sign-in gate (spec E10) tests for `open` SPECIFICALLY.
  // `closed_unsynced` is finished from the collector's point of view and must not block
  // the next person, while still being pending in the outbox. A gate written as
  // `status <> 'closed'` reads as equivalent, is not, and strands the next collector.
  status: text("status", {
    enum: ["open", "closed_unsynced", "closed"],
  })
    .notNull()
    .default("open"),
  closedAt: text("closed_at"),
  declaredTotal: text("declared_total"),
  deviceCount: integer("device_count"),
  deviceTotal: text("device_total"),
});

/**
 * Five-failed-attempt lock, per collector. Parent spec §11.5.
 *
 * IN SQLITE, NOT IN MEMORY. A lock that resets when the app restarts is not a lock, and
 * force-quitting an app is not a skill a thief has to acquire.
 */
export const pinAttempts = sqliteTable("pin_attempts", {
  collectorId: text("collector_id").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedAt: text("locked_at"),
});

/**
 * Receipts this device authored, before the server has them. Spec F1.
 *
 * NOT the mirrored `collections` table, and the distinction is load-bearing: `collections`
 * is in PULLED_TABLES, which an epoch reset empties. A receipt taken offline whose only
 * local record lived there would be destroyed by a supervisor changing a device
 * assignment, and destroyed without trace -- the outbox entry carries no amount, so
 * nothing downstream could notice the loss.
 *
 * `id` is the same client-generated UUID the outbox row uses. One receipt, one id, in both
 * places, which is what makes the push idempotent and the join trivial.
 *
 * `grossAmount` is what THIS DEVICE computed. It is a claim, not truth -- the payload
 * carries no amount at all and the server recomputes from the rate table (invariant #3).
 * It is stored because parent §6.5's closeout comparison needs two sides; without it there
 * is one figure, and a single figure agrees with itself.
 */
export const localCollections = sqliteTable("local_collections", {
  id: text("id").primaryKey(),
  orNo: integer("or_no").notNull(),
  bookletId: text("booklet_id").notNull(),
  collectorId: text("collector_id").notNull(),
  shiftId: text("shift_id").notNull(),
  collectedAt: text("collected_at").notNull(),
  feeTypeId: text("fee_type_id").notNull(),
  leaseId: text("lease_id"),
  // money: text, 2dp, via toDecimalString. Never a float.
  grossAmount: text("gross_amount").notNull(),
  payerRef: text("payer_ref"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/**
 * Which charges this device believes it settled.
 *
 * RESOLVED CHARGE IDS, not the group ranks the payload carries. A rank is meaningless the
 * moment the list it indexes changes, and the whole purpose of these rows is to let the
 * local ledger subtract what this device has already collected (spec F4).
 */
export const localAllocations = sqliteTable(
  "local_allocations",
  {
    collectionId: text("collection_id").notNull(),
    chargeId: text("charge_id").notNull(),
    amount: text("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.chargeId] })],
);

/** On-the-spot items: quantity x rate. The ambulant receipt, and Phase 5's shape. */
export const localLines = sqliteTable("local_lines", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull(),
  feeTypeId: text("fee_type_id").notNull(),
  rateClass: text("rate_class"),
  quantity: integer("quantity").notNull(),
  unitRate: text("unit_rate").notNull(),
  amount: text("amount").notNull(),
});

export const DEVICE_AUTHORED_TABLES = [
  "sync_state",
  "outbox",
  "local_shifts",
  "pin_attempts",
  "local_collections",
  "local_allocations",
  "local_lines",
] as const;

/* -------------------------------------------------------------------------------------
 * The mirrored half: one table per array `sync_pull` returns.
 *
 * COLUMNS COME FROM packages/shared/src/db.types.ts, which `pnpm db:types` generates from
 * the live Postgres schema. Fifteen of the seventeen arrays are built with `to_jsonb(row)`
 * and so carry the whole server row; `collectors` and `consumed_serials` are built with an
 * explicit `jsonb_build_object` and carry only the keys named there (migration
 * 20260918000037_sync_pull_truncate.sql). Those two are mirrored as what actually arrives,
 * not as their server tables -- a column the pull will never send is a column that can only
 * ever be null.
 *
 * EVERY NON-KEY COLUMN IS NULLABLE, even where Postgres says NOT NULL. The device is a
 * cache, not an authority: a column added server-side and not yet understood here must land
 * rather than abort an apply and strand the sync loop.
 * ----------------------------------------------------------------------------------- */

export const facilities = sqliteTable("facilities", {
  id: text("id").primaryKey(),
  code: text("code"),
  name: text("name"),
  type: text("type"),
  active: integer("active", { mode: "boolean" }),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id"),
  name: text("name"),
  defaultAccrualPeriod: text("default_accrual_period"),
  active: integer("active", { mode: "boolean" }),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const stalls = sqliteTable("stalls", {
  id: text("id").primaryKey(),
  sectionId: text("section_id"),
  stallNo: text("stall_no"),
  // numeric server-side, and text here for the same reason money is: a decimal through a
  // JS float is a decimal the device cannot reproduce exactly.
  areaSqm: text("area_sqm"),
  active: integer("active", { mode: "boolean" }),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  fullName: text("full_name"),
  contactNo: text("contact_no"),
  address: text("address"),
  active: integer("active", { mode: "boolean" }),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const leases = sqliteTable("leases", {
  id: text("id").primaryKey(),
  stallId: text("stall_id"),
  tenantId: text("tenant_id"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  // money
  rateAmount: text("rate_amount"),
  accrualPeriod: text("accrual_period"),
  dueDay: integer("due_day"),
  status: text("status"),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const feeTypes = sqliteTable("fee_types", {
  id: text("id").primaryKey(),
  code: text("code"),
  name: text("name"),
  accrues: integer("accrues", { mode: "boolean" }),
  surchargeBps: integer("surcharge_bps"),
  // Where the fee is collected (migration 0045). Null: offered at every facility.
  facilityType: text("facility_type"),
  active: integer("active", { mode: "boolean" }),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const rates = sqliteTable("rates", {
  id: text("id").primaryKey(),
  feeTypeId: text("fee_type_id"),
  rateClass: text("rate_class"),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  // money
  amount: text("amount"),
  basis: text("basis"),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

/**
 * The six keys sync_pull sends, and no more. Never the auth.users email, which belongs to a
 * shared GoTrue instance (§12.1) and has no business on a tablet -- the pull does not send
 * it, and there is no column here for it to land in if it ever did.
 */
export const collectors = sqliteTable("collectors", {
  id: text("id").primaryKey(),
  employeeNo: text("employee_no"),
  fullName: text("full_name"),
  pinHash: text("pin_hash"),
  status: text("status"),
  rowVersion: integer("row_version"),
});

export const booklets = sqliteTable("booklets", {
  id: text("id").primaryKey(),
  formTypeId: text("form_type_id"),
  serialPrefix: text("serial_prefix"),
  startNo: integer("start_no"),
  endNo: integer("end_no"),
  receivedDate: text("received_date"),
  status: text("status"),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

export const bookletAssignments = sqliteTable("booklet_assignments", {
  id: text("id").primaryKey(),
  bookletId: text("booklet_id"),
  collectorId: text("collector_id"),
  assignedAt: text("assigned_at"),
  returnedAt: text("returned_at"),
  createdAt: text("created_at"),
  rowVersion: integer("row_version"),
});

/**
 * §7.1: the device refuses a spent OR offline, which it can only do if it knows which
 * serials are gone. Keyed (booklet_id, or_no) because that is the whole row -- the pull
 * sends no id, and the pair is what the server's own `collections_serial_spent_once`
 * uniqueness is stated over.
 */
export const consumedSerials = sqliteTable(
  "consumed_serials",
  {
    bookletId: text("booklet_id").notNull(),
    orNo: integer("or_no").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookletId, t.orNo] })],
);

export const spoiledForms = sqliteTable("spoiled_forms", {
  id: text("id").primaryKey(),
  bookletId: text("booklet_id"),
  orNo: integer("or_no"),
  reason: text("reason"),
  recordedAt: text("recorded_at"),
  recordedBy: text("recorded_by"),
  rowVersion: integer("row_version"),
});

export const charges = sqliteTable("charges", {
  id: text("id").primaryKey(),
  leaseId: text("lease_id"),
  feeTypeId: text("fee_type_id"),
  chargeType: text("charge_type"),
  parentChargeId: text("parent_charge_id"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  dueDate: text("due_date"),
  // text, not real: this is money. See the header comment.
  amount: text("amount"),
  surchargeBps: integer("surcharge_bps"),
  source: text("source"),
  createdAt: text("created_at"),
  createdBy: text("created_by"),
  rowVersion: integer("row_version"),
});

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  orNo: integer("or_no"),
  bookletId: text("booklet_id"),
  collectorId: text("collector_id"),
  deviceId: text("device_id"),
  collectedAt: text("collected_at"),
  businessDate: text("business_date"),
  feeTypeId: text("fee_type_id"),
  leaseId: text("lease_id"),
  payerRef: text("payer_ref"),
  // money
  grossAmount: text("gross_amount"),
  notes: text("notes"),
  // Migration 20260919000043. Null for anything posted from the web, which belongs to no
  // device shift.
  shiftId: text("shift_id"),
  syncedAt: text("synced_at"),
  postedAt: text("posted_at"),
  postedBy: text("posted_by"),
  rowVersion: integer("row_version"),
});

export const collectionAllocations = sqliteTable("collection_allocations", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id"),
  chargeId: text("charge_id"),
  // money
  amount: text("amount"),
  rowVersion: integer("row_version"),
});

export const collectionCancellations = sqliteTable("collection_cancellations", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id"),
  cancelledBy: text("cancelled_by"),
  cancelledAt: text("cancelled_at"),
  reason: text("reason"),
  rowVersion: integer("row_version"),
});

export const chargeCondonations = sqliteTable("charge_condonations", {
  id: text("id").primaryKey(),
  chargeId: text("charge_id"),
  // money
  amount: text("amount"),
  reason: text("reason"),
  authorityRef: text("authority_ref"),
  condonedBy: text("condoned_by"),
  condonedAt: text("condoned_at"),
  rowVersion: integer("row_version"),
});

/**
 * What an epoch reset empties, in the order sync_pull names them. Never a table from
 * DEVICE_AUTHORED_TABLES -- schema.test.ts forbids the overlap rather than trusting it.
 */
export const PULLED_TABLES = [
  "facilities", "sections", "stalls", "tenants", "leases",
  "fee_types", "rates", "collectors", "booklets", "booklet_assignments",
  "consumed_serials", "spoiled_forms", "charges", "collections",
  "collection_allocations", "collection_cancellations", "charge_condonations",
] as const;
