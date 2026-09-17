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
    const { client } = await createAppUser({
      email: "collector3@example.com",
      role: "collector",
    });
    const { data } = await client.from("app_users").select("id");
    expect(data).toHaveLength(1);
  });

  it("lets an admin read every user", async () => {
    const { client } = await createAppUser({ email: "admin1@example.com", role: "admin" });
    const { data } = await client.from("app_users").select("id");
    expect((data ?? []).length).toBeGreaterThan(1);
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
