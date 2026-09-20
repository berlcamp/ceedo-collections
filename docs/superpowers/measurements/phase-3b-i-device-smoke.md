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

## Two bugs the tablet found that no test had

Both surfaced from one enrollment attempt reporting *"Enrolled, but the first sync
failed... sync-push failed with 400"*. Neither was reachable from Node.

**1. One malformed outbox entry deadlocked the device permanently.** The engine probe (Task
10) left a `spoiled_form` entry in the real outbox whose payload cannot satisfy
`SpoiledFormPayload`. Task 5's contract validation then refused the whole push body with
`400 invalid_body`; the entries stayed `in_flight`, spec E11 re-pushed the same body next
sync, and the server refused it again — forever, with every later receipt stranded behind
it. Migration 0039's lesson arriving by a different road: the Edge Function validates the
body *before* Postgres, so `sync_push`'s per-entry isolation never runs. The device now
quarantines an entry that cannot satisfy the shared contract instead of retrying it, keeping
the row (§6.3) and pushing the rest of the round. Five tests in
`packages/sync-engine/src/quarantine.test.ts`.

**2. `openShift` defaulted its id to `crypto.randomUUID()`, which does not exist on
Hermes.** Not in React Native, not in Expo's winter runtime. It passed every Node test and
would have thrown the instant a collector tapped "Open a shift". The id is now required, so
the missing global is a type error at the call site rather than a crash in a market; the app
supplies it from `expo-crypto`.

Both are the same shape as the `postgres`-vs-`ceedo_app` gap this phase was built around: a
double that is exempt from what the real thing enforces. Worth noting neither would have
been caught by more Node tests — only by running it.

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

Run the whole of this section with the tablet in **airplane mode**. Sign-in is offline by
design: the collector list and the PIN hashes both arrive by pull and are verified locally.

| Check | Expected | Observed |
| --- | --- | --- |
| Sign in as a synced collector | reaches the shift screen | _not yet run_ |
| Time that verification | ~482 ms (Task 2a's figure), and under 2 s regardless | _not yet run_ |
| Fail the PIN four times | "2 attempts left…", then "1 attempt left…" | _not yet run_ |
| Fail it a fifth time | "Locked after five incorrect PINs." | _not yet run_ |
| Force-quit, reopen, try again | still locked — the counter is in SQLite, not memory | _not yet run_ |
| With a shift open, sign in as a SECOND collector | "Another collector's shift is still open…" | _not yet run_ |

The fifth row is the point of keeping `pin_attempts` in SQLite: a lock that resets when the
app restarts is not a lock, and force-quitting an app is not a skill a thief has to acquire.

If the verification time comes back in seconds rather than milliseconds, the native module
is not linked in this build — rebuild, do not work around it. `bcryptjs` under Hermes
measured 22,265 ms for the same call.

## Task 13 — the shift and closeout

| Check | Expected | Observed |
| --- | --- | --- |
| Open a shift, then sync | the `shift_open` entry pushes and the queue empties | _not yet run_ |
| Close out with the drawer matching | "Shift closed", variance ₱0.00 — balanced | _not yet run_ |
| Close out ₱50 short | still closes; variance ₱-50.00 — short | _not yet run_ |
| Close out in **airplane mode** | "Closed on this tablet", and the next collector can sign in | _not yet run_ |
| Leave airplane mode and sync | the queued `shift_close` settles | _not yet run_ |

Rows three and four are the two the whole design turns on. A short drawer must still close —
blocking would give a collector who is short a direct incentive to adjust the declaration
until it matched. And a closeout with no signal must let the collector go home, or "blocking
a collector over bad signal" (parent §3) arrives by a different road.
