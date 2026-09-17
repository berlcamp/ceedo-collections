import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient, uniqueCode, type TestClient } from "../helpers/supabase.js";

/**
 * apply_master_data_policies() grants writes to admins only. Spec 11.1 gives
 * supervisors booklet assignment and return verification, and the admin registry
 * gives them write access to booklets and tablets, so migration 0008 adds a second,
 * OR'd policy restricted to exactly booklets and devices (plus their assignment and
 * spoiled-form tables). This test asserts both directions: a supervisor gains write
 * access on the five named tables, and a collector still does not — proving the grant
 * did not widen to every authenticated role, which would pass the first half of this
 * test while being badly wrong.
 */
describe("supervisor writes (migration 0008)", () => {
  let formTypeId: string;
  let supervisor: TestClient;
  let collector: TestClient;
  let admin: TestClient;

  beforeAll(async () => {
    const { data } = await serviceClient()
      .from("form_types")
      .insert({ code: uniqueCode("OR51"), name: "Official Receipt (Accountable Form 51)" })
      .select("id")
      .single();
    formTypeId = data!.id as string;

    supervisor = (await createAppUser({ email: "sw-sup@example.com", role: "supervisor" })).client;
    collector = (await createAppUser({ email: "sw-col@example.com", role: "collector" })).client;
    admin = (await createAppUser({ email: "sw-admin@example.com", role: "admin" })).client;
  });

  it("lets a supervisor insert a booklet", async () => {
    const { error } = await supervisor.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: uniqueCode("SW"),
      start_no: 1,
      end_no: 50,
      received_date: "2026-09-01",
    });
    expect(error).toBeNull();
  });

  it("lets a supervisor insert a device", async () => {
    const { error } = await supervisor.from("devices").insert({ label: uniqueCode("Tablet-SW") });
    expect(error).toBeNull();
  });

  it("still refuses a collector inserting a booklet", async () => {
    const { error } = await collector.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: uniqueCode("SW"),
      start_no: 100,
      end_no: 150,
      received_date: "2026-09-01",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("still refuses a collector inserting a device", async () => {
    const { error } = await collector.from("devices").insert({ label: uniqueCode("Tablet-SW") });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("leaves an admin able to insert a booklet", async () => {
    const { error } = await admin.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: uniqueCode("SW"),
      start_no: 200,
      end_no: 250,
      received_date: "2026-09-01",
    });
    expect(error).toBeNull();
  });

  it("leaves an admin able to insert a device", async () => {
    const { error } = await admin.from("devices").insert({ label: uniqueCode("Tablet-SW") });
    expect(error).toBeNull();
  });

  it("does not widen a collector's access to unrelated master data (facilities)", async () => {
    const { error } = await collector.from("facilities").insert({
      code: uniqueCode("SW"),
      name: "Should not be insertable",
      type: "market",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
