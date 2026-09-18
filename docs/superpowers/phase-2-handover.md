# CEEDO Collections — Phase 2 Handover

**Branch:** `phase-2-ledger` · 36 commits · 484 tests / 38 files · 13 migrations (`0011`–`0025`)
**Spec:** `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md`
**Plan:** `docs/superpowers/plans/2026-09-18-phase-2-ledger.md`
**Predecessor:** `docs/superpowers/phase-1-handover.md`
**Execution ledger:** `.superpowers/sdd/2026-09-18-phase-2-ledger/progress.md` (27 rulings — the
reasoning behind everything below)

## What exists

**Ledger tables** (append-only, `row_version` on every row, no `UPDATE`/`DELETE` to any role):
`charges`, `collections`, `collection_allocations`, `collection_lines`,
`collection_cancellations`, `charge_condonations`.

**Supporting tables** (deliberately outside the append-only regime): `settings` — one row,
enforced by a unique index on `((true))`, holding `cutover_date`; `accrual_runs` — the job log.

**Functions.** `post_collection(jsonb)` — the settlement engine, §6.2 of the parent spec in one
transaction. `run_accrual(date)`, `run_surcharge(date, uuid)`, `run_nightly()` — the nightly
chain. `record_opening_balance()`, `condone_charge()`, `cancel_collection()` — the three
discretionary acts, each checking the caller's `app_users` role internally. Plus
`unpaid_period_groups(lease_id)` (the one definition of what a tenant owes, FIFO-ordered),
`charge_balances` inputs `business_date()`, `cutover_date()`, `lease_periods()`,
`rental_fee_type()`, `apply_ledger_policies()`.

**Views** (all `security_invoker = true`): `charge_balances` — the derived settled state, and
the only place it is defined; `lease_balances`, `aging_of_receivables`, `delinquency_list`,
`subsidiary_ledger`, `accrual_health`.

**Schedule.** `pg_cron` job `ceedo_nightly_accrual`, `0 18 * * *` — 18:00 UTC = 02:00 Manila —
calling `run_nightly()`, which runs the accrual and then surcharges only if the accrual
succeeded.

**Web.** `apps/web/app/(admin)/ledger/` — subsidiary ledger per lease, aging, delinquency,
collection browser with supervisor cancel, opening-balance entry, admin condonation. Read +
RPC, outside the Phase 1 registry engine. **No screen posts a payment**, by design (D7).

**`packages/shared`.** `charges.ts` (period generation, due dates, surcharge), `fifo.ts`
(ordering, prefix validation, amount-driven selection), `reason-codes.ts` (the ten
`REJECT_REASONS` the device will speak). Pure TypeScript. `parity.test.ts` runs the TS and the
SQL against shared fixtures and asserts they agree.

## Before go-live — things no test can enforce

1. **Enable `pg_cron` in the hosted Supabase dashboard** (Database → Extensions) *before*
   applying migration `0025`. The migration raises and refuses to apply if the extension is
   unavailable. That is deliberate: a silently unscheduled accrual produces no error and no
   log line, just charges that never appear, discovered a month later when arrears are wrong.
2. **Set the real `cutover_date`.** The seeded `2026-10-01` is a development fixture chosen so
   the test suite has a fixed date to work against. Accrual raises nothing before it, so a
   wrong cutover is either a month of missing charges or a month of duplicated ones against
   the opening balances.
3. **Record one opening balance per lease, from the reconciled paper ledger**, before the first
   nightly run. Use `record_opening_balance(lease_id, amount, oldest_unpaid_date, authority_ref)`.
   The date must be the **real oldest unpaid date from the paper record, not the cutover date.**
   That is what makes aging honest — two-year-old debt buckets as over-90, not as current — and
   it is what sorts the opening balance first in FIFO. Setting it to the cutover makes every
   tenant look current on day one and lets this month's rent be settled ahead of two years of
   arrears.
4. **Watch `accrual_health` every morning for the first week.** It reports the last 15 business
   dates. `failed` is a run that raised and logged; `missing` is a night that never ran at all.
   Both are alerts, and `missing` is the one nothing else will tell you about.

