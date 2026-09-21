# CEEDO Collections — Phase 3b-ii (The Collection Round) Design

**Date:** 2026-09-21
**Status:** Approved for planning
**Scope:** The collector app from an open shift to a shift with cash in it — the admin
screens that commission a tablet, the on-device ledger, lease browse, FIFO selection in
both modes, OR entry, the ambulant lines receipt, and spoiled forms.
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Predecessor:** `docs/superpowers/specs/2026-09-19-phase-3b-device-spine-design.md`,
`docs/superpowers/phase-3b-i-handover.md`
**Successor:** Phase 4 (QR cards and the scan flow), Phase 5 (parking, terminal,
slaughterhouse)

This document is an addendum. The parent spec and the Phase 3b-i design govern everything
they cover. Where this one overrules or extends them, §2 says so explicitly with the
reason.

---

## 1. What this phase ships, and why it stops where it does

Phase 3b-i proved a shift containing **zero receipts**. The seam it stopped at was stated
as "no cash crosses it": every mechanism a receipt depends on — enrollment, offline PIN
sign-in, the local database, the sync engine, the outbox, closeout — was proved before it
carried money. This phase puts cash across that seam.

Most of the server side already exists and is not rebuilt here. `post_collection` (with
FIFO prefix validation, booklet authorization, server-side amount recomputation and the
`stale_allocations` race branch), `unpaid_period_groups`, `charge_balances` and
`CollectionPayload` all shipped in Phases 2 and 3a. `sync_pull` already carries leases,
charges, booklets and consumed serials to the device. `packages/shared` already holds
`fifo.ts` and `booklets.ts`, both pinned against the SQL by `tests/db/parity.test.ts`.

**This phase is therefore almost entirely device-side**, plus one web gap that has to close
first. What it adds is the thing no layer below could supply: the device's own answer to
*what does this tenant still owe*, computed locally, offline, from data it already holds.

### 1.1 What it does not ship

- **The QR scan and tenant cards.** Parent §16 places them in Phase 4. Manual search by
  stall number is built here and is not a fallback — parent §9.4 makes it mandatory in its
  own right, and the QR is an accelerator laid over a screen that must already work.
- **Parking, terminal and slaughterhouse.** Phase 5. The ambulant receipt built here is
  the same lines-based shape those need, so Phase 5 adds facility types and rate classes,
  not a new kind of receipt.
- **Cancelling a posted collection.** 3b-i's D4 settled this and it is unchanged: a
  collector who writes a wrong receipt spoils the form and issues a new one, as the paper
  process already does. A collector who can cancel their own receipts can make a shortfall
  disappear.

### 1.2 The paper receipt is the primary document

There is no printer. The receipts are **pre-printed accountable forms** — physical OR
booklets the collector carries, issued to the office and signed for. Parent §3 settled
this ("app records the number"), parent §15 puts thermal printing out of scope, and
parent §5.3 models the booklets, their assignments and their serial ranges because the
paper is the thing being accounted for.

The order of operations follows from that, and every screen in §3.2 is arranged around it:

1. The app computes what is owed and displays it.
2. The collector takes the cash and **hand-writes the paper OR**, using that figure.
3. The collector enters the serial into the app, which validates it against the booklets
   assigned to them.

**The app is a record of a receipt that already exists, not the receipt.** Two consequences
run through this design:

- **It is why there is no cancel.** A wrong receipt is a spoiled form and a new one issued,
  because that is what the paper process requires and what a booklet must balance against
  on return (§7.2: used + spoiled + unused = total).
- **It sharpens F7.** The amount on the paper the tenant walks away holding is the amount
  the *device* computed. So a stale rank set is not merely a device-versus-server
  disagreement — it is a **paper-versus-ledger** divergence, and the paper is the document
  the tenant holds and COA will ask about. That is what makes F7's two obligations
  non-negotiable: the lease screen discloses how stale its data is *before* the collector
  writes anything, and a closeout mismatch blocks.

Parent §6.3 states the same fact from the other end, and it is the reason a rejection may
never mean discard: *"by the time the server sees a problem, the collector has handed a
vendor a paper official receipt and taken their money. That serial is spent."*

