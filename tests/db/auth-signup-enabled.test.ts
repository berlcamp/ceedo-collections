import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anonClient, uniqueEmail } from "../helpers/supabase.js";

/**
 * Configuration invariant: GoTrue's signup switch must stay ON.
 *
 * `[auth] enable_signup` in `supabase/config.toml` maps to `GOTRUE_DISABLE_SIGNUP`, and
 * GoTrue enforces that flag **provider-agnostically**: the `CreateAccount` branch of
 * `createAccountFromExternalIdentity()` checks it for OAuth logins too, not just the
 * email `/signup` endpoint. Turning it off therefore refuses every staff member's FIRST
 * Google sign-in with `signup_disabled`. No `auth.users` row is created, so
 * `ceedo_collections.claim_staff_invite()` never fires and nobody can ever be onboarded —
 * which defeats the entire invite system and a stated Phase 1 exit criterion.
 *
 * Fix round 2 set this flag as a defence-in-depth layer against the invite-claim
 * privilege escalation, and three review rounds missed the breakage because every other
 * test creates users through the **admin API**, which bypasses that code path entirely.
 * Nothing exercised a first-time OAuth sign-in. This file closes that gap: a real Google
 * flow needs credentials we do not have in CI, but the configuration invariant behind it
 * can be asserted directly, so re-enabling the flag fails loudly here instead of silently
 * locking out every new employee.
 *
 * The escalation stays closed without this layer: `staff_invites` SELECT is admin-only
 * (an attacker cannot learn which address is invited) and `claim_staff_invite()` refuses
 * any provider but `google` (a known address claimed via email signup grants nothing).
 * Both are covered in `staff-invites.test.ts`. In the hosted project, the email-signup
 * vector is removed by disabling the email provider in the dashboard — see
 * `apps/web/README.md` — which does not touch Google OAuth.
 */
describe("auth signup configuration", () => {
  it("does not have GOTRUE_DISABLE_SIGNUP enabled on the running stack", async () => {
    // The live probe. `signUp` hits the same GoTrue gate that a first-time Google
    // sign-in hits, so a `signup_disabled` refusal here means OAuth onboarding is dead.
    const { error } = await anonClient().auth.signUp({
      email: uniqueEmail("signup-invariant@example.com"),
      password: "test-password-not-a-secret",
    });

    expect(error?.code).not.toBe("signup_disabled");
    expect(error?.message ?? "").not.toMatch(/signups not allowed/i);
    expect(error).toBeNull();
  });

  it("keeps [auth] enable_signup true in supabase/config.toml", async () => {
    // A static guard for the same invariant, so the reason is visible at review time
    // even when the stack happens to be stale. Only the top-level [auth] table matters:
    // [auth.email] and [auth.sms] have their own `enable_signup` keys that map elsewhere.
    const configPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../supabase/config.toml",
    );
    const config = readFileSync(configPath, "utf8");

    const authSection = config.split(/^\[auth\]\s*$/m)[1];
    expect(authSection, "no top-level [auth] section in supabase/config.toml").toBeDefined();
    const topLevelAuth = authSection!.split(/^\[/m)[0]!;

    const match = /^\s*enable_signup\s*=\s*(\w+)/m.exec(topLevelAuth);
    // Absent is fine — GoTrue defaults to signups enabled. Present and false is not.
    expect(match?.[1] ?? "true").toBe("true");
  });
});