## Mandatory for Phase 3

### The settlement engine

- **`sync-push` calls `post_collection()`. Do not reimplement §6.2 of the parent spec.** The
  function is the reason Phase 2 built the ledger without a UI: idempotency, booklet
  authorization, server-side recompute, FIFO validation and invariant #9 are proven here so a
  settlement bug cannot be confused with a sync bug later.
- **Grant `EXECUTE` on `post_collection` to `ceedo_app` and revoke it from `service_role`.**
  Phase 2 granted it to `service_role` only so the integration tests could reach it through
  PostgREST. Once the sync path exists, no role outside it should be able to call the function.
- **`collections.id` has no default.** The client generates the UUID; that is what makes a retry
  idempotent. A server default would mint a second receipt on every retry.
- **`or_already_used` is not a retryable failure.** `post_collection` discriminates
  `unique_violation` by constraint name: a primary-key conflict means "same receipt, retried" and
  returns `duplicate`; a `collections_serial_spent_once` conflict means "two different devices
  recorded the same OR number" and returns `or_already_used`. The second is the case §6.3 says no
  device can detect on its own, and it **must** become a supervisor exception. Collapsing it into
  `duplicate` would make the device discard a real receipt for money that was actually collected.

### A charge row does not change when it is paid

There is no `status` column on `charges` and no `UPDATE` privilege on it for any role. Settled
state is derived in `charge_balances` from the allocations pointing at the charge and any
condonation against it.

**Sync pull must send *collections* on the `row_version` cursor and let the device recompute
outstanding locally** using the same `packages/shared` rules. The obvious implementation —
watching `charges` for changes — would compile, deploy, and silently never fire: paying a charge
bumps nothing on the charge row for a second tablet to observe. With shared devices and rotating
collectors, two tablets holding the same lease is routine, not an edge case.

### Invariant #9 fires only on `collections`

The deferred constraint trigger asserting `allocations + lines = gross_amount` fires on insert
into `collections`, **not** on inserts into `collection_allocations` or `collection_lines`. It
therefore checks the balance at commit for the parts present in *that* transaction.

**A collection's parent row and all of its parts must be written in one transaction, never
appended later.** Parts appended in a later transaction would be silently unchecked. This is safe
today only because no role holds `INSERT` on those tables and the sole writer is
`post_collection`. If a future design ever needs to append parts, extend the trigger to the child
tables first.

### The FIFO lock, and what happens without it

`post_collection` takes `select ... for update` on the charges in the FIFO prefix before
validating, and **re-reads after waking, comparing the charges it locked against the ones it
saw.** Both halves are load-bearing and both were demonstrated, not argued:

- **Without the lock:** two concurrent posts against the same lease both saw group rank 1 unpaid
  and both allocated to it. Result — two allocations totalling ₱100.00 against a ₱50.00 charge,
  `outstanding` at −₱50.00, `is_settled` reading `true`. Two OR numbers, two tenants' money, one
  period settled twice, and nothing in the schema prevents it: `unique (collection_id, charge_id)`
  stops one collection allocating twice to one charge, not two collections allocating to the same
  charge.
- **Without the re-read:** the loser blocks, wakes onto a changed world, and silently settles the
  *next* period instead of rejecting. Verified by mutation.

Phase 3 runs multiple shared tablets syncing concurrently. Do not remove either half. If row
locking proves too coarse under real sync load, the fallback is serializable isolation on that
one function — not dropping the lock.

### Two known gaps in that locking, for Phase 3 to close

- **A lost race returns `allocation_not_prefix`, which misleads.** The behaviour is correct —
  rejected, nothing written — but the name points at a data problem. The right device response to
  a lost race is **re-sync and retry automatically**, not raise a supervisor exception. Phase 3
  should add a distinct retryable reason code to `REJECT_REASONS` when it builds the outbox, and
  have `post_collection` return it on the re-read mismatch branch.
