# CEEDO Collections — Phase 3a Handover

**Branch:** `phase-3a-sync` · 682 tests / 58 files · 17 migrations (`0026`–`0042`)
**Spec:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md`
**Plan:** `docs/superpowers/plans/2026-09-18-phase-3a-sync.md`
**Predecessor:** `docs/superpowers/phase-2-handover.md`
**Execution ledger:** `.superpowers/sdd/2026-09-18-phase-3a-sync/progress.md`, and the 18
per-task reports beside it — the reasoning behind everything below.

## What exists

**New tables** (three, not the four this phase's own brief claimed at the outset — verified
by grepping `create table` across migrations `0026`–`0042`; `spoiled_forms`, the fourth
candidate, was created in Phase 1's migration `0006` and is only referenced here):
`device_credentials`, `shifts`, `sync_exceptions`. Plus one **new column on an existing
table**: `devices.assignment_epoch` (migration `0031`), bumped by trigger on every
`device_assignments` insert/update/delete. It is not a table, so it does not belong in the
count above, but it is load-bearing — it is the entire mechanism behind D7's forced re-sync
on reassignment (see Deferred, with reasons, below) and would otherwise disappear from this
inventory entirely.

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

1. **Set `CEEDO_JWT_SECRET` to the PROJECT'S OWN JWT SECRET, as a hosted Supabase Edge
   Function secret.** Every Edge Function mints a `ceedo_app`-role JWT signed with this value
   (`supabase/functions/_shared/auth.ts`); locally it comes from `supabase/functions/.env`,
   which is not deployed. Two distinct ways to get this wrong, and only the first is obvious:
   - **Unset** — every Edge Function throws on its first call (`ceedoAppClient()` refuses to
     build).
   - **Set to anything other than the project's JWT secret** — the Functions start cleanly
     and mint a perfectly well-formed token that **PostgREST rejects**, because it verifies
     the signature with the project secret. Every call then fails at the role switch, with
     nothing in this repo's test suite able to see it. Take the value from the project's API
     settings (locally: `supabase status -o env` → `JWT_SECRET`); it is not a value to
     invent.
   - **Also note `verify_jwt` is not set anywhere in `supabase/config.toml`, so it defaults
     to `true`.** The tablet must therefore send the project's anon/publishable key as the
     `apikey`/`Authorization` **gateway** credential on every call, or Kong answers 401
     before any Function runs — with its own body (`UNAUTHORIZED_NO_AUTH_HEADER`), not ours.
     The gateway credential and the `ceedo_app` JWT are two different headers doing two
     different jobs; see `tests/helpers/functions.ts`, which documents this because getting
     it wrong once made every 401 assertion in the suite vacuous.
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

## Two production-blocking bugs a large, fully green test suite could not see

Both were found with the suite fully green — 641 tests for the first, 652 for the second,
not the 682 this branch now carries — which is beside the point and stated only so the
figures below are honest about what was true at discovery. The actual cause is structural, not a matter of
scale: `tests/helpers/supabase.ts` connects every SQL test as `postgres` (`POSTGRES_URL`).
Every real caller — every Edge Function, every device — arrives as `ceedo_app`, reached by
`authenticator` doing `SET ROLE ceedo_app` per request. The two connections are exempt from
different things, so one can silently pass through a path the other cannot, no matter how
large or how green the suite around it grows.

**An earlier draft of this section said "Postgres exempts superusers from restrictions that
bind every other role". That is wrong, and it was the load-bearing explanation for
everything below, so it is corrected rather than quietly dropped.** `postgres` on this
instance is **not a superuser**: `select rolsuper, rolbypassrls from pg_roles where rolname
= 'postgres'` returns `f, t`. What actually exempts it is narrower and worth stating
exactly, because Phase 3b will build test infrastructure on it:

- **It owns every object in `ceedo_collections`.** An owner's privileges are not checked
  against an ACL at all, so no `GRANT`/`REVOKE` this repo writes can ever constrain it.
  That is what made bug 2 below — `permission denied for table collections` as `ceedo_app` —
  invisible to every test.
- **It carries `rolbypassrls`.** Row-level security is skipped outright, so no policy in
  this schema is ever evaluated on a test connection.
- **The unqualified-`DELETE` guard (bug 1) is a THIRD mechanism, and not a role property at
  all.** Determined by inspection: `select setconfig from pg_db_role_setting` shows
  `authenticator` — and only `authenticator` — carrying
  `session_preload_libraries = 'supautils, safeupdate'`. `safeupdate` (`pg_safeupdate`) is
  what raises `DELETE requires a WHERE clause`, and it is loaded **per session, for that one
  role**. A `postgres` session never loads the library, so for it the guard does not exist
  to be exempt from. Note what this means for a test that merely does `set role ceedo_app`
  on a `postgres` connection: it picks up the ACL and RLS behaviour of `ceedo_app` but NOT
  the preloaded library, so it would still not have caught bug 1. Only a connection made as
  `authenticator` does.

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
which does `conn.query("set role ceedo_app")` on its own connection. (That test's own title
carries the "superuser" error corrected above; the title is left as written so this
paragraph and the test are searchable as the same thing, but `postgres` is not a superuser.)
Every test in this repo but that one — including every other assertion in that same file —
still connects as `postgres`. Two bugs of this exact class were found this phase, both only
by accident of a task that happened to route through HTTP. **Nothing proves there is not a
third.**

**And `set role ceedo_app` is not the generalizable fix, which is the part of this that
Phase 3b most needs to get right.** Verified directly on this instance: on a `postgres`
connection, `set role ceedo_app` followed by an unqualified `DELETE` on a table `ceedo_app`
holds `DELETE` on returns `DELETE 1` — no guard, because `safeupdate` is preloaded per
SESSION for `authenticator`, and a `postgres` session never loads it (see the mechanism note
above). So `set role` reproduces `ceedo_app`'s ACL and RLS exposure but **not** its session
configuration, and would not have caught bug 1. The real fix is a test connection made **as
`authenticator`**, which then assumes `ceedo_app` — the same sequence PostgREST performs.
That is the single highest-value piece of test-infrastructure work available to Phase 3b,
and it is a different piece of work from the one an earlier draft of this paragraph
described.

## A third bug of the same family, plus three more, found by the final whole-branch review

All four were found with the suite green, after the two above were fixed. Migrations `0039`,
`0040` and `0041` are the repairs; every one carries a falsifying test, and each of those
tests was confirmed to fail against the unfixed code before being committed.

### Per-entry isolation was incomplete until migration `0039` (the serious one)

Migration `0035`'s header claims each entry runs in its own subtransaction so that "one
permanently-rejectable entry must cost its own receipt, never the round's". That was true of
**dispatch** and false of **exception filing**: the `begin ... exception when others` block
closed at line 96, and the filing block that follows it ran in the OUTER transaction. Three
inputs a device can actually send make that filing `INSERT` raise —

| input | what raises |
| --- | --- |
| `collector_id` naming a non-existent user | `sync_exceptions_collector_id_fkey` |
| `collector_id` absent or null | `collector_id` NOT NULL |
| `payload.id` not a valid UUID | the `nullif(...)::uuid` cast |

— and any of them aborted the whole `sync_push` call. Reproduced over real HTTP as
`ceedo_app` with a two-entry batch (one good receipt, one naming a non-existent collector):
**500 `{"error":"sync_failed"}`, and the good receipt never reached `collections`.** Both
entries lost, nothing filed, and §6.4 has the device re-pushing the identical batch forever:
a permanent sync deadlock with the cash already taken. That is exactly the discard failure
§6.3 exists to prevent, arriving by the road the phase claimed to have closed.

Fixed by giving the filing its own subtransaction, and by never letting a filing failure
lose the entry — a filing that raises still returns the entry as `rejected`, with the filing
failure appended to `detail`. Folded into the same migration: the `ON CONFLICT` clause gained
`where ... status <> 'resolved'`, so a device re-pushing a receipt a supervisor already
resolved as `spoiled` no longer overwrites that row's `reason_code` and bumps its `attempts`.

### One entry's exception was filed against the previous entry's collector (migration `0042`)

Found by the re-review, and **older than any of the above** — present since migration `0035`,
untouched by `0039`. `v_collector` is declared at FUNCTION scope, and PL/pgSQL variables are
not rolled back by a subtransaction; only database state is. So an entry whose
`collector_id` cast raised left the PREVIOUS entry's collector in scope, and the filing block
wrote that entry's exception against them:

```
entry 0: collector_id = a835224d...    -> rejected, collector_not_on_device
entry 1: collector_id = "not-a-uuid"   -> rejected, server_error

