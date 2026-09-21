import { orKey, toDecimalString, type Centavos, type OrEntryContext } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";
import { enqueue } from "./outbox";

export interface DraftAllocation {
  chargeId: string;
  amount: Centavos;
}

export interface DraftLine {
  feeTypeId: string;
  rateClass: string | null;
  quantity: number;
  unitRate: Centavos;
  amount: Centavos;
}

/**
 * A receipt the collector has decided on but not yet recorded.
 *
 * `ranks` and `allocations` describe the same settlement twice, deliberately. The PAYLOAD
 * carries ranks, because post_collection resolves them positionally and recomputes the
 * amount itself. The LOCAL ROWS carry resolved charge ids, because the device's own ledger
 * has to know which charges it has optimistically settled (spec F4) and a rank is
 * meaningless the moment the list it indexes changes.
 */
export interface DraftReceipt {
  id: string;
  orNo: number;
  bookletId: string;
  collectorId: string;
  shiftId: string;
  collectedAt: string;
  feeTypeId: string;
  leaseId: string | null;
  /** What THIS DEVICE computed. A claim; the server recomputes. Never sent. */
  grossAmount: Centavos;
  ranks: readonly number[];
  allocations: readonly DraftAllocation[];
  lines: readonly DraftLine[];
  payerRef: string | null;
  notes: string | null;
}

/**
 * Everything §7.1's point-of-sale check needs, read from local state.
 *
 * `consumed` is the UNION of the pulled consumed_serials and this device's own unsynced
 * receipts. A receipt written an hour ago has not round-tripped, and offering its serial
 * again would put two receipts on one number -- which the server would catch, but only
 * after both vendors had walked away with paper.
 *
 * `spoiled` is likewise the UNION of the pulled `spoiled_forms` and this device's OWN
 * spoils, read out of the outbox. `spoiled_forms` is a PULLED table, so without the outbox
 * half a form this device spoiled is invisible to this device until it round-trips -- and
 * that serial could then be entered as a RECEIPT serial offline. `validateOrEntry` would
 * see it as neither consumed nor spoiled and accept; on push `post_collection` answers
 * `or_spoiled`, a non-retryable rejection, so it becomes a `sync_exception` with a vendor
 * holding paper and the cash already taken. That is precisely the mistake the point-of-sale
 * check exists to catch, blind for the collector's own work.
 *
 * EVERY `spoiled_form` OUTBOX ENTRY COUNTS, WHATEVER ITS STATE, not just the pushable ones.
 * `sync()` pulls BEFORE it pushes, so an entry acked during sync N does not appear in
 * `spoiled_forms` until sync N+1 -- which on a tablet with no signal can be hours. Reading
 * only `pending`/`in_flight` would reopen the gap for exactly that window. `rejected`
 * counts too: the paper form is physically spoiled whatever the server made of the message,
 * and §6.4 keeps acked entries 30 days and rejected ones until resolved, by which time the
 * pulled row has long since arrived.
 *
 * NO `local_spoiled_forms` TABLE, deliberately, and not for lack of symmetry with F1. F1
 * exists because a `collection` outbox entry carries NO AMOUNT (invariant #3 forbids it),
 * so `deviceTotals` had nothing to read and needed device-authored rows of its own. A spoil
 * payload carries `booklet_id` and `or_no` -- everything this set needs -- and the outbox is
 * already device-authored, so it survives an epoch reset exactly as a new table would. The
 * gap F1 was written to close does not exist here; adding a table would only add a second
 * write to keep in step with the first.
 *
 * BOOKLET-SCOPED, per ruling R9: `consumed_serials` is keyed `(booklet_id, or_no)`, and a
 * device pulls the booklet assignments of EVERY collector permitted to sign in to it
 * (parent spec §6.1), so this set routinely spans booklets that are not this collector's
 * candidates at all. All four sources -- `consumed_serials`, `local_collections`,
 * `spoiled_forms` and the queued spoils -- carry a `booklet_id`, so each key is built from
 * the pair, not the bare `or_no`. Without this, a serial spent in one booklet would refuse
 * the same numeral in an entirely different one.
 */