- **`condone_charge` takes no row lock.** A condonation committing concurrently can move
  `outstanding` under an in-flight `post_collection`, because `condone_charge` does not
  participate in the post's lock. Impact is bounded today — the post's re-read compares locked
  against seen charge ids, so it rejects rather than mis-settles — but the rejection is spurious.
  The safe fix is the same `select ... for update` on the charge before reading its balance.

### Inherited from Phase 1, still open

`ceedo_app` exists with **zero** table privileges and is not granted to `authenticator`. Wire it
before Edge Functions use it. It exists so they never use `service_role`, which bypasses RLS
across every schema on this shared instance.

## Known limitations and deferred items

### Performance — the one real early warning

`run_surcharge` scans `charge_balances` **system-wide**, with no lease filter. That is correct
for a nightly job — it must consider every unpaid rental charge — but its cost grows with total
ledger size, not with the night's activity.

Concrete evidence: a third consecutive test-suite run without `supabase db reset` accumulated
45,010 charges across 258 leases, and one surcharge test exceeded Vitest's 5-second default. The
parent spec §8.1 projects **~200,000 charge rows a year.** 45,000 was already enough on a
development machine.

The named upgrade path (design §9) is a **materialised `charge_balances` with a scheduled
refresh**, deliberately not built now. This is the first concrete signal of when it will be
needed. The accumulated rows cannot be cleaned up, because no role holds `DELETE` on a ledger
table — the append-only guarantee working as designed.

Secondary: the FIFO/prefix parity block builds eight separate lease and booklet fixtures
serially. Correct, but it is the slowest part of the suite.

### Coverage gaps — properties nothing currently pins

- The `anon reads nothing` ledger-privilege test is vacuous. `anon` is denied at schema-usage
  level by migration 0002, so it passes regardless of RLS and would pass on an empty table.
- `collections.id` having no default is not pinned by any test. A future migration adding one
  would be caught only by reading the SQL — and it would break idempotency.
- `cancel_collection`'s "no such collection" existence-check branch has no test.
- `aging_of_receivables`' own `bucket_1_30` / `bucket_31_60` seam is not pinned at exactly 30/31.
  The delinquency filter's boundary is.
- The "lease starting long before the cutover" case (e.g. lease 2024-01-01, cutover 2026-10-01)
  is pinned only by an arithmetically equivalent test where `leaseStart == cutover`, not by that
  literal input.
- Cutover-binding and lease-start-binding fixtures exercise daily and monthly, not weekly. Judged
  not a real hole — daily and weekly share the `start = max(leaseStart, cutover)` path and the
  branch that differs is monthly-only — so it is asymmetric naming rather than missing coverage.
- `selectByAmount` tests do not explicitly assert `applied + change === tendered` across all
  cases. The values are correct by inspection.
- No unit tests for `apps/web/lib/ledger/queries.ts` logic (the cancellation-reason merge,
  zero-value rendering). Worth a regression test now that Task 18's writes exercise cancellation.

### Structural and style

- The read-role list is hardcoded inside `apply_ledger_policies()` with no per-call override,
  matching `apply_master_data_policies()`. Five callers now depend on that list.
- `settings` has three `BEFORE UPDATE` triggers (`bump_row_version`, `touch_updated_at`, audit).
  Relative order is alphabetical-by-name in Postgres — an undocumented reliance. Very likely fine
  (audit fires `AFTER`), but it deserves a one-line comment.
- The two `settings` access-control tests fetch the id via `.select()` before filtering the
  `UPDATE`, coupling them to `settings_read` also permitting `accounting`. Intentional and
  documented.
- The cursor-advance `case` expression is duplicated between the skip branch and the loop end in
  `lease_periods()`.
- `role === "admin"` is inlined in five places (`actions.ts` ×2, `opening-balances/page.tsx`,
  `leases/[id]/page.tsx`). `roles.ts` already has `canManageMasterData` with identical semantics;
  a two-line `isAdmin(role)` helper mirroring the DB's own `is_admin()` is the cleaner fix.
- `rpcFailure()` passes `error.message` through with no sanitising fallback. Verified safe for
  today's three RPCs — every exception path in all three is hand-authored with no raw table or
  constraint names. Latent risk only if a future RPC lets an unhandled Postgres error escape.

