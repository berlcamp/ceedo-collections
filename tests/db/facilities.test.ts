import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

describe("facilities, sections and stalls", () => {
  let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];
  let collectorClient: Awaited<ReturnType<typeof createAppUser>>["client"];

  beforeAll(async () => {
    adminClient = (await createAppUser({ email: "fac-admin@example.com", role: "admin" })).client;
    collectorClient = (await createAppUser({ email: "fac-col@example.com", role: "collector" }))
      .client;
  });

  it("lets an admin create a facility", async () => {
    const { error } = await adminClient
      .from("facilities")
      .insert({ name: "Central Public Market", code: "CPM", type: "market" });
    expect(error).toBeNull();
  });

  it("refuses a collector creating a facility", async () => {
    const { error } = await collectorClient
      .from("facilities")
      .insert({ name: "Rogue Market", code: "RGM", type: "market" });
    expect(error).not.toBeNull();
  });

  it("lets a collector read facilities", async () => {
    const { data, error } = await collectorClient.from("facilities").select("code");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("rejects a section on a non-market facility", async () => {
    const service = serviceClient();
    const { data: terminal } = await service
      .from("facilities")
      .insert({ name: "IBJT", code: "IBJT", type: "terminal" })
      .select("id")
      .single();
    const { error } = await service
      .from("sections")
      .insert({ facility_id: terminal!.id, name: "Bay 1", default_accrual_period: "daily" });
    expect(error?.message ?? "").toMatch(/market/i);
  });

  it("bumps row_version on every update", async () => {
    const service = serviceClient();
    const { data: created } = await service
      .from("facilities")
      .insert({ name: "Satellite Market", code: "SAT", type: "market" })
      .select("id, row_version")
      .single();
    const { data: updated } = await service
      .from("facilities")
      .update({ name: "Satellite Market Annex" })
      .eq("id", created!.id)
      .select("row_version")
      .single();
    expect(Number(updated!.row_version)).toBeGreaterThan(Number(created!.row_version));
  });

  it("enforces unique stall numbers within a section", async () => {
    const service = serviceClient();
    const { data: facility } = await service
      .from("facilities")
      .insert({ name: "Dup Market", code: "DUP", type: "market" })
      .select("id")
      .single();
    const { data: section } = await service
      .from("sections")
      .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
      .select("id")
      .single();
    await service.from("stalls").insert({ section_id: section!.id, stall_no: "F-01" });
    const { error } = await service
      .from("stalls")
      .insert({ section_id: section!.id, stall_no: "F-01" });
    expect(error).not.toBeNull();
  });
});