### 1.3 Exit criterion

A complete shift on the physical tablet containing **real receipts**:

- one lease receipt settling several periods FIFO by tapping a row,
- one amount-driven receipt that returns change,
- one ambulant lines receipt with no lease,
- one spoiled form,
- at least one of the above taken in airplane mode and synced afterwards,

closing out with device and server totals agreeing. The mirror of 3b-i's criterion: that
phase proved a shift with no cash in it; this one proves the shift that has some.

---

## 2. Decisions

| # | Decision | Overrules / extends |
| --- | --- | --- |
| **F1** | Device-authored receipts live in three new tables, never in the pulled mirror | **Extends 3b-i E8** |
| **F2** | `deviceTotals` sums `local_collections`, not `collections` | **Corrects a 3b-i defect** |
| **F3** | Outstanding is computed on the device by a TypeScript mirror of the SQL, in `packages/shared` | Implements parent §5.2 |
| **F4** | Pending and rejected outbox allocations overlay the local ledger | Extends parent §6.3, §6.4 |
| **F5** | The local rows and the outbox entry commit in **one** transaction | Extends 3b-i E7 |
| **F6** | Both entry modes produce the same artefact: a set of ranks `1..n` | Implements parent §8.3 |
| **F7** | A stale rank set is caught at closeout, not prevented; the device must make it loud | New — names a limit |
| **F8** | The ambulant receipt is built here, not in Phase 5 | **Extends parent §16** |
| **F9** | `device_assignments` and `collector_assignments` get admin screens before anything else | Closes 3b-i's largest gap |

### F1 in full — a pulled table cannot hold unsynced cash

The obvious place to put a receipt the device just wrote is the local `collections` table.
It is the wrong place, and the reason is already written down in this project.

`collections` is in `PULLED_TABLES`. Spec 3b-i E8 makes an epoch reset empty every table in
that list, because an assignment change means the device's cached view of the world is no
longer the right one. A receipt taken offline, sitting in the outbox, with its only local
record in `collections`, would be **destroyed by a supervisor changing a device
assignment** — and destroyed silently, because the outbox entry carries no amount to
notice its absence by.

So three tables join `DEVICE_AUTHORED_TABLES`:

- `local_collections` — id (the same client-generated UUID the outbox keys on), or_no,
  booklet_id, collector_id, shift_id, collected_at, fee_type_id, lease_id, gross_amount,
  payer_ref, notes, created_at
- `local_allocations` — collection_id, charge_id, amount
- `local_lines` — collection_id, fee_type_id, rate_class, quantity, unit_rate, amount

Every money column is `text` holding `toDecimalString`'s 2dp form, as `db-local`'s existing
tables already do, and is parsed to integer centavos before any arithmetic.

`packages/db-local/src/schema.test.ts` already forbids a table appearing in both halves, so
these three are classified deliberately rather than defaulting into the wipe.

`local_allocations` stores **resolved charge ids**, not the ranks the payload carries. The
device needs to know *which charges* it has optimistically settled in order to compute what
is still owed (F4); a rank is meaningless the moment the list it indexes changes.

### F2 in full — the closeout had nothing to compare

`deviceTotals` is the figure a collector's cash is checked against. In 3b-i it reads:

```sql
select gross_amount from collections where shift_id = ?
```

That was correct for a zero-receipt shift, where both sides of the comparison are zero
whatever the query does. It is wrong the moment receipts exist: a receipt taken offline is
in the outbox and nowhere else, so the device reports `0.00` for it. The closeout would
compare nothing against nothing and balance.

This is a real defect introduced by 3b-i and invisible within 3b-i's own exit criterion —
worth recording as such rather than as new scope. It is the third instance in this project
of the same shape: a correct-looking query whose predicate is only correct for the data the
current phase happens to have.

The query becomes `from local_collections where shift_id = ?`. A shift belongs to one
collector on one device, so that set is complete for the shift and cannot double-count the
pulled row that arrives later under the same id.

**The local gross is a claim, never truth.** The payload still carries no amount at all
(migration `0032`'s header states why: invariant #3 is enforced by never accepting the
figure). The server still recomputes from the rate table. Storing the device's claim is
precisely what gives parent §6.5's comparison two sides — without it there is one figure,
and a single figure agrees with itself.

