import { describe, expect, it } from "vitest";
import {
  createAppUser,
  createGoogleAuthUser,
  createUnregisteredAuthUser,
  serviceClient,
  signIn,
  uniqueCode,
  uniqueEmail,
} from "../helpers/supabase.js";

const service = serviceClient();

/**
 * Migration 0009 breaks the circular dependency where `app_users.id` references
 * `auth.users(id)` (which does not exist until Google sign-in) while the access gate
 * refuses anyone without an `app_users` row. An administrator invites by email in
 * `staff_invites`; `claim_staff_invite()` fires on `auth.users` insert and converts a
 * matching Google identity into a real `app_users` row.
 *
 * A reviewer proved a collector could read a pending admin invite (the original,
 * over-broad master-data read grant), call `auth.signUp` with the anon key, and be
 * handed the invited role — self-service email signup created the exact auth.users
 * insert the trigger keyed on. Fix round 2 closes that at three independent layers:
 *   A. the invite is unreadable except to admins (tested below);
 *   B. self-service signup is disabled project-wide (`supabase/config.toml`,
 *      `[auth] enable_signup = false`) — not retested here, it is an auth-level refusal
 *      that never reaches this schema; verified separately (see the fix-round report);
 *   C. the trigger claims only a Google identity (tested below);
 *   D. the trigger never aborts the `auth.users` insert it fires on (tested below).
 */
