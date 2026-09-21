import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import {
  chargeBalance,
  unpaidPeriodGroups,
  type LedgerCharge,
  type LedgerInput,
} from "./outstanding";

const charge = (over: Partial<LedgerCharge> & { id: string }): LedgerCharge => ({
  leaseId: "L1",
  chargeType: "rental",
  dueDate: "2026-03-01",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  amount: fromCentavos(10_000),
  ...over,
});

const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  charges: [],
  allocations: [],
  condonations: [],
  cancelledCollectionIds: new Set(),
  ...over,
});

describe("chargeBalance", () => {
  it("is the full amount when nothing points at it", () => {
    const c = charge({ id: "c1" });
    expect(chargeBalance(c, input({ charges: [c] }))).toBe(10_000);
  });

  it("subtracts allocations and condonations", () => {
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [{ collectionId: "k1", chargeId: "c1", amount: fromCentavos(3_000) }],
          condonations: [{ chargeId: "c1", amount: fromCentavos(2_000) }],
        }),
      ),
    ).toBe(5_000);
  });

  it("sums two allocations against one charge rather than collapsing them", () => {
    // charge_balances SUMS. Two collections against one charge is the double payment
    // migration 0032's row lock exists to prevent; a ledger that collapsed them would
    // report that failure as correctly settled and hide the condition the lock makes
    // visible.
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [
            { collectionId: "k1", chargeId: "c1", amount: fromCentavos(4_000) },
            { collectionId: "k2", chargeId: "c1", amount: fromCentavos(4_000) },
          ],
        }),
      ),
    ).toBe(2_000);
  });

  it("ignores allocations belonging to a cancelled collection", () => {
    const c = charge({ id: "c1" });
    expect(
      chargeBalance(
        c,
        input({
          charges: [c],
          allocations: [{ collectionId: "k1", chargeId: "c1", amount: fromCentavos(10_000) }],
          cancelledCollectionIds: new Set(["k1"]),
        }),
      ),
    ).toBe(10_000);
  });
});

describe("unpaidPeriodGroups", () => {
  it("groups a rental with its surcharge and ranks oldest first", () => {
    const rentalMar = charge({ id: "r-mar" });
    const surchMar = charge({
      id: "s-mar",
      chargeType: "surcharge",
      amount: fromCentavos(300),
    });
    const rentalApr = charge({
      id: "r-apr",
      dueDate: "2026-04-01",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });

    const groups = unpaidPeriodGroups(
      input({ charges: [rentalApr, surchMar, rentalMar] }),
      "L1",
    );

    expect(groups).toEqual([
      {
        groupRank: 1,
        dueDate: "2026-03-01",
        periodStart: "2026-03-01",
        chargeIds: ["r-mar", "s-mar"],
        outstanding: 10_300,
      },
      {
        groupRank: 2,
        dueDate: "2026-04-01",
        periodStart: "2026-04-01",
        chargeIds: ["r-apr"],
        outstanding: 10_000,
      },
    ]);
  });

  it("places an opening balance before every accrued period", () => {
    // The SQL orders by (due_date, period_start). An opening balance carries the real
    // oldest-unpaid date from the paper record. Ordering by created_at would put it LAST
    // and a tenant would settle this month's rent while two years of arrears sat
    // untouched.
    const current = charge({ id: "now", dueDate: "2026-09-01", periodStart: "2026-09-01" });
    const opening = charge({ id: "ob", dueDate: "2024-01-01", periodStart: "2024-01-01" });

    const groups = unpaidPeriodGroups(input({ charges: [current, opening] }), "L1");
    expect(groups.map((g) => g.chargeIds[0])).toEqual(["ob", "now"]);
  });

  it("omits a fully settled group and closes the rank gap", () => {
    const paid = charge({ id: "p", dueDate: "2026-03-01", periodStart: "2026-03-01" });
    const owing = charge({ id: "o", dueDate: "2026-04-01", periodStart: "2026-04-01" });

    const groups = unpaidPeriodGroups(
      input({
        charges: [paid, owing],
        allocations: [{ collectionId: "k1", chargeId: "p", amount: fromCentavos(10_000) }],
      }),
      "L1",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupRank).toBe(1);
    expect(groups[0]!.chargeIds).toEqual(["o"]);
  });

  it("excludes charges belonging to another lease", () => {
    const mine = charge({ id: "m" });
    const theirs = charge({ id: "t", leaseId: "L2" });
    const groups = unpaidPeriodGroups(input({ charges: [mine, theirs] }), "L1");
    expect(groups.flatMap((g) => g.chargeIds)).toEqual(["m"]);
  });

  it("orders chargeIds by the charge_type enum's declared position, not by string sort", () => {
    // Postgres declares the enum as ('rental', 'surcharge', 'opening_balance')
    // (migration 20260918000011_ledger_charges.sql), and a Postgres enum sorts by
    // DECLARATION POSITION, not alphabetically -- so the real ordering is
    // rental < surcharge < opening_balance, where a naive string sort would put
    // opening_balance FIRST. `{rental, surcharge}` (the only pairing today's other
    // fixtures exercise) happens to agree under either ordering, which is exactly how
    // a plain `localeCompare` on chargeType passed every other test while silently
    // disagreeing with the SQL for any group containing an opening_balance.
    //
    // The database itself rarely produces a group combining a rental and an opening
    // balance -- an opening balance's period_end is cutover - 1, which rarely matches
    // an accrued period's (due_date, period_start, period_end) key. That is a habit of
    // today's data, not a guarantee. The CONTRACT under test is unpaidPeriodGroups()'s
    // documented ordering rule ("chargeIds is ordered by charge_type to match
    // array_agg(b.id order by b.charge_type)"), so this fixture is built directly
    // regardless of whether the current accrual/opening-balance jobs would ever
    // actually produce it. Do not delete this as "unreachable" without first showing
    // the contract itself no longer promises enum order.
    const rental = charge({ id: "r1" });
    const opening = charge({ id: "ob1", chargeType: "opening_balance" });

    const groups = unpaidPeriodGroups(input({ charges: [opening, rental] }), "L1");

    expect(groups).toHaveLength(1);
    expect(groups[0]!.chargeIds).toEqual(["r1", "ob1"]);
  });
});
