# CEEDO Collections — Phase 1 Handover

**Branch:** `phase-1-foundation` · 49 commits · 213 tests / 20 files · 10 migrations
**Spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Plan:** `docs/superpowers/plans/2026-09-17-phase-1-foundation.md`

## What exists

- `ceedo_collections` Postgres schema on a Supabase project shared with other systems
- Facilities (market / terminal / parking / slaughterhouse), sections, stalls
- Tenants and leases, with an exclusion constraint making double-booking a stall impossible
- Effective-dated rates so a two-year-old receipt still recomputes correctly
- OR booklets, assignments, spoiled forms — the accountable-forms spine
- Shared tablets with a device/collector assignment overlap rule
- Next.js admin: Google sign-in, invite-only access, twelve resource screens
- Append-only audit log across sixteen tables

## Before go-live — items no test can enforce

1. **Create the Google OAuth client.** Authorised redirect URI is
   `https://<project>.supabase.co/auth/v1/callback` — the Supabase auth endpoint, **not** the
   Next.js one. Locally it is `http://127.0.0.1:54321/auth/v1/callback`. See `apps/web/README.md`.
2. **Confirm a real Google first sign-in claims its invite.** The claim trigger's behaviour is
   verified against GoTrue v2.196.0 source but has never been exercised against real Google.
3. **Disable the email provider in the hosted Supabase dashboard.** This system is Google-only.
   Do NOT disable signup instead — that also blocks OAuth account creation and prevents all
   onboarding. There is a test (`auth-signup-enabled.test.ts`) guarding that mistake.
4. **Write down that the service-role key is break-glass, not a database password.** Every
   guarantee here — append-only audit, the coming ledger — is defended by withheld privileges.
   A service key pasted into a report script defeats all of it.
5. **Seed the first admin.** A fresh install has no `app_users` rows. Insert one directly, or
   create a `staff_invites` row, before anyone can sign in.

## Mandatory for Phase 2

- **Ledger tables inherit `INSERT, SELECT` only.** Migration 0001's default privileges were
  narrowed precisely so `charges`, `collections`, `collection_allocations` and
  `collection_lines` get append-only by default rather than by remembering to revoke.
  Do not grant `UPDATE`/`DELETE` on them to any role, including `service_role`.
- `apply_master_data_policies()` grants `UPDATE`/`DELETE` to `service_role`. **Do not use it
  for ledger tables.**
- Surcharge is **integer basis points** (3% = `300`), never a float. The reason is rounding
  **direction**, not representation: `0.03 * 8350` is exactly `250.5` in IEEE 754, and
  `Math.floor(250.5)` is `250` where half-up gives `251` — a float pipeline that floors
  loses the centavo on every exact half.
- `charges.due_date` is explicit; the surcharge clock starts from it.
- `booklets.status` is **not authoritative** — nothing transitions it. Derive booklet state
  from `booklet_assignments` and `spoiled_forms`, or add the transition logic first.

## Mandatory for Phase 3

- `ceedo_app` exists but has **zero** table privileges and is not granted to `authenticator`.
  Wire it before Edge Functions use it; it exists so they never use `service_role`, which
  bypasses RLS across every schema on this shared instance.
- Collectors can no longer read master data through PostgREST — by design, per spec §4. The
  tablet syncs through Edge Functions.
- `packages/shared` is pure TypeScript (money, rate resolution, OR validation) with no React,
  Next.js or supabase-js imports, so the Expo app imports the same rules the server uses.
- Device reassignment mid-shift is unrestricted at the database. The in-flight rule belongs in
  the sync/lease layer.

## Previously parked, now fixed

| # | Was | Now |
| --- | --- | --- |
| P1 | An admin could demote or suspend themselves, and a fresh install has one admin. Recovery needed psql. | `assert_admin_remains` refuses to demote, suspend **or** delete the last active administrator, naming their employee number and telling you to appoint another first. Six tests, both directions. |
| P2 | Migration 0002's comment claimed DELETE was withheld — true only for `service_role`. An admin JWT could delete a staff row and write `pin_hash`. | The code now matches the comment: `authenticated` has no INSERT or DELETE on `app_users` at all, and UPDATE on `role` and `status` only. `pin_hash` is unwritable by any web client; Phase 3 writes it through an Edge Function. |
| P3 | Edit-mode submits every field; nothing checked `fields ⊆ select`, so a future resource would silently blank a column. | `registry.test.ts` asserts it for every edit-mode resource and every `optionLabel`. Verified to fail when a column is removed from a select. |

**Note for whoever writes the accrual job:** `assert_admin_remains` fires per row, so a bulk
`UPDATE` suspending several administrators at once will be refused on the last of them even
though the statement as a whole looks safe. Suspend individually, or exclude one explicitly.


## Deferred minors

`applyBasisPoints` comment wording · no test for collector UPDATE/DELETE against RLS-hidden
rows · stray `due_day` on daily leases · ambiguous-rates message omits `rateClass` · duplicated
AUTO-GENERATED header (fails closed) · Next 16 `middleware`→`proxy` deprecation · two
`as unknown as` casts on select results · `ceedo_app` placeholder privileges · seed leaves
audit rows locally · web money fields write 2-dp floats rather than `Centavos`.
