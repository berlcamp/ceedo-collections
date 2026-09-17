import { describe, expect, it } from "vitest";
import {
  createAppUser,
  createAuthUserWithoutProvider,
  createGoogleAuthUser,
  createUnregisteredAuthUser,
  serviceClient,
  setAuthUserProvider,
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
 * insert the trigger keyed on. That is closed at two independent layers, each of which
 * kills the chain on its own:
 *   A. the invite is unreadable except to admins, so an attacker cannot learn which
 *      address is invited (tested below);
 *   C. the trigger claims only a Google identity, so even a known address claimed via
 *      email signup grants nothing (tested below);
 *   D. the trigger never aborts the `auth.users` insert it fires on (tested below).
 *
 * A third layer — `[auth] enable_signup = false` in `supabase/config.toml` — was added in
 * fix round 2 and REMOVED in fix round 4. It maps to `GOTRUE_DISABLE_SIGNUP`, which GoTrue
 * enforces provider-agnostically, so it refused every staff member's first Google sign-in
 * and made onboarding impossible. `auth-signup-enabled.test.ts` now guards against it
 * coming back. In production the email provider is disabled in the Supabase dashboard
 * instead, which removes the email-signup vector without touching OAuth.
 *
 * Fix round 3: round 2 proved (via a temporary debug trigger) that GoTrue's admin API
 * populates `raw_app_meta_data` in a separate UPDATE, not the original INSERT — a pattern
 * that, if a genuine Google sign-in behaves the same way, would make the provider check
 * refuse every legitimate sign-in forever while still admitting no one. The trigger now
 * fires on `insert or update of raw_app_meta_data`, and the "two-step" tests below prove
 * both that this pattern now claims correctly and that it stays idempotent and does not
 * resurrect a suspended user.
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

  it("claims correctly when GoTrue populates the provider in a separate UPDATE — the two-step pattern that would have broken production", async () => {
    // Proven by a temporary debug trigger (see the fix-round-2 report): GoTrue's admin API
    // inserts auth.users with no meaningful raw_app_meta_data and patches the real value in
    // via a separate UPDATE. If that also holds for a genuine external-OAuth sign-in, an
    // AFTER-INSERT-only trigger would see no provider, refuse every real Google user
    // forever, and never claim anything — the worst possible outcome for a security check.
    // Round 3's trigger fires on `insert or update of raw_app_meta_data` specifically so
    // this pattern still works.
    const email = uniqueEmail("two.step.claim@example.com");
    const employeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Two Step",
      role: "supervisor",
    });

    const userId = await createAuthUserWithoutProvider(email);

    // Intermediate state: the INSERT fired the trigger, but with no provider present, so
    // nothing was claimed yet.
    const { data: afterInsert } = await service
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(afterInsert).toBeNull();

    await setAuthUserProvider(userId, "google");

    // The UPDATE fires the trigger a second time, now with the provider present, and
    // claims.
    const { data: afterUpdate, error: afterUpdateError } = await service
      .from("app_users")
      .select("id, employee_no, full_name, role, status")
      .eq("id", userId)
      .maybeSingle();
    expect(afterUpdateError).toBeNull();
    expect(afterUpdate).toMatchObject({
      employee_no: employeeNo,
      full_name: "Two Step",
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

  it("still refuses an email-provider identity when the metadata arrives via UPDATE, not just INSERT", async () => {
    const email = uniqueEmail("two.step.refuse@example.com");
    await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("INV"),
      full_name: "Two Step Refuse",
      role: "admin",
    });

    const userId = await createAuthUserWithoutProvider(email);
    await setAuthUserProvider(userId, "email");

    const { data: noRow } = await service
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    expect(noRow).toBeNull();

    const { data: invite } = await service
      .from("staff_invites")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(invite).not.toBeNull();
  });

  it("is idempotent on a repeat metadata UPDATE for an already-claimed user, and does not reactivate a suspended one", async () => {
    const email = uniqueEmail("two.step.idempotent@example.com");
    const employeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: employeeNo,
      full_name: "Idempotent Check",
      role: "supervisor",
    });

    const userId = await createGoogleAuthUser(email);
    const { data: claimedRow } = await service
      .from("app_users")
      .select("id, role, status, row_version")
      .eq("id", userId)
      .single();
    expect(claimedRow).toMatchObject({ role: "supervisor", status: "active" });

    await service.from("app_users").update({ status: "suspended" }).eq("id", userId);
    const { data: suspendedRow } = await service
      .from("app_users")
      .select("id, role, status, row_version")
      .eq("id", userId)
      .single();
    expect(suspendedRow).toMatchObject({ role: "supervisor", status: "suspended" });

    // A later metadata UPDATE (e.g. GoTrue refreshing app_metadata on a subsequent
    // sign-in) fires the trigger again. The invite is already gone, so the SELECT finds
    // nothing and the function returns early — it must not touch app_users at all, so
    // row_version must be exactly what the suspend UPDATE above left it at, not bumped
    // again by a phantom write from the trigger's own re-firing.
    await setAuthUserProvider(userId, "google");

    const { data: afterRepeat } = await service
      .from("app_users")
      .select("id, role, status, row_version")
      .eq("id", userId)
      .single();
    expect(afterRepeat).toMatchObject({ role: "supervisor", status: "suspended" });
    expect(afterRepeat!.row_version).toBe(suspendedRow!.row_version);

    // No duplicate row was created for this identity either.
    const { count } = await service
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .eq("id", userId);
    expect(count).toBe(1);
  });

  it("re-inviting an existing staff member changes their role", async () => {
    // `on conflict (id) do nothing` made this a silent no-op: the invite was consumed
    // (it is deleted unconditionally), nothing changed, and no error was raised — so an
    // administrator correcting a wrong role had no working mechanism at all and no signal
    // that it had failed. An invite is a statement of what this person's access should be.
    const email = uniqueEmail("reinvite.promote@example.com");
    await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("INV"),
      full_name: "Originally A Collector",
      role: "collector",
    });

    const userId = await createGoogleAuthUser(email);
    const { data: first } = await service
      .from("app_users")
      .select("role, full_name, status")
      .eq("id", userId)
      .single();
    expect(first).toMatchObject({ role: "collector", status: "active" });

    const newEmployeeNo = uniqueCode("INV");
    await service.from("staff_invites").insert({
      email,
      employee_no: newEmployeeNo,
      full_name: "Now An Administrator",
      role: "admin",
    });

    // GoTrue refreshing app_metadata on a subsequent sign-in is the UPDATE the trigger
    // fires on; auth.users will not accept a second row for the same address.
    await setAuthUserProvider(userId, "google");

    const { data: after } = await service
      .from("app_users")
      .select("role, full_name, employee_no, status")
      .eq("id", userId)
      .single();
    expect(after).toMatchObject({
      role: "admin",
      full_name: "Now An Administrator",
      employee_no: newEmployeeNo,
      status: "active",
    });

    // The invite was genuinely consumed, not left pending.
    const { data: remaining } = await service
      .from("staff_invites")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(remaining).toBeNull();
  });

  it("re-inviting a suspended staff member updates their role but does NOT reactivate them", async () => {
    // The half that must not be convenient. Suspension is a deliberate act, typically over
    // a cash irregularity; a re-invite must never be a back door around it. `status` is
    // therefore absent from the conflict update, and this is the assertion that keeps it
    // absent.
    const email = uniqueEmail("reinvite.suspended@example.com");
    await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("INV"),
      full_name: "Suspended Person",
      role: "collector",
    });

    const userId = await createGoogleAuthUser(email);
    await service.from("app_users").update({ status: "suspended" }).eq("id", userId);

    await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("INV"),
      full_name: "Suspended Person",
      role: "supervisor",
    });
    await setAuthUserProvider(userId, "google");

    const { data: after } = await service
      .from("app_users")
      .select("role, status")
      .eq("id", userId)
      .single();
    expect(after).toMatchObject({ role: "supervisor", status: "suspended" });
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
