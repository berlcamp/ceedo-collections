import { fromPesos } from "@ceedo/shared";
import { describe, expect, it } from "vitest";
import type { CollectionRow } from "../ledger/queries";
import type { ExceptionRow } from "../ledger/exceptions";
import type { ShiftRow } from "../ledger/shift-class";
import { summariseExceptions, summariseShifts, summariseToday } from "./summary";

const receipt = (gross: number, cancelled = false) =>
  ({ grossAmount: fromPesos(gross), cancelled }) as CollectionRow;

const shift = (klass: ShiftRow["klass"], variance: number | null = null) =>
  ({ klass, variance: variance === null ? null : fromPesos(variance) }) as ShiftRow;

describe("dashboard summaries", () => {
  it("leaves voided receipts out of today's total, and counts them apart", () => {
    const today = summariseToday([receipt(100), receipt(50), receipt(999, true)]);
    expect(today).toEqual({ receipts: 2, gross: fromPesos(150), voided: 1 });
  });

  it("counts a variance only on a closed shift that disagrees, not on one never counted", () => {
    const summary = summariseShifts([
      shift("open"),
      shift("stale_open"),
      shift("unsynced"),
      shift("closed", 0),
      shift("closed", -20),
      shift("closed", 5),
      shift("remitted", -10),
    ]);
    expect(summary).toEqual({ open: 1, staleOpen: 1, unsynced: 1, varianceCount: 2 });
  });

  it("flags exceptions only once they are past the three-day line", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const seen = (iso: string) => ({ firstSeenAt: iso }) as ExceptionRow;
    const summary = summariseExceptions(
      [seen("2026-09-28T08:00:00Z"), seen("2026-09-25T13:00:00Z"), seen("2026-09-24T00:00:00Z")],
      now,
    );
    expect(summary).toEqual({ open: 3, overThreeDays: 1 });
  });
});
