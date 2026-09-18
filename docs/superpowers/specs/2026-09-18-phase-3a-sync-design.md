# CEEDO Collections — Phase 3a (Sync Server) Design

**Date:** 2026-09-18
**Status:** Approved for planning
**Scope:** Device authentication, shifts, sync exceptions, the three Edge Functions, and
the supervisor web screens — everything the collector app talks to, provable before the
collector app exists.
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Predecessor:** `docs/superpowers/phase-2-handover.md`

This document is an addendum, not a replacement. The parent spec governs everything it
covers. Where this one overrules it, §2 says so explicitly and gives the reason.

---

## 1. What Phase 3a ships

Spec §16 scopes Phase 3 as *"Collector app — market rentals, offline, sync, closeout,"*
shipping when *"a collector can work a market round end to end."* That is five greenfield
subsystems: device auth, server tables, Edge Functions, an Expo app, and supervisor
screens. Phase 2 spent 36 commits on one subsystem of comparable size.

Phase 3 is therefore split, on the same reasoning the parent spec gives for putting
Phase 2 before Phase 3 — *"the ledger must be provably right on the web before a device
starts writing into it."* The same argument applies one level down: the wire protocol
must be provably right before an app is written against it, or a sync bug and an app bug
become indistinguishable.

| Phase | Scope |
| --- | --- |
| **3a — this document** | Device credentials, `shifts`, `sync_exceptions`, `sync_pull` / `sync_push` / `close_shift`, the three Edge Functions, `ceedo_app` wiring, supervisor exceptions queue and shift verification |
| **3b** | `apps/collector` — Expo, SQLite outbox, offline sign-in, collection flow, device-side closeout |

| In scope | Out of scope (and where it lands) |
| --- | --- |
| Device credential issue, rotation, revocation | The Expo app itself (Phase 3b) |
| Collector PIN hashing (server writes it) | PIN entry and offline verification (Phase 3b) |
| `shifts`, `sync_exceptions`, `device_credentials` | QR cards and scan flow (Phase 4) |
| `sync_pull`, `sync_push`, `close_shift` | Parking / terminal / slaughterhouse (Phase 5) |
| `supabase/functions/` — three thin Deno handlers | `remittances`, shift → `remitted` (Phase 6) |
| `ceedo_app` granted to `authenticator` | Treasurer 3-day dashboard, resolutions report (Phase 6) |
| Supervisor exceptions queue and shift verification | Excel and PDF export (Phase 6) |

Phase 3a ships when **the full round-trip can be exercised over HTTP without a tablet**:
a registered device authenticates, pulls its scoped world, pushes a batch containing a
good receipt, a duplicate, a permanently-rejectable receipt and a spoiled form, sees the
rejection land in a supervisor's queue, and closes a shift whose totals disagree and then
agree.

---

## 2. Decisions that overrule or extend the parent spec

| # | Decision | Overrules / extends |
| --- | --- | --- |
| **D1** | Sync logic lives in Postgres functions; Edge Functions are thin | Extends §4 |
| **D2** | Device credential is long-lived with no expiry | Extends §11.5 |
| **D3** | Device secret is SHA-256; the PIN is bcrypt | New |
| **D4** | `cancellation` is **not** a device push type | **Overrules §6.2** |
| **D5** | `shift_open` **is** a device push type | Extends §6.2 |
| **D6** | A lost FIFO race gets its own retryable reason code | Extends §6.3 |
| **D7** | Device reassignment forces a full re-sync via an epoch | Makes §3's "forces a re-sync" a mechanism |
| **D8** | Push entries are isolated per entry, not per batch | Extends §6.2 |
| **D9** | Corrections re-post the original UUID | Extends §11.3 |
| **D10** | `pin_hash` is written by a `SECURITY DEFINER` RPC, not an Edge Function | **Corrects migration 0002's comment** |

### D1 in full — the logic is SQL, the function is transport

Phase 2 put the settlement engine in `post_collection()` rather than in application code,
and the comment at the top of that migration gives the reason: *"Two implementations of
this would be two things to keep correct, and a tenant would get a different balance
depending on which door they paid at."*

Device scoping, FIFO validation and shift reconciliation are the same kind of logic and
get the same treatment. Each Edge Function is roughly eighty lines of Deno: parse the
body, authenticate the device, call one RPC as `ceedo_app`, return its JSONB.

This also means the hard parts are tested by the harness that already proved
`post_collection` — `tests/db`, Vitest, real Postgres — rather than by a second harness
built around a Deno server. HTTP tests still exist (§8) and cover what only they can:
authentication, transport, and the shape of what crosses the wire.

