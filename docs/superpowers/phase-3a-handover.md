# CEEDO Collections — Phase 3a Handover

**Branch:** `phase-3a-sync` · 44 commits · 669 tests / 57 files · 13 migrations (`0026`–`0038`)
**Spec:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md`
**Plan:** `docs/superpowers/plans/2026-09-18-phase-3a-sync.md`
**Predecessor:** `docs/superpowers/phase-2-handover.md`
**Execution ledger:** `.superpowers/sdd/2026-09-18-phase-3a-sync/progress.md`, and the 18
per-task reports beside it — the reasoning behind everything below.

## What exists

**New tables** (three, not the four this phase's own brief claimed at the outset — verified
by grepping `create table` across migrations `0026`–`0038`; `spoiled_forms`, the fourth
candidate, was created in Phase 1's migration `0006` and is only referenced here):
`device_credentials`, `shifts`, `sync_exceptions`.

**Functions genuinely new to Phase 3a:** `authenticate_device`, `issue_device_credential`,
`revoke_device_credential` (`0026`); `set_collector_pin` (`0027`); `bump_assignment_epoch`
(`0031`); `sync_pull` (`0033`, corrected in `0037`); `close_shift` (`0034`); `open_shift`,
`record_spoiled_form`, `sync_push` (`0035`); `assert_can_resolve_exceptions`,
`resolve_exception_corrected`, `resolve_exception_spoiled`, `escalate_exception` (`0036`).
Two Phase 2 functions were modified in place rather than replaced: `post_collection` gained
the `stale_allocations` branch (`0032`) and `assert_collection_balances` gained `security
definer` (`0038`, see below). `has_role`/`is_admin` got a null-safety fix (`0028`).

**The precise, load-bearing count:** `ceedo_app` — the role every real device reaches
through `authenticator` — holds `EXECUTE` on exactly **four** functions:
`authenticate_device`, `sync_pull`, `sync_push`, `close_shift`. `post_collection` is granted
to none; `sync_push` reaches it only because `sync_push` is itself `SECURITY DEFINER`. This
four-function list is pinned by `tests/db/sync-privileges.test.ts`.

**Three Edge Functions** (`supabase/functions/`), each a thin Deno handler that authenticates
the device credential, then calls exactly one SQL function and returns its JSON verbatim:
`sync-pull`, `sync-push`, `closeout`. `supabase/functions/_shared/auth.ts` mints a
short-lived `ceedo_app`-role JWT per invocation (D1) — Edge Functions never hold or use
`service_role`.

**Two web screens**, both under `apps/web/app/(admin)/ledger/`: `exceptions/` — the
supervisor's queue, gated by `canResolveExceptions`, with three dialogs (correct, mark
spoiled, escalate) each requiring a written reason; `shifts/` — read-only shift
verification, no action, open to every role that already cleared `canUseWeb()` (remittance
is Phase 6).

**`packages/shared` additions.** `sync-contract.ts` — the wire contract, `zod`-validated
identically on both ends; `PUSH_REASONS` extends Phase 2's `REJECT_REASONS` with
`collector_not_on_device`, `unknown_entry_type`, `server_error` (the three `sync_push`
raises itself, before or instead of calling `post_collection`), deliberately kept as a
separate superset so `reason-codes.ts`'s own doc comment — "the vocabulary
`post_collection()` answers with" — stays true. `shifts.ts` — `reconciles()` and
`shiftVariance()`, the two closeout comparisons kept structurally apart (§6.5): one blocks,
one never does, and `reconciles()`'s signature has no parameter that could let a cash
shortfall block a close even by mistake.

## Deliverable 1 — the round trip, over HTTP, verified

`tests/http/round-trip.test.ts` exercises design §1's exit criterion literally: a device
authenticates, pulls, opens a shift, pushes a batch of one good receipt / one permanently
rejectable receipt / one spoiled form, sees the rejection land in `sync_exceptions`, retries
idempotently, pulls the delta, and closes a shift that first mismatches and then closes with
a recorded (non-blocking) variance — entirely through `callFunction()`, i.e. real HTTP
through Kong into the deployed Edge Functions, never a direct SQL call for the sync steps
themselves. The brief's test, as written, matched the current schema exactly — no fix
needed. `pnpm --filter @ceedo/tests exec vitest run http/round-trip.test.ts`: **1 file, 1
test, PASS, 602ms** against a freshly reset database with `sync-pull` confirmed live first
(its body — `{"error":"unauthorized"}` — is our handler's, not Kong's
`UNAUTHORIZED_NO_AUTH_HEADER`, which is what proves the function is deployed and executing).

## Before go-live — things no test can enforce

1. **Set `CEEDO_JWT_SECRET` as a hosted Supabase Edge Function secret.** Every Edge Function
   mints a `ceedo_app`-role JWT signed with this value (`supabase/functions/_shared/auth.ts`);
   locally it comes from `supabase/functions/.env`, which is not deployed. Without it, every
   Edge Function throws on its first call.
2. **Issue a real device credential per tablet, and record where each secret went.**
   `issue_device_credential()` (migration `0026`) returns the plaintext secret exactly once;
   it is stored server-side only as a SHA-256 hash (D3). There is no recovery path for a
   secret nobody wrote down — only re-issue, which invalidates the old one.
3. **Set every collector's PIN** via `set_collector_pin()` before their first shift. A
   collector with no `pin_hash` cannot sign in offline; there is no default.
4. **Confirm `grant ceedo_app to authenticator` (migration `0026`, line 166) took effect in
   the hosted database.** This is the single grant that makes the device path exist at all —
   without it, `authenticator` cannot assume `ceedo_app`, and every Edge Function call fails
   at the role switch, not at any check this repo's test suite can see (see the next
   section for exactly why).

## Two production-blocking bugs a green 669-test suite could not see

Both share one root cause: `tests/helpers/supabase.ts` connects every SQL test as the
`postgres` superuser (`POSTGRES_URL`). Every real caller — every Edge Function, every
device — arrives as `ceedo_app`, reached by `authenticator` doing `SET ROLE ceedo_app` per
request. Postgres exempts superusers from restrictions that bind every other role, so a
superuser connection can silently pass through a path a real caller cannot.

1. **`sync_pull`'s scope-table clear.** Migration `20260918000033` wrote
   `delete from _scope_leases;` — no `WHERE` clause. This local Postgres image enforces a
   guard that rejects an unqualified `DELETE`/`UPDATE` for any non-superuser role. As
   `postgres`: `DELETE 0`, silently fine. As `ceedo_app`, reached the way every real device
   reaches it: `ERROR: DELETE requires a WHERE clause`. Every one of the 641 tests that
   existed before this was found connected as `postgres` and never exercised the real role
   path, so none of them could see it — **Task 12's Edge Function smoke test is what first
   drove a call down the real role path and surfaced it.** Fixed in migration `0037` by
   switching to `truncate`, which needs no `WHERE` and is the more idiomatic form for
   unconditionally emptying a table `ceedo_app` created moments earlier in the same
   function (so it holds `TRUNCATE` on it regardless of holding nothing on any permanent
   table).
2. **`assert_collection_balances()`'s deferred-trigger privilege gap.** The
   `collections_balance` constraint trigger (migration `0017`) is
   `deferrable initially deferred` — it fires at **COMMIT**, after `sync_push()`'s
   `SECURITY DEFINER` elevation has already ended for every real caller. The trigger
   function itself was plain `SECURITY INVOKER` and read straight from `collections`,
   `collection_allocations`, `collection_lines` — tables `ceedo_app` holds **no** privilege
   on by design. As `postgres`: commits cleanly. As `ceedo_app`, the way every real device
   commits: `ERROR: permission denied for table collections`. **Every real collection push
   would have died at commit.** Nothing before Task 13's HTTP suite ever posted a collection
   through the deployed `sync-push` Edge Function — the one path that authenticates as
   `ceedo_app` and genuinely commits as that role — so this was invisible to all 642 prior
   tests too. Fixed in migration `0038` by making the trigger function `SECURITY DEFINER`
   as well; a definer function's elevation is resolved when *it* runs, not when its caller
   was invoked, so a deferred trigger still runs with the definer's privileges no matter how
   much later it fires.

**Migration `0038`'s fix lives in commit `7d24f6c`**, whose subject is
`test(sync): HTTP tests over the real Edge Functions, wired into CI` — a `test:`-prefixed
commit. `git log --oneline -- supabase/migrations/` does not advertise a schema change at
that commit; anyone scanning that log for schema history alone will miss it.

**The class of gap remains open.** Exactly one test in this repo runs as the role production
actually uses: `tests/db/sync-pull.test.ts`'s `"succeeds over the real ceedo_app role-switch
path, not just as the postgres superuser \`db\` uses"`, added alongside the fix for bug 1,
which does `conn.query("set role ceedo_app")` on its own connection. Every other one of the
669 tests — including every other assertion in that same file — still connects as
`postgres`. Two bugs of this exact class were found this phase, both only by accident of a
task that happened to route through HTTP. **Nothing proves there is not a third.** The
generalizable fix — running the whole suite, or at minimum every write path, under a
`ceedo_app`-scoped connection — was not attempted this phase; it is the single highest-value
piece of test-infrastructure work available to Phase 3b.

