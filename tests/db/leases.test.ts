import { beforeAll, describe, expect, it } from "vitest";
import { serviceClient, uniqueCode } from "../helpers/supabase.js";

const service = serviceClient();

async function makeStall(code: string): Promise<string> {
  const { data: facility } = await service
    .from("facilities")
    .insert({ name: `Market ${code}`, code: uniqueCode(code), type: "market" })
    .select("id")
    .single();
  const { data: section } = await service
    .from("sections")
    .insert({ facility_id: facility!.id, name: "Fish", default_accrual_period: "daily" })
    .select("id")
    .single();
  const { data: stall } = await service
    .from("stalls")
    .insert({ section_id: section!.id, stall_no: "F-01" })
    .select("id")
    .single();
  return stall!.id as string;
}

async function makeTenant(name: string): Promise<string> {
  const { data } = await service.from("tenants").insert({ full_name: name }).select("id").single();
  return data!.id as string;
}

describe("leases", () => {
  let stallId: string;

  beforeAll(async () => {
    stallId = await makeStall("LEA");
  });

  it("accepts an active lease on a vacant stall", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Aling Nena"),
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      rate_amount: 120.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("refuses a second active lease overlapping the same stall", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Mang Tonyo"),
      start_date: "2026-06-01",
      end_date: "2026-12-31",
      rate_amount: 130.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).not.toBeNull();
  });

  it("allows a later lease that starts after the previous one ends", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: stallId,
      tenant_id: await makeTenant("Aling Rosa"),
      start_date: "2026-07-01",
      end_date: "2026-12-31",
      rate_amount: 130.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("ignores ended leases when checking overlap", async () => {
    const endedStall = await makeStall("END");
    await service.from("leases").insert({
      stall_id: endedStall,
      tenant_id: await makeTenant("Former Tenant"),
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      rate_amount: 100.0,
      accrual_period: "daily",
      status: "ended",
    });
    const { error } = await service.from("leases").insert({
      stall_id: endedStall,
      tenant_id: await makeTenant("New Tenant"),
      start_date: "2026-03-01",
      end_date: "2026-12-31",
      rate_amount: 110.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).toBeNull();
  });

  it("rejects an end date before the start date", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: await makeStall("BAD"),
      tenant_id: await makeTenant("Backwards"),
      start_date: "2026-12-31",
      end_date: "2026-01-01",
      rate_amount: 100.0,
      accrual_period: "daily",
      status: "active",
    });
    expect(error).not.toBeNull();
  });

  it("requires a due_day for a monthly lease", async () => {
    const { error } = await service.from("leases").insert({
      stall_id: await makeStall("MON"),
      tenant_id: await makeTenant("Monthly Tenant"),
      start_date: "2026-01-01",
      end_date: null,
      rate_amount: 3000.0,
      accrual_period: "monthly",
      due_day: null,
      status: "active",
    });
    expect(error).not.toBeNull();
  });
});