A secondary benefit: `@ceedo/shared` never has to resolve from Deno across a pnpm
workspace, which is a real source of friction and would otherwise appear on the critical
path of every Function.

### D2/D3 in full — two secrets, two threat models

The parent spec fixes the *shape* of device authentication — a device credential plus an
offline PIN — and §11.5 gives the reason OAuth cannot be used: it *"needs a round trip at
exactly the moment a collector may have no signal — a 5am market round that cannot begin
is a collector sent home."*

**That argument does not stop at OAuth.** Any credential with an expiry reintroduces the
same failure one step removed: a tablet that has been offline overnight wakes with a dead
token and cannot record anything until it finds signal. The device credential is
therefore long-lived and has no expiry. Revocation is `devices.active = false`, which
§11.5 already names as the answer to a lost or stolen tablet, and it takes effect on the
device's next contact with the server — which is also the only moment it could do any
harm.

The two secrets in this system get different hashes, and the difference is not an
oversight:

| Secret | Entropy | Hash | Why |
| --- | --- | --- | --- |
| Device credential | 256 bits, random | SHA-256 (`pgcrypto digest`) | Brute force is infeasible at any speed. A slow KDF buys nothing against a uniformly random 256-bit secret. |
| Collector PIN | ~20 bits (6 digits) | bcrypt (`crypt`, cost 12) | 10⁶ candidates total. Cost is the *only* mitigation: ~4 days to exhaust at cost 12, versus seconds against SHA-256. |

§11.5 specifies argon2. Postgres has no argon2 without an extension this project does not
install, and `pgcrypto`'s bcrypt is available on Supabase today. Cost 12 is the honest
substitute and the substitution is recorded here rather than made silently.

**The PIN hash is synced to the device, so a stolen tablet is an offline cracking
target.** Three things stand there and only the first is a Phase 3a decision: the cost
factor, the five-failed-attempt lock (Phase 3b), and §11.5's own position that *"the PIN
is not the security boundary — the booklet is."* A 6-digit PIN protects attribution and
convenience. It does not protect money, and nothing in this design pretends otherwise.

### D4 in full — collectors do not cancel

§6.2 lists four push entry types, one of which is `cancellation`. Phase 2 built
`cancel_collection()` checking the caller's `app_users` role and permitting supervisors
only. The two cannot both be right.

**The supervisor wins, and §6.2's list is corrected rather than implemented.** A
collector who writes a wrong receipt marks the form spoiled and issues a new one — which
is what the paper process already does, and what the existing `spoiled_forms` table
already models. Cancelling a *posted* collection remains a supervisor act on the web.

The deciding reason is cash accountability: a collector who can cancel their own receipts
can make a shortfall disappear, and §6.5 exists precisely so that shortfalls cannot.

### D5 in full — `shift_open` is worth a fifth entry type

§6.2's four types do not include one for opening a shift, because §6.5 only describes the
closing ritual. But Phase 3a ships a supervisor shift-verification screen, and without an
open-shift record that screen cannot show a shift until the moment it ends — precisely
inverting its purpose, which is to notice a shift that is *not* ending.

`shift_open` is therefore a push type. It is idempotent on the client-generated shift id
like everything else, and a device that never finds signal until closeout simply pushes
both entries in one batch.

### D6 in full — one retryable rejection

Phase 2's handover records a known gap:

> A lost race returns `allocation_not_prefix`, which misleads. The behaviour is correct —
> rejected, nothing written — but the name points at a data problem. The right device
> response to a lost race is re-sync and retry automatically, not raise a supervisor
> exception.

Phase 3a closes it. `stale_allocations` joins `REJECT_REASONS` and is returned from
`post_collection`'s re-read-mismatch branch. It is the **only** retryable reason, and
that status has a concrete consequence: it files no `sync_exceptions` row. Every other
reason means a human must look at a paper receipt.

This matters more in Phase 3 than it did in Phase 2, because Phase 3 is the first time
multiple tablets push concurrently against the same lease. §3 notes collectors rotate
across shared tablets; two devices holding the same lease is routine.

### D10 in full — the PIN is set by an RPC, not an Edge Function

Migration 0002 withholds `pin_hash` from every web grant — `authenticated` holds
`update (role, status)` and nothing more — and its comment says *"Phase 3 writes pin_hash
through an Edge Function, not as `authenticated`."*

**The requirement is right; the mechanism named is wrong for this caller.** An admin sets a
collector's PIN from the web admin screen, and §4's architecture table is explicit that the
web talks to Supabase directly while Edge Functions exist for the device. Routing an admin
form through an Edge Function inverts that split for no gain.