## Mandatory for Phase 3b

- **The device holds its credential in Android Keystore-backed storage, never plain
  `AsyncStorage`.** The credential is long-lived (D2) and its secret is checked only by
  hash server-side (D3) — a leaked plaintext secret is a standing liability with no
  expiry to bound it, and `AsyncStorage` is unencrypted application-readable disk.
- **The outbox survives a change of collector, and signing out clears a session, never
  data** (§6.4). Outbox entries carry `collector_id` and sync pushes every pending entry
  regardless of who is currently signed in — a shared tablet's second collector must never
  see the first collector's unsynced receipts silently disappear or get re-attributed.
- **`stale_allocations` is the one retryable reason** (`PUSH_REASONS`/`REJECT_REASONS`,
  `packages/shared/src/reason-codes.ts`; `sync_push`'s `v_retryable` check, migration
  `0035`). It is retried automatically — the device re-pulls and re-pushes on its own, no
  supervisor involved, per D6. Every other rejection reason is shown to the collector and
  kept in the outbox as unresolved until a supervisor acts on it in `sync_exceptions`.
- **The device enforces one open shift locally**, because §6.5 says it must work offline —
  a new collector cannot sign in while the previous shift is open, `closed_unsynced` if
  there is no signal at that moment. The server-side guarantee behind this is
  `shifts_one_open_per_device`, a partial unique index (migration `0029`) scoped to
  simultaneously-open shifts on one device — it is what makes the device-side rule an
  actual guarantee rather than a UI convention a bug could silently violate.

