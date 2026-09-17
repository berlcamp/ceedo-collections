import { beforeAll, describe, expect, it } from "vitest";
import { serviceClient, uniqueCode } from "../helpers/supabase.js";

const service = serviceClient();

describe("fee types and rates", () => {
  let feeTypeId: string;

  beforeAll(async () => {
    const { data } = await service
      .from("fee_types")
      .insert({
        code: uniqueCode("MKT_DAILY"),
        name: "Market daily rental",
        accrues: true,
        surcharge_bps: 300,
      })
      .select("id")
      .single();
    feeTypeId = data!.id as string;
  });

  it("stores the surcharge rate as integer basis points", async () => {
    const { data } = await service
      .from("fee_types")
      .select("surcharge_bps")
      .eq("id", feeTypeId)
      .single();
    expect(data!.surcharge_bps).toBe(300);
  });

  it("rejects a surcharge rate above 100 percent", async () => {
    const { error } = await service
      .from("fee_types")
      .insert({ code: uniqueCode("BAD"), name: "Bad", accrues: true, surcharge_bps: 10001 });
    expect(error).not.toBeNull();
  });

  it("accepts a rate row", async () => {
    const { error } = await service.from("rates").insert({
      fee_type_id: feeTypeId,
      effective_from: "2026-01-01",
      amount: 120.0,
      basis: "per_day",
    });
    expect(error).toBeNull();
  });

  it("refuses an overlapping rate for the same fee type and class", async () => {
    const { error } = await service.from("rates").insert({
      fee_type_id: feeTypeId,
      effective_from: "2026-06-01",
      amount: 130.0,
      basis: "per_day",
    });
    expect(error).not.toBeNull();
  });

  it("allows the same period for a different rate class", async () => {
    const { data: slaughter } = await service
      .from("fee_types")
      .insert({
        code: uniqueCode("SLAUGHTER"),
        name: "Slaughter fee",
        accrues: false,
        surcharge_bps: 0,
      })
      .select("id")
      .single();
    await service.from("rates").insert({
      fee_type_id: slaughter!.id,
      rate_class: "hog",
      effective_from: "2026-01-01",
      amount: 85.0,
      basis: "per_head",
    });
    const { error } = await service.from("rates").insert({
      fee_type_id: slaughter!.id,
      rate_class: "goat",
      effective_from: "2026-01-01",
      amount: 45.0,
      basis: "per_head",
    });
    expect(error).toBeNull();
  });
});