Phase 3a instead adds `set_collector_pin(collector_id, pin)` — `security definer`, checking
`is_admin()` internally, hashing server-side. This is precisely the pattern Phase 2 used for
`condone_charge`, `cancel_collection` and `record_opening_balance`, and it satisfies what
migration 0002 actually cared about: the hash is never writable through a plain PostgREST
`UPDATE` and never readable by any client role. The plaintext PIN crosses the wire once,
over TLS, and is never stored.

Migration 0002's comment is corrected in the same phase that makes it concrete.

### D7 in full — a cursor cannot say "this left your scope"

The sync cursor is `row_version_seq`, a single bigint across all tables, already built and
already indexed. §5.7 gives the reason it is a sequence and not a timestamp.

A cursor delta answers *"what changed?"* It cannot answer *"what is no longer yours?"*
When a supervisor reassigns a tablet from the fish section to the vegetable section, the
fish section's leases do not change, so no `row_version` moves, so the delta is empty and
the tablet keeps a section's worth of data it must no longer show.

§3 says reassignment *"forces a re-sync before it is used elsewhere."* D7 makes that a
mechanism: `devices.assignment_epoch` is an integer bumped by trigger on any
`device_assignments` change. Every pull response carries it. A device whose stored epoch
differs discards its scoped data and pulls from cursor 0.

### D8 in full — a poison entry costs its own receipt, not the round's

A push carries a whole round — potentially a hundred receipts. `sync_push` loops in
PL/pgSQL with a `begin ... exception` block per entry, so each entry commits or rolls
back alone inside one outer transaction and one round trip.

The alternative of one transaction per batch is not merely slower to recover from, it is
wrong: a single permanently-rejectable entry — say an OR number a second device already
spent — would block every other receipt in that round forever. That is the discard
failure §6.3 exists to prevent, arriving by a different road.

**Documented caveat:** a PL/pgSQL exception block is a real subtransaction, so a 200-entry
push opens 200 of them. That is well within Postgres's tolerance at this scale, and the
alternative is worse. If a round ever grows large enough for this to matter, the fallback
is chunking the batch in the Edge Function, not removing the isolation.

### D9 in full — a correction re-posts the original UUID

§11.3 names three supervisor resolutions but not what they write. Against an append-only
ledger that needs deciding.

A rejected entry **wrote nothing**, so its client-generated UUID is still free. "Accept
with correction" therefore re-runs `post_collection` with that same id, and the supervisor
may edit only the device's *claims*: OR number, booklet, lease, which periods, quantities.

**Amounts remain unacceptable from the payload, for supervisors exactly as for devices.**
Invariant #3 says the device's figure is never authoritative; a supervisor override would
put a hole in it reachable by anyone holding a supervisor account. The server recomputes.
A correction that is itself invalid is rejected again rather than forced in, and
idempotency, FIFO validation and invariant #9 all apply unchanged.

This also keeps the device's outbox coherent. The tablet still holds that UUID as
unresolved; when it re-pushes, `post_collection` returns `duplicate` against the now-posted
row and the entry settles. A correction under a fresh UUID would leave the device
re-pushing a ghost that nothing recognises.

---

## 3. Schema

Three new tables. **All three are deliberately outside the append-only regime** — they
have lifecycles, unlike anything in §5.4. Phase 2 set the precedent of stating this rather
than leaving it to be inferred, with `settings` and `accrual_runs`.

Every table carries `row_version bigint` fed by the shared sequence and bumped by trigger,
per §5.7.

### 3.1 `device_credentials`

```
id           uuid primary key default gen_random_uuid()
device_id    uuid not null references devices (id)
secret_hash  bytea not null          -- sha256 of the issued secret
issued_at    timestamptz not null default now()
issued_by    uuid not null references app_users (id)
revoked_at   timestamptz
revoked_by   uuid references app_users (id)
row_version  bigint not null default 0
```

Partial unique index on `(device_id) where revoked_at is null` — one live credential per
device.

**A separate table, not a column on `devices`, for two reasons.** Rotation: issuing a
replacement and revoking the old one is two rows, not a destructive update, and the
history of who issued what survives. And privilege: `devices` carries
`apply_master_data_policies`, which grants `SELECT` to staff roles. A secret hash must not
inherit that. `device_credentials` gets RLS enabled and **no policy granting read to
anyone** — it is reachable only through the `security definer` functions in §4.

`devices.credential_id` (already present, already unique) remains the public half: the
identifier a device sends alongside its secret. Its existing comment — *"The secret itself
is never stored here"* — is honoured rather than revised.

### 3.2 `shifts`

