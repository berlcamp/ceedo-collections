import { describe, expect, it } from "vitest";
import { createAppUser, createOutsiderClient, serviceClient } from "../helpers/supabase.js";

describe("membership gate", () => {
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
    // A live row count is not a safe assertion here: vitest runs test files
    // concurrently, several of which call createAppUser against this same
    // app_users table, so a count taken via one client and a count taken via
    // another can legitimately differ by whatever inserted in between. Assert
    // the actual security property instead — a specific known row is visible
    // to the privileged reader and invisible to an unprivileged one — which
    // is both stronger than a count and immune to concurrent inserts.
    const { userId: markerId } = await createAppUser({
      email: "marker-admin@example.com",
      role: "collector",
    });
    const { client: admin } = await createAppUser({ email: "admin1@example.com", role: "admin" });
    const { client: collector } = await createAppUser({
      email: "collector-vs-admin@example.com",
      role: "collector",
    });

    const { data: adminData } = await admin.from("app_users").select("id");
    const { data: collectorData } = await collector.from("app_users").select("id");

    expect((adminData ?? []).map((row) => row.id)).toContain(markerId);
    expect((collectorData ?? []).map((row) => row.id)).not.toContain(markerId);
  });

  it("lets a supervisor read every user", async () => {
    // This is the test that guards app_users_read_all specifically: app_users_admin_write
    // is FOR ALL, so its USING clause backstops SELECT for admins even if read_all is
    // deleted. Supervisor and accounting are the only two roles read_all uniquely serves.
    // See the admin test above for why this asserts membership rather than a count.
    const { userId: markerId } = await createAppUser({
      email: "marker-sup@example.com",
      role: "collector",
    });
    const { client: supervisor } = await createAppUser({
      email: "sup-read@example.com",
      role: "supervisor",
    });
    const { client: collector } = await createAppUser({
      email: "collector-vs-sup@example.com",
      role: "collector",
    });

    const { data: supervisorData } = await supervisor.from("app_users").select("id");
    const { data: collectorData } = await collector.from("app_users").select("id");

    expect((supervisorData ?? []).map((row) => row.id)).toContain(markerId);
    expect((collectorData ?? []).map((row) => row.id)).not.toContain(markerId);
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

  /**
   * The edit path the admin registry's `users` resource now uses. The server action
   * (apps/web/lib/admin/actions.ts) issues a plain PostgREST UPDATE through the caller's
   * own session, so what the caller's JWT can do here IS what the engine can do — the
   * registry's writeRoles check is a second gate in front of this one, not a substitute
   * for it.
   */
  describe("administering staff (app_users_admin_write)", () => {
    it("lets an admin change someone's role", async () => {
      const { userId } = await createAppUser({ email: "promote-me@example.com", role: "collector" });
      const { client: admin } = await createAppUser({
        email: "promoter-admin@example.com",
        role: "admin",
      });

      const { error } = await admin.from("app_users").update({ role: "supervisor" }).eq("id", userId);
      expect(error).toBeNull();

      const { data } = await serviceClient()
        .from("app_users")
        .select("role")
        .eq("id", userId)
        .single();
      expect(data!.role).toBe("supervisor");
    });

    it("lets an admin suspend a leaver", async () => {
      const { userId } = await createAppUser({ email: "leaver@example.com", role: "accounting" });
      const { client: admin } = await createAppUser({
        email: "suspender-admin@example.com",
        role: "admin",
      });

      const { error } = await admin
        .from("app_users")
        .update({ status: "suspended" })
        .eq("id", userId);
      expect(error).toBeNull();

      const { data } = await serviceClient()
        .from("app_users")
        .select("status")
        .eq("id", userId)
        .single();
      expect(data!.status).toBe("suspended");
    });

    it("still refuses a supervisor changing anyone's role", async () => {
      // The other direction: app_users_admin_write is admin-only, and giving the registry
      // a write path must not have widened it. A supervisor's UPDATE is filtered out by
      // the USING clause, which affects zero rows and raises nothing — so assert the
      // stored value, not an error.
      const { userId } = await createAppUser({ email: "not-promotable@example.com", role: "collector" });
      const { client: supervisor } = await createAppUser({
        email: "would-be-promoter@example.com",
        role: "supervisor",
      });

      await supervisor.from("app_users").update({ role: "admin" }).eq("id", userId);

      const { data } = await serviceClient()
        .from("app_users")
        .select("role")
        .eq("id", userId)
        .single();
      expect(data!.role).toBe("collector");
    });
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
