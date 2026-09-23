import { describe, expect, it } from "vitest";
import { intoSheets, sortCards, type CardRow } from "./cards";

function card(stallNo: string, sectionName = "Dry Goods", facilityName = "Central"): CardRow {
  return { leaseId: stallNo, stallNo, tenantName: "T", sectionName, facilityName };
}

describe("sortCards", () => {
  it("orders stall numbers numerically, the way a row of stalls runs", () => {
    const sorted = sortCards([card("DG-10"), card("DG-2"), card("DG-1")]);
    expect(sorted.map((c) => c.stallNo)).toEqual(["DG-1", "DG-2", "DG-10"]);
  });

  it("groups by market, then section, before stall number", () => {
    const sorted = sortCards([
      card("1", "Wet", "North"),
      card("2", "Dry", "Central"),
      card("1", "Wet", "Central"),
      card("1", "Dry", "Central"),
    ]);
    expect(sorted.map((c) => `${c.facilityName}/${c.sectionName}/${c.stallNo}`)).toEqual([
      "Central/Dry/1",
      "Central/Dry/2",
      "Central/Wet/1",
      "North/Wet/1",
    ]);
  });

  it("does not reorder its input", () => {
    const input = [card("2"), card("1")];
    sortCards(input);
    expect(input.map((c) => c.stallNo)).toEqual(["2", "1"]);
  });
});

describe("intoSheets", () => {
  it("puts two cards on each sheet, and an odd one alone on the last", () => {
    expect(intoSheets([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("makes no sheets from no cards", () => {
    expect(intoSheets([])).toEqual([]);
  });
});