```
id              uuid primary key          -- NO DEFAULT. Client-generated.
collector_id    uuid not null references app_users (id)
device_id       uuid not null references devices (id)
business_date   date not null
opened_at       timestamptz not null
closed_at       timestamptz
declared_total  numeric(14,2)
system_total    numeric(14,2)
system_count    integer
variance        numeric(14,2)
status          text not null check (status in ('open','closed','closed_unsynced','remitted'))
row_version     bigint not null default 0
```

**`id` has no default, and this is the same decision as `collections.id`.** A shift opens
offline, before the device has ever spoken to the server about it. The client generates
the UUID and that is what makes `shift_open` idempotent across retries. A server default
would mint a second shift every time a push was retried on a bad connection.

Partial unique index on `(device_id) where status = 'open'`.

That index is §6.5's one-open-shift rule **enforced in the schema rather than in the
app**: *"A device permits only one open shift at a time... Without this rule a shared
tablet accumulates overlapping open shifts and the cash accountability cannot be untangled
afterwards."* The device enforces it locally too, because it must work offline — but the
device's copy is a convenience and this one is the guarantee.

`remitted` is in the check constraint but unreachable in Phase 3a; remittance is Phase 6.
Naming it now costs nothing and avoids a constraint migration later.

### 3.3 `sync_exceptions`

```
id                 uuid primary key default gen_random_uuid()
collection_uuid    uuid not null unique
device_id          uuid not null references devices (id)
collector_id       uuid not null references app_users (id)
reason_code        text not null
payload            jsonb not null
attempts           integer not null default 1
first_seen_at      timestamptz not null default now()
last_seen_at       timestamptz not null default now()
status             text not null default 'open'
                     check (status in ('open','escalated','resolved'))
resolution         text check (resolution in ('corrected','spoiled'))
resolution_reason  text
resolved_by        uuid references app_users (id)
resolved_at        timestamptz
row_version        bigint not null default 0
```

**The unique on `collection_uuid` is load-bearing.** §6.4 says a rejected entry *stays* in
the device outbox and remains visible as unresolved, which means the device re-pushes it
on every single sync. Without the constraint, one permanently-rejected receipt breeds an
exception row per sync attempt and buries the queue within a day. A re-push instead bumps
`attempts` and `last_seen_at`, which is also the honest signal of how long a receipt has
been stuck.

**`escalated` is a status, not a resolution.** §11.3's three resolutions are "accept with
correction", "mark spoiled" and "escalate for investigation", but the third is not a
terminus — an escalated exception is still unresolved and still counts against the
collector at closeout. Modelling it as a resolution would let an exception be closed by
declaring it interesting.

A check constraint pins the lifecycle: `resolution`, `resolved_by` and `resolved_at` are
all null unless `status = 'resolved'`, and `resolution_reason` is **not null** whenever
`status` is not `'open'`. §11.3: *"A written reason is mandatory on every resolution."* A
constraint, not a form validation.

### 3.4 Privileges

`shifts` and `sync_exceptions` hold `UPDATE` — they have lifecycles. This is the
distinction Phase 2 drew for `settings` and `accrual_runs` and it is restated here so that
a future reader does not mistake these for ledger tables. **No table in §5.4 gains a
privilege in this phase.**

`DELETE` is granted on none of the three, to any role.

`device_credentials` grants `SELECT` to no role at all. The functions that read it are
`security definer`.

### 3.5 `ceedo_app` wiring

Phase 1 created `ceedo_app` with `nologin`, schema `USAGE`, and **zero table privileges**,
and did not grant it to `authenticator`. Phase 1's handover names wiring it as a Phase 3
obligation, and §12.5 gives the reason it exists at all: *"Edge Functions must not use
`service_role`"* — which bypasses RLS across every schema on this shared instance.

Phase 3a wires it:

- `grant ceedo_app to authenticator` — without this, PostgREST cannot `set role ceedo_app`
  and the JWT is inert.
- `EXECUTE` on exactly four functions: `authenticate_device`, `sync_pull`, `sync_push`,
  `close_shift`.
- `SELECT`, `INSERT` and `UPDATE` on **nothing**. Every one of those four is
  `security definer`; the role is a key to four doors and holds no table privilege of its
  own. A compromised `ceedo_app` JWT can call four functions with their own internal
  authorization and can read no table directly.

**`post_collection` is not on that list, and that is stronger than Phase 2 asked for.**
Phase 2's handover says to grant it to `ceedo_app` and revoke it from `service_role`. The
first half turns out to be unnecessary: `sync_push` is `SECURITY DEFINER`, so it reaches
`post_collection` as its owner, and `ceedo_app` needs no grant of its own. So
`post_collection`'s `EXECUTE` is revoked from `service_role` and granted to **no client
role at all** — it becomes reachable only through the sync path, which is what invariant
20 asked for and what Phase 2 could not yet deliver because no sync path existed.