export async function orEntryContext(
  driver: SqliteDriver,
  collectorId: string,
): Promise<OrEntryContext> {
  const booklets = await driver.select<{
    id: string;
    serial_prefix: string;
    start_no: number;
    end_no: number;
  }>(
    `select b.id, b.serial_prefix, b.start_no, b.end_no
       from booklets b
       join booklet_assignments ba on ba.booklet_id = b.id
      where ba.collector_id = ? and ba.returned_at is null`,
    [collectorId],
  );

  const pulled = await driver.select<{ booklet_id: string; or_no: number }>(
    "select booklet_id, or_no from consumed_serials",
  );
  // NOT scoped to this collector: on a shared tablet, a previous collector's spent serials
  // in a booklet they still hold are still spent, and booklet scoping (not collector
  // scoping) is what makes that correct rather than incidental.
  const mine = await driver.select<{ booklet_id: string; or_no: number }>(
    "select booklet_id, or_no from local_collections",
  );
  const spoiled = await driver.select<{ booklet_id: string; or_no: number }>(
    "select booklet_id, or_no from spoiled_forms",
  );
  // This device's own spoils, which cannot be in the pulled table yet. Not scoped to this
  // collector, for the same reason `mine` above is not: on a shared tablet a previous
  // collector's spoil in a booklet they still hold is still a spoiled form.
  const queuedSpoils = await driver.select<{ payload: string }>(
    "select payload from outbox where type = 'spoiled_form'",
  );

  return {
    booklets: booklets.map((b) => ({
      id: b.id,
      serialPrefix: b.serial_prefix,
      startNo: b.start_no,
      endNo: b.end_no,
    })),
    consumed: new Set(
      [...pulled, ...mine].map((r) => orKey(r.booklet_id, r.or_no)),
    ),
    spoiled: new Set([
      ...spoiled.map((r) => orKey(r.booklet_id, r.or_no)),
      ...queuedSpoils.flatMap((r) => spoilKey(r.payload)),
    ]),
  };
}

/**
 * The `orKey` of a queued spoil, or nothing if its payload cannot supply one.
 *
 * A payload this device wrote itself always can; the tolerance is here because the
 * alternative -- throwing out of `orEntryContext` -- strands the whole entry screen behind
 * "Could not load your booklets" over a single unreadable row, refusing every serial rather
 * than one. `[]` degrades to the behaviour this function was written to replace, for that
 * row only, which is the smaller failure.
 */
function spoilKey(payload: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const { booklet_id: bookletId, or_no: orNo } = parsed as Record<string, unknown>;
  if (typeof bookletId !== "string" || typeof orNo !== "number") return [];
  return [orKey(bookletId, orNo)];
}

/**
 * Records a receipt: local rows and outbox entry, in ONE transaction. Spec F5.
 *
 * This is 3b-i E7's rule ("apply and the cursor commit together") in a second place, and
 * the failure modes are symmetrical and both silent:
 *
 *   - an outbox entry without local rows leaves the closeout short by that receipt, and
 *     tells the collector their drawer is over by an amount that IS in fact recorded;
 *   - local rows without an outbox entry mean cash recorded on the device, never pushed,
 *     and a closeout that balances against a server that never heard of it.
 *
 * `lineIds` is REQUIRED rather than generated here, for the reason openShift's `id` is:
 * this package may not import expo-crypto, and `crypto.randomUUID()` is a Node global that
 * neither Hermes nor React Native provides. A missing id is a type error at the call site
 * instead of a crash in a market.
 */
export async function commitReceipt(
  driver: SqliteDriver,
  draft: DraftReceipt,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length !== draft.lines.length) {
    throw new Error(
      `commitReceipt needs one id per line: ${draft.lines.length} lines, ${lineIds.length} ids`,
    );
  }

  await driver.transaction(async (tx) => {
    await tx.execute(
      `insert into local_collections
         (id, or_no, booklet_id, collector_id, shift_id, collected_at, fee_type_id,
          lease_id, gross_amount, payer_ref, notes, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draft.id,
        draft.orNo,
        draft.bookletId,
        draft.collectorId,
        draft.shiftId,
        draft.collectedAt,
        draft.feeTypeId,
        draft.leaseId,
        toDecimalString(draft.grossAmount),
        draft.payerRef,
        draft.notes,
        new Date().toISOString(),
      ],
    );

    for (const allocation of draft.allocations) {
      await tx.execute(
        "insert into local_allocations (collection_id, charge_id, amount) values (?, ?, ?)",
        [draft.id, allocation.chargeId, toDecimalString(allocation.amount)],
      );
    }

    for (const [index, line] of draft.lines.entries()) {
      await tx.execute(
        `insert into local_lines
           (id, collection_id, fee_type_id, rate_class, quantity, unit_rate, amount)
         values (?, ?, ?, ?, ?, ?, ?)`,
        [
          lineIds[index]!,
          draft.id,
          line.feeTypeId,
          line.rateClass,
          line.quantity,
          toDecimalString(line.unitRate),
          toDecimalString(line.amount),
        ],
      );
    }

    // The payload carries no amount at all. Invariant #3 is enforced by never accepting
    // the figure, and CollectionPayload declares gross_amount and device_id as `never`.
    await enqueue(tx, {
      id: draft.id,
      type: "collection",
      payload: {
        id: draft.id,
        or_no: draft.orNo,
        booklet_id: draft.bookletId,
        collector_id: draft.collectorId,
        collected_at: draft.collectedAt,
        fee_type_id: draft.feeTypeId,
        lease_id: draft.leaseId,
        shift_id: draft.shiftId,
        payer_ref: draft.payerRef,
        notes: draft.notes,
        allocations: draft.ranks.map((group_rank) => ({ group_rank })),
        lines: draft.lines.map((line) => ({
          fee_type_id: line.feeTypeId,
          ...(line.rateClass === null ? {} : { rate_class: line.rateClass }),
          quantity: line.quantity,
        })),
      },
      collectorId: draft.collectorId,
    });
  });
}
