import { describe, expect, it } from "vitest";
import { createAppUser, serviceClient, uniqueCode } from "../helpers/supabase.js";

// Every table the admin engine writes to must exist. A renamed table would
// otherwise surface as a runtime 404 the first time someone opens that screen.
const TABLES = [
  "facilities",
  "sections",
  "stalls",
  "tenants",
  "leases",
  "fee_types",
  "rates",
  "form_types",
  "booklets",
  "devices",
  "app_users",
  "staff_invites",
  "device_assignments",
  "collector_assignments",
];

describe("admin registry parity", () => {
  it.each(TABLES)("table %s exists and is readable", async (table) => {
    const { error } = await serviceClient().from(table).select("id").limit(1);
    expect(error).toBeNull();
  });
});

// Ruling R5 (Task 1): the brief's Step 5 asked for a browser pass through /device-assignments
// and /collector-assignments, which the web admin's Google-Sign-In gate makes impossible from
// here. These two blocks are its replacement: the `select:` string is the one piece of a
// registry entry that a passing typecheck cannot reach -- a wrong embedded-resource name (e.g.
// `sections(name)` when the relationship is actually named something else) only fails at
// runtime, against the live PostgREST schema. The strings below are copied verbatim from the
// `device-assignments` and `collector-assignments` entries in apps/web/lib/admin/registry.ts.
describe("admin registry select expressions resolve against the live schema", () => {
  it("device-assignments", async () => {
    const { error } = await serviceClient()
      .from("device_assignments")
      .select(
        "id, active, devices(label), facilities(name), sections!device_assignments_section_id_fkey(name)",
      )
      .limit(1);
    expect(error).toBeNull();
  });

  it("collector-assignments", async () => {
    const { error } = await serviceClient()
      .from("collector_assignments")
      .select(
        "id, collector_id, facility_id, active, app_users(full_name), facilities(name), sections!collector_assignments_section_id_fkey(name)",
      )
      .limit(1);
    expect(error).toBeNull();
  });
});

// The two negative paths Step 5 asked to be proven in the browser: a form that let either of
// these through would be silently swallowing a constraint violation, which is the exact
// failure mode this task exists to remove.
describe("admin registry database refusals", () => {
  it("refuses a second active device_assignments row for the same device (device_assignments_one_active, 23505)", async () => {
    const service = serviceClient();
    const { data: facility, error: facilityError } = await service
      .from("facilities")
      .insert({ code: uniqueCode("RPD"), name: "Registry Parity Refusal Market", type: "market" })
      .select("id")
      .single();
    expect(facilityError).toBeNull();
    const { data: device, error: deviceError } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-Refusal") })
      .select("id")
      .single();
    expect(deviceError).toBeNull();

    const first = await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facility!.id, active: true });
    expect(first.error).toBeNull();

    const second = await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facility!.id, active: true });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("refuses a collector_assignments row whose collector is a supervisor (collector_assignments_collector_only, 23514)", async () => {
    const service = serviceClient();
    const { data: facility, error: facilityError } = await service
      .from("facilities")
      .insert({ code: uniqueCode("RPC"), name: "Registry Parity Refusal Market", type: "market" })
      .select("id")
      .single();
    expect(facilityError).toBeNull();
    const { userId } = await createAppUser({
      email: "registry-parity-supervisor@example.com",
      role: "supervisor",
    });

    const { error } = await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facility!.id, active: true });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });
});
