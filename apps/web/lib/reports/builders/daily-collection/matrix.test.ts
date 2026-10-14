import { describe, expect, it } from "vitest";
import { sectionTotals } from "../../report";
import { sept30 } from "./fixture";
import { matrixSections } from "./matrix";

describe("matrixSections", () => {
  it("has one row per active collector and per collector who collected, by name", () => {
    const [matrix] = matrixSections(sept30());
    // C is active with nothing; D is inactive but collected; E is inactive with nothing.
    expect(matrix.rows.map((r) => r.collector)).toEqual(["Collector A", "Collector B", "Collector C", "Collector D"]);
  });

  it("puts each collector's live money in the RCD columns and totals the row", () => {
    const [matrix] = matrixSections(sept30());
    const a = matrix.rows[0]!;
    expect(a).toMatchObject({ "col:RC_PM": 160_000, "col:RC_SUR": 1_800, "col:RC_ELEC": 172_200, "col:RC_ELEC_SUR": 3_444, total: 337_444 });
    expect(a["col:RC_SLH"]).toBeNull();
    const c = matrix.rows[2]!;
    expect(c.total).toBeNull();
  });

  it("shows active columns in order, Other collections only when it holds money", () => {
    const [matrix] = matrixSections(sept30());
    expect(matrix.columns.map((c) => c.key)).toEqual([
      "collector", "col:RC_PM", "col:RC_SUR", "col:RC_SLH", "col:RC_NMIS", "col:RC_IBJT", "col:RC_CEM", "col:RC_ELEC", "col:RC_ELEC_SUR", "col:RC_OTHER", "total",
    ]);
    const input = sept30();
    input.portions = input.portions.filter((p) => p.accountId !== "acc-unc");
    expect(matrixSections(input)[0].columns.map((c) => c.key)).not.toContain("col:RC_OTHER");
  });

  it("totals to the grand total", () => {
    const [matrix] = matrixSections(sept30());
    expect(sectionTotals(matrix)!.total).toBe(755_444);
  });

  it("splits the deposit block into checks and cash, deposited and not", () => {
    const [, deposit] = matrixSections(sept30());
    expect(deposit.rows.map((r) => [r.item, r.amount])).toEqual([
      ["Less: checks", 100_000],
      ["Cash", 655_444],
      ["Total deposit", 455_444],
      ["Undeposited", 300_000],
      ["Total collection", 755_444],
    ]);
  });

  it("omits the Undeposited row when everything is deposited", () => {
    const input = sept30();
    input.shifts = input.shifts.map((s) => (s.deposit ? s : { ...s, deposit: { on: "2026-10-01", verified: true } }));
    expect(matrixSections(input)[1].rows.map((r) => r.item)).not.toContain("Undeposited");
  });

  it("is landscape on the Per collector sheet", () => {
    const [matrix, deposit] = matrixSections(sept30());
    expect([matrix.orientation, matrix.sheet, matrix.breakBefore]).toEqual(["landscape", "Per collector", true]);
    expect([deposit.orientation, deposit.sheet]).toEqual(["landscape", "Per collector"]);
  });
});
