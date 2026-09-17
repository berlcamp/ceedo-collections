# CEEDO Collections — Phase 2 (Ledger) Design

**Date:** 2026-09-18
**Status:** Approved for planning
**Scope:** Charge ledger, accrual, surcharge, settlement, condonation, and the web
screens that make arrears and aging correct before any device exists.
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Predecessor:** `docs/superpowers/phase-1-handover.md`

This document is an addendum, not a replacement. The parent spec governs everything it
covers. Where this one overrules it, §2 says so explicitly and gives the reason.

---

## 1. What Phase 2 ships

Spec §16 says Phase 2 ships when *"arrears and aging are correct on the web before any
device exists."* A ledger in which nothing is ever paid cannot demonstrate that: FIFO
settlement, invariant #9, and a running balance all require a payment to exist.

Phase 2 therefore builds both halves of the ledger:

| In scope | Out of scope (and where it lands) |
| --- | --- |
| `charges`, surcharge, condonation | Collector app, offline sync (Phase 3) |
| `collections`, allocations, lines, cancellations | QR cards and scan flow (Phase 4) |
| Nightly accrual job and its run log | Parking / terminal / slaughterhouse rates (Phase 5) |
| Settlement engine (`post_collection`) | Excel and PDF export (Phase 6) |
| Collection browser with supervisor cancel | Edge Functions and `ceedo_app` wiring (Phase 3) |
| Subsidiary ledger, aging, delinquency views | Shifts, remittances, sync exceptions (Phase 3) |
| | **Any web payment path — see below** |

**Collections originate only on the collector app.** There is no treasury window, no office
payment screen, and no web path that posts a receipt. Every collection in this system is
recorded in the field on a tablet against a pre-printed OR, and reaches the database
through Phase 3's `sync-push`.

**The ledger tables and the settlement engine are still built in Phase 2, driven by tests
rather than by a UI.** Splitting it this way is deliberate:

- Phase 3 inherits a settlement engine that is already proven. Landing FIFO validation,
  booklet authorization, idempotency, offline sync, the outbox and closeout together would
  make a settlement bug nearly impossible to isolate from a sync bug.
- The ledger tables get created under Phase 1's withheld-privilege discipline now, while
  that discipline is fresh, rather than during the busiest phase.
- FIFO ordering, invariant #9 and the cancelled-collection rule (§4.2) get tested this
  phase, at a SQL prompt, instead of first meeting reality on a tablet over bad signal.

The consequence, stated plainly: Phase 2's ship criterion — "arrears and aging are correct
on the web" (§16) — is demonstrated for **charges** through the web, and for **settlement**
through the test suite. No screen in Phase 2 shows a payment, because until a tablet exists
there are no payments to show.

## 2. Decisions that overrule or extend the parent spec

| # | Parent spec says | This phase does | Why |
| --- | --- | --- | --- |
| D1 | `charges` has a `status` column (§5.4) | **No `status` column** | §11.2 grants no `UPDATE` on `charges` to any role. A status column that can never be written stays `unpaid` forever, including after payment. The two statements cannot both hold. |
| D2 | `collections` has a `status` column (§5.4) | **No `status` column** | Identical contradiction, identical resolution. Cancellation is the existence of a `collection_cancellations` row. |
| D3 | Accrual is "a nightly job" (§8.1) | `pg_cron` calling a `SECURITY DEFINER` function | The job never leaves the database: no key to leak, no endpoint to attack, no network hop that fails silently at 2am. |
| D4 | Accrual covers "elapsed periods" (§8.1) | Never before the **cutover date** | Taken literally, a stall let in 2023 raises ~1,000 charges that were already paid in cash on paper, and every tenant shows as catastrophically delinquent on day one. |
| D5 | `charge_type` is `rental \| surcharge` (§5.4) | Adds `opening_balance` | Pre-cutover arrears must enter the ledger as a fact, not as a thousand fabricated period charges. |
| D6 | Ledger tables grant `SELECT, INSERT` (§12.3) | `authenticated` gets **`SELECT` only** | All writes go through `SECURITY DEFINER` functions, so a compromised admin JWT talking directly to PostgREST cannot write even a bare allocation row. |
| D7 | — | **No web payment path at all** | Collections are recorded on the collector app only. A second, office-side way to post a receipt would be a second thing to keep correct and the weaker of the two to abuse. |

