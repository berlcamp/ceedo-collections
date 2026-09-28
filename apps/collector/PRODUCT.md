# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

The primary — and effectively only — user is a **municipal market collector** working a
round for a Philippine local government's CEEDO office.

The situation is specific and it governs everything: an Android tablet held **one-handed**,
in **daylight**, in a **public market**, with a **queue of vendors waiting** and a **paper
receipt booklet in the other hand**. Rounds begin around 05:00. There is **no printer**.

The job: find a tenant's lease, see what they owe oldest-first, take cash for whole billing
periods, **hand-write the figure from the screen onto a pre-printed paper Official Receipt**,
then type that receipt's serial number back into the tablet. Plus on-the-spot ambulant fees,
spoiling a mis-written form, and closing out the shift against declared cash.

Two secondary, low-frequency users touch the app in an office, not a market: an
administrator **enrolling a tablet** (scanning or typing a one-time credential), and a
collector **signing in** with a 6-digit PIN.

## Product Purpose

CEEDO Collections replaces a paper-and-ledger market collection process with a tablet that
works **fully offline** and reconciles later. It exists so that money taken in a market is
recorded once, attributed to the right tenant and the right billing period, and can be
proved against both the paper booklet and the cash in the drawer at the end of a shift.

Success is a shift that closes with the device's figures, the server's figures and the
physical cash all agreeing — and a collector who was never stranded mid-round by the app.

## Positioning

The app is **secondary to the paper receipt, not a replacement for it.** The tenant walks
away holding a hand-written pre-printed Official Receipt; the tablet's job is to validate a
serial against an assigned booklet and record what the paper already says. Every screen is
an aid to a paper transaction that legally happens without it.

Offline is the normal case, not a degraded one. Sign-in, lease lookup, outstanding balances,
rate lookup and receipt capture all work with no signal, because the market has none.

## Operating Context

- **Sequence, not a set of peers.** Navigation is enrol → sign in → open shift → collect →
  close out. A plain stack, no tabs.
- **Nine routes** in `apps/collector/src/app/`: `index`, `enroll`, `sign-in`, `shift`,
  `leases`, `lease/[leaseId]`, `receipt`, `ambulant`, `spoil`, `closeout`, plus two
  diagnostic probes (`bcrypt-probe`, `engine-probe`) that are instruments, not UI.
- **The paper booklet is a first-class object.** Serials are scoped to a booklet, ranges
  across form types may legally overlap, and skipped numbers are legitimate.
- **Closeout is adversarial by design.** The declared cash figure is typed, never
  prefilled, so a shortfall cannot vanish by accepting a default.
- Local data can be stale. Another tablet may have collected against the same lease since
  this one last pulled, and the device cannot detect it — so it must state how old its
  figures are rather than imply freshness.

## Capabilities and Constraints

- **Stack:** Expo SDK 57 / React Native 0.86 / expo-router, TypeScript. Styling is plain
  `StyleSheet` per file. `src/global.css` is unused Expo scaffold — there is no NativeWind
  and no CSS pipeline. Reanimated 4.5 and `react-native-safe-area-context` are available.
- **Portrait orientation**, locked in `app.json`.
- **Money is integer centavos.** Rendered only through `format()` from `@ceedo/shared`;
  the outbound wire form is `toDecimalString()`. Floats never touch a peso.
- **PIN verification must use the local native bcrypt module.** `bcryptjs` under Hermes
  takes ~22s against the native module's ~482ms.
- **`deviceDriver()`, never `expoSqliteDriver(openDeviceDb())` in a render body** — the
  unmemoized form returns a fresh object per render and makes effects re-fire forever.
- **Language: English only** (confirmed). No translation layer required.
- **One light theme only** (confirmed). Daylight legibility is the governing condition;
  no dark mode.
- The Android package id `ph.gov.ceedo.collector` is **not yet confirmed by the office**
  and cannot change after installation.

## Brand Commitments

None recorded. There is no supplied logo, wordmark, palette or typeface for the collector
app. The splash currently uses `#208AEF` and the Android adaptive icon `#E6F4FE`, both Expo
scaffold values rather than chosen brand colors.

"CEEDO" is the office name (City Economic Enterprise and Development Office) and appears
as the app title.

## Evidence on Hand

- `docs/superpowers/phase-3b-ii-handover.md` — the governing handover.
- `docs/superpowers/specs/2026-09-21-phase-3b-ii-collection-round-design.md` — the spec.
- `docs/superpowers/measurements/phase-3b-ii-device-smoke.md` — the device checklist,
  **rows still blank**.
- 819 tests across 76 files, passing.
- **No design artifacts exist**: no screenshots of the app in use, no photographs of the
  market, no tablet model recorded, no field observation notes. Future work must not
  invent these.
- **The app has never been in a collector's hands.** Every claim about it is from tests and
  review, not use.

## Product Principles

1. **Never name a cause the screen has not checked.** A confident wrong explanation is
   worse than an honest vague one. This is a rule with a bug behind it.
2. **No dead ends.** A disabled control states what is missing — all of it, not the first
   thing checked — and every failure offers the action that resolves it.
3. **The paper is the record; the screen serves the hand writing it.** The figure a
   collector copies onto an OR must be the most legible thing on the screen.
4. **Warn where the process legitimately varies; block only where a mistake is
   unrecoverable.** A warning that fires on correct behaviour gets ignored on the day it
   is right.
5. **State staleness rather than implying freshness.** The device cannot know what another
   tablet did; it can be honest about when it last looked.

## Accessibility & Inclusion

No formal standard was established for this product. Two product-specific needs are
confirmed by the operating context:

- **Sunlight-legible contrast** and **large money figures** — the collector reads a number
  off the screen and transcribes it by hand.
- **One-handed touch targets** on a tablet, with the other hand holding a receipt booklet.