**This has a cost the plan must absorb:** Phase 2's collection tests call
`post_collection` through PostgREST as `service_role`. They move to the `node-postgres`
connection the DB suite already opens, which connects as `postgres`. The tests change; the
assertions do not.

---

## 4. The Edge Functions

Three handlers in `supabase/functions/`, sharing one `_shared/` module for authentication
and error shaping.

### 4.1 Authentication, and the chicken-and-egg

A Function cannot verify a credential before it holds a database role, and it must not
hold `service_role`. It therefore carries a JWT with `{"role": "ceedo_app"}` signed with
the project JWT secret, held as a Function secret — and calls:

```
authenticate_device(p_credential_id text, p_secret text) -> uuid | null
```

`security definer`, `stable`. It hashes the presented secret, compares against the live
`device_credentials` row, and requires `devices.active`. It returns the device id or null,
and it updates `devices.last_seen_at` — the column Phase 1 created for exactly this.

Comparison uses a constant-time equality on the digest rather than `=`. At 256 bits of
entropy a timing oracle is not a realistic attack, but the habit costs one function call.

**Deactivation takes effect on next contact.** A stolen tablet marked inactive keeps
working offline until it reaches the network, at which point every push is refused. That
is inherent to an offline-first design and is stated plainly rather than papered over:
the mitigation for a stolen tablet holding unsynced receipts is the booklet, which is
physical, and the closeout, which will not balance.

### 4.2 `POST /sync-pull`

Body `{ credential_id, secret, cursor, epoch }`. Calls `sync_pull(device_id, cursor)`.

Returns everything with `row_version > cursor`, scoped through the device's **active**
assignment, plus the new high-water cursor and the current `assignment_epoch`:

- Facilities, sections, stalls, tenants and leases within the assignment
- Rates, rate classes, fee types
- The collectors permitted to sign in on this device — `employee_no`, `full_name`,
  `pin_hash`, `status` — resolved through `can_collector_use_device()`'s own join
- Their booklet assignments and consumed serials
- Charges for the scoped leases: unpaid, plus paid within 90 days for the history view
- **`collections`, `collection_allocations` and `collection_cancellations` for those
  leases**

That last group is not optional and Phase 2's handover explains why at length:

> A charge row does not change when it is paid. There is no `status` column on `charges`
> and no `UPDATE` privilege on it for any role... Sync pull must send *collections* on the
> `row_version` cursor and let the device recompute outstanding locally. The obvious
> implementation — watching `charges` for changes — would compile, deploy, and silently
> never fire.

The device recomputes outstanding from `packages/shared`, using the same `fifo.ts` and
`charges.ts` that `parity.test.ts` already pins against the SQL.

**Scoping re-checks the role.** `sync_pull` requires `role = 'collector' and status =
'active'` when resolving permitted collectors rather than trusting `collector_assignments`
alone. Migration 0007's own comment predicted this reader:

> Phase 3's sync scoping keys off these rows directly and does not re-check, so a
> supervisor named in `collector_assignments`, or a collector promoted while still
> assigned, becomes a real scoping fault there.

The guard triggers that comment introduced make the table safe; the re-check makes the
reader safe independently. Both, not either.

### 4.3 `POST /sync-push`

Body `{ credential_id, secret, entries: [...] }`. Calls `sync_push(device_id, entries)`,
which loops with a subtransaction per entry (D8) and returns one result per entry in
order.

| Type | Handling |
| --- | --- |
| `collection` | `post_collection()`. Unchanged from Phase 2 — §6.2 is not reimplemented. |
| `spoiled_form` | Insert into the existing `spoiled_forms`, idempotent on `(booklet_id, or_no)`. |
| `shift_open` | Insert `shifts` with status `open`, idempotent on the client id. |
| `shift_close` | `close_shift()` — §5. |

**Two fields the push overrides rather than trusts:**

- **`device_id` comes from the authenticated credential and never from the payload.** A
  device may claim any `collector_id` it likes — the PIN was verified offline, so that
  claim is unverifiable by construction and §11.5 accepts this — but it must not be able
  to claim to be a different tablet, because that would let one device push receipts
  attributed to another's assignment.
- The claimed collector is checked against `can_collector_use_device()` before anything
  else, and then against the booklet inside `post_collection()`, which is where §11.5 puts
  the actual boundary.

**Rejections file exceptions, with one exception.** A `rejected` result inserts into
`sync_exceptions` — `on conflict (collection_uuid) do update` bumping `attempts` and
`last_seen_at` — *unless* the reason is `stale_allocations` (D6), which is retryable and
files nothing. `accepted` and `duplicate` file nothing.

