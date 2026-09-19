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

Run on the tablet, and **the engine passed on the real driver**:

| Line | Expected | Observed |
| --- | --- | --- |
| `apply 1500 rows` | `1500 present` | `1500 present` ✓ |
| `cursor` | `1500` | `1500` ✓ |
| `atomicity` | `cursor held at 1500` | `cursor held at 1500` ✓ |
| `outbox pushable` | `1` | line printed; count not transcribed |

**What this settles, and it is the whole point of the task.** `expo-sqlite` is asynchronous
and transacts through `withTransactionAsync`; `better-sqlite3` is synchronous and transacts
through hand-issued BEGIN/COMMIT. The three results above are the three places that
difference could have shown:

- **1,500 rows landed**, so the 50-row chunking clears this device's
  `SQLITE_MAX_VARIABLE_NUMBER` — an unchunked apply would have exceeded both the 999 and
  32766 ceilings.
- **The cursor advanced to 1500**, so apply and cursor commit together on the success path.
- **The cursor held at 1500 through a failing apply**, which is spec E7 on the driver that
  ships. This is the one that could not be inferred from Node: if `withTransactionAsync`
  had swallowed the throw, or committed what had already been written before it, the cursor
  would have moved to 9999 and every row in a failed batch would have been lost permanently
  on every future crash. It did not.

No `ATOMICITY FAILED`, no `THREW`. The Node driver is not exempt from anything `expo-sqlite`
enforces, at least along these three paths.

The fourth line printed but its count was not transcribed. It is the least load-bearing of
the four — the outbox is covered by 11 Node tests and the engine reached that line without
throwing, which is what proves `enqueue` and `pushable` run on this driver at all. Fill in
the number on the next run.

### What was verified without the tablet

- The Android bundle builds: `npx expo export --platform android` produces a Hermes bundle
  containing the probe screen and the 21 `CREATE TABLE` statements, so metro resolves the
  three workspace packages and `babel-plugin-inline-import` does inline the generated `.sql`.
- `disableHierarchicalLookup` had to come OUT of `metro.config.js`. Expo's monorepo guide
  offers it, but under pnpm's isolated layout it makes every transitive dependency
  unreachable — with it on, the export fails to resolve `@expo/metro-runtime` from
  expo-router's own entry file.

Neither of those was a substitute for the run above. A bundle that builds says nothing about
how `withTransactionAsync` behaves when an apply throws — which is exactly the question the
run answered.

---

## Task 11 — enrollment

Needs a native rebuild first: `expo-camera`, `expo-sqlite` and `expo-secure-store` are
native modules, and Fast Refresh does not reload them. Also needs
`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ANON_KEY` in the build's environment (see
`apps/collector/.env.example`); without them the screen says so plainly rather than failing
at the first sync.

| Check | Expected | Observed |
| --- | --- | --- |
| Scan the QR from the admin's Device credential screen | "Enrolled and synced. This tablet is ready." | _not yet run_ |
| Force-quit and reopen, then sync again | still enrolled — the Keystore kept it | _not yet run_ |
| Re-issue a credential, then TYPE both values | same success message | _not yet run_ |
| Type a secret with one character wrong | "That code did not scan cleanly…" immediately, no network call | _not yet run_ |

The second row is the one an emulator makes easy to skip and it is the point of using
`expo-secure-store` at all. The fourth is the reason the payload carries a checksum: without
it a mistyped secret fails at the first sync with `unauthorized`, which is
indistinguishable from a revoked credential or a server that is down.

## Task 12 — offline sign-in

_(added when Task 12 lands)_

## Task 13 — the shift and closeout

_(added when Task 13 lands)_