sync_exceptions:
  1111...  collector_id a835224d...  collector_not_on_device
  2222...  collector_id a835224d...  server_error     <-- entry 1, entry 0's collector
```

`sync_exceptions` is indexed and read **by collector**, and §11.3 counts an unresolved one
against that collector at closeout — so this attached a failed receipt to a person with
nothing to do with it, in the queue a supervisor uses to judge whether someone is short. And
it **succeeded**: the foreign key was satisfied, nothing raised, nothing was logged. A silent
wrong answer, which is why it was fixed rather than carried.

`v_collector := null;` at the top of the loop body — the stale-variable fault itself rather
than one symptom of it, so any future reader of `v_collector` after the dispatch block is
safe by construction. An entry whose `collector_id` cannot be parsed now files no exception
at all (correctly — there is no collector to file it against) and says so in `detail`. The
migration header records the check that no other variable in the function needs the same
treatment, `v_uuid` included.

### A shift could close with no cash declaration at all (migration `0040`)

`close_shift`'s `p_declared_total` was never NULL-checked, so an omitted field wrote the
shift `closed` with `declared_total = null` and `variance = null` — and the `already_closed`
idempotency guard then made that permanent. §6.5's "variance is recorded, not hidden" was
defeated not by a wrong number but by an absent one. Now refused outright, before anything is
written. (`p_device_count`/`p_device_total` needed no equivalent: `is distinct from` already
treats NULL as a mismatch and leaves the shift open.)

### The wire contract did not match what the server returns (`sync-contract.ts`)

`PushResult` is `.strict()`, and four real responses failed it: `gross_amount` (returned on
**every** accepted collection) and `shift_status` were absent from the schema, `closed` was
missing from the status enum, and `money` was a `string` regex while `jsonb_build_object`
emits `numeric` as a bare JSON **number**. A Phase 3b device validating its responses — the
entire point of shipping a contract — would have treated every settled receipt and every
completed closeout as a protocol error, and gone on re-pushing them. `sync-contract.test.ts`
could not catch this: it parses hand-written literals, which only ever prove the schema
agrees with whoever wrote them. `tests/http/functions.test.ts` now pipes real `sync-push`
responses through `PushResult.array().parse()`.

### Every sync request wrote an `audit_log` row (migration `0041`)

`authenticate_device` touches `devices.last_seen_at` on every success, and `devices` carried
the blanket AFTER INSERT/UPDATE/DELETE audit trigger `attach_audit()` puts on every
master-data table. Each Edge Function authenticates separately, so a device that pulls,
pushes and closes out wrote three full before/after row images recording no decision at all.
Thirty tablets over an eight-hour round would bury the accountability table under its own
heartbeat. The UPDATE side of the trigger is now scoped to the columns that carry a decision;
INSERT and DELETE are untouched, and deactivating a device (§4.1) still audits. The list is
every column **but** `last_seen_at` — read it that way and not as "the columns in migration
`0007`", which is how a first draft omitted `assignment_epoch` (added later, by `0031`) and
would have made it a second unaudited column by accident. **Not fixed:
the heartbeat still bumps `devices.row_version` from `row_version_seq`, because that BEFORE
trigger is schema-wide and `row_version` is what `sync_pull`'s cursor reads — changing it is
a cursor-semantics decision for Phase 3b, not an audit-noise fix.**

### And one weak test made real

`tests/http/functions.test.ts`'s `"leaks no Postgres detail"` (item 6 on the vacuous list
above, previously marked **still open**) sent `entries: "not-an-array"`, which `sync-push`
refuses at its own `Array.isArray` check — Postgres never ran, so there was never an error
string that could have leaked. It now drives a real Postgres failure (a `closeout` with a
malformed `shift_id`, which PostgREST answers with `invalid input syntax for type uuid`) and
asserts the body **deep-equals** `{"error":"closeout_failed"}` — not merely that it lacks
forbidden substrings, which a body with an appended `detail` would still satisfy. That list
item is now closed.

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
- **Build the SQL test harness on a connection made AS `authenticator`, not on
  `set role ceedo_app`.** This is the single most actionable sentence in this document, and
  it is easy to get wrong in a way that looks right. Three separate things exempt the
  current `postgres` test connection from what a real caller faces — object ownership,
  `rolbypassrls`, and the `pg_safeupdate` guard — and **`set role ceedo_app` reproduces only
  the first two**. `safeupdate` is preloaded per SESSION for `authenticator` alone
  (`pg_db_role_setting`), so a `postgres` session never loads it at all: verified directly on
  this instance, `set role ceedo_app` followed by an unqualified `DELETE` on a table
  `ceedo_app` holds `DELETE` on returns `DELETE 1`, no guard. A harness built on `set role`
  would still not have caught bug 1 below, while looking like it closed the class. Connect as
  `authenticator` and let it assume `ceedo_app` — the sequence PostgREST actually performs.
  Full reasoning in "Two production-blocking bugs a large, fully green test suite could not
  see".
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
| Full suite as measured in Task 17 (57 files / 669 tests) | 41.30s (Vitest) / 41.855s wall | 54.89s (Vitest) / 55.441s wall | +32.9% / +32.5% |
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
- **Eight tests this phase passed whether or not the thing they named worked, found only by
  mutation, enumerated here rather than merely counted — a tally that exists only in a
  since-deleted execution ledger is exactly the failure mode this section exists to
  prevent:**
  1. **Task 2** — `collector-pin.test.ts`: all 8 tests ran over the raw `pg` connection,
     where `is_admin()` reads NULL for the caller and the guard silently no-ops. **None of
     the 8 would have failed if the admin check were deleted outright.**
  2. **Task 7** — `sync_pull`'s collector-role-change test: the fixture deactivated the
     assignment *before* changing the role, so the join already excluded the row for an
     unrelated reason. Deleting `and u.role = 'collector'` from the query left all 13 tests
     in the file green.
  3. **Task 9** — `sync_push`'s per-entry isolation test used `or_no: 999999` as its
     "poison" entry — but `post_collection`'s `or_out_of_range` check is a graceful
     `return`, never a raised exception, so there was nothing for `sync_push`'s
     `begin ... exception` block to catch. Removing the whole subtransaction block changed
     **zero** observable behaviour for that payload; invariant 22 (isolation) was verified
     by nothing. Fixed by changing the poison entry to `booklet_id: "not-a-uuid"`, which
     fails the function's own `::uuid` cast and genuinely raises. **And that fix was only
     half of it.** The repaired test still exercised only the DISPATCH half of the loop
     body. Migration `0035`'s subtransaction closed *before* the exception-filing block, so
     filing ran in the outer transaction and any error it raised aborted the entire
     `sync_push` call — every entry in the batch, including accepted ones. Found by the
     final whole-branch review and fixed in migration `0039`; see "Per-entry isolation was
     incomplete until migration 0039" below for the full account. Until that migration,
     invariant 22 was **half** verified, and this handover's own claim that the round trip
     proved it was, to that extent, wrong.
  4. **Task 11** — the `PushResult` wire-contract schema used Zod's `.passthrough()`:
     deleting `retryable` from the schema entirely still let both `{retryable: true}` and a
     wrong-typed `{retryable: "yes"}` validate successfully.
  5. **Task 13** — `callFunction` originally omitted the gateway `apikey` header. Kong
     answers 401 for a missing `apikey` too, so every 401 assertion in the suite would have
     passed identically whether the Edge Functions worked, were broken, or were never
     deployed at all. **Caught and fixed before this ever shipped as a passing test** — the
     one entry on this list that never reached a green run.
  6. **Task 13** — `tests/http/functions.test.ts`'s `"leaks no Postgres detail"` test
     passes against *any* generic error body, including a bare 503 from a dead server — it
     only fails if a real Postgres error detail actually leaks through. Worse than that, as
     the final review found: its input (`entries: "not-an-array"`) stopped at `sync-push`'s
     own `Array.isArray` check and returned 400 without Postgres ever running, so there was
     no error string in existence for it to have caught. **Now closed** — it drives a real
     Postgres failure and deep-equals the redacted body; see the final-review section
     below.
  7. **Task 14** — `summarisePayload({})`: property access on an empty object never throws
     in JavaScript, so an unguarded implementation with no empty-payload handling at all
     passes the test identically to a correct one.
  8. **Task 16** — `sync-concurrency.test.ts`'s "never double-settles a period under
     concurrency" asserted only `outstanding >= 0` for the lease's charges, with zero
     collections ever posted in that fixture (`amount > 0` is a CHECK constraint;
     `allocated` starts at 0) — unconditionally true, a tautology. It would have passed
     against `post_collection` with its STEP 4b row lock removed, or against no
     `post_collection` at all. Fixed by staging the actual two-device race and asserting the
     real consequence: every `outstanding` stays `>= 0` *and* exactly one
     `collection_allocations` row exists against the contested charge — verified falsifiable
     by hand-injecting Phase 2's exact recorded damage shape (a second allocation against
     the same charge from a different collection) and confirming the count assertion then
     reads `2`, not `1`.

  **The shared shape, and the one lesson worth carrying forward whole:** a test that
  *errors* gets attention immediately — someone reads the stack trace. A test that *passes
  vacuously* gets a green tick and is never looked at again. Every one of the eight above
  had exactly that shape. Mutation is the only technique used this phase that reliably tells
  the two apart; a green suite alone cannot.

  **A distinct trap, worth one line separately rather than folded into the eight: Task 3's
  "denies DELETE to every role" test could never pass at all**, against any migration,
  correct or not. `has_table_privilege` reports the predefined role `pg_write_all_data` as
  holding DELETE on every relation in the cluster as a hardcoded ACL bypass — confirmed
  directly: a throwaway scratch table with zero grants ever applied to it already showed
  `pg_write_all_data` holding DELETE, and `revoke delete ... from pg_write_all_data` had no
  effect. This is the mirror image of the eight above, not a ninth instance of the same
  thing: an **unrunnable** test fails loudly and gets fixed immediately, which is exactly
  why it is not dangerous the way a vacuous pass is. Fixed by adding `pg_write_all_data` to
  the test's exclusion list, verified afterward to still catch a real stray grant.
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
| P1 | Phase 2's handover flagged `ceedo_app` as existing with zero table privileges and not granted to `authenticator` — wired before Edge Functions use it. | `grant ceedo_app to authenticator` (migration `0026`); `ceedo_app` holds `EXECUTE` on exactly four functions and no privilege on any table, view, materialized view, partitioned table or foreign table — **but it does hold `USAGE, SELECT` on two sequences**, `row_version_seq` and `audit_log_id_seq` (migration `0001`, deliberately). All of it pinned by `sync-privileges.test.ts`. |
| P2 | Phase 2's handover named a lost FIFO race returning the misleading `allocation_not_prefix`, and asked Phase 3 to add a distinct retryable reason code (D6 in the Phase 3a design doc responds to this directly). | `stale_allocations` (migration `0032`), the one reason `PUSH_REASONS` marks `retryable: true`; the device is expected to re-pull and re-push automatically, no supervisor exception filed. |
| P3 | Phase 2's handover flagged `role === "admin"` inlined in five (actually four) places in `apps/web`. | Zero occurrences remain, verified by grep this task. |

## Deferred to Phase 3b and beyond

Unchanged from this phase's own plan — named here once more so nothing is lost between
phases:

| Item | Where it lands |
| --- | --- |
| **Edge Functions validate nothing — `sync-contract.ts` is imported by no function** (see the note directly below this table) | Phase 3b |
| `apps/collector` — Expo, SQLite outbox, offline sign-in, collection flow | Phase 3b |
| Five-failed-attempt PIN lock | Phase 3b (device-side) |
| `closed_unsynced` written by a device with no signal | Phase 3b |
| `shift_id` on `collections`, so closeout can scope to one shift instead of collector+date | Phase 3b |
| `remittances`, shift → `remitted` | Phase 6 |
| Treasurer 3-day exception dashboard, monthly resolutions report | Phase 6 |
| Materialised `charge_balances` with scheduled refresh | When §9's alarm fires |
| QR cards, scan flow, amount-driven FIFO entry | Phase 4 |
| Parking, terminal, slaughterhouse rate classes | Phase 5 |

**The first row needs saying plainly, because it is the one deferral that sounds worse than
it is — and because the reason it is survivable is a fact about the SQL, not a reassurance.**
`packages/shared/src/sync-contract.ts` is imported by `packages/shared`, by
`apps/web`, and by this repo's tests. It is imported by **none of the three Edge Functions**
(`grep -rn "sync-contract" supabase/functions/` returns nothing). `sync-push` checks
`Array.isArray(body.entries)` and passes the array to Postgres as jsonb; `sync-pull` and
`closeout` forward their fields untouched. So the server today accepts arbitrary JSON, and
**the contract's two load-bearing refusals — `gross_amount` and `device_id` — are
client-side conventions, not server-enforced rules.**

What makes that a defence-in-depth gap rather than a money bug is that the SQL enforces both
independently, and neither enforcement reads the contract:

- **`gross_amount`**: `post_collection()` (migration `0022`, STEP 5) recomputes the amount
  from the rate table and writes what it computed. A client-supplied `gross_amount` is never
  read by any handler on any path — it is ignored, not trusted.
- **`device_id`**: `sync_push()` overrides it from the authenticated credential
  (`v_payload || jsonb_build_object('device_id', p_device_id)`, invariant 21), so a payload
  carrying one cannot take effect. `tests/http/functions.test.ts` proves this over the wire.

This is design D1 working as intended — thin Functions, SQL as the enforcement layer — and
the reason it was carried rather than fixed at the end of this phase is that adding a Deno
validation layer is new work with its own failure modes, not a repair. Phase 3b should add
it: a malformed payload should be refused at the edge with a 400 naming the field, rather
than reaching Postgres and coming back as a `server_error` rejection a supervisor has to
read a `detail` string to understand.