## Known limitations

### Two accumulation ceilings, with measured numbers (Task 17)

| | Fresh reset | Second run, no reset | Delta |
| --- | --- | --- | --- |
| Full suite (57 files / 669 tests) | 41.30s (Vitest) / 41.855s wall | 54.89s (Vitest) / 55.441s wall | +32.9% / +32.5% |
| `db/accrual-schedule.test.ts` (4 `run_nightly` tests) | 159ms | 4962ms | ~31x |
| Worst individual `run_nightly` test | — | 1668ms | under Vitest's 5s default `testTimeout` |
| `ceedo_collections.charges` row count | 0 (fresh) | **178,167** | — |
| `ceedo_collections.app_users` row count | 0 (fresh) | **558** (~279/run) | — |

**`run_surcharge`'s unbounded system-wide scan** (design §9's named early warning, unchanged
since Phase 2) is the visible cost driver — `run_nightly`'s four tests alone went 31x slower
after one extra unreset run, purely from `run_surcharge` re-scanning a `charges` table grown
to 178,167 rows. It did **not** cross the 5s per-test timeout in this run (worst individual
test: 1668ms), but the growth curve makes clear a few more unreset runs would.

**`app_users` will break `membership-gate.test.ts` on a fourth consecutive unreset run.**
558 rows after two runs (~279/run) extrapolates to ~1,096–1,112 rows after a fourth —
crossing PostgREST's 1000-row default page size. Not exercised directly (only two runs were
run), but the trajectory matches the projection. `supabase db reset` before the suite, every
time, is the standing rule this reaffirms (Phase 2's handover already said as much for the
ledger tables; this extends it to `app_users`).

