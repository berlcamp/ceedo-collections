import { describe, expect, it } from "vitest";
import {
  createAppUser,
  createUnregisteredAuthUser,
  serviceClient,
  uniqueCode,
  uniqueEmail,
} from "../helpers/supabase.js";

const service = serviceClient();

/**
 * Migration 0009 breaks the circular dependency where `app_users.id` references
 * `auth.users(id)` (which does not exist until Google sign-in) while the access gate
 * refuses anyone without an `app_users` row. An administrator invites by email in
 * `staff_invites`; `claim_staff_invite()` fires on `auth.users` insert and converts a
 * matching invite into a real `app_users` row.
 */
describe("staff invites", () => {
  it("claims a matching invite on first sign-in, with the invited role, and removes the invite", async () => {
    const email = uniqueEmail("invite.claim@example.com");
    const employeeNo = uniqueCode("INV");
    const { error: inviteError } = await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Invited Person",
      role: "supervisor",
    });
    expect(inviteError).toBeNull();

    const { userId } = await createUnregisteredAuthUser(email);

    const { data: claimed, error: claimedError } = await service
      .from("app_users")
      .select("id, employee_no, full_name, role, status")
      .eq("id", userId)
      .maybeSingle();
    expect(claimedError).toBeNull();
    expect(claimed).toMatchObject({
      employee_no: employeeNo,
      full_name: "Invited Person",
      role: "supervisor",
      status: "active",
    });

    const { data: remainingInvite } = await service
      .from("staff_invites")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(remainingInvite).toBeNull();
  });

  it("matches the invite's email case-insensitively", async () => {
    const email = uniqueEmail("Invite.CaseTest@Example.com");
    const employeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Case Test",
      role: "accounting",
    });

    // Sign in with a different casing of the same address.
    const { userId } = await createUnregisteredAuthUser(email.toLowerCase());

    const { data: claimed } = await service
      .from("app_users")
      .select("role, status")
      .eq("id", userId)
      .maybeSingle();
    expect(claimed).toMatchObject({ role: "accounting", status: "active" });
  });

  it("leaves no app_users row for a sign-in with no matching invite — invite-only access", async () => {
    const { userId } = await createUnregisteredAuthUser(
      uniqueEmail("no.invite@example.com"),
    );

    const { data, error } = await service
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("does not duplicate or overwrite the app_users row on a second sign-in", async () => {
    const email = uniqueEmail("invite.once@example.com");
    const employeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Once Only",
      role: "admin",
    });

    const { userId } = await createUnregisteredAuthUser(email);

    const { data: firstRow } = await service
      .from("app_users")
      .select("id, role, row_version")
      .eq("id", userId)
      .single();
    expect(firstRow).toMatchObject({ role: "admin" });

    // `auth.users` only ever inserts once per identity — GoTrue itself refuses a second
    // registration for an email already in use, which is what stops the trigger firing
    // twice through a real "sign in again" flow. Exercising that directly proves a second
    // sign-in cannot create a second auth identity, and therefore cannot duplicate or
    // overwrite this app_users row through the claim trigger.
    await expect(createUnregisteredAuthUser(email)).rejects.toThrow();

    const { data: secondRow } = await service
      .from("app_users")
      .select("id, role, row_version")
      .eq("id", userId)
      .single();
    expect(secondRow).toEqual(firstRow);
  });

  it("lets a collector read staff_invites (like every other master data table) but not write them", async () => {
    // apply_master_data_policies() — unchanged, applied to staff_invites exactly as to
    // every other master-data table — grants SELECT to any registered staff member and
    // restricts writes to admins. master-data-policies.test.ts already asserts a collector
    // can read all fourteen other master-data tables; staff_invites is not special-cased,
    // so a collector reading it is expected, not a gap.
    const collector = (await createAppUser({ email: "si-col@example.com", role: "collector" }))
      .client;

    const { error: readError } = await collector.from("staff_invites").select("id").limit(1);
    expect(readError).toBeNull();

    const { error: writeError } = await collector.from("staff_invites").insert({
      email: uniqueEmail("collector-attempt@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should not be insertable",
      role: "collector",
    });
    expect(writeError).not.toBeNull();
  });

  it("lets a supervisor read staff_invites but not write them", async () => {
    const supervisor = (await createAppUser({ email: "si-sup@example.com", role: "supervisor" }))
      .client;

    const { error: readError } = await supervisor.from("staff_invites").select("id").limit(1);
    expect(readError).toBeNull();

    const { error: writeError } = await supervisor.from("staff_invites").insert({
      email: uniqueEmail("supervisor-attempt@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should not be insertable",
      role: "collector",
    });
    expect(writeError).not.toBeNull();
  });

  it("lets an admin write staff_invites", async () => {
    const admin = (await createAppUser({ email: "si-admin@example.com", role: "admin" })).client;

    const { error } = await admin.from("staff_invites").insert({
      email: uniqueEmail("admin-invited@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Admin Invited",
      role: "collector",
    });
    expect(error).toBeNull();
  });
});
