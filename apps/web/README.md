# CEEDO Collections — web app

Next.js app for CEEDO Collections staff (supervisors, accounting, admins). Access is
invite-only: signing in with Google proves *who* someone is, but a registered, active
`app_users` row is what grants entry (see `lib/auth/gate.ts`). Collectors do not use this
app — they record collections on the tablet.

## Local development

```bash
pnpm install
set -a; eval "$(supabase status -o env)"; set +a   # exports ANON_KEY, etc. from the running local stack
cp .env.example .env.local                         # fill in NEXT_PUBLIC_SUPABASE_ANON_KEY from the export above
pnpm --filter @ceedo/web dev
```

Google sign-in will not work until you create a Google OAuth client and set
`GOOGLE_CLIENT_ID` / `GOOGLE_SECRET` for the Supabase CLI (see below). Everything else —
the access gate, the Supabase clients, the middleware, and the pages — builds, typechecks
and has automated tests without Google credentials.

## Creating the Google OAuth client

You'll need a Google account with access to [Google Cloud Console](https://console.cloud.google.com/).

1. **Create or select a project.** Go to Google Cloud Console → select a project (or
   create a new one, e.g. "CEEDO Collections").
2. **Configure the OAuth consent screen.** APIs & Services → OAuth consent screen.
   - User type: **External** (staff use personal Gmail accounts, so they are not part of
     a Google Workspace you control).
   - Fill in the app name, support email, and developer contact email.
   - You do not need to submit for verification for internal/local testing — an
     "unverified app" warning is fine for a small number of test users, but you must add
     each staff Gmail address under **Audience → Test users** while the app is in
     "Testing" mode.
3. **Create the OAuth client ID.** APIs & Services → Credentials → Create Credentials →
   OAuth client ID.
   - Application type: **Web application**.
   - Name: anything, e.g. "CEEDO Collections — local".
   - **Authorized redirect URIs**: add exactly
     ```
     http://127.0.0.1:54321/auth/v1/callback
     ```
     This is the **Supabase Auth server's** callback endpoint, not the Next.js app's
     `/auth/callback` route. Supabase Auth completes the OAuth exchange first and then
     redirects the browser on to the app. Pointing Google at the Next.js route
     (`http://localhost:3000/auth/callback`) is the most common setup mistake and will
     fail with a redirect_uri_mismatch error.
   - Save, then copy the generated **Client ID** and **Client secret**.
4. **Set the environment variables for the Supabase CLI.** `supabase/config.toml` reads
   these via `env(GOOGLE_CLIENT_ID)` and `env(GOOGLE_SECRET)`:
   ```bash
   export GOOGLE_CLIENT_ID="<client id from step 3>"
   export GOOGLE_SECRET="<client secret from step 3>"
   supabase stop && supabase start
   ```
   (`supabase start` also works fine with these unset — Google sign-in just won't work
   until they're set.)
5. **Register yourself in `app_users`.** Access is invite-only: even a perfectly valid
   Google sign-in is refused unless an administrator has already created a matching
   `app_users` row (see `lib/auth/gate.ts`). Insert a row for your own Gmail-linked user
   with an allowed role (`supervisor`, `accounting`, or `admin`) and `status = 'active'`
   before attempting to sign in, or you will correctly land on `/no-access`.

## Manual smoke test

Once the Google OAuth client is configured and your account has an `app_users` row:

1. Run `pnpm --filter @ceedo/web dev` and open `http://localhost:3000`. You should be
   redirected to `/sign-in` (middleware refuses unauthenticated visitors).
2. Click **Sign in with Google** and complete the Google sign-in flow.
3. You should land back on `/` and see "Signed in as `<your name>` (`<your role>`)" — the
   `requireStaff()` gate matched your session to your `app_users` row.
4. Sign out (clear cookies, or open an incognito window) and sign in again with a Google
   account that has **no** `app_users` row. You should be redirected to `/no-access` —
   the session is valid, but membership is not, and the app refuses it.
5. If instead you add an `app_users` row with `role = 'collector'`, that account should
   also be redirected to `/no-access` (`role_not_permitted`) — collectors belong on the
   tablet, not the web app.

If step 4 or 5 instead lets you into `/`, the gate is broken — stop and fix
`decideAccess` / `requireStaff()` before doing anything else with this app.

## Production auth posture: disable the email provider

**In the hosted Supabase project, turn the email provider OFF** (Dashboard → Authentication
→ Sign In / Providers → Email → disable). This system authenticates only with Google, so
nothing legitimate uses email/password, and leaving the provider enabled leaves a
self-service `auth.signUp()` endpoint reachable with the public anon key. That endpoint is
the input `ceedo_collections.claim_staff_invite()` keys on, so it is the vector an attacker
would use to try to claim someone else's pending staff invitation.

Do **not** try to close this with the project-wide signup switch (`[auth] enable_signup` /
`GOTRUE_DISABLE_SIGNUP`). GoTrue enforces that flag provider-agnostically — its
`createAccountFromExternalIdentity()` `CreateAccount` branch checks it for OAuth too — so
it refuses every staff member's **first** Google sign-in with `signup_disabled`. No
`auth.users` row is created, the claim trigger never fires, and nobody can ever be
onboarded. Disabling the email provider removes the email-signup vector without touching
Google OAuth. `tests/db/auth-signup-enabled.test.ts` guards against that flag being
re-enabled.

**Local development keeps email enabled** (`supabase/config.toml` leaves both
`[auth] enable_signup` and `[auth.email] enable_signup` at `true`), because the test suite
creates fixtures via the admin API and signs them in with `signInWithPassword`. Disabling
the email provider locally breaks the whole suite.

Even with email enabled, the invite-claim escalation is closed at two independent layers,
both covered by `tests/db/staff-invites.test.ts`: `staff_invites` is readable only by
admins, so an attacker cannot learn which address is invited; and `claim_staff_invite()`
refuses any provider but `google`, so an address claimed through email signup is granted
nothing and the invitation stays unclaimed.

## Learn more

This is a standard Next.js App Router project (`create-next-app` with TypeScript,
Tailwind, ESLint). See the [Next.js documentation](https://nextjs.org/docs) for framework
details.
