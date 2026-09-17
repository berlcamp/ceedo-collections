import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient } from "../helpers/supabase.js";

const service = serviceClient();

describe("audit log", () => {
  let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];
  let adminId: string;

  beforeAll(async () => {
    const created = await createAppUser({ email: "audit-admin@example.com", role: "admin" });
    adminClient = created.client;
    adminId = created.userId;
  });

  it("records an insert with the acting user", async () => {
    const { data: facility } = await adminClient
      .from("facilities")
      .insert({ name: "Audited Market", code: "AUD", type: "market" })
      .select("id")
      .single();

    const { data: entries } = await service
      .from("audit_log")
      .select("action, entity, entity_id, actor_id, before, after")
      .eq("entity_id", facility!.id);

    expect(entries).toHaveLength(1);
    expect(entries![0]).toMatchObject({
      action: "insert",
      entity: "facilities",
      actor_id: adminId,
      before: null,
    });
    expect((entries![0]!.after as Record<string, unknown>).code).toBe("AUD");
  });

  it("records an update with both before and after", async () => {
    const { data: facility } = await adminClient
      .from("facilities")
      .insert({ name: "Before Name", code: "UPD", type: "market" })
      .select("id")
      .single();

    await adminClient.from("facilities").update({ name: "After Name" }).eq("id", facility!.id);

    const { data: entries } = await service
      .from("audit_log")
      .select("action, before, after")
      .eq("entity_id", facility!.id)
      .eq("action", "update");

    expect(entries).toHaveLength(1);
    expect((entries![0]!.before as Record<string, unknown>).name).toBe("Before Name");
    expect((entries![0]!.after as Record<string, unknown>).name).toBe("After Name");
  });

  it("logs rate changes", async () => {
    const { data: feeType } = await service
      .from("fee_types")
      .insert({ code: "AUDIT_FEE", name: "Audited fee", accrues: false, surcharge_bps: 0 })
      .select("id")
      .single();

    const { data: rate } = await adminClient
      .from("rates")
      .insert({
        fee_type_id: feeType!.id,
        effective_from: "2026-01-01",
        amount: 50.0,
        basis: "per_entry",
      })
      .select("id")
      .single();

    const { data: entries } = await service
      .from("audit_log")
      .select("entity")
      .eq("entity_id", rate!.id);

    expect(entries).toEqual([{ entity: "rates" }]);
  });

  it("refuses an update to an audit entry, even from an admin", async () => {
    const { data: entry } = await service.from("audit_log").select("id").limit(1).single();
    const { error } = await adminClient
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("id", entry!.id);
    expect(error).not.toBeNull();
  });

  it("refuses a delete of an audit entry, even from an admin", async () => {
    const { data: entry } = await service.from("audit_log").select("id").limit(1).single();
    const { error } = await adminClient.from("audit_log").delete().eq("id", entry!.id);
    expect(error).not.toBeNull();
  });

  it("hides the audit log from collectors", async () => {
    const { client } = await createAppUser({ email: "audit-col@example.com", role: "collector" });
    const { data } = await client.from("audit_log").select("id");
    expect(data).toEqual([]);
  });
});