### F3 in full — one rule, two languages, pinned by execution

`packages/shared/src/outstanding.ts`, pure and without I/O:

- `chargeBalance(charge, allocations, condonations, cancelledCollectionIds)` → outstanding
  in integer centavos, mirroring the `charge_balances` view **including the
  cancelled-collection exclusion**. The SQL calls that exclusion "the easiest mistake in
  the phase to make and the hardest to notice"; a mirror that omits it reports voided money
  as received on the device only, which is worse than omitting it in both places.
- `unpaidPeriodGroups(rows)` → `PeriodGroup[]` grouped by `(due_date, period_start,
  period_end)` and ordered by `(due_date, period_start)`, ranked `1..n`.

It returns the `PeriodGroup` interface `fifo.ts` already declares, so `isContiguousPrefix`
and `selectByAmount` plug in unchanged.

The ordering is not incidental. An opening balance carries the real oldest-unpaid date from
the paper record; ordering by `created_at` instead would place it **last**, and a tenant
would settle this month's rent while two years of arrears sat untouched. The SQL says so in
a comment; the TypeScript must be pinned to it by a test, not by a matching comment.

`packages/sync-engine/src/ledger.ts` reads the local tables through the existing
`SqliteDriver` and calls these functions. Money is integer centavos throughout, via
`money.ts`. Nothing sums a text column in SQL and nothing touches a float.

**Two approaches were rejected.** Mirroring the view as SQLite SQL would put the most
consequential arithmetic in the system into a second dialect where `numeric(14,2)` is
stored as `text` — so the sums happen either on text or on floats, and "floats never touch
a peso" is the one rule the parent spec states twice. Having the server send precomputed
groups in the pull fails for a different reason: a computed group has no `row_version`, so
it cannot be delta-synced, and 3b-i E9 already establishes that the cursor cannot express
anything it does not own.

### F4 in full — the device must subtract its own unsynced receipts

`ledger.ts` reads `local_allocations` alongside the pulled `collection_allocations`.

Without that overlay a collector settles periods 1–3 offline, returns to the same lease an
hour later, and is shown those periods as still unpaid. They would take the money twice,
and the second receipt would be rejected server-side for a reason no one at the stall can
act on — after the cash is already in the drawer and the serial already spent.

**Allocations from `rejected` entries stay in the overlay.** Parent §6.3 is explicit that a
rejection never means discard: by the time the server sees a problem the collector has
handed over a paper receipt and taken the money, and that serial is spent. A rejected
receipt is an exception for a supervisor, not a period that became payable again.

Acked entries are the one case the overlay must eventually stop covering: once the server's
own `collection_allocations` row arrives on the next pull, both rows describe the same
settlement and the ledger must not subtract twice.

The overlay therefore deduplicates on **`(collection_id, charge_id)`**, preferring the
pulled row, and keeps the local one only where no pulled row carries that pair. Not on
`charge_id` alone: `charge_balances` deliberately *sums* every allocation against a charge,
because two collections allocating to one charge is the double-payment migration `0032`'s
row lock exists to prevent — and a ledger that collapsed them would report that failure as
correctly settled, hiding the exact condition the lock was built to make visible.

### F5 in full — two writes that must not be separable

`src/collect/commit.ts` writes `local_collections`, its `local_allocations` or
`local_lines`, **and** the outbox entry inside a single `SqliteDriver` transaction.

This is 3b-i E7's rule ("apply and the cursor commit together") arriving in a second place,
and the failure modes are symmetrical and both silent:

- outbox entry without local rows → the closeout total is short by that receipt, and the
  collector is told their drawer is over by an amount that is in fact recorded,
- local rows without an outbox entry → cash is recorded on the device, never pushed, and
  the closeout balances against a server that never heard of it.

### F6 in full — two ways in, one thing out

Tapping the fifth row selects rows one through five; `isContiguousPrefix` checks the shape.
Typing a peso figure runs `selectByAmount`, which takes the longest oldest-first run of
whole periods the cash covers. Both produce a set of ranks `1..n` and nothing else — so the
payload, the validation and the server path are identical, and the second mode is a second
way to reach one artefact rather than a second code path to the wire.

