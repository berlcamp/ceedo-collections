# CEEDO Collections — Phase 3b-i (Device Spine) Design

**Date:** 2026-09-19
**Status:** Approved for planning
**Scope:** The three server carryovers Phase 3a left, plus the collector app up to and
including a complete shift that contains no receipts: enrollment, offline PIN sign-in,
on-device SQLite, the sync engine, the outbox, and closeout.
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Predecessor:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md`,
`docs/superpowers/phase-3a-handover.md`
**Successor:** Phase 3b-ii (the collection round) — not this document

This document is an addendum. The parent spec and the Phase 3a design govern everything
they cover. Where this one overrules or extends them, §2 says so explicitly with the
reason.

---

## 1. What this phase ships, and why it stops where it does

Phase 3a split Phase 3 on the argument that *"the wire protocol must be provably right
before an app is written against it, or a sync bug and an app bug become
indistinguishable."* The same argument applies once more, one level down.

`apps/collector` as scoped by 3a is five things at once: an Expo application, an on-device
relational store, a sync engine, an offline authentication scheme, and a cash-handling UI.
The first four are infrastructure whose failures are silent; the fifth is where money
appears. Building them together means the first receipt exercises all five for the first
time simultaneously, and a lost receipt cannot be attributed.

**Phase 3b is therefore split at the line where cash enters.**

| Phase | Scope |
| --- | --- |
| **3b-i — this document** | Server carryovers; Expo shell; device enrollment; offline PIN sign-in; `packages/db-local`; `packages/sync-engine`; the outbox; shift open and close; closeout |
| **3b-ii** | Lease and tenant browse, FIFO prefix picker, OR entry and booklet validation, spoiled forms, rejection display, `stale_allocations` auto-retry surfacing |

| In scope | Out of scope (and where it lands) |
| --- | --- |
| `shift_id` on `collections` | The collection entry flow itself (3b-ii) |
| Edge Function payload validation | QR *tenant cards* and scan-to-pay (Phase 4) |
| SQL test harness on an `authenticator` connection | Parking / terminal / slaughterhouse (Phase 5) |
| Device enrollment, credential in Keystore | `remittances`, shift → `remitted` (Phase 6) |
| Offline PIN sign-in, five-attempt lock | Treasurer dashboards and reports (Phase 6) |
| Device SQLite schema and migrations | Materialised `charge_balances` (when §9's alarm fires) |
| Pull, apply, cursor, epoch, outbox, push | |
| Shift open, close, `closed_unsynced` | |

### 1.1 Exit criterion

Phase 3a's exit criterion was a round trip over HTTP with no tablet. This phase's is the
opposite and is deliberately stated as a physical act, because the entire lesson of Phase
3a's postmortem is that a path nothing walked is a path nothing proved:

> **On the physical tablet:** an admin enrolls the device from the web; a collector signs
> in with their PIN with the device in airplane mode; opens a shift; regains signal;
> syncs; declares cash; closes out; and signs out. A second collector then signs in and
> finds the first collector's shift gone from their view and the first collector's data
> still on the device.

No receipt is involved. Every mechanism a receipt will later depend on is proved before it
carries money.

---

## 2. Decisions

| # | Decision | Overrules / extends |
| --- | --- | --- |
| **E1** | The sync engine is pure TypeScript behind async-shaped driver and transport interfaces | Extends parent §4 |
| **E2** | Device schema is Drizzle in `packages/db-local`; migrations bundle into the app | Implements parent §4 |
| **E3** | A correction re-posts the original `shift_id` as well as the original UUID | **Extends 3a D9** |
| **E4** | The Edge Function contract copy is generated, and staleness fails CI | Closes 3a's deferred item 1 |
| **E5** | The SQL harness connects **as `authenticator`**; five exemptions, not three | Extends 3a handover's mandatory item |
| **E6** | Enrollment is QR with mandatory manual fallback | Extends parent §9.4's principle |
| **E7** | Apply and cursor advance are one transaction | New |
| **E8** | An epoch reset wipes pulled data and never the outbox | **Reconciles 3a D7 with parent §6.4** |
| **E9** | A full re-sync runs on the first sync of each business date | New — answers the deletion gap |
| **E10** | The sign-in gate tests `status = 'open'`, not `status <> 'closed'` | New |
| **E11** | `in_flight` entries are re-pushed, never skipped | Extends parent §6.4 |

### E1 in full — the engine is not in the app

Phase 3a's D1 put sync logic in Postgres and made the Edge Functions transport, giving the
reason plainly: the hard parts are then tested *"by the harness that already proved
`post_collection` — `tests/db`, Vitest, real Postgres — rather than by a second harness
built around a Deno server."*

The same question arrives for the device, and the same answer holds. `packages/sync-engine`
is pure TypeScript taking two interfaces: a SQLite driver and an HTTP transport. Under
Vitest the driver is `better-sqlite3` and the transport is real HTTP into the running Edge
Functions — the `callFunction()` path `round-trip.test.ts` already uses. On the tablet the
driver is `expo-sqlite` and the transport is `fetch`. `apps/collector` is screens and glue.

This also satisfies parent §4's standing rule that the rate rules, OR validation and sync
contract *"stay authoritative"* if the app is ever rebuilt natively.

**The trap, and it is the same trap Phase 3a fell into.** A driver interface is a place
where the test double can be exempt from something the real driver is not — structurally
identical to testing as `postgres` when production runs as `ceedo_app`. There, `set role`
reproduced two of three exemptions and *looked* like it closed the class. Here the
candidates are concrete: `better-sqlite3` is synchronous, `expo-sqlite` is not; their
transaction semantics and bound-parameter ceilings differ.

Two rules follow, and neither is optional:

1. **The interface is async-shaped from the start** — shaped to the constrained driver,
   never the convenient one. Verified achievable: `drizzle-orm/expo-sqlite` exposes a
   promise-shaped API over `openDatabaseSync`, so this costs nothing on either side.
2. **One on-device test runs the real engine against `expo-sqlite`.** This is the local
   translation of "connect as `authenticator`, not `set role ceedo_app`."

### E3 in full — a correction must not leave its shift

3a's D9 rules that "accept with correction" re-runs `post_collection` with the rejected
entry's original UUID, so the device's outbox stays coherent and settles on `duplicate`.

Once `shift_id` exists on `collections` (§3.1), D9 needs one more clause: **the correction
re-posts the original `shift_id` too.** A corrected receipt is cash that was physically in
that collector's drawer during that shift. A correction that dropped the `shift_id`, or
took the supervisor's current context instead, would silently move that money out of the
shift it belonged to — and a closeout that had already balanced would stop balancing, with
nothing pointing at why.

This is cheap to specify now and expensive to discover later, which is the only reason it
appears in a phase that does not otherwise touch the exceptions queue.

### E5 in full — five exemptions, not three

The Phase 3a handover calls this *"the single most actionable sentence in this document"*
and names three things that exempt the `postgres` test connection from what a real caller
faces: object ownership, `rolbypassrls`, and the `pg_safeupdate` guard preloaded per
session for `authenticator`.

**Measured on this instance during design, there are five.** `pg_db_role_setting` gives
`authenticator`:

```
session_preload_libraries = supautils, safeupdate
statement_timeout         = 8s
lock_timeout              = 8s
```

`postgres` carries `statement_timeout = 0`. Verified directly: `select pg_sleep(9)`
succeeds as `postgres` and fails as `authenticator` with *"canceling statement due to
statement timeout"*.

This is not a cosmetic addition to the list. It means **every query a real device makes is
subject to an 8-second ceiling that no test in this repo has ever applied**, and the
longest-running query in the system is `sync_pull` on a first sync. See §3.4.

`authenticator` logs in locally with the standard development password, so the harness
change is a second connection helper, not a privilege negotiation.

### E8 in full — the reset wipes data, never cash

3a's D7 says a device whose `assignment_epoch` differs *"discards its scoped data and pulls
from cursor 0."* Parent §6.4 says outbox entries *"survive a change of collector"* and that
signing out *"clears a session, never data."*

Read carelessly, D7 destroys what §6.4 protects. A reassignment mid-round would discard a
collector's unsynced receipts along with the scoped master data — cash taken, no record,
which is precisely the failure §6.3 exists to prevent.

**The wipe is of pulled data only.** The outbox, the local shift records, and the failed-PIN
counter are device-authored state and are never touched by a reset. Nothing the device
wrote itself is ever discarded by a sync operation.

### E9 in full — a cursor cannot express a deletion

A sequence cursor reports rows whose `row_version` advanced. A deleted row has no
`row_version` to report, so it is invisible to every delta forever.

This was assumed non-applicable on the grounds that the schema is append-only. **It is not.**
Measured during design: `DELETE` is granted to `authenticated` on `facilities`, `sections`,
`stalls`, `tenants`, `leases`, `rates`, `fee_types`, `booklets`, `booklet_assignments` and
`spoiled_forms` — every one of which the device caches. The ledger tables are correctly
absent from that list.

So an admin deleting a stall on the web leaves a device holding that stall indefinitely.
D7's epoch is no help: it bumps on reassignment, which may never happen.

Three answers were considered. **Tombstone rows** written by trigger and carried in the
pull are the general fix, but they add a table, a trigger on ten tables, and a new pull
array, all to solve a problem measured in single-digit rows per month. **Soft-deleting all
master data** is a larger change that reaches into the web app. **A full re-sync on the
first sync of each business date** reuses the reset path E8 already builds, costs one
comparison of a stored date, and bounds any ghost's lifetime to one working day.

The third is chosen. A ghost stall for part of one day is a display nuisance; the machinery
to prevent it entirely is not yet worth its own failure modes. **If the first-sync duration
measured in §3.4 turns out to be material, this decision must be revisited** — a daily full
re-sync is only cheap while a full sync is cheap.

### E10 in full — the gate reads the state it means

Parent §6.5: *"A new collector cannot sign in while the previous collector's shift is still
open — the device requires a closeout first, `closed_unsynced` if there is no signal."*

`closed_unsynced` is finished from the collector's point of view and must not block the next
person; it is also still pending in the outbox and must still push. Both are true at once
only if the gate tests `status = 'open'` specifically. A gate written as `status <> 'closed'`
reads as equivalent, is not, and strands the next collector at the sign-in screen with a
shift nobody can close because the collector who owned it has gone home.

### E11 in full — `in_flight` is where receipts get stranded

Parent §6.4 gives the outbox states as `pending → in_flight → acked | rejected` and does not
say what happens to an entry whose response never arrives.

It must be **re-pushed on the next sync, not skipped.** The server outcome is genuinely
unknown — the push may have committed and the response been lost — and client-generated
UUIDs make a re-push safe by construction: `post_collection` answers `duplicate` and the
entry settles. An implementation that treats `in_flight` as "already sent, someone else's
problem" silently drops exactly the receipts a dropped connection created, which is the
one condition guaranteed to occur on a market round.

---

## 3. The server carryovers

These land before any Expo work, because three of the four change the wire the app is
written against.

### 3.1 `shift_id` on `collections`

A nullable `shift_id uuid references shifts(id)` column, carried on the `collection` push
payload and on `CollectionPayload` in `sync-contract.ts`.

Nullable is correct rather than convenient: every collection posted before this phase, and
every collection a supervisor posts from the web, belongs to no device shift.

`close_shift` then scopes by `shift_id` instead of `(collector_id, business_date)`, which
retires the deferral the 3a handover records — a collector working two tablets in a day,
or a second shift on one device, currently fails safe by refusing to close rather than
closing correctly.

Push ordering follows: a shift's `shift_open` entry must reach the server before any
collection referencing it, which §5.3 makes a property of the outbox rather than a
convention.

### 3.2 Edge Function payload validation

`packages/shared/src/sync-contract.ts` is imported by **none** of the three Edge Functions.
The server accepts arbitrary JSON; a malformed payload reaches Postgres and returns as a
`server_error` a supervisor must decode from a `detail` string.

The obstacle is the one D1 deliberately avoided: Deno resolving `@ceedo/shared` across a
pnpm workspace. A hand-copied duplicate of the contract would replace a validation gap with
a drift hazard, which is a worse trade — the contract is the one file whose whole purpose is
being identical on both ends.

**A generated `supabase/functions/_shared/contract.ts`, emitted from the shared source by a
script, with a test that fails when it is stale.** Drift becomes a red test rather than a
silent divergence. Malformed payloads are then refused at the edge with a 400 naming the
field.

### 3.3 The `authenticator` harness

A second connection helper in `tests/helpers/supabase.ts` connecting as `authenticator`,
which then assumes `ceedo_app` — the sequence PostgREST actually performs.

Every SQL test asserting a privilege, an RLS outcome, or a device-path behaviour moves onto
it. `set role ceedo_app` on a `postgres` connection is not an acceptable substitute and E5
gives the measured reason.

### 3.4 Measure first-sync duration as `authenticator`

Phase 3a's Task 16 measured the first-sync **payload** at ~634 KiB against an 8 MiB alarm,
and stated plainly that the case which would stress it — a long-delinquent stall with full
collection and allocation history — was not exercised, estimating 1.5–3 MB.

**Nothing has ever measured how long it takes.** In production it runs under
`statement_timeout = 8s`; in every test in this repo it runs with no timeout at all. A first
sync that crosses eight seconds fails on every tablet and passes the entire suite — the same
shape as the two bugs that reached the end of Phase 3a, arriving by a mechanism nobody has
looked at.

One measurement, on the `authenticator` connection, against a fixture that includes
collection and allocation history. It also gates E9, which is only affordable while a full
sync is cheap.

---

## 4. The device

### 4.1 Packages

```
packages/
  shared/        exists — contract, money, fifo, charges, booklets, shifts, reason-codes
  db-local/      NEW  — Drizzle schema for device SQLite + generated migrations
  sync-engine/   NEW  — pull, apply, push, outbox, cursor, epoch; pure TypeScript
