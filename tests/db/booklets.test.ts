import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

describe("booklets", () => {
  let formTypeId: string;
  let collectorId: string;

  beforeAll(async () => {
    const { data } = await service
      .from("form_types")
      .insert({ code: "OR51", name: "Official Receipt (Accountable Form 51)" })
      .select("id")
      .single();
    formTypeId = data!.id as string;
    collectorId = (await createAppUser({ email: "bk-col@example.com", role: "collector" })).userId;
  });

  it("accepts a booklet with an ordered serial range", async () => {
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 1001,
      end_no: 1050,
      received_date: "2026-09-01",
    });
    expect(error).toBeNull();
  });

  it("rejects a booklet whose end precedes its start", async () => {
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 2050,
      end_no: 2001,
      received_date: "2026-09-01",
    });
    expect(error).not.toBeNull();
  });

  it("refuses two booklets with overlapping serial ranges", async () => {
    await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 3001,
      end_no: 3050,
      received_date: "2026-09-01",
    });
    const { error } = await service.from("booklets").insert({
      form_type_id: formTypeId,
      serial_prefix: "OR",
      start_no: 3040,
      end_no: 3090,
      received_date: "2026-09-01",
    });
    expect(error).not.toBeNull();
  });

  it("refuses assigning one booklet to two collectors at once", async () => {
    const { data: booklet } = await service
      .from("booklets")
      .insert({
        form_type_id: formTypeId,
        serial_prefix: "OR",
        start_no: 4001,
        end_no: 4050,
        received_date: "2026-09-01",
      })
      .select("id")
      .single();
    const other = (await createAppUser({ email: "bk-col2@example.com", role: "collector" })).userId;

    await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: collectorId, assigned_at: "2026-09-01" });
    const { error } = await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: other, assigned_at: "2026-09-02" });
    expect(error).not.toBeNull();
  });

  it("refuses assigning a booklet to a non-collector", async () => {
    const accountant = (await createAppUser({ email: "bk-acct@example.com", role: "accounting" }))
      .userId;
    const { data: booklet } = await service
      .from("booklets")
      .insert({
        form_type_id: formTypeId,
        serial_prefix: "OR",
        start_no: 5001,
        end_no: 5050,
        received_date: "2026-09-01",
      })
      .select("id")
      .single();
    const { error } = await service
      .from("booklet_assignments")
      .insert({ booklet_id: booklet!.id, collector_id: accountant, assigned_at: "2026-09-01" });
    expect(error?.message ?? "").toMatch(/collector/i);
  });
});