**`or_already_used` is never collapsed into `duplicate`.** Phase 2's handover is explicit:
`post_collection` discriminates `unique_violation` by constraint name, and the
`collections_serial_spent_once` case means two different devices recorded the same OR
number — §6.3's case that no device can detect on its own. It **must** become a supervisor
exception. Collapsing it would make the device discard a real receipt for money that was
actually collected.

### 4.4 `POST /closeout`

Body `{ credential_id, secret, shift_id, declared_total, device_count, device_total }`.
Calls `close_shift()`. Described in §5 because the reconciliation rules are the substance.

### 4.5 What the Functions do not do

They do not compute, scope, validate or reconcile. A Function that starts accumulating
business logic is a Function that has begun to be a second implementation of §6, and D1
exists to prevent that.

---

## 5. Closeout

`close_shift(p_shift_id, p_device_id, p_declared_total, p_device_count, p_device_total)`
runs §6.5 in order.

1. Resolve the shift; it must belong to the authenticated device.
2. Compute the server's own count and sum of collections for that collector and business
   date, **net of cancellations** — `collection_cancellations` already exists and Phase 2's
   `charge_balances` already excludes cancelled collections; the same exclusion applies
   here or a cancelled receipt would inflate the figure a collector is asked to match.
3. **If the device's count or sum disagrees, return `mismatch` with both sides and write
   nothing. The shift stays open.**
4. If they agree, close: `status = 'closed'`, record `declared_total`, `system_total`,
   `system_count`, and `variance = declared_total − system_total`.

### 5.1 Two comparisons, and conflating them would be a real bug

| Comparison | Meaning | Consequence |
| --- | --- | --- |
| Device count/sum vs. server count/sum | **Records** are missing on one side | **Blocks closeout.** §6.5 step 4. |
| Declared cash vs. server sum | The **drawer** is short or over | **Recorded, never blocking.** §6.5 step 5. |

A collector ₱50 short still closes their shift — with the ₱50 on the record, which is the
entire point of *"variance is recorded, not hidden."* A collector whose tablet holds a
receipt the server has never seen does **not** close, because the difference is not cash,
it is a missing record, and §6.5 calls this *"what makes silent data loss impossible to
overlook."*

Blocking on a cash variance would be worse than useless: it would give a collector who is
short a direct incentive to adjust the declaration until it matched.

### 5.2 `closed_unsynced` is a device-side state

It is what a tablet writes locally when closeout happens with no signal. The server never
mints it. When the device eventually reaches the network, the same `shift_close` entry is
pushed and `close_shift` either reconciles it to `closed` or returns the mismatch.

Until then the shift is invisible to the server — which is exactly why D5 adds
`shift_open`, and why the supervisor screen in §6 lists shifts still open past their
business date as the thing to chase.

### 5.3 Step 1 belongs to the device

§6.5 step 1 is *"force sync; outbox must reach zero pending."* That is a device-side
precondition and belongs to Phase 3b. The server's contribution is step 3: if the device
still holds unpushed receipts, its count will not match and closeout is refused. The rule
is enforced by arithmetic, not by trusting the device to have tried.

---

## 6. Web

Two screens under `apps/(admin)`, following Phase 2's pattern: server components reading
through RLS, writes through RPC in `actions.ts`.

### 6.1 Exceptions queue

Supervisor and admin. Lists open and escalated exceptions, oldest first, with
`reason_code`, collector, device, `attempts`, `first_seen_at`, and the pushed payload
rendered readably rather than as raw JSON — a supervisor resolving an `or_already_used`
needs to see which OR number and which lease, not a blob.

§11.3's three actions, each through an RPC that checks the caller's role internally, the
way `condone_charge` and `cancel_collection` already do:

| Action | Writes |
| --- | --- |
| Accept with correction | Re-runs `post_collection` with the **original UUID** and the supervisor's corrected claims (D9). On `accepted`, marks the exception `resolved`/`corrected`. On a second rejection, the exception stays open and the new reason is recorded. |
| Mark spoiled | Writes `spoiled_forms` for that serial; marks the exception `resolved`/`spoiled`. No collection is posted. |
| Escalate | Sets `status = 'escalated'`. Still unresolved, still counted. |

A written reason is required on all three, by constraint (§3.3) as well as by the form.
Each writes an `audit_log` row, per §11.4.

### 6.2 Shift verification

Supervisor, admin and accounting. Shifts by business date with status, collector, device,
`system_total`, `declared_total` and `variance`, with two states surfaced deliberately:

- **Open past their business date** — a tablet that never closed out, which is the
  condition nothing else in the system will report.