**On Phase 2's cited 45,000-charge figure: do not chain the two.** Phase 2 recorded
~45,010 charges blowing a 5-second timeout on a *third* consecutive unreset run, without
naming which test timed out, and its own handover separately documents an unrelated
auth-latency timeout confound in the same suite. This phase measured 178,167 charges — nearly
4x that count — with a worst individual test of 1668ms, well inside the timeout. `run_surcharge`,
`charge_balances`, and every index touching either are byte-identical to Phase 2's. Nothing
explains why 4x the rows would run faster, so the right conclusion is that these two figures
were produced under different, unreproduced conditions and **neither reproduces nor
contradicts the other.** State both as measured, not as one data point on a trend line. The
mechanism — an unbounded system-wide scan on every accrual/surcharge run — is unchanged and
is still exactly what design §9 says to fix with a materialised `charge_balances`.

### First-sync payload — a lower bound, and the gap in what it measures (Task 16)

**~634 KiB** (634.4 KiB on the final measured run; 633.6–639.8 KiB run to run, from
UUID/timestamp text-encoding variance) for one lease, 1,461 unpaid charge rows, and **zero**
collections or allocations — against an 8 MiB alarm threshold from design §9. This is
comfortably under the alarm (>12x), but it is a **lower bound that does not exercise §9's
actual concern**: design §9 specifically flags that `collections` are now part of the pull,
and this fixture posts none. A fully-paid, long-delinquent stall — the case that would
actually stress this — could plausibly triple the row count once its allocation and
collection history is included (those rows are wider than charge rows), landing somewhere
in the 1.5–3 MB range. Still under the alarm on that estimate, but genuinely unmeasured.

### Coverage gaps — properties nothing currently pins

- **`resolve_exception_corrected`'s "rejected again" branch writes no `audit_log` row.**
  Migration `0036`: when a supervisor's correction is itself rejected by `post_collection`
  (e.g. still not a valid FIFO prefix), the function updates the exception's `reason_code`
  and `last_seen_at` but takes the `else` branch, which has no `insert into audit_log`.
  Every other resolution path (`resolved`/`corrected`, `resolved`/`spoiled`, `escalated`)
  writes one. Verified directly by reading the function and confirming
  `tests/db/resolve-exception.test.ts` has no test that drives a correction into the
  rejected-again branch and checks `audit_log` afterward — the one committed audit-row test
  (`"writes an audit row"`) only exercises the accepted path. Not closed this task; a
  one-line addition (`insert into audit_log ...` in the `else` branch) plus a test that
  submits a correction guaranteed to fail FIFO validation would close it.
- **Nine tests this phase passed whether or not the thing they named worked, found only by
  mutation.** The two most instructive, both fixed once found:
  - `sync_push`'s per-entry isolation test (Task 9) originally used `or_no: 999999` as its
    "poison" entry — but `post_collection`'s `or_out_of_range` check is a graceful `return`,
    never a raised exception, so there was nothing for `sync_push`'s
    `begin ... exception` block to catch. Removing the whole subtransaction block changed
    **zero** observable behaviour for that payload; invariant 22 (isolation) was verified by
    nothing. Fixed by changing the poison entry to `booklet_id: "not-a-uuid"`, which fails
    the function's own `::uuid` cast and genuinely raises — confirmed directly against
    `psql` before trusting it, then reconfirmed the mutation now fails the test as expected.
  - `sync-concurrency.test.ts`'s "never double-settles a period under concurrency" (Task 16)
    asserted only `outstanding >= 0` for the lease's charges — true unconditionally, with
    zero collections ever posted in that fixture (`amount > 0` is a CHECK constraint;
    `allocated` starts at 0). It would have passed against `post_collection` with its STEP
    4b row lock removed, or against no `post_collection` at all. Fixed by staging the actual
    two-device race and asserting the real consequence: every `outstanding` stays `>= 0`
    *and* exactly one `collection_allocations` row exists against the contested charge —
    verified falsifiable by hand-injecting Phase 2's exact recorded damage shape (a second
    allocation against the same charge from a different collection) and confirming the
    count assertion then reads `2`, not `1`.

  **The shared shape, and the one lesson worth carrying forward whole:** a test that
  *errors* gets attention immediately — someone reads the stack trace. A test that *passes
  vacuously* gets a green tick and is never looked at again. Mutation is the only technique
  used this phase that reliably tells the two apart; a green suite alone cannot.
