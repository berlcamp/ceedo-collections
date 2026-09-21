import {
  chargeOutstanding,
  parsePesoInput,
  unpaidPeriodGroups,
  type Centavos,
  type LedgerAllocation,
  type LedgerInput,
  type PeriodGroup,
} from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

/**
 * What a lease still owes, as this device can know it. Spec F4.
 *
 * Reads the pulled ledger tables AND this device's own unsynced allocations, because a
 * receipt sitting in the outbox has settled periods the server has not heard about yet.
 * Without that overlay the collector settles March offline, walks back an hour later, is
 * shown March as unpaid, and takes the money twice -- after the paper receipt is written
 * and the serial spent.
 */
async function readLedgerInput(
  driver: SqliteDriver,
  leaseId: string,
): Promise<LedgerInput> {
  const charges = await driver.select<{
    id: string;
    lease_id: string;
    charge_type: string;
    due_date: string;
    period_start: string;
    period_end: string;
    amount: string;
  }>(
    `select id, lease_id, charge_type, due_date, period_start, period_end, amount
       from charges where lease_id = ?`,
    [leaseId],
  );

  const pulled = await driver.select<{
    collection_id: string;
    charge_id: string;
    amount: string;
  }>("select collection_id, charge_id, amount from collection_allocations");

  /*
   * The overlay. Every local allocation belonging to a collection the server has NOT yet
   * reported any allocation for.
   *
   * `rejected` entries stay in. Parent §6.3 is explicit that a rejection never means
   * discard: by the time the server sees a problem the collector has handed a vendor a
   * paper official receipt and taken their money, and that serial is spent.
   *
   * DEDUPLICATED PER COLLECTION, NOT PER (collection_id, charge_id) PAIR, AND NOT ON
   * charge_id. Each of those three keys is wrong in a different direction:
   *
   *   - charge_id alone would collapse TWO DIFFERENT collections settling one charge.
   *     charge_balances deliberately SUMS those, because that is the double payment
   *     migration 0032's row lock exists to make visible -- a ledger that collapsed them
   *     would report that failure as correctly settled. Keying per COLLECTION keeps that
   *     distinction intact: a local collection with no pulled rows of its own is still
   *     subtracted, whichever charges some other collection already claimed.
   *
   *   - the PAIR silently assumes that when the server's rows for a collection arrive they
   *     name the same charges the device recorded. F7 is the decision that says they may
   *     not: post_collection resolves ranks POSITIONALLY at post time, so if another tablet
   *     settled a group and the accrual raised a new one, the count still matches and the
   *     ranks name different periods. The server then allocates k1 to charges C and D while
   *     the device wrote A and B; under a pair key neither A nor B is suppressed and the
   *     ledger subtracts FOUR settlements from one receipt. A and B then read as settled on
   *     that device permanently -- nothing deletes local_allocations, and an epoch reset
   *     only wipes the pulled tables -- so the collector is never shown them again and they
   *     are never collected. The closeout catches the shift's amount divergence and blocks,
   *     which is F7 working as designed, but reconciling a shift does not repair this.
   *
   * Once ANY server row for a collection has arrived, the server's set is authoritative for
   * that collection and the device's guesses about it are dropped entirely.
   */
  const local = await driver.select<{
    collection_id: string;
    charge_id: string;
    amount: string;
  }>(
    `select la.collection_id, la.charge_id, la.amount
       from local_allocations la
       join local_collections lc on lc.id = la.collection_id
      where lc.lease_id = ?`,
    [leaseId],
  );

  const settled = new Set(pulled.map((r) => r.collection_id));
  const allocations: LedgerAllocation[] = pulled.map((r) => ({
    collectionId: r.collection_id,
    chargeId: r.charge_id,
    amount: parsePesoInput(r.amount),
  }));
  for (const r of local) {
    if (settled.has(r.collection_id)) continue;
    allocations.push({
      collectionId: r.collection_id,
      chargeId: r.charge_id,
      amount: parsePesoInput(r.amount),
    });
  }

  const condonations = await driver.select<{ charge_id: string; amount: string }>(
    "select charge_id, amount from charge_condonations",
  );
  const cancelled = await driver.select<{ collection_id: string }>(
    "select collection_id from collection_cancellations",
  );

  return {
    charges: charges.map((r) => ({
      id: r.id,
      leaseId: r.lease_id,
      chargeType: r.charge_type,
      dueDate: r.due_date,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      amount: parsePesoInput(r.amount),
    })),
    allocations,
    condonations: condonations.map((r) => ({
      chargeId: r.charge_id,
      amount: parsePesoInput(r.amount),
    })),
    cancelledCollectionIds: new Set(cancelled.map((r) => r.collection_id)),
  };
}

/** The FIFO groups the lease screen lists and the picker selects from. */
export async function leaseLedger(
  driver: SqliteDriver,
  leaseId: string,
): Promise<PeriodGroup[]> {
  return unpaidPeriodGroups(await readLedgerInput(driver, leaseId), leaseId);
}

/**
 * The groups AND each unpaid charge's own outstanding, from ONE read.
 *
 * The screen settles a whole period group, but `local_allocations` stores one row per
 * charge (spec F1), because the overlay in this same file subtracts per charge. So the
 * caller needs the split the group hides, and getting it from a second read would let the
 * two views disagree about the same lease.
 */
export async function leaseLedgerDetail(
  driver: SqliteDriver,
  leaseId: string,
): Promise<{ groups: PeriodGroup[]; perCharge: Map<string, Centavos> }> {
  const input = await readLedgerInput(driver, leaseId);
  return {
    groups: unpaidPeriodGroups(input, leaseId),
    perCharge: new Map(
      chargeOutstanding(input, leaseId).map((r) => [r.chargeId, r.outstanding]),
    ),
  };
}

/**
 * How stale this ledger is, for the disclosure spec F7 requires.
 *
 * The device cannot detect the case where another tablet settled a group and the accrual
 * raised a new one, because the count still matches and the ranks silently name different
 * periods. The collector writes the paper receipt from the DEVICE's figure, so that is a
 * paper-versus-ledger divergence, caught at closeout rather than prevented. What the screen
 * owes is not prevention but an honest statement of how old its numbers are.
 */
export async function ledgerStaleness(
  driver: SqliteDriver,
): Promise<{ lastFullSyncDate: string | null; pendingCount: number }> {
  const state = await driver.select<{ last_full_sync_date: string | null }>(
    "select last_full_sync_date from sync_state where id = 1",
  );
  const pending = await driver.select<{ n: number }>(
    "select count(*) as n from outbox where state in ('pending','in_flight')",
  );
  return {
    lastFullSyncDate: state[0]?.last_full_sync_date ?? null,
    pendingCount: pending[0]?.n ?? 0,
  };
}