- **Non-zero variance** — with the sign, since over and short are different problems.

Read-only in Phase 3a. Verification and remittance are Phase 6.

### 6.3 Collector PIN

Admin only, on the existing staff screen. Calls `set_collector_pin()` (D10). The form takes
a 6-digit PIN and shows it back never — there is nothing to show, since only the bcrypt hash
is kept.

The screen must state plainly that a PIN reaches the collector's device only on that
device's next sync. §14 of the parent spec already records the consequence as a known
limitation: *"a collector who forgets mid-round offline cannot sign in."* A supervisor who
resets a PIN believing it takes effect immediately has sent a collector out unable to work.

### 6.4 Device credential issue

Extends the existing device registration screen. Admin only. Issuing generates a random
256-bit secret, stores its hash, and **displays the secret exactly once** with the
`credential_id`, for enrollment. Re-issuing revokes the previous credential in the same
transaction.

There is no "show me the secret again". It is not recoverable from the hash and the screen
says so, because a screen that appears to offer recovery invites a support process that
cannot exist.

---

## 7. `packages/shared`

Additions, all pure TypeScript, no React Native (§4):

- **`sync-contract.ts`** — zod schemas for the three request and response bodies, and the
  push entry union. The device validates outgoing entries against the same schemas the
  server's tests validate responses against, so a contract drift is a type error in both
  apps rather than a runtime surprise in one.
- **`reason-codes.ts`** — gains `stale_allocations` (D6) and a `RETRYABLE_REASONS` set. The
  device branches on membership rather than on a literal, so adding a retryable reason
  later does not mean finding every `if` that named this one.
- **`shifts.ts`** — variance arithmetic in integer centavos, and the device/server
  comparison, shared by the app and by the parity test.

`db.types.ts` is regenerated once the migrations land, and `check-types-current.sh` keeps
it honest.

---

## 8. Testing

### 8.1 Where each layer is proved

| Layer | Harness | Covers |
| --- | --- | --- |
| SQL functions | `tests/db`, Vitest, real Postgres | Scoping, idempotency, isolation, reconciliation, privileges |
| Edge Functions | Vitest over `supabase functions serve` | Authentication, transport, response shape, revocation |
| `packages/shared` | Vitest, Node | Contract schemas, variance arithmetic |
| Parity | `parity.test.ts` | TS and SQL agree on shared fixtures |

The HTTP layer gets a small, deliberate set — enough to prove the thing that is deployed
is the thing that works, not a second copy of the logic tests.

### 8.2 Properties that must be pinned, and their mutations

Phase 2's handover closes with a warning worth honouring: *"five classes of vacuous test
were found in this phase's own plan — tests that passed whether or not the thing they
named worked. The technique that caught them was mutation."* Every property below names
the mutation that must break it.

| Property | Mutation that must fail it |
| --- | --- |
| Push overrides `device_id` from the credential | Trust the payload's `device_id`; a device pushing another's id must stop being rejected |
| A poison entry does not roll back its batch | Remove the per-entry exception block; entries 1, 2 and 4 must stop being accepted |
| One exception row per `collection_uuid` | Drop the unique; re-pushing must stop being idempotent |
| `stale_allocations` files no exception | File one anyway; the count must change |
| `or_already_used` is not `duplicate` | Collapse the constraint discrimination; the exception must vanish |
| Device/server mismatch blocks closeout | Compare only the sum, not the count; a shift with a matching sum and wrong count must close |
| Cash variance does **not** block closeout | Block on non-zero variance; the short shift must fail to close |
| Epoch mismatch forces full re-sync | Stop bumping the epoch; a reassigned device must keep stale rows |
| One open shift per device | Drop the partial unique; a second `shift_open` must succeed |
| `sync_pull` re-checks collector role | Remove the `role` predicate from the join |
| `ceedo_app` holds no table privilege | Grant it `SELECT` on `collections`; a direct PostgREST read as `ceedo_app` must start succeeding |
| `device_credentials` is readable by nobody | Add a staff read policy; the outsider test must start failing |

The last two are the kind Phase 2's `anon reads nothing` test failed to be: they must
assert against a role that would otherwise *succeed*, not one already denied at schema
level.

### 8.3 Concurrency

Phase 2 demonstrated the FIFO lock by racing two posts and showing the damage without it.
Phase 3a is the first phase where that race is the *normal* case, so it is tested at the
push layer too: two devices pushing overlapping allocations for one lease, asserting one
`accepted` and one `stale_allocations`, and asserting that the loser files no exception.

### 8.4 Suite hygiene, inherited