### Development environment

- `pnpm test:watch` is bare `vitest` with no `--no-file-parallelism`, so it still races the
  `settings` singleton against the DB suite locally. Not invoked by CI. Latent footgun.
- A rare `Test timed out in 5000ms` appeared in `devices.test.ts` in 1 of 4 root runs — GoTrue
  signup latency against Vitest's 5s default, **not** a settings collision (zero
  `settings_singleton` errors in that run). Pre-existing and unrelated to the ledger. A longer
  timeout on the auth-dependent tests is the likely fix if it recurs in CI.
- `MKT_WEEKLY` is seeded at ₱800.00/week — an interpolation between the existing daily ₱120.00×7
  and monthly ₱3,000/4.3. `seed.sql` is headed "Local development seed. Never applied to
  production," so this figure never reaches CEEDO. Real rates come from the ordinance at go-live.

## Corrections to inherited documentation

Phase 1's spec, plan and handover — and three code files — justify integer basis points by
claiming `0.03 * 8350` evaluates to `250.49999999999997` in IEEE 754.

**That is false.** `0.03 * 8350` is exactly `250.5` in JavaScript. Verified in Node during Task
16, confirmed independently.

The **conclusion stands** — integer basis points are correct — but the mechanism is rounding
**direction**, not representation error. `Math.floor(250.5)` is `250` where half-up gives `251`;
a float pipeline that floors loses the centavo on every exact half. The integer form,
`floor((amount * bps + 5000) / 10000)`, carries half-up in the `+5000` and cannot drift.

Genuine representation error does exist, and `money.ts` cites a real instance correctly elsewhere
(`1.005 * 100` is `100.49999999999999`), which is why `roundHalfUp` normalises through
`toFixed(9)`. The surcharge example was simply the wrong illustration.

Already corrected: the Phase 2 design doc §8a, and `tests/db/parity.test.ts`.

Needing a one-pass correction — comments only, no arithmetic changes:

| File | Line |
| --- | --- |
| `packages/shared/src/money.ts` | 46 |
| `packages/shared/src/money.test.ts` | 51 |
| `packages/shared/src/charges.test.ts` | 275 |
| `supabase/migrations/20260917000005_rates.sql` | 12 |
| `supabase/migrations/20260918000021_surcharge.sql` | 32 |
| `tests/db/surcharge.test.ts` | 84 |
| `docs/superpowers/phase-1-handover.md` | 43 |
| `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md` | 118 |
| `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md` | 499 (§8's bullet, not §8a) |
| `docs/superpowers/plans/2026-09-17-phase-1-foundation.md` | 322, 429, 1999 |
| `docs/superpowers/plans/2026-09-18-phase-2-ledger.md` | 909, 2768, 2846, 2989 |

The two plan files are historical execution records; correcting them is optional. The other nine
are live and should be fixed together.

## Operational notes

**Numeric crosses the wire differently by path, and both were verified live.**

```
PostgREST      GET /rest/v1/charges?select=amount   ->  [{"amount":50.00}]   JSON number
node-postgres  select amount from charges           ->  "50.00"              string
```

PostgREST serialising `numeric` as a JSON number means money reaches the web as an **IEEE-754
double** before `fromPesos` converts it to `Centavos` — the very representation this system's
integer-centavo discipline exists to avoid. At CEEDO's magnitudes (`numeric(14,2)`, stall rents
in the thousands) the round-trip is exact and `fromPesos`'s half-up normalisation recovers the
centavo regardless, so this is a known property rather than a defect. `fromPesos(Number(value ?? 0))`
is correct for both paths. PostgREST **can** be configured to emit numerics as strings if a later
phase wants the stronger guarantee.

**The suite must run with file parallelism off.** The root script is
`vitest run --no-file-parallelism`. Every test file shares one database and one single-row
`settings` table; parallel files race to write the cutover date and collide on
`settings_singleton`. Note `fileParallelism` is a **root-level** Vitest option — setting it in
`tests/vitest.config.ts` (a project config under `vitest.workspace.ts`) is silently ignored by the
root runner, which is how CI ran unprotected for most of this phase while every filtered local run
looked green.

