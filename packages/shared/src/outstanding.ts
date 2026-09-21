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
 * Charge-type ordinal, mirroring how Postgres orders the `charge_type` enum
 * (migration 20260918000011_ledger_charges.sql:47-48):
 *
 *   create type ceedo_collections.charge_type as enum
 *     ('rental', 'surcharge', 'opening_balance');
 *
 * A Postgres enum sorts by DECLARATION POSITION, not alphabetically -- verified directly
 * against a live database rather than assumed:
 *
 *   select string_agg(t::text, ',' order by t)
 *     from unnest(array['surcharge','opening_balance','rental']::ceedo_collections.charge_type[]) t
 *   -> rental,surcharge,opening_balance
 *
 * The SQL this file mirrors, `array_agg(b.id order by b.charge_type)`
 * (unpaid_period_groups(), same migration file as charge_balances), relies on exactly that
 * declaration order. `{rental, surcharge}` -- the only pairing today's fixtures exercise
 * -- sorts as `rental, surcharge` under BOTH the real enum order and a plain alphabetical
 * string sort, since `rental` < `surcharge` either way. That coincidence is exactly how a
 * prior `localeCompare`-based sort passed every test while silently disagreeing with the
 * SQL for any group that also contains an `opening_balance`: alphabetically
 * `opening_balance` sorts FIRST (before `rental`), but the enum -- and the SQL -- puts it
 * LAST.
 *
 * THIS MAP MUST STAY IN STEP WITH MIGRATION 0011's DECLARATION, and that is now CHECKED
 * rather than asserted here in capitals. tests/db/parity.test.ts reads `enum_range` off the
 * live type and compares it against this map's own ordering, so a migration that adds or
 * reorders a charge_type fails the suite instead of silently diverging. It is exported for
 * exactly that test: the unit test in outstanding.test.ts pins the ordering against a
 * hardcoded assumption of what the enum order IS, which cannot catch drift, and the parity
 * fixture contains only `rental` and `surcharge` -- the one pairing that sorts identically
 * under the enum and a naive string sort, which is the same coincidence that already fooled
 * a `localeCompare` implementation on this branch.
 */
export const CHARGE_TYPE_ORDER: Record<string, number> = {
  rental: 0,
  surcharge: 1,
  opening_balance: 2,
};

/**
 * An unrecognized charge_type sorts LAST, not first.
 *
 * `LedgerCharge.chargeType` is kept as a plain string (see that field's own comment)
 * because the device is a cache and can receive a charge_type a future migration added
 * before this file's CHARGE_TYPE_ORDER is updated to know about it. Sorting an unknown
 * type to position 0 would let it silently claim the front of `chargeIds` -- exactly
 * where a caller unpacking a rental+surcharge group might assume `chargeIds[0]` is always
 * the rental. Sorting it last cannot be mistaken for that guarantee, so it is the safer
 * failure: a caller that trips over an unrecognized type at the end of the array is
 * looking at something it does not understand, not something it misidentifies as familiar.
 */
function chargeTypeRank(chargeType: string): number {
  return CHARGE_TYPE_ORDER[chargeType] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The FIFO-ordered groups of what a lease still owes.
 *
 * Grouped by (due_date, period_start, period_end) and ordered by (due_date, period_start),
 * which is the SQL's ordering verbatim. `chargeIds` is ordered by CHARGE_TYPE_ORDER (the
 * enum's declared position, not alphabetically) to match `array_agg(b.id order by
 * b.charge_type)` -- so a rental sorts before its surcharge, and the parity test can
 * compare the arrays element by element.
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
        .sort((a, b) => chargeTypeRank(a.chargeType) - chargeTypeRank(b.chargeType))
        .map((e) => e.id),
      outstanding: fromCentavos(bucket.outstanding),
    }));
}

/**
 * Per-charge outstanding within one lease, for callers that must settle charge by charge.
 *
 * `unpaidPeriodGroups` answers "what does this tenant owe, in the order it must be paid";
 * this answers "and how does one group's total divide across its rows". The device needs
 * both: it SELECTS a group and it RECORDS per charge, because `local_allocations` is keyed
 * (collection_id, charge_id) so the overlay can subtract exactly what was settled.
 */
export function chargeOutstanding(
  input: LedgerInput,
  leaseId: string,
): { chargeId: string; outstanding: Centavos }[] {
  return input.charges
    .filter((c) => c.leaseId === leaseId)
    .map((c) => ({ chargeId: c.id, outstanding: chargeBalance(c, input) }))
    .filter((r) => r.outstanding > 0);
}