Change is shown explicitly, because parent §14 settled that a remainder is handed back
rather than part-applied. If the amount tendered does not cover even the oldest group, the
button stays off and says which figure is short. Whole periods only; there is no partial
payment in this system.

### F7 in full — the stale-rank case the server cannot catch

Allocations are positional. `post_collection` resolves rank `n` against the unpaid groups
as they stand **at post time**, which may be hours after the device read them.

The server catches two of the three ways this goes wrong. If the prefix names fewer groups
than exist unpaid, `allocation_not_prefix` rejects it. If a concurrent post settles part of
the prefix while this one waits on the row lock, `stale_allocations` rejects it as
retryable. Both were built in migration `0032` precisely because shared tablets make two
devices holding one lease routine.

The third way it goes wrong passes both checks: another device settled group 1 and the
nightly accrual raised a new period, so the count still matches and the ranks now name
different periods than the collector quoted. The receipt posts. Its amount is correct
against the ledger and **different from the cash in the drawer**.

This is not fixable on the device — the device cannot know what it has not pulled. It is
caught, and caught loudly, by the mechanism parent §6.5 already requires: the closeout
compares the device's claim against the server's recomputation and a records mismatch
**blocks**. That is the whole reason F2 matters.

What this phase owes is not prevention but visibility: the lease screen states how stale
its data is and offers a sync before the picker commits. A quiet wrong number is the
failure this project is built to refuse; a loud one at closeout is the design working.

### F8 in full — the ambulant receipt belongs to the market round

Parent §2 lists the ambulant / daily vendor fee as a market stream: charged on the spot, no
receivable, a `collections` row with lines and no allocations. Parent §16 names Phase 5 as
"parking, terminal and slaughterhouse" and does not name ambulant.

It belongs here because it is the same collector, on the same round, tearing serials from
the same booklet. Leaving it out does not defer the work — it moves half the round onto
paper, and then the device's local consumed-serial set diverges from the booklet it is
validating against. Honest receipts would start raising sequence-skip warnings, and a
warning that fires on correct behaviour is a warning that gets ignored, including on the
day it is right.

`CollectionPayload.lines` already exists and `post_collection` already prices lines from
the rate table, so this is device work only.

### F9 in full — a tablet nobody can commission cannot be tested

`device_assignments` and `collector_assignments` are not in
`apps/web/lib/admin/registry.ts`. A tablet cannot go from enrolled to working through the
UI alone; the rows are written by hand with `scripts/dev-wire-tablet.sql`.

The 3b-i handover names this as the phase's largest practical gap and records that it is
what made two of that phase's four device-found bugs reachable — the state was unreachable
from the admin screens, so nobody had ever seen a device in it. It is Task 1 here because
every device test of the collection flow otherwise begins with hand-written SQL, which is
both a poor test of the real path and the exact condition that produced those bugs.

---

## 3. The device

### 3.1 New modules

| Path | Purpose | May import |
| --- | --- | --- |
| `packages/shared/src/outstanding.ts` | `chargeBalance`, `unpaidPeriodGroups` — pure | nothing but `money.ts` |
| `packages/sync-engine/src/ledger.ts` | reads local tables, applies the overlay | `SqliteDriver`, shared |
| `packages/db-local/src/schema.ts` | the three device-authored tables | drizzle |
| `apps/collector/src/collect/draft.ts` | the receipt in progress | nothing |
| `apps/collector/src/collect/commit.ts` | validate, write, enqueue — one transaction | engine, shared |

`packages/sync-engine` still may not import React Native (parent §4, 3b-i E1). The bug that
rule exists to catch — `crypto.randomUUID()` defaulted inside `openShift` — is the reason
`commit.ts` lives in the app and takes its id from `expo-crypto` as a required argument.

### 3.2 Screens