**Run `supabase db reset` before the suite.** Two consecutive runs without a reset now pass; a
third times out, because the ledger is append-only and no role holds `DELETE`, so charges
accumulate across runs until `run_surcharge`'s system-wide scan exceeds the 5s default. CI does
`supabase db reset && pnpm test`; do the same locally.

## One open question for the client — please resolve before go-live

**A monthly lease starting mid-month is not billed for that month.** A lease starting 15 October
is first charged for November.

This was a ruling made during execution, on two grounds:

1. **Internal consistency.** The code already refused a partial *trailing* period — a lease
   ending mid-month is not billed for that month — so billing a partial *leading* one was
   inconsistent. The head was made symmetric with the tail. That inconsistency was the defect; no
   new policy was invented.
2. **Asymmetry of harm.** Overcharging is the worse failure: FIFO forces the tenant to settle the
   spurious charge *before* their genuine arrears, and undoing it needs an admin condonation
   against an ordinance reference. Undercharging is recovered with a `source = 'manual'` charge,
   which the schema already supports.

**This was not decided from CEEDO's ordinance.** Nothing in the spec, the schema or the seed
speaks to it.

If the ordinance charges a full month for partial occupancy, the fix is **one line** in
`ceedo_collections.lease_periods()` and its TypeScript twin `generatePeriods()` — relax the head
guard so `period_start` may precede `greatest(lease_start, cutover)` — plus `source = 'manual'`
charges for the months missed in the interim. `tests/db/parity.test.ts` pins both implementations
together, so they cannot be changed apart without a failure.

## Previously parked, now fixed

| # | Was | Now |
| --- | --- | --- |
| P1 | `pnpm --filter tests test` and `pnpm --filter @ceedo/shared test` exited **0 having run zero tests** — neither package.json defined a `test` script. Any task could have claimed green having executed nothing. | Both packages define `"test": "vitest run"`. |
| P2 | Root `pnpm test` — the exact command CI runs — had **never been green this phase**. 7 files / 8 tests failed on `settings_singleton` collisions, because `fileParallelism: false` sat in a project config the root runner ignores. Every green result came from the filtered command. | Root script is `vitest run --no-file-parallelism`; verified green as the CI command itself. |
| P3 | `db.types.ts` predated **every** Phase 2 migration; CI's `check-types-current.sh` was failing on a second independent count, and a documented `as unknown as` cast existed only to bridge the missing view types. | Regenerated, 914 → 1577 lines. `check-types-current.sh` passes. The Phase 2 cast is deleted; only Phase 1's two pre-existing ones remain. |
| P4 | `surcharge.test.ts` set `cutover_date = 2027-01-01` and never restored it, so a second suite run without a DB reset failed in `accrual.test.ts` and `collections.test.ts` — far from the cause. | `resetCutover(db)` helper, called in `afterAll` of all six files that touch `settings`; the `delete`-then-`insert` pairs converted to an idempotent upsert. Suite run twice consecutively, green both times. |
| P5 | `delinquency_list`'s own `security_invoker` flag was unfalsifiable behaviourally — its `FROM` clause is two other invoker views, so removing the flag failed zero tests while the view joins `tenants` directly for `address` and `contact_no`. | A structural test asserts `'security_invoker=true' = any(reloptions)` from `pg_class` for all four views, kept *alongside* the behavioural outsider tests. Mutation: resetting the flag fails exactly that one test while all four behavioural tests still pass. |
| P6 | `pnpm typecheck` had been red on this branch for several tasks, and `>>> FULL TURBO / 4 cached` was being accepted as evidence that the tree typechecks. | Fixed at source (`rateAmount?: number \| string`); every typecheck verification now uses `pnpm typecheck --force`. |

**Note for whoever writes Phase 3's tests:** five classes of vacuous test were found in this
phase's own plan — tests that passed whether or not the thing they named worked. The technique
that caught them was mutation: break the mechanism, run the unmodified test, and see whether it
fails. When a mutation produces *fewer* failures than expected, suspect the tests before
suspecting the mutation.