- **`tests/http/functions.test.ts`'s "leaks no Postgres detail" test is weak in one specific,
  known, uncorrected way** (Task 13): it passes against *any* generic error body, including a
  bare, non-redacted 500 with no detail at all — it only fails if a real Postgres error
  detail actually leaks through. It is discriminating for the failure mode it was written
  for (a raw `sqlerrm` reaching the client) but not for "the error body is well-formed."
  Flagged, not fixed — narrowing it needs a positive assertion on the redacted shape, which
  this phase did not add.
- **`condone_charge` still takes no row lock** (Phase 2's handover named this as an open
  gap; Phase 3a did not touch it). Its impact is unchanged from Phase 2's own analysis:
  bounded by `post_collection`'s own re-read-and-compare, so it produces a spurious
  rejection under a concurrent condonation, never a mis-settlement.

## Deferred, with reasons

- **Closeout reconciles by `(collector_id, business_date)`, not by shift.** `close_shift`
  (migration `0034`) sums every collection for that pair, which is §6.5 step 3 taken
  literally but assumes one collector, one device, one shift per date. Two real cases break
  it: a collector working two tablets the same day, and a second shift opened on the same
  device later the same day (`shifts_one_open_per_device` only forbids *simultaneously* open
  shifts, and deliberately permits this). Both **fail safe** — the server's figures are a
  superset of what the closing device actually knows, so its count falls short, the mismatch
  branch returns before any write, and the shift stays open needing a supervisor; no other
  shift's money is ever silently absorbed. Device-id scoping was rejected (fixes the rarer
  case, leaves the likelier one looking fixed); time-window scoping was rejected as strictly
  worse (a collection queued before `shift_open` acks can carry `collected_at < opened_at`,
  and a window filter would drop it invisibly, trading a safe over-block for a silent
  under-count). The real fix is `shift_id` on `collections`, which needs a `post_collection`
  payload change and belongs in Phase 3b alongside the device-side closeout it depends on.
- **The sequence cursor can skip a row under a concurrent long-running writer.** `sync_pull`
  reads `last_value` from `row_version_seq` as its high-water mark. A transaction that
  reserved a lower `nextval()` but commits *after* that read produces a row the device will
  never see on a later delta, because its next cursor is already past it. Inherent to a
  bare-sequence cursor under read-committed isolation, not introduced by anything in this
  phase, and negligible at current write volume — but it is exactly why **D7's assignment
  epoch must keep working**: a full re-sync from cursor 0 is the only thing that recovers a
  skipped row, and nothing else in this design does.
- **The 20-bit PIN on a device that may be stolen.** A 6-digit PIN is ~10^6 combinations
  (~2^19.9). The PIN is deliberately *not* the security boundary — §11.5 makes the booklet
  the boundary, and a stolen device is answered by server-side deactivation
  (`revoke_device_credential`), not by PIN strength. Still worth naming as a limitation
  rather than an oversight: five-failed-attempt lockout is device-side and belongs to
  Phase 3b (deferred-items table).
- **bcrypt at cost 12 stands in for §11.5's specified argon2.** `set_collector_pin`
  (migration `0027`) uses `extensions.crypt(p_pin, extensions.gen_salt('bf', 12))` —
  Postgres's `pgcrypto` does not ship argon2, and bcrypt at a real cost factor was judged an
  acceptable stand-in for a 6-digit PIN's threat model. Revisit if `pgcrypto`'s argon2
  support becomes available, or move hashing out of Postgres.
- **A rejected correction attempt writes no `audit_log` row** — see Coverage gaps above;
  listed again here because it is a genuine design gap, not merely an untested branch.

## Corrections to inherited documentation

- **The basis-points rounding rationale** (Task 17). Phase 1's spec, plan and handover, and
  several Phase 2 code comments, justified integer basis points by claiming
  `0.03 * 8350` evaluates to `250.49999999999997` in IEEE 754. **That is false** —
  `0.03 * 8350` is exactly `250.5` in JavaScript, reverified directly with `node -e` this
  task (`250.5 250 100.49999999999999`, matching expectations exactly). The conclusion
  (integer basis points are correct) stands; the mechanism is rounding **direction**
  (`Math.floor` loses the centavo on an exact half where half-up gives one more), not
  representation error. Corrected in 9 live files this phase (`packages/shared/src/money.ts`
  and its test, `charges.test.ts`, two SQL migration comments, `surcharge.test.ts`, both
  handover-adjacent design docs, and `phase-1-handover.md` itself); the two historical plan
  files were left uncorrected on purpose (execution records of already-completed phases, not
  living documentation anyone still consults for the mechanism).