| Route | Job |
| --- | --- |
| `shift.tsx` *(exists)* | gains **Collect**, **Ambulant**, **Spoil a form**, and this shift's count and total |
| `leases.tsx` | search by stall number or tenant name, scoped to the device's assignment |
| `lease/[leaseId].tsx` | tenant and stall header, balance, FIFO groups oldest-first and collapsible, both entry modes |
| `receipt.tsx` | OR entry, booklet resolution, confirm — shared by the lease and ambulant paths |
| `ambulant.tsx` | fee type and quantity lines, no lease |
| `spoil.tsx` | mark a serial spoiled with a reason |

A receipt in progress lives in `src/collect/draft.ts`, a module-level store shaped like the
existing `src/auth/session.ts` — not router params. A money figure and a group selection
serialized through a URL is a class of bug nobody needs to invent twice.

### 3.3 OR entry

`validateOrEntry` runs against the booklets assigned to **this** collector, with `consumed`
being the union of pulled `consumed_serials` and this device's own unsynced
`local_collections`. A serial spent offline is spent.

- A sequence skip is a **soft warning the collector can accept**, never a block. Parent
  §7.1: booklets legitimately get skipped.
- `ambiguous_booklet` is a hard stop, as `booklets.ts` already decided — a silently wrong
  booklet id on a real receipt is unrecoverable once the vendor walks away.
- The server re-validates all of it authoritatively. These checks catch honest mistakes at
  the point of sale and are not trusted.

### 3.4 The ambulant lines receipt

Pick fee type and rate class, enter quantity, `resolveRate` gives the unit rate in force at
`collected_at` from the local `rates` table, and the extension is `unit_rate × quantity` in
integer centavos. Several lines may sit on one receipt — which is what makes the same code
serve Phase 5's terminal receipt carrying several vehicle classes.

`resolveRate` throws rather than choosing when two rates overlap. On the device that throw
becomes a refusal the collector can read and a supervisor can act on, never a crash at a
stall: the rates are stale-able local data, and a device that has not pulled a new
ordinance's rate row must say so rather than price the receipt itself.

`collection_lines` is **not** in `PULLED_TABLES` and is not added. Lines do not round-trip;
`local_lines` is the device's record and the server's row is authoritative. Recorded here
as a deliberate omission so the next person does not read it as an oversight.

### 3.5 Error handling

| Failure | Where it surfaces | What the collector sees |
| --- | --- | --- |
| Ranks shifted since last pull | `stale_allocations` (retryable) or `allocation_not_prefix` | nothing at the stall; re-pushed after a re-sync. Only a persistent failure reaches the outbox as `rejected` |
| Device gross ≠ server gross | closeout `mismatch` — **blocks** | both figures and their difference; the shift stays open |
| Serial spent on another device | `post_collection` rejects → `sync_exceptions` | the receipt stays visible as unresolved and **still counts at closeout** |
| Rate missing or overlapping | `resolveRate` throws, caught in `ambulant.tsx` | which class has no rate as of today, plus **Sync now** |
| Payload the device cannot validate | quarantined locally, `rejected`, row kept | 3b-i's `quarantine.ts`, extended to the lines and allocations payloads |

**No message may name a cause the screen has not checked.** This is 3b-i bug 3's lesson
stated as a rule: a screen that says "not synced" when the real problem is a missing rate
sends someone to the wrong place, and does it in a confident voice.

---

## 4. Testing

Four layers: pure unit tests in `packages/shared`; engine tests in `packages/sync-engine`
against the in-memory driver; `tests/db/parity.test.ts` **extended** to execute
`unpaid_period_groups` in Postgres and `unpaidPeriodGroups` in TypeScript against one
fixture and assert they agree; and `tests/device/round-trip.test.ts` for the full
outbox → push → pull loop.

### 4.1 Falsification checks

Each is run, and its result recorded in the handover. A test that cannot fail is not
evidence.