apps/
  collector/     NEW  — Expo: screens and glue only
```

`packages/db-local` uses `drizzle-orm` with `drizzle-kit` configured `dialect: 'sqlite',
driver: 'expo'`, generating migrations that bundle into the app and apply through
`useMigrations`. This requires `babel-plugin-inline-import` and metro configuration; it is
real build surface and §7 lists it as a risk.

Neither new package may import React Native, for the reason parent §4 already gives.

### 4.2 Secrets and storage

| Held | Where | Why |
| --- | --- | --- |
| `credential_id` + 256-bit secret | `expo-secure-store`, Android Keystore-backed | Mandatory. Long-lived with no expiry (D2), hash-only server-side (D3) — a plaintext leak has nothing bounding it. Never `AsyncStorage`. |
| `pin_hash` per collector | SQLite, as synced | Already a bcrypt hash and public-by-design in this threat model |
| Failed-PIN counter | SQLite, **not memory** | A lock that resets when the app restarts is not a lock |
| Session (who is signed in) | Memory only | Signing out clears a session, never data (§6.4) |

### 4.3 Enrollment (E6)

3a's web screen displays the secret exactly once with no recovery path, and nothing
specified how 64 hex characters reach the tablet. Typing them across a fleet is an
error-prone ritual whose failure mode is a device that cannot be enrolled and a secret that
cannot be re-read.

The web enrollment screen renders `credential_id` and the secret as a QR code; the tablet
scans it with `expo-camera`. **Manual hex entry, with a checksum, remains mandatory** —
parent §9.4 already establishes manual fallback as a rule for QR in this system, and the
same reasoning applies to a camera that fails at 5am.

A secondary benefit: the camera stack Phase 4 needs is proved a phase early, on a flow
where a failure costs an enrollment retry rather than a vendor's payment.

**Enrollment must force a first sync before the device leaves the office.** Collectors reach
the device only through the pull (§4.4), so an enrolled-but-unsynced tablet has no
collectors and cannot be signed into at all.

### 4.4 Sign-in

Collectors arrive in the pull as `employee_no`, `full_name`, `pin_hash`, `status`, resolved
server-side through `can_collector_use_device()` with the role re-checked (3a §4.2).

Sign-in is `employee_no` plus a 6-digit PIN, verified locally with bcrypt against the synced
hash. Five consecutive failures lock the device until its next successful sync, with the
counter in SQLite.

Two failures need specific messages rather than a generic refusal:

- **A collector with a null `pin_hash`** — "PIN not set; sync at the office." 3a §6.3
  already records that a supervisor who resets a PIN believing it takes effect immediately
  has sent a collector out unable to work. A generic "incorrect PIN" makes that
  undiagnosable in the field.
- **A device that has never synced** — "Device not yet synced", not an empty collector list.

**bcrypt cost 12 under Hermes is unmeasured and is task one of this phase.** Measured during
design on the development machine: native C bcrypt at cost 12 takes ~184ms, and `bcryptjs`
on V8 takes ~233ms — only ~1.27x slower, so the common assumption that JavaScript bcrypt
requires a native module is **not** supported by measurement. Hermes is the open variable:
it has no JIT, and a tablet CPU is slower again. The plausible range is roughly 1.5–5
seconds, which is wide enough to be an estimate rather than a finding. Measure it on the
device before the sign-in screen is built. If it lands beyond about two seconds, the options
are a native binding or a cost-factor conversation, and both are decisions for the phase
that has the number.

### 4.5 The sign-in gate (E10)

A local shift with `status = 'open'` belonging to a different collector blocks sign-in and
routes to closeout. Belonging to the same collector, it resumes. `closed_unsynced` never
blocks.

The server-side backstop is `shifts_one_open_per_device`, the partial unique index migration
`0029` added, which is what makes this a guarantee rather than a UI convention a bug could
silently violate.

---

## 5. The sync engine

### 5.1 State and the loop

Local `sync_state` holds `cursor`, `epoch`, and `last_full_sync_date`.

```
sync():
  if last_full_sync_date <> today        -> full()      # E9
  pull(cursor, epoch)
  if response.epoch <> stored epoch      -> full()      # D7
  apply(response) and advance cursor     # one transaction, E7
  push(outbox where state in (pending, in_flight))      # E11
  apply results

