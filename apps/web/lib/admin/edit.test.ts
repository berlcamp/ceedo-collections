import { describe, expect, it } from "vitest";
import { selectWithFields, updatePayload } from "./edit";
import "./registry";
import { RESOURCES } from "./resource";

describe("updatePayload", () => {
  it("drops locked fields even when the request posts them", () => {
    expect(
      updatePayload(
        { lockedOnEdit: ["stall_id", "tenant_id"] },
        { stall_id: "s2", tenant_id: "t2", status: "ended", end_date: "2026-09-30" },
      ),
    ).toEqual({ status: "ended", end_date: "2026-09-30" });
  });

  it("passes everything through for a resource with no locks", () => {
    expect(updatePayload({}, { full_name: "Rosalinda B.", active: true })).toEqual({
      full_name: "Rosalinda B.",
      active: true,
    });
  });
});

describe("selectWithFields", () => {
  it("adds the raw id columns a list selects only as joined labels", () => {
    expect(
      selectWithFields("id, status, stalls(stall_no), tenants(full_name)", [
        "stall_id",
        "tenant_id",
        "status",
      ]),
    ).toBe("id, status, stalls(stall_no), tenants(full_name), stall_id, tenant_id");
  });

  it("does not mistake a column inside a join for a top-level one", () => {
    expect(selectWithFields("id, sections(name, facility_id)", ["facility_id"])).toBe(
      "id, sections(name, facility_id), facility_id",
    );
  });

  it("leaves a select alone when it already has every field", () => {
    expect(selectWithFields("id, full_name, active", ["full_name", "active"])).toBe(
      "id, full_name, active",
    );
  });
});

describe("the registry's locks", () => {
  it("only lock fields that the resource actually has", () => {
    // A misspelt lock would silently lock nothing.
    for (const config of Object.values(RESOURCES)) {
      const names = new Set(config.fields.map((f) => f.name));
      for (const locked of config.lockedOnEdit ?? []) {
        expect(names.has(locked), `${config.key}.${locked}`).toBe(true);
      }
    }
  });

  it("keep a lease's stall and tenant, and a booklet's serial range, fixed", () => {
    expect(RESOURCES.leases?.lockedOnEdit).toEqual(
      expect.arrayContaining(["stall_id", "tenant_id"]),
    );
    expect(RESOURCES.booklets?.lockedOnEdit).toEqual(
      expect.arrayContaining(["serial_prefix", "start_no", "end_no"]),
    );
  });
});

describe("fee types' Collected at", () => {
  const schema = RESOURCES["fee-types"]!.schema;
  const cashOnly = { code: "TERMINAL", name: "Terminal fee", accrues: false, surcharge_bps: 0, active: true };

  it("stores a facility type as chosen", () => {
    expect(schema.parse({ ...cashOnly, facility_type: "terminal" })).toMatchObject({
      facility_type: "terminal",
    });
  });

  it("is required for an on-the-spot fee, which would otherwise reach every tablet", () => {
    const result = schema.safeParse({ ...cashOnly, facility_type: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["facility_type"]);
  });

  it("may be left blank for a fee that creates a receivable", () => {
    expect(
      schema.safeParse({ ...cashOnly, code: "MKT_DAILY", accrues: true, surcharge_bps: 300, facility_type: null })
        .success,
    ).toBe(true);
  });

  it("refuses a kind of facility that does not exist, and the old Anywhere value", () => {
    expect(schema.safeParse({ ...cashOnly, facility_type: "airport" }).success).toBe(false);
    expect(schema.safeParse({ ...cashOnly, facility_type: "any" }).success).toBe(false);
  });
});