describe("staff invites", () => {
  it("claims a matching Google identity on first sign-in, with the invited role, and removes the invite", async () => {
    const email = uniqueEmail("invite.claim@example.com");
    const employeeNo = uniqueCode("INV");
    const { error: inviteError } = await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Invited Person",
      role: "supervisor",
    });
    expect(inviteError).toBeNull();

    const userId = await createGoogleAuthUser(email);

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
    const userId = await createGoogleAuthUser(email.toLowerCase());

    const { data: claimed } = await service
      .from("app_users")
      .select("role, status")
      .eq("id", userId)
      .maybeSingle();
    expect(claimed).toMatchObject({ role: "accounting", status: "active" });
  });

  it("leaves no app_users row for a Google sign-in with no matching invite — invite-only access", async () => {
    const userId = await createGoogleAuthUser(uniqueEmail("no.invite@example.com"));

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

    const userId = await createGoogleAuthUser(email);

    const { data: firstRow } = await service
      .from("app_users")
      .select("id, role, row_version")
      .eq("id", userId)
      .single();
    expect(firstRow).toMatchObject({ role: "admin" });

    // `auth.users` enforces one row per email itself (a partial unique index on `email`
    // where not an SSO user) — a second identity for the same address cannot be created
    // at all, so the claim trigger cannot fire a second time through any real "sign in
    // again" flow.
    await expect(createGoogleAuthUser(email)).rejects.toThrow();

    const { data: secondRow } = await service
      .from("app_users")
      .select("id, role, row_version")
      .eq("id", userId)
      .single();
    expect(secondRow).toEqual(firstRow);
  });

  it("keeps a suspended user suspended across a second sign-in", async () => {
    // The control that matters if someone is suspended over a cash irregularity: nothing
    // about signing in again — a genuine password/session refresh, not a new auth.users
    // row — can resurrect them. This exercises app_users_read_self directly and does not
    // depend on the invite-claim mechanism (it uses a plain password identity, exactly
    // like createAppUser), since the property under test is about sessions, not claiming.
    const email = uniqueEmail("suspend.resignin@example.com");
    const userId = await createUnregisteredAuthUser(email).then((u) => u.userId);
    const { error: insertError } = await service.from("app_users").insert({
      id: userId,
      employee_no: uniqueCode("INV"),
      full_name: "Suspend Candidate",
      role: "supervisor",
      status: "active",
    });
    expect(insertError).toBeNull();

    const { error: suspendError } = await service
      .from("app_users")
      .update({ status: "suspended" })
      .eq("id", userId);
    expect(suspendError).toBeNull();

    const secondSession = await signIn(email);
    // app_users_read_self requires status = 'active'; a suspended user cannot even see
    // their own row through their own, freshly re-authenticated session.
    const { data: ownRow } = await secondSession
      .from("app_users")
      .select("status")
      .eq("id", userId)
      .maybeSingle();
    expect(ownRow).toBeNull();

    const { data: viaService } = await service
      .from("app_users")
      .select("status")
      .eq("id", userId)
      .single();
    expect(viaService).toMatchObject({ status: "suspended" });
  });

  it("refuses a non-Google identity even with a matching invite — the trigger's provider gate", async () => {
    const email = uniqueEmail("nongoogle.invite@example.com");
    const employeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Non-Google Claimant",
      role: "admin",
    });

    // The admin API's own default identity ("email" provider) — see createAuthUser. This
    // is the trigger's own, independent gate: it would still hold even if project-wide
    // self-service signup (supabase/config.toml [auth] enable_signup) were re-enabled.
    const { userId } = await createUnregisteredAuthUser(email);

    const { data: noRow, error } = await service
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(noRow).toBeNull();

    // The invite was never touched: still there, unclaimed.
    const { data: invite } = await service
      .from("staff_invites")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(invite).not.toBeNull();
  });

  it("does not abort the auth.users insert on a colliding employee_no — the person just gets no access", async () => {
    const collidingEmployeeNo = uniqueCode("DUP");
    // An existing, already-claimed staff member holding this employee_no.
    await createAppUser({
      email: "existing-empno@example.com",
      role: "supervisor",
      employeeNo: collidingEmployeeNo,
    });

    const email = uniqueEmail("bad.invite@example.com");
    const { error: inviteError } = await service.from("staff_invites").insert({
      email,
      employee_no: collidingEmployeeNo, // unique within staff_invites, but collides with app_users
      full_name: "Bad Invite",
      role: "supervisor",
    });
    expect(inviteError).toBeNull();

    // The claim will fail (app_users.employee_no is unique) — proving that failure is
    // swallowed inside the trigger, not propagated up to abort this insert, is the whole
    // point of this test: it must not throw.
    const userId = await createGoogleAuthUser(email);
    expect(userId).toBeTruthy();

    const { data: noRow } = await service
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(noRow).toBeNull();

    // Left in place for an administrator to correct, not silently dropped.
    const { data: invite } = await service
      .from("staff_invites")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(invite).not.toBeNull();
  });

  it("rejects a second invite differing from an existing one only by email case", async () => {
    const localPart = `case.collide.${uniqueCode("X").toLowerCase()}`;
    const email = `${localPart}@example.com`;
    const { error: firstError } = await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("INV"),
      full_name: "First",
      role: "collector",
    });
    expect(firstError).toBeNull();

    const upperCasedEmail = `${localPart.toUpperCase()}@example.com`;
    const { error: secondError } = await service.from("staff_invites").insert({
      email: upperCasedEmail,
      employee_no: uniqueCode("INV"),
      full_name: "Second",
      role: "collector",
    });
    expect(secondError).not.toBeNull();
  });

  it("rejects an invite email with leading or trailing whitespace", async () => {
    const { error } = await service.from("staff_invites").insert({
      email: ` ${uniqueEmail("padded@example.com")} `,
      employee_no: uniqueCode("INV"),
      full_name: "Padded",
      role: "collector",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a collector reading staff_invites at all — the escalation chain's first stopped layer", async () => {
    // This is the security property, not an incidental detail: the reviewer's chain
    // started with a collector reading a pending admin invite. Confirm they now see none,
    // even when one genuinely exists.
    await service.from("staff_invites").insert({
      email: uniqueEmail("should-be-invisible@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should Be Invisible",
      role: "admin",
    });

    const collector = (await createAppUser({ email: "si-col@example.com", role: "collector" }))
      .client;

    const { data, error } = await collector.from("staff_invites").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { error: writeError } = await collector.from("staff_invites").insert({
      email: uniqueEmail("collector-attempt@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should not be insertable",
      role: "collector",
    });
    expect(writeError).not.toBeNull();
  });

  it("refuses a supervisor reading or writing staff_invites — admin only, not master-data-standard", async () => {
    await service.from("staff_invites").insert({
      email: uniqueEmail("should-be-invisible-2@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should Be Invisible",
      role: "admin",
    });

    const supervisor = (await createAppUser({ email: "si-sup@example.com", role: "supervisor" }))
      .client;

    const { data, error } = await supervisor.from("staff_invites").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { error: writeError } = await supervisor.from("staff_invites").insert({
      email: uniqueEmail("supervisor-attempt@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Should not be insertable",
      role: "collector",
    });
    expect(writeError).not.toBeNull();
  });

  it("lets an admin read and write staff_invites", async () => {
    const admin = (await createAppUser({ email: "si-admin@example.com", role: "admin" })).client;

    const { error: writeError } = await admin.from("staff_invites").insert({
      email: uniqueEmail("admin-invited@example.com"),
      employee_no: uniqueCode("INV"),
      full_name: "Admin Invited",
      role: "collector",
    });
    expect(writeError).toBeNull();

    const { data, error: readError } = await admin.from("staff_invites").select("id").limit(1);
    expect(readError).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});
