# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user — confirmed, and the one the app should be built around — is an
**accounting clerk in the CEEDO office, at a desktop, all day**. This is their main
window, not a tool they visit. Reconciling collections against shifts, reading aging and
delinquency, and chasing variances is the work; density and scanning speed matter more to
them than anything else on this surface.

Two secondary roles use the same screens less often:

- a **supervisor**, in bursts — clearing sync exceptions, checking shift variances, voiding
  a receipt, then closing the tab;
- an **administrator**, heavily at go-live and rarely after — configuring facilities,
  sections, stalls, tenants, leases, fee types, rates, OR booklets and tablets, issuing
  device credentials, setting collector PINs, and recording opening balances.

**Collectors never use this app.** `canUseWeb()` refuses them and the RLS policies refuse
their JWT the rows. Collections are recorded on the Android tablet (`apps/collector`),
which has its own PRODUCT.md and its own, deliberately separate, design constraints.

## Product Purpose

`apps/web` is the back office for CEEDO Collections. Cash is taken in a public market on a
tablet against a pre-printed paper Official Receipt; this app is where that money is
**checked, reconciled, corrected and accounted for** after it syncs.

It exists so the office can answer, at any moment: what is owed and how long it has been
owed, what was collected and by whom, which shifts do not balance, which pushes were
rejected and what was done about them, and who changed what.

Success is an office that can close a day against the tablets and the physical cash without
opening a paper ledger, and can defend every figure to the Treasurer.

## Positioning

This is the **authoritative side of a two-sided system whose other side is deliberately
offline**. The tablet is allowed to be stale and to be wrong; the web app is where that is
detected and resolved. That asymmetry governs the design: this surface's job is to surface
disagreement — between the device and the server, between the system count and the declared
cash, between a charge and its payment — not merely to display records.

It is also **subordinate to paper in law and superior to it in practice**: the hand-written
Official Receipt is the legal record, and this app proves the paper and the cash agree.

## Operating Context

- **Roles:** `supervisor`, `accounting`, `admin` reach this app. `collector` cannot.
  RLS in Postgres is the real gate; every role check in the UI is presentation only and
  must mirror the policies exactly, or it hands someone a dead screen or hides an
  entitlement.
- **Two families of screen**, and they are genuinely different shapes:
  - **Master data** (`app/(admin)/[resource]/`) — 13 registry-driven CRUD resources:
    facilities, sections, stalls, tenants, leases, fee types, rates, accountable form
    types, OR booklets, tablets, collection areas, staff invitations,
    staff, audit log. Config-driven from `lib/admin/registry.ts`; one page component
    serves all of them.
  - **Ledger** (`app/(admin)/ledger/`) — read-plus-RPC reporting over Postgres views:
    aging of receivables, delinquency list, collections, opening balances, exceptions,
    shifts, and a per-lease subsidiary ledger. Not CRUD, and deliberately outside the
    registry engine.
- **Actions are RPCs behind SECURITY DEFINER functions**, not table writes: cancel a
  collection, condone a charge, resolve an exception (correct / spoil / escalate), record
  an opening balance, issue a device credential, set a collector PIN. Each is a
  consequential act against cash that has already changed hands.
- **Data scale is hundreds of rows** in the largest tables — confirmed. Fetching a
  resource in full and paginating, sorting and filtering it in the browser is correct
  here; server-side pagination would be plumbing against a problem this deployment does
  not have.
- Sign-in is **Google OAuth only**, by invitation. An unregistered account lands on
  `/no-access`.

## Capabilities and Constraints

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4 (`@import
  "tailwindcss"`, no `tailwind.config.js`), Supabase SSR client, Zod 4. Server Components
  by default; client components only where interaction demands it.
- **Component layer: Radix Primitives, styled by this project** — confirmed. Not
  shadcn/ui, not Radix Themes. The primitives supply behaviour and accessibility; the
  visual language is ours.
- **Money is integer centavos**, rendered only through `format()` from `@ceedo/shared`.
  Floats never touch a peso. `<Money>` also renders zero as an em dash, deliberately.
- **`ResourceTable` and `LedgerTable` are two different contracts** and must stay so:
  the first formats `Record<string, unknown>` generically, the second lets each column
  render its own cell so a money column can go through `<Money>`.
- **A denied read and an empty table must never look the same.** The resource page already
  distinguishes them and shows the Postgres error code; this is a rule, not an accident.
- **`writeMode: "edit"`** exists because `app_users` rows can only be created by the claim
  trigger on a real Google sign-in — that resource updates, never inserts.
- **Single theme, no theme switcher** — confirmed by the user for this pass.
- Language: English only.

## Brand Commitments

None recorded. There is no supplied logo, wordmark, palette or typeface. "CEEDO
Collections" and "City Economic Enterprise and Development Office" are the names in use.

The collector tablet app has its own separate constraints (one light theme, daylight
legibility, large money figures) and is **not** a visual reference for this surface: a
sunlit one-handed tablet in a market and an all-day office desktop are different scenes.

## Evidence on Hand

- `README.md` — stack, the non-default Supabase port range (563xx), and the OAuth redirect
  consequence.
- `docs/superpowers/phase-*-handover.md` and `docs/superpowers/specs/` — the governing
  build history.
- `lib/admin/registry.ts` — the authoritative list of resources, fields, columns and role
  sets.
- `supabase/migrations/` — the RLS policies every role check here mirrors.
- **No design artifacts exist** for this app: no screenshots of it in use, no office
  photographs, no observation notes, no record of the monitor it runs on. Future work must
  not invent these.
- The current interface is **untouched `create-next-app` styling** — Geist, neutral grays,
  no tokens. It is evidence of what the app does, not authority over how it should look.

## Product Principles

1. **Surface disagreement first.** A variance, an exception, a stale open shift and an
   overdue charge are the reasons this app exists. Anything that makes them equal in
   weight to a settled row is a design failure.
2. **Never let a refusal read as an absence.** "Nothing here yet" told to someone being
   denied by RLS is a lie about the data. Say which it is.
3. **Presentation gates mirror policy; they never enforce it.** Hiding a control is a
   courtesy to the operator. The database is what refuses.
4. **Every consequential act carries a written reason.** Voiding, condoning, correcting,
   spoiling and escalating all demand one, because each disposes of cash a vendor has
   already handed over.
5. **Density serves the clerk.** This is an all-day reconciliation surface. Comfortable
   spacing that halves the rows visible is a cost paid by the person who uses it most.

## Accessibility & Inclusion

No formal standard was established. Two needs follow from the confirmed context:

- **All-day desktop legibility** — sustained reading of dense figures, so contrast and
  type size are read against hours of use, not a glance.
- **Keyboard-complete operation** — a clerk reconciling hundreds of rows should not need
  the mouse for filtering, paging, opening a record or dismissing a dialog. Radix
  primitives are chosen partly for this.
