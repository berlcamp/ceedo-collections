# CEEDO Collections — Phase 3b-ii Handover

**Merged to `main`** as `aba62d0 Merge Phase 3b-ii: the collection round` · 34 commits
**819 tests / 76 files** · no new migrations
**Spec:** `docs/superpowers/specs/2026-09-21-phase-3b-ii-collection-round-design.md`
**Plan:** `docs/superpowers/plans/2026-09-21-phase-3b-ii-collection-round.md`
**Predecessor:** `docs/superpowers/phase-3b-i-handover.md`
**Device smoke:** `docs/superpowers/measurements/phase-3b-ii-device-smoke.md` — **rows blank, not yet run**

Verified from a clean `supabase db reset`: 76 files, 819 tests, all passing, 75s.
`pnpm typecheck --force` clean across all seven packages (0 cached).

---

## The one thing to read first

**Task 12, the device session, has not run.** It is the plan's exit criterion — a real shift
on the physical tablet with real receipts, one of them taken in airplane mode, closing out
with the totals agreeing. Everything below was verified by tests, by reading, and by review.
None of it has been in a collector's hands.

Phase 3b-i's handover records four bugs the device found that no amount of Node testing
would have caught, and two of them were not wrong code at all — every unit test passed and
the system was unusable end to end. Expect the same here. The checklist is written and
waiting.

**Before that session: re-enrol the tablet.** The database was reset many times during this
phase, and a reset destroys the device row, its credential and its assignments.

---

## What exists

**No migrations.** Every server-side mechanism this phase needed already shipped in Phases 2
and 3a: `post_collection` (FIFO prefix validation, booklet authorization, server-side
amount recomputation, the `stale_allocations` race branch), `unpaid_period_groups`,
`charge_balances`, and `CollectionPayload`. This phase is almost entirely device-side.

