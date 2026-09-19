# Phase 3b-i — device smoke checklist

Everything here can only be answered by the real tablet. Node tests run the engine against
`better-sqlite3`, which is synchronous, has different transaction semantics and a different
bound-parameter ceiling; that gap is the local form of Phase 3a's `postgres`-vs-`ceedo_app`
exemption, and nothing run on a laptop closes it.

**Device:** _(model — fill in)_
**Android version:** _(fill in)_
**Build:** `pnpm --filter @ceedo/collector exec expo run:android --device`

---

## Task 10 — the sync engine on `expo-sqlite`

Open the app, tap **The sync engine, on expo-sqlite**, then the button.

| Line | Expected | Observed |
| --- | --- | --- |
| `apply 1500 rows` | `1500 present` | _not yet run_ |
| `cursor` | `1500` | _not yet run_ |
| `atomicity` | `cursor held at 1500` | _not yet run_ |
| `outbox pushable` | `1` | _not yet run_ |

**A line reading `ATOMICITY FAILED` or `THREW` is a finding about the engine, not about the
probe.** It means the Node driver is exempt from something `expo-sqlite` enforces, which is
the entire reason this probe exists. Record it here and fix the engine.

### What was verified without the tablet

- The Android bundle builds: `npx expo export --platform android` produces a Hermes bundle
  containing the probe screen and the 21 `CREATE TABLE` statements, so metro resolves the
  three workspace packages and `babel-plugin-inline-import` does inline the generated `.sql`.
- `disableHierarchicalLookup` had to come OUT of `metro.config.js`. Expo's monorepo guide
  offers it, but under pnpm's isolated layout it makes every transitive dependency
  unreachable — with it on, the export fails to resolve `@expo/metro-runtime` from
  expo-router's own entry file.

Neither of those is a substitute for the run above. A bundle that builds says nothing about
how `withTransactionAsync` behaves when an apply throws.

---

## Task 11 — enrollment

_(added when Task 11 lands)_

## Task 12 — offline sign-in

_(added when Task 12 lands)_

## Task 13 — the shift and closeout

_(added when Task 13 lands)_
