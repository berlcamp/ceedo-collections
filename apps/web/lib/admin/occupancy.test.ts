import { describe, expect, it } from "vitest";
import { occupancyText, stallOccupancy, type StallLease } from "./occupancy.js";

const TODAY = "2026-09-28";
const lease = (over: Partial<StallLease>): StallLease => ({
  status: "active",
  start_date: "2026-01-01",
  end_date: null,
  tenants: { full_name: "Ana Reyes" },
  ...over,
});

describe("stallOccupancy", () => {
  it("is vacant with no leases", () => {
    expect(stallOccupancy(true, [], TODAY)).toEqual({ state: "vacant" });
  });

  it("is inactive when the stall is switched off, whatever its leases", () => {
    expect(stallOccupancy(false, [lease({})], TODAY)).toEqual({ state: "inactive" });
  });

  it("is occupied by a running active lease", () => {
    expect(stallOccupancy(true, [lease({ end_date: "2026-12-31" })], TODAY)).toEqual({
      state: "occupied",
      tenant: "Ana Reyes",
      until: "2026-12-31",
    });
  });

  it("is vacant once the only lease is ended or terminated", () => {
    expect(stallOccupancy(true, [lease({ status: "ended" })], TODAY).state).toBe("vacant");
    expect(stallOccupancy(true, [lease({ status: "terminated" })], TODAY).state).toBe("vacant");
  });

  it("is vacant when an active lease's end date has passed", () => {
    expect(stallOccupancy(true, [lease({ end_date: "2026-09-27" })], TODAY).state).toBe("vacant");
  });

  it("is still occupied on the lease's last day", () => {
    expect(stallOccupancy(true, [lease({ end_date: TODAY })], TODAY).state).toBe("occupied");
  });

  it("is reserved by an active lease starting later", () => {
    const result = stallOccupancy(true, [lease({ start_date: "2026-10-01" })], TODAY);
    expect(result).toEqual({ state: "reserved", tenant: "Ana Reyes", from: "2026-10-01" });
    expect(occupancyText(result)).toBe("Reserved for Ana Reyes from 2026-10-01");
  });
});
