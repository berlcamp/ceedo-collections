import { describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

// Every table the admin engine writes to must exist. A renamed table would
// otherwise surface as a runtime 404 the first time someone opens that screen.
const TABLES = [
  "facilities",
  "sections",
  "stalls",
  "tenants",
  "leases",
  "fee_types",
  "rates",
  "form_types",
  "booklets",
  "devices",
  "app_users",
  "staff_invites",
];

describe("admin registry parity", () => {
  it.each(TABLES)("table %s exists and is readable", async (table) => {
    const { error } = await serviceClient().from(table).select("id").limit(1);
    expect(error).toBeNull();
  });
});
