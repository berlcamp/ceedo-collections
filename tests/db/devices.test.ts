import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

async function marketWithSections(code: string) {
  const { data: facility } = await service
    .from("facilities")
    .insert({ name: `Market ${code}`, code, type: "market" })
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
      .insert({ label: "Tablet 01" })
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

  it("refuses a collector assigned to a different section of the same market", async () => {
    const { userId } = await createAppUser({ email: "dev-meat@example.com", role: "collector" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: meatId });
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
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
      .insert({ label: "Tablet 99", active: false })
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
    const { userId } = await createAppUser({ email: "dev-sup@example.com", role: "supervisor" });
    await service
      .from("collector_assignments")
      .insert({ collector_id: userId, facility_id: facilityId, section_id: fishId })
      .select();
    const { data } = await service.rpc("can_collector_use_device", {
      collector: userId,
      device: deviceId,
    });
    expect(data).toBe(false);
  });
});
