import { describe, expect, it } from "vitest";
import { accountFor, showRange, type BookletInput, type Consumption } from "./accountability";

const booklet: BookletInput = {
  id: "b1",
  label: "OR-2026",
  startNo: 1001,
  endNo: 1050,
  receivedOn: "2026-09-01",
};

// The round from the device session: 1002 and 1003 written, 1004 and 1005 spoiled, 1006
// and 1007 written, all on 23 Sep. 1001 was never used.
const round: Consumption[] = [
  { orNo: 1002, on: "2026-09-23", spoiled: false },
  { orNo: 1003, on: "2026-09-23", spoiled: false },
  { orNo: 1004, on: "2026-09-23", spoiled: true },
  { orNo: 1005, on: "2026-09-23", spoiled: true },
  { orNo: 1006, on: "2026-09-23", spoiled: false },
  { orNo: 1007, on: "2026-09-23", spoiled: false },
];

describe("accountFor", () => {
  it("carries a held booklet through the day: beginning - issued = ending", () => {
    const a = accountFor(booklet, round, "2026-09-23", "2026-09-23");
    expect(a.beginning).toMatchObject({ qty: 50, from: 1001, to: 1050 });
    expect(a.received.qty).toBe(0);
    expect(a.issued).toMatchObject({ qty: 6, from: 1002, to: 1007 });
    expect(a.ending.qty).toBe(44);
    expect(a.ending.from).toBe(1001); // the skipped form is still unused, and still owed
    expect(a.used).toBe(4);
    expect(a.spoiled).toBe(2);
    expect(a.balances).toBe(true);
  });

  it("counts spoiled forms as issued, because they left the collector's hands", () => {
    const a = accountFor(booklet, round, "2026-09-23", "2026-09-23");
    expect(a.issued.qty).toBe(a.used + a.spoiled);
    expect([a.issuedUsed, a.issuedSpoiled]).toEqual([4, 2]);
  });

  it("the next day begins where this one ended", () => {
    const next = accountFor(booklet, round, "2026-09-24", "2026-09-24");
    expect(next.beginning.qty).toBe(44);
    expect(next.issued.qty).toBe(0);
    expect([next.issuedUsed, next.issuedSpoiled]).toEqual([0, 0]);
    expect(next.ending.qty).toBe(44);
  });

  it("shows a booklet assigned during the period as received, not as beginning", () => {
    const month = accountFor(booklet, round, "2026-09-01", "2026-09-30");
    expect(month.beginning.qty).toBe(0);
    expect(month.received).toMatchObject({ qty: 50, from: 1001, to: 1050 });
    expect(month.issued.qty).toBe(6);
    expect(month.ending.qty).toBe(44);
  });

  it("ignores serials outside the booklet", () => {
    const a = accountFor(booklet, [...round, { orNo: 2000, on: "2026-09-23", spoiled: false }], "2026-09-23", "2026-09-23");
    expect(a.issued.qty).toBe(6);
  });
});

describe("showRange", () => {
  it("never hides a gap: the skipped 1001 stands apart from 1008–1050", () => {
    const a = accountFor(booklet, round, "2026-09-23", "2026-09-23");
    expect(showRange(a.ending)).toBe("1001, 1008–1050");
    expect(showRange(a.issued)).toBe("1002–1007");
  });

  it("writes a single serial alone, and a dash for none", () => {
    const one = accountFor(booklet, [{ orNo: 1004, on: "2026-09-23", spoiled: true }], "2026-09-23", "2026-09-23");
    expect(showRange(one.issued)).toBe("1004");
    const none = accountFor(booklet, [], "2026-09-23", "2026-09-23");
    expect(showRange(none.issued)).toBe("—");
  });
});
