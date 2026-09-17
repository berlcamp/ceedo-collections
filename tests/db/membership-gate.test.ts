import { beforeAll, describe, expect, it } from "vitest";
import {
  createAppUser,
  createOutsiderClient,
  resetFixtures,
  serviceClient,
} from "../helpers/supabase.js";

describe("membership gate", () => {
  beforeAll(async () => {
    await resetFixtures();
  });

  it("denies a signed-in user who has no app_users row", async () => {
    // This is the whole point: auth.users is shared with unrelated projects.
    const outsider = await createOutsiderClient();
    const { data, error } = await outsider.from("app_users").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns null from active_role() for an outsider", async () => {
    const outsider = await createOutsiderClient();
    const { data } = await outsider.rpc("active_role");
    expect(data).toBeNull();
  });

  it("lets a registered user read their own row", async () => {
    const { client, userId } = await createAppUser({
      email: "collector1@example.com",
      role: "collector",
    });
    const { data } = await client.from("app_users").select("id, role");
    expect(data).toEqual([{ id: userId, role: "collector" }]);
  });

  it("returns the caller's role from active_role()", async () => {
    const { client } = await createAppUser({
      email: "supervisor1@example.com",
      role: "supervisor",
    });
    const { data } = await client.rpc("active_role");
    expect(data).toBe("supervisor");
  });

  it("hides other users' rows from a collector", async () => {
    await createAppUser({ email: "collector2@example.com", role: "collector" });
    const { client, userId } = await createAppUser({
      email: "collector3@example.com",
      role: "collector",
    });
    const { data } = await client.from("app_users").select("id");
    // Not just a count: a policy that returned exactly one wrong row would also pass a
    // length-only assertion. Assert it is specifically the caller's own row.
    expect(data).toEqual([{ id: userId }]);
  });

  it("lets an admin read every user", async () => {
    const { client } = await createAppUser({ email: "admin1@example.com", role: "admin" });
    const { data } = await client.from("app_users").select("id");
    const { count } = await serviceClient()
      .from("app_users")
      .select("id", { count: "exact", head: true });
    // Compared against the service-client count taken at the same moment, not a fixed
    // number: this test must stand alone (e.g. `vitest -t` in isolation) as well as in
    // the full suite, where earlier tests have already left other rows behind.
    expect(data).toHaveLength(count ?? -1);
  });

  it("lets a supervisor read every user", async () => {
    const { client } = await createAppUser({ email: "sup-read@example.com", role: "supervisor" });
    const { data } = await client.from("app_users").select("id");
    const { count } = await serviceClient()
      .from("app_users")
      .select("id", { count: "exact", head: true });
    // This is the test that guards app_users_read_all specifically: app_users_admin_write
    // is FOR ALL, so its USING clause backstops SELECT for admins even if read_all is
    // deleted. Supervisor and accounting are the only two roles read_all uniquely serves.
    expect(data).toHaveLength(count ?? -1);
  });

  it("treats a suspended user as having no role", async () => {
    const { client, userId } = await createAppUser({
      email: "suspended1@example.com",
      role: "accounting",
    });
    await serviceClient().from("app_users").update({ status: "suspended" }).eq("id", userId);
    const { data } = await client.rpc("active_role");
    expect(data).toBeNull();
  });

  it("hides a suspended user's own row from a table read", async () => {
    const { client, userId } = await createAppUser({
      email: "suspended2@example.com",
      role: "accounting",
    });
    await serviceClient().from("app_users").update({ status: "suspended" }).eq("id", userId);
    const { data, error } = await client.from("app_users").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides pin_hash from a supervisor", async () => {
    const { client } = await createAppUser({ email: "pin-sup@example.com", role: "supervisor" });
    const { data, error } = await client.from("app_users").select("id, pin_hash");
    // Verified against the live REST endpoint: requesting a column the role has no SELECT
    // privilege on makes Postgres reject the whole query (42501, "permission denied for
    // table app_users") rather than PostgREST silently dropping the column — so an error
    // here, with no data, is the pass condition.
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("hides pin_hash from an accounting user", async () => {
    const { client } = await createAppUser({ email: "pin-acct@example.com", role: "accounting" });
    const { data, error } = await client.from("app_users").select("id, pin_hash");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("hides pin_hash from an admin", async () => {
    const { client } = await createAppUser({ email: "pin-admin@example.com", role: "admin" });
    const { data, error } = await client.from("app_users").select("id, pin_hash");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("refuses a collector attempting to promote themselves", async () => {
    const { client, userId } = await createAppUser({
      email: "collector4@example.com",
      role: "collector",
    });

    await client.from("app_users").update({ role: "admin" }).eq("id", userId);

    // Assert the stored role, not an error. An UPDATE filtered out by a policy's
    // USING clause affects zero rows and returns no error at all — only a WITH CHECK
    // violation raises 42501. Asserting on the error would fail while the security
    // property it is meant to protect holds perfectly well.
    const { data } = await serviceClient()
      .from("app_users")
      .select("role")
      .eq("id", userId)
      .single();
    expect(data!.role).toBe("collector");
  });
});