Unchanged and non-negotiable, from Phase 2's handover: the root script is
`vitest run --no-file-parallelism` (`fileParallelism` in a project config is silently
ignored by the root runner), and `supabase db reset` runs before the suite because the
ledger is append-only and charges accumulate across runs until `run_surcharge`'s
system-wide scan exceeds the default timeout.

---

## 9. Risks and known limits

**`run_surcharge` still scans `charge_balances` system-wide.** Phase 2 flagged this as the
first concrete performance signal: 45,010 charges across 258 leases already exceeded a
5-second test timeout, against §8.1's projection of ~200,000 rows a year. Phase 3a does not
make it worse — nothing here is on the nightly path — but Phase 3b puts real devices behind
it and the named upgrade path remains a materialised `charge_balances` with a scheduled
refresh.

**First-sync payload size is unmeasured.** §6.1 estimates "a few megabytes," but that
estimate predates D-mandated `collections` and allocations in the pull. A delinquent daily
stall contributes ~1,460 charge rows and now its collections too. Phase 3a should measure a
realistic first sync and record the figure; if it is large, the answer is pagination on the
cursor, which the design already permits because the cursor is resumable.

**The sequence cursor can skip a row under a concurrent long-running writer.** `sync_pull`
reads `last_value` from `row_version_seq` as the response's high-water mark. A transaction
that has already reserved a lower `nextval()` but commits *after* that read produces a row the
device will never see again, because its next cursor is already past it. This is inherent to a
bare-sequence cursor under read-committed isolation — it is not introduced by any migration
here, and §5.7's reasoning for preferring a sequence over a timestamp still holds. Negligible
at this write volume, but it is the reason a device's full re-sync path (D7's epoch) must stay
working: it is the only thing that recovers a skipped row.

**Closeout reconciles by collector and business date, not by shift.** `close_shift` computes
the server's figures from `(collector_id, business_date)`, which is §6.5 step 3 taken
literally. That assumes one collector, one device, one shift per date. Two cases break it: a
collector working two tablets, and a second shift opened on the same device later the same day
— which `shifts_one_open_per_device` deliberately permits, since it forbids only
*simultaneously* open shifts.

Both **fail safe**: the server's figures are a superset of what the closing device knows, so
its count falls short, the mismatch branch returns before any write, and the shift stays open.
An honest closeout is refused and needs a supervisor; no other shift's money is ever silently
absorbed into this one's variance.

Scoping by `device_id` was rejected as a trap — it fixes the rarer two-device case while
leaving the likelier same-device case untouched and looking fixed. Scoping by the shift's time
window was rejected as strictly worse: a collection queued before `shift_open` is acked can
carry `collected_at < opened_at` and would be dropped invisibly, turning a safe over-block into
an under-count that closes cleanly. The real fix is `shift_id` on `collections`, which needs a
`post_collection` payload change and belongs in Phase 3b alongside the device-side closeout.

**Subtransaction count per push** (D8) — bounded by round size, fine at this scale,
chunking is the fallback.

**The PIN remains a 20-bit secret on a device that may be stolen** (D3). Mitigated, not
solved, and §11.5 already says the booklet is the boundary.

**`closed_unsynced` shifts can accumulate unnoticed** if no one reads the shift screen.
Phase 3a builds the screen; it does not build alerting. Phase 6's Treasurer dashboard is
where that belongs.

---

## 10. Invariants added by this phase

Extending Appendix A:

21. A device's `device_id` on any pushed record comes from its authenticated credential,
    never from the payload.
22. One entry's failure in a push never rolls back another entry in the same push.
23. A rejected entry produces exactly one `sync_exceptions` row per client UUID, no matter
    how many times it is re-pushed.
24. Exactly one rejection reason is retryable, and a retryable rejection files no
    exception.
25. Closeout is refused while device and server disagree on count or sum; it is never
    refused over a cash variance.
26. `ceedo_app` holds `EXECUTE` on four functions and no privilege on any table.
27. A device credential secret is never readable after issue, by any role, through any
    path.

---

## 11. Open questions

| Question | Assumption if unanswered |
| --- | --- |
| Does the ordinance permit a collector to void a receipt in the field? | **No** (D4) — spoil the form and reissue, as the paper process does |
| How long are resolved exceptions retained? | Indefinitely; they are small and they are audit evidence |
| Should a device be able to pull while its shift is closed? | **Yes** — pull is scoped to the device, not the shift, and a tablet must be able to sync before anyone signs in |
| Real first-sync payload size | Measured in Phase 3a and recorded; pagination if needed (§9) |

Carried forward, unresolved, from Phase 2 and still needing the client before go-live:
**a monthly lease starting mid-month is not billed for that month.** Phase 2's handover
§"One open question for the client" states the reasoning and the one-line fix.