- **Migration `0002`'s comment predicting an Edge Function for `pin_hash`.** Corrected in
  Task 2 (and again referenced, correctly, by the Phase 3a design doc's D10): `pin_hash` is
  written by `set_collector_pin()`, a `SECURITY DEFINER` RPC, not an Edge Function. The
  plaintext PIN crosses the wire once over TLS and is never stored; the comment now says so.
- **Phase 2 handover's "five places" count for inlined `role === "admin"`.** Phase 2's own
  handover named this as four call sites (`actions.ts` ×2,
  `opening-balances/page.tsx`, `leases/[id]/page.tsx`) while claiming five — already wrong
  on arrival. Re-verified this task by grep across `apps/web/`:
  `role === "admin"` now returns **zero** matches anywhere in the web app. It was not
  Phase 3a's job to fix this and no Phase 3a task touched it deliberately — it appears to
  have been cleaned up incidentally somewhere in this phase's web work. Flagged so the count
  in this document is the one actually checked, not inherited a second time.

## Operational notes

**The env-export gotcha is real and was hit directly, not merely warned about (Task 17).**
`eval "$(supabase status -o env)"` in one Bash tool call followed by `pnpm test` in a
separate call reproduces exactly the documented failure — 43 files fail with "Supabase keys
are not set," 14 pass (the ones with no DB dependency) — because this harness resets shell
state between tool invocations and the exported variables never reach the child process.
`set -a && eval "$(supabase status -o env)" && set +a && pnpm test`, all in **one** Bash
call, is required every time.

**Run `supabase db reset` before the suite, every time**, exactly as Phase 2's handover
already said for the ledger tables — this phase extends the same warning to `app_users` (see
Known limitations above). Two consecutive unreset runs stayed green this phase; a third or
fourth was not tested here but is not expected to stay that way.

## One open question for the client — carried forward unresolved

**A monthly lease starting mid-month is not billed for that month.** Unchanged from Phase 2's
handover, which raised it as a ruling made during execution on internal-consistency and
asymmetry-of-harm grounds, explicitly **not** decided from CEEDO's ordinance. Nothing in
Phase 3a touches billing periods, so there is nothing new to add — this still needs CEEDO's
ordinance, not a decision from either phase's implementers. See Phase 2's handover for the
full reasoning and the one-line fix if the ordinance turns out to require full-month billing.

## Previously parked, now fixed

| # | Was | Now |
| --- | --- | --- |
| P1 | Phase 2's handover flagged `ceedo_app` as existing with zero table privileges and not granted to `authenticator` — wired before Edge Functions use it. | `grant ceedo_app to authenticator` (migration `0026`); `ceedo_app` holds `EXECUTE` on exactly four functions and no privilege on any table, pinned by `sync-privileges.test.ts`. |
| P2 | Phase 2's handover named a lost FIFO race returning the misleading `allocation_not_prefix`, and asked Phase 3 to add a distinct retryable reason code (D6 in the Phase 3a design doc responds to this directly). | `stale_allocations` (migration `0032`), the one reason `PUSH_REASONS` marks `retryable: true`; the device is expected to re-pull and re-push automatically, no supervisor exception filed. |
| P3 | Phase 2's handover flagged `role === "admin"` inlined in five (actually four) places in `apps/web`. | Zero occurrences remain, verified by grep this task. |

## Deferred to Phase 3b and beyond

Unchanged from this phase's own plan — named here once more so nothing is lost between
phases:

| Item | Where it lands |
| --- | --- |
| `apps/collector` — Expo, SQLite outbox, offline sign-in, collection flow | Phase 3b |
| Five-failed-attempt PIN lock | Phase 3b (device-side) |
| `closed_unsynced` written by a device with no signal | Phase 3b |
| `shift_id` on `collections`, so closeout can scope to one shift instead of collector+date | Phase 3b |
| `remittances`, shift → `remitted` | Phase 6 |
| Treasurer 3-day exception dashboard, monthly resolutions report | Phase 6 |
| Materialised `charge_balances` with scheduled refresh | When §9's alarm fires |
| QR cards, scan flow, amount-driven FIFO entry | Phase 4 |
| Parking, terminal, slaughterhouse rate classes | Phase 5 |
