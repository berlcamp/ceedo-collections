import { describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/supabase.js";

describe("schema bootstrap", () => {
  it("exposes the ceedo_collections schema through PostgREST", async () => {
    // A query against a schema PostgREST does not expose fails with a schema error
    // rather than a missing-table error.
    const { error } = await serviceClient().from("app_users").select("id").limit(1);
    expect(error?.message ?? "").not.toMatch(/schema must be one of/i);
  });

  it("issues strictly increasing row versions", async () => {
    const client = serviceClient();
    const first = await client.rpc("next_row_version");
    const second = await client.rpc("next_row_version");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(Number(second.data)).toBeGreaterThan(Number(first.data));
  });
});