**Three device-authored tables** — `local_collections`, `local_allocations`, `local_lines`
(migration `0001_true_bedlam.sql`, generated and committed to both
`packages/db-local/drizzle/` and the app's bundled copy). They are device-authored and not
pulled, because `collections` is in `PULLED_TABLES` and an epoch reset empties those: a
receipt taken offline whose only local record lived there would be destroyed by a supervisor
changing a device assignment, silently, since the outbox entry carries no amount to notice
its absence by.

**`packages/shared/src/outstanding.ts`** — a pure TypeScript mirror of `charge_balances` and
`unpaid_period_groups`, so the device can compute what a tenant owes offline. Pinned to the
SQL by `tests/db/parity.test.ts`, which **executes both** against one fixture rather than
comparing them by reading.

**`packages/sync-engine/src/ledger.ts`** — reads the local tables and overlays this device's
own unsynced allocations. Without it a collector settles March offline, returns an hour
later, is shown March as unpaid, and takes the money twice.

**`packages/sync-engine/src/collect.ts`** — `orEntryContext` (the point-of-sale OR check) and
`commitReceipt`, which writes the local rows and the outbox entry in **one transaction**.

**Six screens** in `apps/collector`: `leases`, `lease/[leaseId]`, `receipt`, `ambulant`,
`spoil`, and the extended `shift`.

**Two web resources** — `device_assignments` and `collector_assignments` in the admin
registry. A tablet can now be taken from enrolled to working through the UI alone, which was
the largest practical gap Phase 3b-i left.

---

## Six defects found that no test was looking for

Three were in code already merged to `main`.

1. **The generated migration never reached the app's bundled copy.** Metro bundles
   `apps/collector/drizzle`, not the package's. The three new tables would not have existed
   on the tablet at all — the entire task inert.
2. **`deviceTotals` read the pulled `collections` table.** A receipt taken offline lives only
   in the outbox and `local_collections`, so an offline closeout compared **nothing against
   nothing and balanced**. Invisible throughout 3b-i because that phase's exit criterion was
   a shift with zero receipts, and zero sums to zero whichever table you read.
3. **The ledger mirror sorted charge ids alphabetically.** Postgres orders an enum by
   declaration position (`rental, surcharge, opening_balance`), not lexicographically. The
   two agree for `{rental, surcharge}` — every pairing any fixture produced — so it passed by
   coincidence.
4. **OR serials were not scoped to their booklet.** `consumed_serials` is keyed
   `(booklet_id, or_no)` and we flattened it to bare numbers; parent §6.1 sends a device the
   booklets of every collector permitted to sign in to it, and overlapping ranges across form
   types are legal. Serial 1005 spent in booklet A refused serial 1005 in booklet B — a
   collector denied a receipt they were entitled to write, with no way to clear it.
5. **Every screen rebuilt its database driver on each render**, put it in an effect's
   dependency list, and so re-fired the effect after its own `setState` — forever. Not a
   crash: battery drain and sluggishness over a six-hour round, which is why 3b-i's device
   smoke never caught it. Three of the six sites were already on `main`.
6. **F4 and F7 contradicted each other** (found only by the whole-branch review; each
   decision was correct in its own task review). F4's dedup key assumed the server names the
   same charges the device recorded. F7 is the decision that says it may not. When that race
   fires, one receipt subtracts four settlements and two charges read as settled on that
   device **forever** — nothing deletes device-authored rows and an epoch reset only wipes
   pulled tables.

---

## Falsification checks

Every decision the spec records as a *decision* had its test deliberately broken to confirm
the test could see the difference. All ten were run.

| Claim | Broken how | Result |
| --- | --- | --- |
| F4 — pending allocations reduce what is owed | overlay loop deleted | a lease paid offline read as owing; 2 tests failed |
| F5 — the commit is atomic | split into non-transactional writes | outbox 1, local_collections 1, local_allocations 1 of 2 |
| F2 — the closeout has two sides | `deviceTotals` pointed back at `collections` | offline receipts totalled `0.00` |
| F3 — cancelled allocations stop counting | exclusion dropped from `chargeBalance` | voided money read as received; parity failed |
| F3 — ordering is `(due_date, period_start)` | sort comparator flattened | group order differed; parity failed |
| F1 — the reset never destroys unsynced cash | `local_collections` added to the wipe loop | the reset test failed |
| §7.1 — a skip warns, never blocks | skip made a hard refusal | 2 tests failed |
| §8.3 — whole periods only | `selectByAmount` allowed a partial | a charge neither settled nor untouched |
| F3 — enum ordinal, not string order | `localeCompare` retained | `expected [ 'ob1', 'r1' ] to deeply equal [ 'r1', 'ob1' ]` |
| C1 — the server's set is authoritative | pair key restored | `expected [ [ 'r3' ] ] to deeply equal [ [ 'r1', 's1' ], [ 'r3' ] ]` |

**Two tests were found to be incapable of failing**, and both were fixed rather than
trusted:

- The original atomicity test reused one draft id, and `enqueue` is `on conflict do nothing`,
  so it passed identically with or without a transaction. Replaced with a fresh id and a
  duplicated charge id forcing a mid-write failure; the old test was **renamed** to describe
  what it actually checks.
- The `(collection_id, charge_id)` dedup key was pinned by nothing: every fixture used one
  collection on both sides, where a `charge_id`-only key gives the same answer.

---

## Deviations from the plan

- **`commitReceipt` lives in `packages/sync-engine`, not `apps/collector/src/collect/`** as
  spec §3.1 had it. `apps/collector` is outside the vitest workspace, so anything placed
  there cannot be tested at all. `id` and `lineIds` are required arguments, which satisfies
  the spec's actual stated reason (no `expo-crypto` in the engine) and gains a test home.
- **The parity fixture builds its charges with direct INSERTs**, not `run_accrual()` /
  `run_surcharge()`. Those jobs are global — they walk every active lease — and this suite
  never cleans up between files, so calling them corrupted three unrelated test files.
- **Six errors were found in the plan's own text** during execution: a non-existent
  `leases.fee_type_id` column, an out-of-range OR number in a fixture, `resolveRate` called
  with an object instead of positionally, a `git add` missing a file a ruling had moved, an
  unguarded `parsePesoInput` that would have crashed a screen on a lone `"."` typed on a
  decimal pad, and a falsification check that could not fail. Each was caught by the
  implementer or reviewer working the task, not by the plan's author.

---

## Known gaps, carried forward

### Task 12 has not run

See the top of this document. The checklist is at
`docs/superpowers/measurements/phase-3b-ii-device-smoke.md` with every row blank.

### Three residual findings from the whole-branch review

1. **`purgeAcked` cuts on `created_at`, not on when an entry was acked**, and runs right
   after a sync. A spoil queued offline for 30+ days and acked on the next sync is deleted
   from the outbox before its pulled `spoiled_forms` row exists, so that serial reads
   un-spoiled for one sync window. Requires a month-long offline spoil.
2. **"An OR number is digits only" is shown for `"0"` and for over-16-digit pastes**, which
   are digits. Both are unreal serials the booklet-range check refuses anyway.
3. **The plan document still describes the old dedup rule** in three places. The spec — the
   governing document — was corrected.

### The Android package identifier is unconfirmed

`ph.gov.ceedo.collector` replaced Expo's `com.anonymous.collector` placeholder, which must
not ship. **The office has not confirmed the value.** It cannot be changed after installation
without uninstalling from every tablet, so confirm before any signed build.

### The test suite needs a warm Docker VM to mean anything

This cost three subagents and the controller significant time in one session. A degraded or
freshly restarted VM produces **timeout-only failures, in varying files**, that read
convincingly as code defects — zero assertions fail. Symptoms: runs of 130–300s against a
normal ~70s, a different set of files failing each time, and `docker ps` reporting containers
`unhealthy`.

Before trusting a full-suite result: check `docker ps`, run `supabase db reset`, and give the
containers a moment. `tests/db/first-sync-budget.test.ts` is a useful canary — 767ms on a
healthy stack, 12s and a hook timeout on a sick one. For reference, `main` before this phase
was 763/763 in 69.6s.

The underlying weakness is real but smaller than it looks: the suite never cleans up fixtures
between files, and `run_surcharge()` walks every active lease, so `surcharge.test.ts` roughly
doubles over a full run (776ms alone, 1546ms in place). That is nowhere near the 5s default.
**Fixture cleanup between files is the right fix** if the suite grows much further.

### Supabase runs on non-default ports

56321/56322 and the rest, declared in `supabase/config.toml` and documented in the README,
because more than one Supabase project runs on the development machine. `supabase status`
reports the config file's values, not the running containers' — use `docker ps` when they
disagree. The CI Edge Function readiness poll was hardcoded to the old port and is fixed.

---

## What Phase 4 inherits

A collector who can work a market round end to end: find a lease by stall number or tenant
name, see what is owed oldest-first, select whole periods by tapping or by the amount
tendered, record the paper receipt's serial against a physical booklet, take an on-the-spot
ambulant fee priced from the rate table, and spoil a form written wrong.

Phase 4 is **QR cards and the scan flow** (parent §9). The scan resolves a lease id and
lands on `lease/[leaseId]` — the screen this phase built, which §9.4 requires to work on its
own anyway, because cards get soaked, torn, peeled off and stolen.

Phase 5's terminal and slaughterhouse receipts are the **same lines-based shape** as the
ambulant receipt built here: one fee type per receipt, several rate classes across lines.
That constraint is enforced, not assumed — a mixed-fee-type receipt would misattribute
revenue in parent §10's Abstract of Collections, which totals by fee type off the
`collections` row.