full():
  wipe pulled tables; cursor := 0; retain outbox, shifts, PIN counter   # E8
  set last_full_sync_date := today
```

### 5.2 Four rules

1. **Apply and cursor advance are one transaction (E7).** Split, a crash mid-apply either
   advances past rows the device never stored — lost until a reset that may never come — or
   is harmlessly redundant. Atomicity makes every crash the second kind.
2. **A reset never touches device-authored state (E8).**
3. **Apply with `PRAGMA defer_foreign_keys = ON`** inside the transaction, rather than
   maintaining a hand-ordered topological insert sequence across 17 tables in perpetuity.
4. **Outstanding is computed, never stored.** 3a §4.2 requires it and Phase 2's handover
   gives the reason: a charge row does not change when it is paid. The device recomputes
   from `collections` using the same `fifo.ts` and `charges.ts` that `parity.test.ts`
   already pins against the SQL.

The pull returns 17 table arrays: `facilities`, `sections`, `stalls`, `tenants`, `leases`,
`fee_types`, `rates`, `collectors`, `booklets`, `booklet_assignments`, `consumed_serials`,
`spoiled_forms`, `charges`, `collections`, `collection_allocations`,
`collection_cancellations`, `charge_condonations`. `devices` is **not** among them, which is
why the authenticate heartbeat's `row_version` churn (3a migration `0041`, left deliberately
unfixed) costs cursor motion but no payload and needs nothing from this phase.

Rows apply as upserts by primary key. A first sync of thousands of rows must be **chunked**
against SQLite's bound-parameter ceiling — see §7.

### 5.3 The outbox

`outbox(id uuid primary key, type, payload, collector_id, created_at, state, attempts,
reason_code, retryable, last_result)`.

States `pending → in_flight → acked | rejected`, per parent §6.4, with three properties that
are requirements rather than implementation detail:

- **Entries carry `collector_id` and survive a change of collector.** Signing out clears a
  session, never data. A shared tablet's second collector must never see the first
  collector's unsynced receipts disappear or be re-attributed.
- **`in_flight` entries are re-pushed, never skipped (E11).**
- **Insertion order is preserved on push**, so a `shift_open` reaches the server before any
  collection carrying its `shift_id` (§3.1).

`stale_allocations` is the only retryable reason. The device re-pulls and re-pushes on its
own with no supervisor involved (D6), under a **bounded** attempt count — an unbounded retry
on a recurring reason is a tablet stuck in a loop with a collector watching it. On exhaustion
it surfaces like any other unresolved entry.

Retention: `acked` purged after 30 days, `rejected` retained until resolved.

### 5.4 Closeout

1. Force sync; the outbox must reach zero `pending` (3a §5.3 — a device-side precondition).
2. Compute the device's own count and sum for the shift.
3. `POST /closeout` with `declared_total`, `device_count`, `device_total`.
4. `mismatch` leaves the shift open and displays both sides. `closed` records the variance.

With no signal, the device writes `closed_unsynced` locally and queues the `shift_close`
entry. That is the entire reason the state exists: it lets the collector leave and the next
one sign in.

**A `closed_unsynced` shift whose eventual push returns `mismatch`** is specified rather than
discovered. The collector has gone home and the server will not close the shift. It resurfaces
in two places: the supervisor's shift screen, which 3a already built to list shifts open past
their business date, and the tablet, on the next sign-in by anyone.

The two comparisons stay structurally apart, as 3a §5.1 insists: a records mismatch blocks,
a cash variance never does. `packages/shared/src/shifts.ts` already enforces this in the
shape of its signatures, and the device must not reintroduce a path around it.

---

## 6. Testing

Phase 3a's postmortem is the design here. Two production-blocking bugs survived 641 green
tests because no test walked the real path; eight more tests passed vacuously and were found
only by mutation.

| Layer | Where | Proves |
| --- | --- | --- |
| Engine in Node | `tests/device/` — `better-sqlite3` + real HTTP into the deployed Edge Functions | Cursor, epoch reset, full re-sync, delta apply, chunking, outbox states, `in_flight` recovery, idempotency, push ordering |
| SQL as `authenticator` | `tests/db/` on the new connection (§3.3) | Privileges, RLS, `safeupdate`, `statement_timeout`, `lock_timeout` — five exemptions, not three |
| On-device smoke | The physical tablet, written checklist, executed by hand | What Node cannot: Keystore persistence across restart and reinstall, `expo-sqlite` transaction semantics, Hermes bcrypt timing, airplane-mode closeout, the §1.1 exit criterion |

### 6.1 Four vacuous tests to pre-empt by name

Each has the precise shape of one Phase 3a shipped green. Each must be verified falsifiable
by hand-injecting the damage shape and confirming the assertion then fails — the treatment
`sync-concurrency.test.ts` eventually received.

1. **"Outbox survives sign-out"** — that never signs out.
2. **"Epoch reset preserves the outbox"** — asserted against an **empty** outbox. This is
   Task 16's `outstanding >= 0` tautology exactly: unconditionally true, and it would pass
   against an implementation that wipes the outbox, or against no implementation at all.
3. **"`in_flight` entries are re-pushed"** — where the simulated failure never actually left
   anything in `in_flight`, so there was nothing to recover. This is Task 9's poison-entry
   shape: the mechanism under test was never reached.
4. **"A wrong PIN is refused"** — passing because bcrypt comparison returns false for
   everything, the right PIN included. Task 2's shape: a guard that silently no-ops passes
   every test written against it.

### 6.2 What only the tablet can prove

The on-device checklist is a deliverable of this phase, written down and executed, not a
sentiment. It exists because E1's driver interface is a structural opportunity for the Node
double to be exempt from something `expo-sqlite` is not, and no amount of Vitest closes that.

---

## 7. Risks and known limits

**Unmeasured, both scheduled as early tasks.** Hermes bcrypt cost-12 verification on the
tablet (§4.4). `sync_pull` first-sync **duration** under the 8s `statement_timeout` (§3.4) —
the gap E5 opened, where payload size was measured and elapsed time never was. The second
also gates E9.

**Concrete traps.** SQLite's bound-parameter ceiling — 999 on older builds, 32766 on newer —
against a first sync of thousands of rows across 17 tables. The bulk apply must chunk, and a
fixture small enough not to cross the limit will hide the need entirely; the fixture must be
sized deliberately. The Drizzle / metro / `babel-plugin-inline-import` configuration is real
build surface. A custom dev build rather than Expo Go is likely forced once `expo-camera` and
any native module land, and confirming that early costs nothing while discovering it at the
first device test costs a day.

**Inherited, unchanged.** The sequence cursor can skip a row under a concurrent long-running
writer, recoverable only by a full re-sync — more consequential now that a device caches
rather than re-reads, and partially mitigated by E9's daily reset, which was not its purpose.
The 20-bit PIN, and bcrypt at cost 12 standing in for §11.5's specified argon2. The five-
attempt lock is device-side and therefore defeated by a reinstall; the booklet remains the
security boundary (§11.5) and nothing here pretends otherwise.

**Ordering dependency.** `close_shift` reconciles by `(collector_id, business_date)` until
§3.1 lands, so the `shift_id` migration precedes the device closeout work rather than running
beside it.

**Carried forward, still unresolved.** A monthly lease starting mid-month is not billed for
that month. This needs CEEDO's ordinance and has needed it since Phase 2; nothing in this
phase touches billing periods.

---

## 8. Invariants added by this phase

Extending Appendix A. Phase 3a added invariants 21–27; these continue that sequence.

28. A device's outbox is never cleared by sign-out, by a change of collector, or by an epoch
    reset. Only an explicit purge of `acked` entries older than 30 days removes anything.
29. Applying a pull and advancing the cursor commit together or not at all.
30. An outbox entry in `in_flight` is re-pushed on the next sync. No entry is ever skipped
    because its outcome is unknown.
31. A collection's `shift_id`, once set, is preserved by every later re-post of that
    collection — including a supervisor's correction.
32. The device credential lives only in Keystore-backed storage and is never written to
    application-readable disk.