### D1/D2 in full — paid state is derived, never stored

A charge is a fact: this lease owed this amount for this period, due this date. Whether it
is settled is a *conclusion* drawn from the allocations pointing at it and any condonation
against it. That conclusion lives in the `charge_balances` view.

The value is not tidiness. With no mutable field there is nothing to fight over: no hotfix
that marks arrears paid, no path by which the ledger and its own summary disagree, and no
second source of truth that can silently drift from the allocations — a drift that, when it
happens, gives no signal about which side is lying. Aging, the subsidiary ledger,
delinquency and FIFO all read one view, so they cannot disagree with each other.

The cost is that arrears queries join through a view. §9 records the mitigation and the
upgrade path.

**Consequence reaching into Phase 3.** Sync pull (§6.1) sends unpaid charges on a
`row_version` cursor. A derived view has no `row_version`, so a charge settled on one
tablet bumps nothing that a second tablet is watching — and with shared devices and
rotating collectors, two tablets holding the same lease is routine, not an edge case. The
resolution: the *collection* carries a `row_version`, a device receives collections
affecting its leases, and recomputes outstanding locally using the same `packages/shared`
rules. Phase 3 must not assume a charge row changes when it is paid, because it does not.

### D4/D5 in full — the cutover

A single system-wide `cutover_date` on a one-row `settings` table. The accrual job never
raises a charge whose `period_start` precedes it.

Pre-cutover arrears enter as one `opening_balance` charge per lease:

| Column | Value |
| --- | --- |
| `amount` | The reconciled paper figure, penalties already included |
| `period_start`, `due_date` | The **actual oldest unpaid date** from the paper record |
| `period_end` | `cutover_date - 1 day` |
| `surcharge_bps` | `0` — the surcharge job skips it |
| `authority_ref` | Who reconciled the paper ledger, and against what |

Setting `due_date` to the real oldest unpaid date rather than the cutover date is what
makes aging honest: two-year-old debt buckets as over 90 days, not as current. It also
sorts the opening balance first in FIFO, which is both correct and how the office already
works.

**No surcharge on an opening balance.** The paper figure already carries accumulated
penalties; a fresh 3% charges twice for the same delinquency.

## 3. Schema

**Six ledger tables** (§3.1–3.4), append-only, each carrying `row_version bigint` fed by
`ceedo_collections.row_version_seq` via trigger, per the global constraint — plus **two
supporting tables** (§3.5) that are deliberately outside that regime. §3.6 covers audit
attachment, §3.7 the privilege model.

### 3.1 `charges`

```
id                uuid pk
lease_id          uuid not null → leases
fee_type_id       uuid not null → fee_types
charge_type       text not null  -- rental | surcharge | opening_balance
parent_charge_id  uuid → charges  -- surcharge only
period_start      date not null
period_end        date not null
due_date          date not null
amount            numeric(14,2) not null, > 0
surcharge_bps     integer not null default 0, 0..10000
source            text not null  -- accrual | opening_balance | manual
created_at        timestamptz not null default now()
created_by        uuid → app_users  -- null for the accrual job
row_version       bigint not null
```

Constraints:

| Constraint | Guards |
| --- | --- |
| unique `(lease_id, period_start) where charge_type = 'rental'` | **Accrual idempotency** (§8.1). This index *is* the idempotency; the job does not check before inserting. |
| unique `(parent_charge_id) where charge_type = 'surcharge'` | Invariant #6 — one surcharge per rental charge, ever |
| unique `(lease_id) where charge_type = 'opening_balance'` | One opening balance per lease |
| check: `surcharge` has a parent; `rental` and `opening_balance` do not | Structural integrity of the period group |
| check: `opening_balance` has `surcharge_bps = 0` | D5 |
| A surcharge's `period_start`, `period_end` and `due_date` mirror its parent rental charge | Keeps the period group a single unit for FIFO and aging; a surcharge is never owed on a different date than the rent it penalises |
| check: `period_end >= period_start` | |

Indexes: `(lease_id, due_date)` and `(due_date) where charge_type <> 'surcharge'` for aging.

### 3.2 `charge_condonations`

```
id             uuid pk
charge_id      uuid not null → charges
amount         numeric(14,2) not null, > 0
authority_ref  text not null   -- ordinance number
reason         text not null
condoned_by    uuid not null → app_users
condoned_at    timestamptz not null default now()
row_version    bigint not null
```

