import { describe, expect, it } from "vitest";
import { exceptionsInScope, type OpenException } from "./open-exceptions";
import type { ReportParams } from "./params";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const LEASE = "33333333-3333-4333-8333-333333333333";

const params: ReportParams = { date: "2026-09-29", month: "2026-09", collectorId: ALICE, leaseId: LEASE };

function ex(collectorId: string, collectedAt: string | null, leaseId: string | null = null): OpenException {
  return { collectorId, collectedAt, leaseId };
}

describe("exceptionsInScope", () => {
  it("scopes a daily report to that Manila date and collector", () => {
    const rows = [
      ex(ALICE, "2026-09-28T16:30:00Z"), // 00:30 on the 29th in Manila
      ex(ALICE, "2026-09-28T15:30:00Z"), // 23:30 on the 28th in Manila
      ex(BOB, "2026-09-29T02:00:00Z"),
    ];

    expect(exceptionsInScope(rows, ["collector", "date"], params)).toEqual([rows[0]]);
  });

  it("scopes a monthly report to the month, for every collector", () => {
    const rows = [ex(ALICE, "2026-09-01T00:00:00+08:00"), ex(BOB, "2026-09-30T23:00:00+08:00"), ex(BOB, "2026-10-01T00:30:00+08:00")];

    expect(exceptionsInScope(rows, ["month"], params)).toEqual([rows[0], rows[1]]);
  });

  it("counts every open exception for a balance as of now", () => {
    const rows = [ex(ALICE, "2025-01-01T00:00:00Z"), ex(BOB, "2026-09-29T00:00:00Z")];

    expect(exceptionsInScope(rows, [], params)).toEqual(rows);
  });

  it("scopes a lease's ledger to that lease", () => {
    const rows = [ex(ALICE, "2026-09-29T00:00:00Z", LEASE), ex(ALICE, "2026-09-29T00:00:00Z", null)];

    expect(exceptionsInScope(rows, ["lease"], params)).toEqual([rows[0]]);
  });

  it("counts a receipt whose date cannot be read rather than hiding it", () => {
    const rows = [ex(ALICE, null)];

    expect(exceptionsInScope(rows, ["month"], params)).toEqual(rows);
  });
});
