import { describe, expect, it } from "vitest";
import { fromCentavos } from "./money";
import { computeSurcharge, generatePeriods, surchargeDueFrom } from "./charges";

describe("generatePeriods — daily", () => {
  it("raises one period per day, due on the day itself", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-03",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-01", dueDate: "2026-10-01" },
      { periodStart: "2026-10-02", periodEnd: "2026-10-02", dueDate: "2026-10-02" },
      { periodStart: "2026-10-03", periodEnd: "2026-10-03", dueDate: "2026-10-03" },
    ]);
  });

  it("never starts a period before the cutover date", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2024-01-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-02",
      dueDay: null,
    });
    expect(periods[0]!.periodStart).toBe("2026-10-01");
    expect(periods).toHaveLength(2);
  });

  it("stops at the lease end date", () => {
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2026-10-01",
      leaseEnd: "2026-10-02",
      cutover: "2026-10-01",
      through: "2026-10-05",
      dueDay: null,
    });
    expect(periods).toHaveLength(2);
  });

  it("returns nothing when the lease starts after the through date", () => {
    expect(
      generatePeriods({
        accrualPeriod: "daily",
        leaseStart: "2026-12-01",
        leaseEnd: null,
        cutover: "2026-10-01",
        through: "2026-10-05",
        dueDay: null,
      }),
    ).toEqual([]);
  });

  it("is unaffected by the lease-start guard — a daily period is always exactly one lease-covered day", () => {
    // Explicit regression pin: the head guard added for the monthly asymmetry must not
    // affect daily periods. A daily period's cursor is always `start` itself
    // (= max(leaseStart, cutover)), never floored to an earlier boundary, so periodStart
    // can never land before leaseStart.
    const periods = generatePeriods({
      accrualPeriod: "daily",
      leaseStart: "2026-10-15",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-16",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-15", periodEnd: "2026-10-15", dueDate: "2026-10-15" },
      { periodStart: "2026-10-16", periodEnd: "2026-10-16", dueDate: "2026-10-16" },
    ]);
  });
});

describe("generatePeriods — weekly", () => {
  it("raises seven-day periods due on the last day", () => {
    const periods = generatePeriods({
      accrualPeriod: "weekly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-15",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-07", dueDate: "2026-10-07" },
      { periodStart: "2026-10-08", periodEnd: "2026-10-14", dueDate: "2026-10-14" },
    ]);
  });

  it("does not raise a partial week", () => {
    const periods = generatePeriods({
      accrualPeriod: "weekly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-10",
      dueDay: null,
    });
    expect(periods).toHaveLength(1);
  });

  it("is unaffected by the lease-start guard when the lease starts mid-week", () => {
    // A weekly period's cursor starts exactly at `start` (= max(leaseStart, cutover)) rather
    // than being floored to some calendar-week boundary, so there is no partial-first-period
    // case to guard against here -- unlike monthly, where the cursor floors to the 1st. This
    // pins that the fix for the monthly asymmetry did not introduce a false skip for weekly.
    const periods = generatePeriods({
      accrualPeriod: "weekly",
      leaseStart: "2026-10-07", // a Wednesday
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-13",
      dueDay: null,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-07", periodEnd: "2026-10-13", dueDate: "2026-10-13" },
    ]);
  });
});

describe("generatePeriods — monthly", () => {
  it("raises calendar months due on the lease's due day", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-12-15",
      dueDay: 5,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-10-05" },
      { periodStart: "2026-11-01", periodEnd: "2026-11-30", dueDate: "2026-11-05" },
    ]);
  });

  it("handles February without needing to clamp — due_day is 1..28 by constraint", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2027-02-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2027-03-05",
      dueDay: 28,
    });
    expect(periods).toEqual([
      { periodStart: "2027-02-01", periodEnd: "2027-02-28", dueDate: "2027-02-28" },
    ]);
  });

  it("gets February right in a leap year", () => {
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2028-02-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2028-03-05",
      dueDay: 1,
    });
    expect(periods[0]!.periodEnd).toBe("2028-02-29");
  });

  it("rejects a monthly lease with no due day", () => {
    expect(() =>
      generatePeriods({
        accrualPeriod: "monthly",
        leaseStart: "2026-10-01",
        leaseEnd: null,
        cutover: "2026-10-01",
        through: "2026-12-01",
        dueDay: null,
      }),
    ).toThrow(/due day/i);
  });

  it("does not bill a partial first month when the lease starts mid-month", () => {
    // Not in the brief's own test list. This is the inverse of an earlier characterization
    // test that asserted the opposite (a mid-month start billing the whole calendar month).
    // That was found to be an asymmetric bug: the code already refused a partial *trailing*
    // period (`periodEnd > hardEnd`) but had no matching guard on the head, so a lease
    // *ending* mid-month billed nothing for that month while a lease *starting* mid-month
    // billed the full month. The head now matches the tail: no period is raised at all here,
    // because through (2026-10-31) never reaches a fully-lease-covered month.
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2026-10-15",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-31",
      dueDay: 5,
    });
    expect(periods).toEqual([]);
  });

  it("skips the partial first month and starts billing the following month", () => {
    // Mirror of the case above with a longer `through`, so the skipped October period and
    // the first genuinely billed period (November) are both visible.
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2026-10-15",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-12-31",
      dueDay: 5,
    });
    expect(periods).toEqual([
      { periodStart: "2026-11-01", periodEnd: "2026-11-30", dueDate: "2026-11-05" },
      { periodStart: "2026-12-01", periodEnd: "2026-12-31", dueDate: "2026-12-05" },
    ]);
  });

  it("does bill the first month when the lease starts exactly on the first of the month", () => {
    // The off-by-one the head guard could easily introduce: a lease starting precisely on
    // the 1st must not be treated as "starting mid-month" and skipped.
    const periods = generatePeriods({
      accrualPeriod: "monthly",
      leaseStart: "2026-10-01",
      leaseEnd: null,
      cutover: "2026-10-01",
      through: "2026-10-31",
      dueDay: 5,
    });
    expect(periods).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-10-05" },
    ]);
  });
});

describe("computeSurcharge", () => {
  it("is exact on the half-centavo case floats get wrong", () => {
    // 0.03 * 8350 is 250.49999999999997 in IEEE 754 and floors to 250.
    expect(computeSurcharge(fromCentavos(8350), 300)).toBe(251);
  });

  it("is zero for a zero rate", () => {
    expect(computeSurcharge(fromCentavos(8350), 0)).toBe(0);
  });

  it("rounds half up", () => {
    expect(computeSurcharge(fromCentavos(50000), 300)).toBe(1500);
  });
});

describe("surchargeDueFrom", () => {
  it("uses calendar-month arithmetic, so 31 January becomes 28 February", () => {
    expect(surchargeDueFrom("2027-01-31")).toBe("2027-02-28");
  });

  it("gives 29 February in a leap year", () => {
    expect(surchargeDueFrom("2028-01-31")).toBe("2028-02-29");
  });

  it("is an ordinary month step otherwise", () => {
    expect(surchargeDueFrom("2026-10-05")).toBe("2026-11-05");
  });
});
