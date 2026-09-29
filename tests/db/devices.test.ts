import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient, uniqueCode } from "../helpers/supabase.js";

const service = serviceClient();

async function marketWithSections(code: string) {
  const { data: facility } = await service
    .from("facilities")
    .insert({ name: `Market ${code}`, code: uniqueCode(code), type: "market" })
    .select("id")
    .single();
  const { data: fish } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
    .select("id")
    .single();
  const { data: meat } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Meat", default_accrual_period: "daily" })
    .select("id")
    .single();
  return { facilityId: facility!.id as string, fishId: fish!.id as string, meatId: meat!.id as string };
}

describe("devices and assignments", () => {
  let facilityId: string;
  let fishId: string;
  let meatId: string;
  let deviceId: string;

  beforeAll(async () => {
    ({ facilityId, fishId, meatId } = await marketWithSections("DEV"));
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-01") })
      .select("id")
      .single();
    deviceId = device!.id as string;
    await service
      .from("device_assignments")
      .insert({ device_id: deviceId, facility_id: facilityId, section_id: fishId });
  });

  it("has no collector column — tablets are shared", async () => {
    const { error } = await service.from("devices").select("collector_id").limit(1);
    expect(error).not.toBeNull();
  });

  it("permits a collector assigned to the same section", async () => {
    const { userId } = await createAppUser({ email: "dev-fish@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  // Migration 20260929000055: the tablet's own assignment no longer narrows sign-in. Any
  // active collector with an active collection area may use any active tablet.
  it("permits a collector assigned to a different section of the same market", async () => {
    const { userId } = await createAppUser({ email: "dev-meat@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: meatId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  it("permits a facility-wide collector on any section device of that facility", async () => {
    const { userId } = await createAppUser({ email: "dev-wide@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: null });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  it("refuses a collector with no assignment at all", async () => {
    const { userId } = await createAppUser({ email: "dev-none@example.com", role: "collector" });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  it("refuses a deactivated device to an otherwise eligible collector", async () => {
    const { userId } = await createAppUser({ email: "dev-dead@example.com", role: "collector" });
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-99"), active: false })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facilityId, section_id: fishId });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(false);
  });

  it("refuses a device to a non-collector role", async () => {
    // This used to insert the collector_assignments row for a supervisor and then check
    // that can_collector_use_device() said no. The row can no longer be created at all —
    // collector_assignments_collector_only refuses it — which is the stronger guarantee,
    // so both halves are asserted: the row is refused, and the function still says no.
    const { userId } = await createAppUser({ email: "dev-sup@example.com", role: "supervisor" });
    const { error } = await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/only be assigned to a collector/i);

    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  it("permits a collector assigned to a section when the device is assigned facility-wide", async () => {
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-FW1") })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facilityId, section_id: null });
    const { userId } = await createAppUser({ email: "dev-fw-col@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(true);
  });

  it("permits a facility-wide collector on a facility-wide device", async () => {
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-FW2") })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facilityId, section_id: null });
    const { userId } = await createAppUser({ email: "dev-fw-fw@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: null });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(true);
  });

  it("permits a collector and device assigned to different facilities", async () => {
    const { facilityId: otherFacilityId } = await marketWithSections("DEV-OTHER");
    const { userId } = await createAppUser({ email: "dev-other-fac@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: otherFacilityId, section_id: null });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(true);
  });

  it("permits a collector of any facility on a device assigned to all facilities", async () => {
    const { facilityId: otherFacilityId, meatId: otherMeatId } = await marketWithSections("DEV-ALL");
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-ALL") })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: null, section_id: null });
    const { userId } = await createAppUser({ email: "dev-all@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: otherFacilityId, section_id: otherMeatId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(true);
  });

  it("refuses a section on an all-facilities assignment", async () => {
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-ALL-SEC") })
      .select("id")
      .single();
    const { error } = await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: null, section_id: fishId })
      .select();
    expect(error?.message ?? "").toMatch(/device_assignments_section_needs_facility/);
  });

  it("permits a device with no active assignment of its own", async () => {
    const { data: device } = await service
      .from("devices")
      .insert({ label: uniqueCode("Tablet-INACT-DA") })
      .select("id")
      .single();
    await service
      .from("device_assignments")
      .insert({ device_id: device!.id, facility_id: facilityId, section_id: fishId, active: false });
    const { userId } = await createAppUser({ email: "dev-inact-da@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: device!.id,
    });
    expect(data).toBe(true);
  });

  it("refuses when the collector_assignments row is inactive", async () => {
    const { userId } = await createAppUser({ email: "dev-inact-ca@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId, active: false });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  it("refuses a suspended collector", async () => {
    const { userId } = await createAppUser({ email: "dev-suspended@example.com", role: "collector" });
    await service.from("app_users").update({ status: "suspended" }).eq("id", userId);
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });

  /**
   * The pair of guards booklet_assignments has carried since migration 0006, now mirrored
   * onto collector_assignments (migration 0007). Each is asserted in both directions: a
   * guard that refuses everything would pass the refusing half of a suite while being
   * useless, so every "must block" here is paired with a "must permit".
   *
   * can_collector_use_device() re-checks the role at read time, so neither hole was
   * exploitable through it. Phase 3's sync scoping reads these rows directly and does not
   * re-check, which is what makes the table itself the right place for the invariant.
   */
  describe("collector_assignments role guards", () => {
    it("refuses an assignment naming a supervisor", async () => {
      const { userId } = await createAppUser({
        email: "ca-guard-sup@example.com",
        role: "supervisor",
      });
      const { error } = await service
        .from("collector_assignments")
        .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/only be assigned to a collector/i);
    });

    it("refuses an assignment naming an accounting user or an admin", async () => {
      for (const role of ["accounting", "admin"] as const) {
        const { userId } = await createAppUser({
          email: `ca-guard-${role}@example.com`,
          role,
        });
        const { error } = await service
          .from("collector_assignments")
          .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
        expect(error, `${role} should not be assignable`).not.toBeNull();
      }
    });

    it("permits an assignment naming an actual collector", async () => {
      const { userId } = await createAppUser({
        email: "ca-guard-col@example.com",
        role: "collector",
      });
      const { error } = await service
        .from("collector_assignments")
        .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });
      expect(error).toBeNull();
    });

    it("refuses repointing an existing assignment at a non-collector", async () => {
      // The trigger is BEFORE INSERT OR UPDATE: a valid row must not become invalid by
      // having collector_id swapped afterwards.
      const { userId: collectorId } = await createAppUser({
        email: "ca-repoint-col@example.com",
        role: "collector",
      });
      const { userId: supervisorId } = await createAppUser({
        email: "ca-repoint-sup@example.com",
        role: "supervisor",
      });
      const { data: row } = await service
        .from("collector_assignments")
        .insert({ collector_id: collectorId, facility_id: facilityId, section_id: meatId })
        .select("id")
        .single();

      const { error } = await service
        .from("collector_assignments")
        .update({ collector_id: supervisorId })
        .eq("id", row!.id);
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/only be assigned to a collector/i);
    });

    it("refuses promoting a collector who still holds an active assignment", async () => {
      const { userId } = await createAppUser({
        email: "ca-promote-held@example.com",
        role: "collector",
      });
      await service
        .from("collector_assignments")
        .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });

      const { error } = await service
        .from("app_users")
        .update({ role: "supervisor" })
        .eq("id", userId);
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/active collection assignments/i);

      const { data } = await service
        .from("app_users")
        .select("role")
        .eq("id", userId)
        .single();
      expect(data!.role).toBe("collector");
    });

    it("permits promoting a collector once the assignment is deactivated", async () => {
      const { userId } = await createAppUser({
        email: "ca-promote-freed@example.com",
        role: "collector",
      });
      const { data: row } = await service
        .from("collector_assignments")
        .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId })
        .select("id")
        .single();
      await service
        .from("collector_assignments")
        .update({ active: false })
        .eq("id", row!.id);

      const { error } = await service
        .from("app_users")
        .update({ role: "supervisor" })
        .eq("id", userId);
      expect(error).toBeNull();

      const { data } = await service
        .from("app_users")
        .select("role")
        .eq("id", userId)
        .single();
      expect(data!.role).toBe("supervisor");
    });

    it("permits promoting a collector who never had an assignment", async () => {
      const { userId } = await createAppUser({
        email: "ca-promote-none@example.com",
        role: "collector",
      });
      const { error } = await service
        .from("app_users")
        .update({ role: "accounting" })
        .eq("id", userId);
      expect(error).toBeNull();
    });

    it("leaves unrelated updates to an assigned collector alone", async () => {
      // The guard keys off a role CHANGE away from collector. Suspending an assigned
      // collector, or any other non-role edit, must still go through — otherwise the
      // guard has quietly become "an assigned collector is uneditable".
      const { userId } = await createAppUser({
        email: "ca-suspend-assigned@example.com",
        role: "collector",
      });
      await service
        .from("collector_assignments")
        .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId });

      const { error } = await service
        .from("app_users")
        .update({ status: "suspended" })
        .eq("id", userId);
      expect(error).toBeNull();
    });
  });
});
