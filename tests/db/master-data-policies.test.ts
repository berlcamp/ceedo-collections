import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, serviceClient, type TestClient } from "../helpers/supabase.js";

/**
 * Every table that apply_master_data_policies() is applied to.
 *
 * Nothing in this schema grants privileges implicitly — Task 4 removed the default
 * privileges because an implicit table-level grant silently subsumed a narrower
 * column-level one. That makes apply_master_data_policies() the only thing making these
 * tables reachable by a real signed-in user, and every other database test uses
 * serviceClient(), which bypasses RLS and would not notice if it broke.
 *
 * The reader under test is a SUPERVISOR, not a collector. The installer's read policy
 * originally said `active_role() is not null`, which let a collector's own JWT pull the
 * whole tenant register (names, addresses, mobile numbers), every lease and its amount,
 * every stall and every device straight out of PostgREST. Spec §4 says the collector app
 * reaches this system through Edge Functions and never through PostgREST, so there was no
 * feature behind that reach — only a Data Privacy Act exposure. The policy is now
 * supervisor/accounting/admin, and this file asserts both directions: the back office can
 * read, and a collector cannot. A read test that only checked the permitted side would
 * have passed just as happily before the fix.
 */
const MASTER_DATA_TABLES = [
  "facilities",
  "sections",
  "stalls",
  "tenants",
  "leases",
  "fee_types",
  "rates",
  "form_types",
  "booklets",
  "booklet_assignments",
  "spoiled_forms",
  "devices",
  "device_assignments",
  "collector_assignments",
] as const;

describe("master data reachability", () => {
  let supervisor: TestClient;
  let collector: TestClient;

  beforeAll(async () => {
    supervisor = (await createAppUser({ email: "mdp-sup@example.com", role: "supervisor" })).client;
    collector = (await createAppUser({ email: "mdp-col@example.com", role: "collector" })).client;

    // Test files run concurrently, so "some other suite will have inserted a tenant by
    // now" is not a fact this file may rely on. The collector-sees-nothing assertion is
    // only worth anything against a table that certainly has a row in it.
    await serviceClient()
      .from("tenants")
      .insert({
        full_name: "Privacy Probe Tenant",
        address: "123 Real Street, Poblacion",
        contact_no: "09171234567",
      });
  });

  it.each(MASTER_DATA_TABLES)(
    "lets a signed-in supervisor select from %s",
    async (table) => {
      const { error } = await supervisor.from(table).select("id").limit(1);
      expect(error).toBeNull();
    },
  );

  it.each(MASTER_DATA_TABLES)(
    "returns nothing to a collector from %s",
    async (table) => {
      // RLS filters rather than errors: a policy that matches no row yields an empty set,
      // not a 42501. The SELECT grant is still there (the collector role holds it), so the
      // absence of rows is the assertion that matters, and it must hold on tables that
      // demonstrably have rows — every one of these is populated by the other suites.
      const { data, error } = await collector.from(table).select("id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
  );

  it("hides tenant contact details from a collector while showing them to a supervisor", async () => {
    // The concrete privacy claim, not just a row count: the reviewer pulled 25 tenants
    // with addresses and mobile numbers through a collector's own JWT.
    const { data: supervisorRows } = await supervisor
      .from("tenants")
      .select("id, full_name, address, contact_no")
      .limit(5);
    expect((supervisorRows ?? []).length).toBeGreaterThan(0);

    const { data: collectorRows } = await collector
      .from("tenants")
      .select("id, full_name, address, contact_no")
      .limit(5);
    expect(collectorRows).toEqual([]);
  });
});
