import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { compareStall, groupBySection, rateLabel } from "./grouping";

describe("grouping helpers", () => {
  it("orders stall numbers the way people count them", () => {
    expect(["10", "2", "G-1", "1"].sort(compareStall)).toEqual(["1", "2", "10", "G-1"]);
  });

  it("labels a rate with its period", () => {
    expect(rateLabel(fromPesos(200), "daily")).toBe("200.00/day");
    expect(rateLabel(fromPesos(30000), "monthly")).toBe("30,000.00/month");
  });

  it("groups by facility then section, both sorted", () => {
    const rows = [
      { facilityName: "Public Mall", sectionName: "Meat", id: 1 },
      { facilityName: "IBJT", sectionName: "Building 2", id: 2 },
      { facilityName: "Public Mall", sectionName: "Bakery", id: 3 },
      { facilityName: "Public Mall", sectionName: "Meat", id: 4 },
    ];
    const groups = groupBySection(rows);
    expect(groups.map((g) => `${g.facilityName}/${g.sectionName}`)).toEqual([
      "IBJT/Building 2", "Public Mall/Bakery", "Public Mall/Meat",
    ]);
    expect(groups[2]!.rows.map((r) => r.id)).toEqual([1, 4]);
  });
});
