import { beforeAll, describe, expect, it } from "vitest";
import { createAppUser, type TestClient } from "../helpers/supabase.js";

/**
 * Every table that apply_master_data_policies() is applied to.
 *
 * Nothing in this schema grants privileges implicitly — Task 4 removed the default
 * privileges because an implicit table-level grant silently subsumed a narrower
 * column-level one. That makes apply_master_data_policies() the only thing making these
 * tables reachable by a real signed-in user, and every other database test uses
 * serviceClient(), which bypasses RLS and would not notice if it broke.
 *
 * Later tasks MUST add their tables here: booklets, form_types,
 * booklet_assignments and spoiled_forms (Task 8), devices,
 * device_assignments and collector_assignments (Task 9).
 */
const MASTER_DATA_TABLES = [
  "facilities",
  "sections",
  "stalls",
  "tenants",
  "leases",
  "fee_types",
  "rates",
] as const;

describe("master data reachability", () => {
  let collector: TestClient;

  beforeAll(async () => {
    collector = (await createAppUser({ email: "mdp-col@example.com", role: "collector" })).client;
  });

  it.each(MASTER_DATA_TABLES)(
    "lets a signed-in collector select from %s",
    async (table) => {
      const { error } = await collector.from(table).select("id").limit(1);
      expect(error).toBeNull();
    },
  );
});
