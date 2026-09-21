import { fromCentavos, type Centavos } from "./money";
import { type PeriodGroup } from "./fifo";

/**
 * The device's copy of what is owed. Spec F3.
 *
 * This is a TypeScript mirror of two things in migration 20260918000019: the
 * `charge_balances` view and the `unpaid_period_groups(uuid)` function. It exists because
 * parent §5.2 says outstanding is computed and never stored, and the device must compute
 * it offline from rows it already holds.
 *
 * TWO DEFINITIONS OF ONE RULE IS A DRIFT RISK, so tests/db/parity.test.ts EXECUTES both
 * against one fixture rather than comparing them by reading. A matching comment is not a
 * test.
 *
 * Pure: no I/O, no driver, no clock. packages/sync-engine/src/ledger.ts does the reading.
 */

export interface LedgerCharge {
  id: string;
  leaseId: string;
  /** 'rental' | 'surcharge' | 'opening_balance'. Kept as a string: the device is a cache. */
  chargeType: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: Centavos;
}

export interface LedgerAllocation {
  collectionId: string;
  chargeId: string;
  amount: Centavos;
}

export interface LedgerCondonation {
  chargeId: string;
  amount: Centavos;
}

export interface LedgerInput {
  charges: readonly LedgerCharge[];
  allocations: readonly LedgerAllocation[];
  condonations: readonly LedgerCondonation[];
  /** Collections with a cancellation row. Their allocations stop counting. */
  cancelledCollectionIds: ReadonlySet<string>;
}

/**
 * amount - allocated - condoned, exactly as the view computes it.
 *
 * The cancelled-collection exclusion is not optional. The SQL calls omitting it "the
 * easiest mistake in the phase to make and the hardest to notice": the ledger would report
 * voided money as received and every downstream figure would agree with it.
 */
export function chargeBalance(charge: LedgerCharge, input: LedgerInput): Centavos {
  let allocated = 0;
  for (const a of input.allocations) {
    if (a.chargeId !== charge.id) continue;
    if (input.cancelledCollectionIds.has(a.collectionId)) continue;
    allocated += a.amount;
  }

  let condoned = 0;
  for (const k of input.condonations) {
    if (k.chargeId === charge.id) condoned += k.amount;
  }

  return fromCentavos(charge.amount - allocated - condoned);
}

/**
 * The FIFO-ordered groups of what a lease still owes.
 *
 * Grouped by (due_date, period_start, period_end) and ordered by (due_date, period_start),
 * which is the SQL's ordering verbatim. `chargeIds` is ordered by charge_type to match
 * `array_agg(b.id order by b.charge_type)` -- so a rental sorts before its surcharge, and
 * the parity test can compare the arrays element by element.
 *
 * `is_settled` in SQL is `outstanding <= 0`, not `= 0`. An over-allocation must not
 * resurrect a period, so the comparison here is `<= 0` too.
 */
export function unpaidPeriodGroups(input: LedgerInput, leaseId: string): PeriodGroup[] {
  const buckets = new Map<
    string,
    { dueDate: string; periodStart: string; entries: { id: string; chargeType: string }[]; outstanding: number }
  >();

  for (const charge of input.charges) {
    if (charge.leaseId !== leaseId) continue;
    const outstanding = chargeBalance(charge, input);
    if (outstanding <= 0) continue;

    const key = `${charge.dueDate}|${charge.periodStart}|${charge.periodEnd}`;
    const bucket = buckets.get(key) ?? {
      dueDate: charge.dueDate,
      periodStart: charge.periodStart,
      entries: [],
      outstanding: 0,
    };
    bucket.entries.push({ id: charge.id, chargeType: charge.chargeType });
    bucket.outstanding += outstanding;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.periodStart.localeCompare(b.periodStart)
        : a.dueDate.localeCompare(b.dueDate),
    )
    .map((bucket, index) => ({
      groupRank: index + 1,
      dueDate: bucket.dueDate,
      periodStart: bucket.periodStart,
      chargeIds: [...bucket.entries]
        .sort((a, b) => a.chargeType.localeCompare(b.chargeType))
        .map((e) => e.id),
      outstanding: fromCentavos(bucket.outstanding),
    }));
}