Append-only, admin-only, audit-logged (§8.4, §11.4). `condoned + allocated <= amount` is
enforced inside `condone_charge()`, not by a table check — the rule spans rows.

### 3.3 `collections`

```
id             uuid pk          -- CLIENT-GENERATED, no default
or_no          integer not null
booklet_id     uuid not null → booklets
collector_id   uuid not null → app_users
device_id      uuid not null → devices
collected_at   timestamptz not null
business_date  date not null    -- Asia/Manila, see §5
fee_type_id    uuid not null → fee_types
lease_id       uuid → leases    -- null for cash-only streams
payer_ref      text
gross_amount   numeric(14,2) not null, > 0
notes          text
synced_at      timestamptz
posted_at      timestamptz not null default now()
posted_by      uuid → app_users
row_version    bigint not null
```

`id` has **no default**. A client-generated UUID is what makes posting idempotent
(invariant #2); a server default would silently mint a second receipt on every retry.

`device_id` is `NOT NULL`. Every collection is recorded on a tablet (D7), so a collection
with no device is not a special case to allow for — it is a bug, and the column says so.

Unique `(booklet_id, or_no)`. A serial is spent exactly once across the whole system. This
index is the only mechanism that catches the same OR number recorded on two different
devices — the case §6.3 notes a device physically cannot detect.

### 3.4 `collection_allocations`, `collection_lines`, `collection_cancellations`

```
collection_allocations:  id, collection_id → collections, charge_id → charges,
                         amount numeric(14,2) > 0, row_version
                         unique (collection_id, charge_id)

collection_lines:        id, collection_id → collections, fee_type_id → fee_types,
                         rate_class text, quantity integer > 0,
                         unit_rate numeric(14,2) not null,
                         amount numeric(14,2) generated always as
                           (quantity * unit_rate) stored,
                         row_version

collection_cancellations: id, collection_id → collections UNIQUE, reason text not null,
                         cancelled_by → app_users, cancelled_at, row_version
```

`collection_lines.amount` is a generated column: quantity × rate cannot be recorded
inconsistently because it is not recorded at all.

`collection_cancellations.collection_id` is unique — a receipt is cancelled once.

**Invariant #9** (allocations + lines = `gross_amount`) is enforced by a **deferred
constraint trigger** checked at commit, because the parts are inserted after the parent
row within the same transaction.

### 3.5 Supporting tables (operational, not ledger)

Two tables outside the append-only regime, because their job is to record and be corrected
rather than to hold cash facts.

```
settings:      id boolean pk default true, check (id)   -- one row, enforced
               cutover_date date not null
               updated_at, updated_by → app_users

accrual_runs:  id uuid pk
               business_date date not null
               started_at timestamptz not null
               finished_at timestamptz
               charges_raised integer not null default 0
               surcharges_raised integer not null default 0
               status text not null   -- running | succeeded | failed
               error text
               unique (business_date, started_at)
```

`settings` is a one-row table: `id boolean primary key default true` with
`check (id)` admits exactly one row and no more, so there is no way to end up with two
cutover dates and no way to guess which one applies. Writable by admin only, audit-logged —
moving the cutover date after go-live changes what the accrual job will raise, which is
consequential enough to need an actor's name against it.

`accrual_runs` carries `UPDATE` (the job marks its own completion) and is therefore
explicitly **not** a ledger table. Nothing in it is a cash fact.

### 3.6 Audit attachment — deliberately partial

Phase 1's `attach_audit(table_name)` installs a trigger recording every insert, update and
delete into `audit_log`. Phase 2 attaches it to **`charge_condonations`,
`collection_cancellations` and `settings` only.**

Not to `charges`, `collections`, `collection_allocations` or `collection_lines`. Those
tables are already immutable, already timestamped, and already carry their actor — they
*are* the audit record. Attaching the trigger would copy every row into `audit_log` a
second time, doubling a table that §8.1 puts at ~200,000 rows a year, and would record no
fact that reading the ledger does not already give you.

The three that do get it are the discretionary acts — writing off a debt, voiding a
receipt, moving the cutover date. §11.4 names condonation explicitly. These are low-volume
and are precisely the actions where "who decided this, and when" is the question asked
later.

### 3.7 Privileges — the guarantee

```sql
grant select on <every ledger table> to authenticated, service_role;
revoke insert on <every ledger table> from service_role;
-- No INSERT, UPDATE or DELETE to any client role. Inserts happen as the
-- SECURITY DEFINER functions' owner, and only after validation.
```

Phase 1's `ALTER DEFAULT PRIVILEGES` already withholds `UPDATE`/`DELETE` from
`service_role` on every table this schema will ever contain, so nothing needs revoking
there — the append-only property holds because nothing granted more.

`INSERT` is different, and this is the one place Phase 2 must actively revoke rather than
inherit. That same default grants `select, insert` to `service_role` on every future table,
which would hand `service_role` a direct write path into the ledger the moment these tables
are created. **Each ledger table's migration revokes `INSERT` from `service_role`
explicitly.** Without it, invariant #20 is false on the day it is written.

D6 withholds `INSERT` from `authenticated` for the same reason. Every write lands through a
`SECURITY DEFINER` function that validates first, inserting as the function's owner. The
practical effect: there is no way to write an allocation row that did not pass FIFO
validation — not from an admin session token, and not from the break-glass key.

This does mean **test fixtures cannot insert ledger rows directly**; they go through
`run_accrual`, `record_opening_balance` and `post_collection` like everything else. That is
a feature — it means the tests exercise the real write path — but it shapes how every test
in §8 is set up, so it is worth knowing before writing the first one.

RLS is enabled on every table with policies joining through `ceedo_collections.app_users`,
never resting on `authenticated` (§12.1, invariant #8).

## 4. The settlement engine

One function writes collections. The web calls it now; Phase 3's `sync-push` calls the
same function rather than reimplementing §6.2.

```
post_collection(payload jsonb) → { status, reason_code, collection_id }
  status: accepted | duplicate | rejected
```

`SECURITY DEFINER`, `set search_path = ceedo_collections, pg_temp`, one transaction.
Executes §6.2 in order:

1. **Idempotency** — `insert … on conflict (id) do nothing`. Not inserted → `duplicate`.
   Never a second receipt.
2. **Authorize** — booklet assigned to this collector at `collected_at`, `or_no` inside
   its serial range, serial unconsumed, serial not spoiled.
3. **Recompute** — allocation totals against `charge_balances`; line `unit_rate` resolved
   from the rate table as of `collected_at`. The caller's figure is a claim to be checked,
   never truth (invariant #3).
4. **FIFO** — allocations form a contiguous oldest-first prefix of unpaid period groups,
   and each settles its charge **in full**. Whole periods only (§8.3, §14).
5. **Write** — collection, allocations and lines in one transaction.
6. **Respond** — with a reason code from the shared vocabulary (§6).

Companion functions, each checking the caller's `app_users` role internally, each
append-only, each audit-logged:

| Function | Role | Effect |
| --- | --- | --- |
| `cancel_collection(id, reason)` | supervisor, admin | Inserts a cancellation row |
| `condone_charge(charge_id, amount, authority_ref, reason)` | **admin only** (§8.4) | Inserts a condonation row after checking it does not exceed outstanding |
| `record_opening_balance(lease_id, amount, oldest_unpaid_date, authority_ref)` | admin only | One per lease |

`EXECUTE` is revoked from `public` on every one of them and granted explicitly, following
the pattern migration 0001 established for `next_row_version()`.

**`post_collection` is granted to no web role.** With D7 there is no web caller: the
function exists in Phase 2 to be tested and to be called by Phase 3's `sync-push`. Phase 2
grants `EXECUTE` to `service_role` **only so the integration tests can reach it through
PostgREST** — the function validates its input identically whoever calls it, so this widens
what the break-glass key can do only to "post a receipt that passes every check." Phase 3
grants `EXECUTE` to `ceedo_app` and revokes it from `service_role`, at which point no role
outside the sync path can call it at all.

`cancel_collection`, `condone_charge` and `record_opening_balance` are granted to
`authenticated`, because each has a real web caller and each checks the caller's
`app_users` role internally.

### 4.1 One definition of what is owed

`unpaid_period_groups(lease_id)` returns the FIFO-ordered groups — each a rental charge
with its surcharge, or an opening balance — with amounts outstanding.

**Ordering is `(due_date, period_start)`, ascending.** Naming the key matters: an opening
balance carries the real oldest-unpaid date from the paper record (D4), which places it
before every accrued period without any special case in the ordering. Ordering by
`created_at` instead would put it last, and a tenant would settle this month's rent while
two years of arrears sat untouched — the exact failure FIFO exists to prevent.

It is read by `post_collection`'s FIFO validator, by Phase 3's sync pull, and by Phase 4's
entry UI. "What does this tenant owe, and in what order" therefore has exactly one
definition in the system.

### 4.2 A cancelled collection stops counting

`charge_balances` excludes allocations whose collection has a cancellation row. This is
how a mistaken payment is undone without an `UPDATE`, and it is easy to omit: a balance
view that forgets the cancellation join reports money that was never really received.
Tested explicitly (§8).

## 5. Accrual and surcharge

```
run_accrual(business_date date)   → raises rental charges
run_surcharge(business_date date) → raises surcharges
```

Both `SECURITY DEFINER`. Both wrapped in an `accrual_runs` row — business date, started,
finished, rows raised, error text. After an outage the first question is always "did last
Tuesday actually run?", and a job with no log cannot answer it. `accrual_runs` is
operational, not ledger, so it is freely updatable.

**Scheduling.** `pg_cron`, nightly at **18:00 UTC = 02:00 Manila** — after the business
day closes, before a 5am market round.

**The business date is `(now() at time zone 'Asia/Manila')::date`, never the UTC date.**
On a UTC server the two differ for eight hours of every day, and the failure looks like
randomly missing charges rather than like a timezone bug.

**Accrual.** For each active lease, raise rental charges for every elapsed period from
`greatest(lease.start_date, settings.cutover_date)` through the business date, at the
lease's `accrual_period`, at `lease.rate_amount`. Idempotency is the unique index (§3.1),
so a re-run after an outage raises only what is missing.

`due_date` by period:

| Accrual period | `due_date` |
| --- | --- |
| daily | the day itself |
| weekly | `period_end` |
| monthly | the lease's `due_day` in that month |

**No month-length clamping is needed, and none should be written.** Phase 1's
`leases.due_day` carries `check (due_day between 1 and 28)`, so a monthly due date can
never fall on a day that some month lacks. Adding defensive clamping here would be dead
code implying a case the schema already made unreachable.

The calendar-month edge the parent spec raises in §8.2 — a 31 January charge becoming
delinquent on 28 February — still occurs, but through **daily** accrual, where `due_date`
is the day itself and can legitimately be the 31st. §5's surcharge test must therefore use
a daily lease, not a monthly one.

**Surcharge** (§8.2). For each unpaid rental charge where
`business_date > due_date + interval '1 month'`, insert one surcharge charge:
`parent_charge_id` pointing at the rental, `amount = floor((amount * bps + 5000) / 10000)`
with `bps` from `fee_types.surcharge_bps`, and that `bps` **stamped onto the row** so a
later ordinance cannot alter a receipt already issued. One-time, never compounding, guarded
by the unique index. Postgres calendar arithmetic gives 31 January → 28 February, as §8.2
requires. Opening balances are excluded (D5).

## 6. `packages/shared`

Pure TypeScript, no React Native, no supabase-js — the parent spec's §4 constraint holds.

| Module | Contents |
| --- | --- |
| `charges.ts` | Period generation, due-date derivation with month clamping, surcharge computation |
| `fifo.ts` | Period-group ordering, prefix validation, amount-driven selection returning change |
| `reason-codes.ts` | The rejection vocabulary `post_collection` returns and Phase 3's device will speak |

**A parity test runs the TypeScript and the SQL against shared fixtures and asserts they
agree.** The device's copy of these rules is advisory — §7.1 is explicit that device checks
catch honest mistakes and the server re-validates authoritatively — but advisory is not the
same as free to diverge. A device that computes a different FIFO prefix than the server
accepts produces a rejection the collector cannot understand while holding a spent receipt.

## 7. Web

Five screens plus two actions, under `apps/web/app/(admin)/`:

| Screen | Role | Purpose |
| --- | --- | --- |
| Subsidiary ledger (per lease) | accounting, admin | Charges and payments interleaved, running balance |
| Aging of receivables | accounting, admin | 30 / 60 / 90 / over buckets |
| Delinquency list | accounting, admin, supervisor | Drives demand letters |
| Collection browser | all web roles | Read-only, with cancel action for supervisor and admin |
| Condonation action | **admin only** | Against an ordinance reference |
| Opening balance entry | admin only | One per lease, at cutover |

These are read-plus-RPC, not CRUD, so they sit **outside** the Phase 1 registry engine
rather than being forced into a shape built for master-data editing.

**The collection browser is empty until Phase 3, and built anyway.** Supervisors need the
cancel action the morning the first tablet syncs (§11.3), and building it now against a
tested engine is cheaper and safer than bolting it on while Phase 3 is also landing sync.
Cancellation is append-only: it inserts a `collection_cancellations` row and a written
reason is mandatory, per §11.3.

**No screen in Phase 2 posts a payment** (D7). Amount-driven FIFO entry is Phase 4's
interaction (§16); Phase 2 builds and tests the selection *logic* in `packages/shared`
(§6) so that Phase 4's UI has a proven rule to render, but ships no UI for it.

New money fields use `Centavos` end to end, converting only at the PostgREST boundary. The
2-decimal-float shortcut the Phase 1 handover lists under deferred minors is not extended
into the ledger.

## 8. Testing

In order of what matters most:

**The privilege test.** `UPDATE` and `DELETE` are refused on every ledger table for
`authenticated`, `anon` *and* `service_role`, and `INSERT` is refused for all three. This
single test guards the entire COA position. Everything below it is ordinary correctness.

**Accrual.**
- Run three times for the same date → identical row count
- Run five days late → five days raised, none doubled
- Never raises a charge before `cutover_date`
- Monthly `due_date` uses the lease's `due_day` directly; the 1–28 constraint means no
  clamping path exists to test

**Surcharge.**
- Raised once and only once per rental charge
- Never on an opening balance
- 31 January charge becomes delinquent 28 February — tested via a **daily** lease, since
  `due_day` is constrained to 1–28 and cannot produce a 31st monthly due date
- `₱83.50 × 3% = ₱2.51` — the exact case IEEE 754 gets wrong (`250.49999999999997`)

**`post_collection` rejections**, one test each: duplicate UUID, OR outside booklet range,
already-consumed serial, spoiled serial, booklet not assigned to that collector,
non-prefix allocation, partial-period allocation, amount mismatch.

**Balances.** Cancellation restores outstanding. Condonation reduces it. Over-condonation
is refused. Invariant #9's deferred trigger fires on a mismatched total.

**RLS.** An authenticated Google account with no `app_users` row sees zero ledger rows
(§12.1).

**Scenario — a market month, driven through the engine.** Accrue a month across several
leases at mixed accrual periods, let two fall past due into surcharge, settle some via
`post_collection`, cancel one collection, condone one charge; then assert that
`charge_balances`, the subsidiary ledger, aging and delinquency all agree with each other
and with hand-computed figures. This is the test that stands in for the UI Phase 2 does not
have, and it is the one that has to pass before Phase 3 starts.

## 9. Risks and known limits

| Risk | Handling |
| --- | --- |
| `pg_cron` must be enabled in the Supabase dashboard | Dashboard access confirmed. The migration **fails loudly** if the extension is absent rather than silently skipping the schedule — a silently unscheduled accrual is invisible until arrears are a month wrong. |
| `pg_cron` is instance-wide on a shared project | Job names are visible to other systems on the instance; no data is. Accepted. |
| View performance at ~200k charges/year (§8.1) | Indexes per §3.1. A materialised `charge_balances` with scheduled refresh is the upgrade path, deliberately **not** built now. |
| Timezone drift between UTC server and Manila business date | Business date computed in `Asia/Manila` at every boundary; tested. |
| Phase 3 assuming a charge row changes when paid | It does not (D1). Recorded here and in the handover. |

## 10. Invariants added by this phase

Extending Appendix A of the parent spec:

15. A charge is never updated or deleted; its settled state is derived from allocations
    and condonations.
16. A collection's cancelled state is the existence of a cancellation row, never a field.
17. An OR serial is consumed at most once across the entire system.
18. Accrual raises no charge whose period begins before the cutover date.
19. An opening balance exists at most once per lease and never accrues a surcharge.
20. Every ledger write passes through a validating `SECURITY DEFINER` function. No client
    role — `authenticated`, `anon` or `service_role` — holds a direct `INSERT` privilege on
    a ledger table.
