import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient, uniqueCode } from "../helpers/supabase.js";

const service = serviceClient();

// Mirrors the direct-Postgres fallback in tests/helpers/supabase.ts. Needed only here,
// to attach the audit trigger to a throwaway table whose shape no fixture in the normal
// schema can produce (Test 5's forced-failure case) — everything else in this file goes
// through supabase-js like every other db test.
const PG_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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

  describe("secrets and sensitive entities (fix round 1)", () => {
    let pinUserId: string;
    let supervisorClient: Awaited<ReturnType<typeof createAppUser>>["client"];
    let accountingClient: Awaited<ReturnType<typeof createAppUser>>["client"];
    let inviteEntityId: string;
    let rateEntityId: string;
    let leaseEntityId: string;

    beforeAll(async () => {
      // A pin_hash only ever exists on app_users, and only service role can write it
      // (the authenticated grant on app_users deliberately omits the column — see
      // migration 0002). app_users.id references auth.users(id), so the row has to come
      // from a real signed-up user (createAppUser); setting pin_hash on it afterward, via
      // service role, reproduces the exact write the reviewer's probe depends on.
      const created = await createAppUser({ email: "audit-pin@example.com", role: "collector" });
      pinUserId = created.userId;
      await service
        .from("app_users")
        .update({ pin_hash: "sha256:not-a-real-hash" })
        .eq("id", pinUserId);

      supervisorClient = (await createAppUser({ email: "audit-sup@example.com", role: "supervisor" }))
        .client;
      accountingClient = (
        await createAppUser({ email: "audit-acc@example.com", role: "accounting" })
      ).client;

      const { data: invite } = await adminClient
        .from("staff_invites")
        .insert({
          email: `invitee-${uniqueCode("inv")}@example.com`,
          employee_no: uniqueCode("INV"),
          full_name: "Invited Person",
          role: "collector",
        })
        .select("id")
        .single();
      inviteEntityId = invite!.id as string;

      const { data: feeType } = await service
        .from("fee_types")
        .insert({ code: uniqueCode("SENS_FEE"), name: "Sensitivity fee", accrues: false, surcharge_bps: 0 })
        .select("id")
        .single();
      const { data: rate } = await adminClient
        .from("rates")
        .insert({
          fee_type_id: feeType!.id,
          effective_from: "2026-02-01",
          amount: 10.0,
          basis: "per_entry",
        })
        .select("id")
        .single();
      rateEntityId = rate!.id as string;

      const { data: facility } = await service
        .from("facilities")
        .insert({ name: "Sensitivity Market", code: uniqueCode("SENS"), type: "market" })
        .select("id")
        .single();
      const { data: section } = await service
        .from("sections")
        .insert({ facility_id: facility!.id, name: "Sens", default_accrual_period: "daily" })
        .select("id")
        .single();
      const { data: stall } = await service
        .from("stalls")
        .insert({ section_id: section!.id, stall_no: "S-01" })
        .select("id")
        .single();
      const { data: tenant } = await service
        .from("tenants")
        .insert({ full_name: "Sensitivity Tenant" })
        .select("id")
        .single();
      const { data: lease } = await adminClient
        .from("leases")
        .insert({
          stall_id: stall!.id,
          tenant_id: tenant!.id,
          start_date: "2026-01-01",
          rate_amount: 100.0,
          accrual_period: "daily",
          status: "active",
        })
        .select("id")
        .single();
      leaseEntityId = lease!.id as string;
    });

    it("1. a supervisor cannot obtain a pin_hash from the audit log", async () => {
      const { data } = await supervisorClient
        .from("audit_log")
        .select("before, after")
        .eq("entity", "app_users")
        .eq("entity_id", pinUserId);

      // Policy blocks app_users entries from supervisors entirely (belt), and even if it
      // did not, redaction means the key would not be there (suspenders). Assert both:
      // no rows are visible, and — the stronger, content-level claim the reviewer's probe
      // is really about — none of whatever came back carries the key.
      expect(data).toEqual([]);
      for (const row of data ?? []) {
        expect(row.before).not.toHaveProperty("pin_hash");
        expect(row.after).not.toHaveProperty("pin_hash");
      }
    });

    it("2. an admin cannot either, because it is never stored — proved via service role", async () => {
      const { data: entries } = await service
        .from("audit_log")
        .select("before, after")
        .eq("entity", "app_users")
        .eq("entity_id", pinUserId)
        .eq("action", "update");

      expect(entries!.length).toBeGreaterThan(0);
      for (const row of entries!) {
        expect(Object.keys((row.after as Record<string, unknown>) ?? {})).not.toContain(
          "pin_hash",
        );
        expect(Object.keys((row.before as Record<string, unknown>) ?? {})).not.toContain(
          "pin_hash",
        );
      }
    });

    it("3. a supervisor gets no staff_invites entries, but does get rate and lease entries", async () => {
      const { data: inviteEntries } = await supervisorClient
        .from("audit_log")
        .select("id")
        .eq("entity", "staff_invites")
        .eq("entity_id", inviteEntityId);
      expect(inviteEntries).toEqual([]);

      const { data: rateEntries } = await supervisorClient
        .from("audit_log")
        .select("entity")
        .eq("entity_id", rateEntityId);
      expect(rateEntries).toEqual([{ entity: "rates" }]);

      const { data: leaseEntries } = await supervisorClient
        .from("audit_log")
        .select("entity")
        .eq("entity_id", leaseEntityId);
      expect(leaseEntries).toEqual([{ entity: "leases" }]);

      // accounting is granted the same visibility as supervisor for this policy.
      const { data: accInviteEntries } = await accountingClient
        .from("audit_log")
        .select("id")
        .eq("entity", "staff_invites")
        .eq("entity_id", inviteEntityId);
      expect(accInviteEntries).toEqual([]);
    });

    it("4. an admin sees app_users and staff_invites entries", async () => {
      const { data: userEntries } = await adminClient
        .from("audit_log")
        .select("entity")
        .eq("entity", "app_users")
        .eq("entity_id", pinUserId);
      expect(userEntries!.length).toBeGreaterThan(0);

      const { data: inviteEntries } = await adminClient
        .from("audit_log")
        .select("entity")
        .eq("entity", "staff_invites")
        .eq("entity_id", inviteEntityId);
      expect(inviteEntries).toEqual([{ entity: "staff_invites" }]);
    });

    it("6. pg_role distinguishes a service-role write from an authenticated one", async () => {
      const { data: facility } = await adminClient
        .from("facilities")
        .insert({ name: "Pg Role Auth", code: uniqueCode("PGA"), type: "market" })
        .select("id")
        .single();
      const { data: authEntry } = await service
        .from("audit_log")
        .select("pg_role")
        .eq("entity_id", facility!.id)
        .single();
      expect(authEntry!.pg_role).toBe("authenticated");

      const { data: svcFacility } = await service
        .from("facilities")
        .insert({ name: "Pg Role Service", code: uniqueCode("PGS"), type: "market" })
        .select("id")
        .single();
      const { data: svcEntry } = await service
        .from("audit_log")
        .select("pg_role")
        .eq("entity_id", svcFacility!.id)
        .single();
      expect(svcEntry!.pg_role).toBe("service_role");
    });
  });

  describe("a failed audit write never aborts the audited statement (fix round 1)", () => {
    const pg = new PgClient({ connectionString: PG_URL });

    beforeAll(async () => {
      await pg.connect();
      await pg.query(`
        set search_path = ceedo_collections, public;
        create table ceedo_collections.audit_log_test_bad_id (
          id serial primary key,
          name text not null
        );
        select ceedo_collections.attach_audit('audit_log_test_bad_id');
      `);
    });

    afterAll(async () => {
      await pg.query("drop table if exists ceedo_collections.audit_log_test_bad_id");
      await pg.end();
    });

    it("5. a forced audit failure produces an audit_failed marker and does not abort the write", async () => {
      const insertResult = await pg.query(
        `insert into ceedo_collections.audit_log_test_bad_id (name) values ($1) returning id`,
        ["forced failure test"],
      );
      // The audited statement itself must succeed — this is the whole point.
      expect(insertResult.rows).toHaveLength(1);

      const { rows: markerRows } = await pg.query(
        `select action, entity, note from ceedo_collections.audit_log
           where entity = 'audit_log_test_bad_id' and action = 'audit_failed'
           order by id desc limit 1`,
      );
      expect(markerRows).toHaveLength(1);
      expect(markerRows[0].action).toBe("audit_failed");
      expect(markerRows[0].note).toContain("uuid");
    });
  });
});