| Claim | Break it by | Expected |
| --- | --- | --- |
| F4 — pending allocations reduce what is owed | dropping `local_allocations` from the overlay | a lease paid offline reads as still owing |
| F5 — the commit is atomic | splitting it into two transactions and failing between | an outbox entry with no local row |
| F2 — the closeout has two sides | pointing `deviceTotals` back at `collections` | offline receipts total `0.00` |
| F3 — cancelled allocations stop counting | dropping the exclusion from `chargeBalance` | voided money reads as received; parity fails |
| F3 — ordering is `(due_date, period_start)` | ordering by `created_at` | the opening balance sorts last; parity fails |
| F1 — the reset never destroys unsynced cash | adding `local_collections` to the wipe loop | the reset test fails |
| §7.1 — a skip warns, never blocks | making a sequence skip a hard refusal | a legitimately skipped booklet refuses a receipt |
| §8.3 — whole periods only | letting `selectByAmount` take a partial | a charge neither settled nor untouched |

### 4.2 Four vacuous shapes to pre-empt by name

1. A parity fixture with no surcharge, no condonation and no cancellation passes whatever
   the TypeScript does. The fixture must contain all four inputs to `chargeBalance`.
2. An overlay test with an empty outbox passes trivially. It must assert against a
   non-empty one, and against a `rejected` entry specifically.
3. A prefix test over a single group passes under almost any wrong implementation, because
   `[1]` is a prefix of nearly everything.
4. From the 3b-i handover's own correction: an exact-count assertion such as
   `toEqual({ n: 1 })` fails on an empty fixture just as it fails on a wiped one, so it is
   **not** the tautology it resembles. The shape that needs pre-empting is a weaker
   assertion, not this one.

### 4.3 What only the tablet can prove

3b-i found four bugs on the device that no amount of Node testing would have caught, and
two of them were not wrong code at all. This phase expects the same and does not treat the
suite as sufficient. Specifically unprovable in Node: the real `expo-sqlite` transaction
semantics under `commit.ts`, whether the FIFO list is legible and tappable at a stall in
daylight, and whether the amount-driven keypad is usable with a queue waiting.

---

## 5. Tasks

1. **Admin registry** — `device_assignments` and `collector_assignments`, with
   `registry-parity.test.ts` coverage (F9). Nothing else can be tested on a tablet first.
2. **Schema** — the three device-authored tables, generated Drizzle migration, and the
   classification test (F1).
3. **`outstanding.ts`** — the ledger mirror, with the parity test (F3).
4. **`ledger.ts`** — local reads plus the overlay (F4).
5. **`deviceTotals` correction** and its falsification check (F2).
6. **`commit.ts`** — the single transaction, OR validation, outbox enqueue (F5, §3.3).
7. **Lease browse and the lease screen** — both entry modes (F6), staleness disclosure (F7).
8. **`receipt.tsx`** — OR entry and confirm.
9. **Ambulant** — the lines receipt (F8).
10. **Spoiled forms** — the screen over the existing entry type.
11. **Carryovers** — the Android package identifier off `com.anonymous.collector`, and a
    caller for `outbox.purgeAcked` on the shift screen's sync. Both are named in the 3b-i
    handover and both need the rebuild this phase forces anyway.
12. **Device session** — the exit criterion of §1.3, transcribed.

---

## 6. Risks and known limits

- **The stale-rank case of F7 is not prevented.** It is caught at closeout, which blocks.
  Accepted deliberately; the alternative is refusing to collect without a fresh sync, which
  parent §3 rules out ("blocking a collector over bad signal is unworkable").
- **A mid-month monthly lease is still not billed for that month.** Carried forward
  unresolved since Phase 2, decided on internal-consistency grounds and explicitly not from
  CEEDO's ordinance. Needs the client, not an implementer.
- **`local_collections` grows without a purge rule.** `outbox.purgeAcked` gets a caller in
  Task 11; the local receipt rows deliberately do not, because they are what a closeout and
  any later dispute read. A retention rule for them is a question for the office, not a
  default chosen here.
- **The 3b-i device smoke checklist remains partly untranscribed.** Those rows are about
  the spine, not this phase, and are left blank rather than assumed.

---

## 7. Invariants added by this phase

15. A device-authored receipt is never stored in a pulled table, and an epoch reset never
    destroys unsynced cash.
16. The device's own unsynced allocations reduce what it believes a lease owes, and a
    rejected entry's allocations keep doing so until the exception is resolved.
17. A receipt's local rows and its outbox entry commit together or not at all.
18. The device's closeout total is computed from what the device authored, never from what
    it was sent.
