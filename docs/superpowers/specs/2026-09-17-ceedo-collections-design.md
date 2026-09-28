# CEEDO Collections — Design Spec

**Date:** 2026-09-17
**Status:** Approved for planning
**Scope:** Field collection and collections accounting for the City Economic Enterprise and Development Office (CEEDO)

---

## 1. Purpose

CEEDO collects revenue in the field across several enterprises: public market stall
rentals, ambulant vendor fees, parking, slaughterhouse fees, and terminal fees at the
Integrated Bus and Jeepney Terminal (IBJT). Collection is done daily, on foot, in
places with unreliable
mobile data.

This system provides:

- An **offline-capable Android app** for collectors to record collections against
  pre-printed official receipts.
- A **web application** for master data, supervision, and collections accounting.

It does **not** replace eNGAS. It produces subsidiary detail and the COA collection
reports; the Accounting Office keeps the books of account.

## 2. Revenue streams

| Stream | Charged | Creates a receivable |
| --- | --- | --- |
| Market stall rental | Per day, week or month, per lease | Yes |
| Surcharge | 3% once a rental passes one month unpaid | Yes |
| Ambulant / daily vendor fee | Per day, on the spot | No |
| Parking fee | Per entry | No |
| Terminal fee (IBJT) | Per entry, by vehicle class | No |
| Slaughter fee | Per head, by animal class | No |

Accrual frequency is a property of the **lease**, defaulting from its **section**.
Fish and meat may run daily while dry goods runs monthly.

## 3. Decisions and rationale

| Decision | Choice | Why |
| --- | --- | --- |
| Receipt issuance | Pre-printed OR booklets; app records the number | Office practice; keeps the app free of printer hardware |
| Accounting depth | Collections reporting + subsidiary ledgers | eNGAS remains the book of record; this fills the actual gap |
| Tenancy | Single LGU, single deployment | No tenant threading in schema or RLS |
| Android stack | Expo / React Native + TypeScript | One language across both apps; one shared wire contract and fee engine |
| Sync | Hand-rolled outbox, append-only | Writes are append-only and idempotent, so there are no conflicts to resolve; no vendor in the cash path |
| Payment order | FIFO, enforced | Prevents arrears being kept alive; simplifies the UI to a prefix selection |
| Surcharge | One-time 3%, simple (not compounding) | Bounded row count; explainable at the stall |
| Unsynced closeout | Permitted, flagged `closed_unsynced` | Blocking a collector over bad signal is unworkable |
| Database schema | `ceedo_collections` on a shared Supabase project | Existing infrastructure |
| Web authentication | Google Sign-In, invite-only | Staff use personal Gmail; no domain to restrict on |
| App authentication | Device credential + collector PIN | OAuth needs network at the moment a collector may have none |
| Device ownership | Shared, assigned per facility | Collectors rotate across tablets |

### Revisit triggers

The Expo decision should be revisited if any of the following becomes true:

- Collector devices are Android 9 or below, or have 2 GB RAM or less.
- The app must be locked into kiosk mode or managed by MDM.
- Sync must run headless, without a collector opening the app.
- Hardware is added: thermal printers, NFC, or barcode scanners.

**Device procurement recommendation:** Android 13+, 4 GB RAM, 64 GB storage,
5000 mAh battery. LGU-issued, never BYOD — cash records and tenant data should not live
on personal phones.

**Devices are shared.** A tablet is assigned to a facility or section and whoever is
rostered there that day signs in; supervisors may reassign a device, which forces a
re-sync before it is used elsewhere. Accountability is therefore anchored to the
booklet rather than to the device (§11.5).

## 4. Architecture

```
ceedo-collections/
├── apps/
│   ├── web/              Next.js — admin, supervision, accounting
│   └── collector/        Expo — Android collection app
├── packages/
│   ├── shared/           zod schemas, money, rate resolution, OR validation, sync contracts
│   └── db-local/         Drizzle schema for on-device SQLite
└── supabase/
    ├── migrations/       plain SQL — tables, RLS, triggers, views
    └── functions/        sync-pull, sync-push, closeout
```

**Schema ownership.** Postgres schema lives in plain SQL migrations under the Supabase
CLI, not in Drizzle — RLS policies, triggers and reporting views are SQL-native.
Web types come from `supabase gen types typescript --schema ceedo_collections` into
`packages/shared`. Drizzle is used only for the device's SQLite.

**Access paths differ by client and this is deliberate:**

| Client | Path |
| --- | --- |
| Web | Supabase directly — `supabase-js`, PostgREST, RLS |
| Collector app | Edge Functions only — never PostgREST |

The device must not write to tables directly. Posting a collection requires validating
the OR number against the collector's assigned booklet, checking it is unconsumed,
recomputing the amount from the server's rate table, and inserting the collection plus
its allocations in one transaction. RLS cannot express this. Direct PostgREST access
from a phone would let a modified client post any amount against any receipt number.

**`packages/shared` must not import React Native.** It is pure TypeScript, testable in
Node. If the collector app is ever rebuilt natively, the rate rules, OR validation and
sync contract — and their test suites — stay authoritative.

## 5. Data model

All money is `numeric(14,2)` in Postgres and **integer centavos** in TypeScript.
Rounding is **half-up to the centavo**, explicitly, and tested. Floats never touch a peso.

**Percentage rates are stored as integer basis points**, never floats — 3% is `300`.
A float rate misrounds exact half-centavo results — not through representation error but
through rounding **direction**: `0.03 * 8350` is exactly `250.5` in IEEE 754, and
`Math.floor(250.5)` is `250` where half-up gives the correct `251`. The integer form,
`floor((amount * bps + 5000) / 10000)`, carries half-up in the `+5000` and cannot drift.

### 5.1 Reference data

- `facilities` — id, name, code, type
  (`market` | `terminal` | `parking` | `slaughterhouse`)
- `sections` — id, facility_id, name, default_accrual_period
- `stalls` — id, section_id, stall_no, area_sqm, status
- `tenants` — id, name, address, contact
- `leases` — id, stall_id, tenant_id, start_date, end_date, rate_amount,
  accrual_period, due_day, status

**Leases, not stalls, are the billing unit.** Stalls get re-let; the lease preserves
each tenant's history across that.

**Only market facilities have sections and stalls.** The terminal, parking areas and
slaughterhouse are collection points with no tenancies — they carry rates and collection
lines, never leases or charges.

### 5.2 Rates

`fee_types` — id, code, name, accrues (bool), surcharge_bps (integer, 0–10000)

`rates` — id, fee_type_id, effective_from, effective_to, amount, basis
(`per_day` | `per_week` | `per_month` | `per_entry` | `per_head` | `per_sqm`),
rate_class

`rate_class` is the classifying dimension for per-unit fees: vehicle class at the
terminal, animal class at the slaughterhouse. One column rather than one per facility
type, so a new classified fee needs rate rows, not a migration.

Rate rows are **never updated in place**. A new ordinance inserts a new row with an
effectivity date, so historical receipts still recompute correctly.

### 5.3 Accountable forms

- `form_types` — OR 51, cash ticket, etc.
- `booklets` — id, form_type_id, serial_prefix, start_no, end_no, received_date, status
- `booklet_assignments` — id, booklet_id, collector_id, assigned_at, returned_at
- `spoiled_forms` — id, booklet_id, or_no, reason, recorded_by, recorded_at

Booklet lifecycle: `received → assigned → in_use → returned`. A returned booklet must
balance: **used + spoiled + unused = total serials**.

### 5.4 Ledger

`charges` — id, lease_id, fee_type_id, charge_type (`rental` | `surcharge`),
parent_charge_id, period_start, period_end, **due_date**, amount, surcharge_bps,
status, row_version

`collections` — **id (uuid, client-generated)**, or_no, booklet_id, collector_id,
device_id, collected_at, fee_type_id, payer_ref, gross_amount, notes, synced_at, status

`collection_allocations` — collection_id, charge_id, amount

`collection_lines` — collection_id, fee_type_id, rate_class, quantity, unit_rate, amount

`collection_cancellations` — collection_id, reason, cancelled_by, cancelled_at

**Two ways a collection is itemised, and they do not overlap.**
`collection_allocations` settles existing `charges` — market arrears. `collection_lines`
describes on-the-spot items as quantity × rate — twelve hogs at the per-head rate, or
several vehicle classes on one terminal receipt. Both sum to `gross_amount`.

**Cash-only streams create no charges.** Ambulant, parking, terminal and slaughterhouse
collections are `collections` rows with lines and no allocations. Only fee types with
`accrues = true` produce `charges`, and only those appear in aging and delinquency
reports.

**`due_date` is explicit on every charge.** For daily accruals it is the day itself;
for monthly leases it is the lease's `due_day`. Without an explicit column this gets
re-derived inconsistently in several places.

**Nothing is ever deleted or updated.** Corrections are cancellation or adjustment rows.
This is both what COA expects and what makes append-only sync sound — the same constraint.

### 5.5 Shift and remittance

- `shifts` — id, collector_id, business_date, opened_at, closed_at, declared_total,
  system_total, variance, status (`open` | `closed` | `closed_unsynced` | `remitted`)
- `remittances` — id, collector_id, deposit_slip_no, bank, amount, deposited_at, verified_by

### 5.6 Operations

- `app_users` — id (FK `auth.users`), employee_no, full_name, role, pin_hash, status
- `devices` — id, label, registered_at, credential_id, active, last_seen_at
- `device_assignments` — id, device_id, facility_id, section_id (nullable), active
- `collector_assignments` — id, collector_id, facility_id, section_id (nullable), active

An assignment names a **facility**, optionally narrowed to one section. A market
collector is assigned to the fish section; a terminal or slaughterhouse collector is
assigned to the facility with no section.

**Devices carry no collector.** Because tablets are shared, `devices` has no owner
column. A device's assignment determines **what data syncs to it**; a collector's
assignment determines **where that person may collect**. A collector may sign in to a
device only where the two overlap.
- `sync_exceptions` — id, collection_uuid, collector_id, reason_code, payload,
  status, resolved_by, resolved_at, resolution, resolution_reason
- `audit_log` — id, actor_id, action, entity, entity_id, before, after, at

### 5.7 Change tracking

Every synced table carries `row_version bigint` fed by one shared sequence
(`ceedo_collections.row_version_seq`) and bumped by trigger.

**The sync cursor is this sequence, not a timestamp.** Timestamps break on clock skew
and same-millisecond writes, and the failure mode is a silently skipped row — a missing
lease means a collector cannot record a payment.

## 6. Sync protocol

### 6.1 Pull — master data down

`POST /sync-pull` with `{ cursor: bigint, device_id }`, returning everything with
`row_version > cursor`, **scoped to the device's assignment** (§5.6):

- Facilities, sections, stalls, tenants and leases within those assignments
- The rate table, including `rate_class` rows for classified fees
- Their own booklet assignments, and consumed serials within them
- **Unpaid** charges for those leases, plus paid charges from the last 90 days for the
  history view

A tablet assigned to the fish section receives that section's data, not the terminal's.
Scoping to the device rather than the collector keeps the payload stable as collectors
rotate through the tablet. Booklet data is the exception: a device receives the booklet
assignments of every collector currently permitted to sign in to it.

A device assigned to the slaughterhouse or terminal receives rates and booklets only —
there are no tenancies or charges to carry. First sync is a few megabytes; deltas are kilobytes.
A tenant two years delinquent on a daily stall contributes roughly 1,460 rows, which
is acceptable.

### 6.2 Push — transactions up

`POST /sync-push` with `{ device_id, entries: [...] }`. Each entry carries the
client-generated UUID, a type (`collection` | `cancellation` | `spoiled_form` |
`shift_close`), a payload, and the device timestamp.

Per entry, server-side:

1. **Idempotency** — insert on conflict do nothing, keyed by the UUID. A retry after a
   dropped connection returns `duplicate`, not a second receipt.
2. **Authorize** — booklet assigned to this collector, OR number inside its range,
   unconsumed, not spoiled.
3. **Recompute the amount** from the rate table as of `collected_at`. The device's
   figure is a claim to be checked, never truth.
4. **Validate FIFO** — allocations must be a contiguous oldest-first prefix of that
   lease's unpaid period groups.
5. **Write** the collection and its allocations in one transaction.
6. **Respond per entry**: `accepted` | `duplicate` | `rejected` with a reason code.

### 6.3 Rejection handling

**A server rejection must never mean "discard the record."**

By the time the server sees a problem, the collector has handed a vendor a paper
official receipt and taken their money. That serial is spent. If the device drops the
entry, cash exists with no record — exactly the variance an audit will find.

Rejected entries therefore:

- Create a row in `sync_exceptions` for supervisor resolution.
- Remain visible on the device as unresolved.
- **Still count toward that collector's accountability at closeout.**

This is also the only mechanism that catches the case a device physically cannot
detect: the same OR number recorded on two different devices.

### 6.4 Device outbox

States: `pending → in_flight → acked | rejected`.

Acked entries are retained for closeout reconciliation and purged after 30 days.
Rejected entries are retained until resolved.

**Outbox entries carry `collector_id` and survive a change of collector.** On a shared
tablet, one collector's unsynced receipts must never be lost, cleared, or attributed to
the next person to sign in. Sync pushes every pending entry regardless of who is
currently signed in; signing out clears a session, never data.

### 6.5 Closeout reconciliation

Non-negotiable. At end of shift:

| Step | Rule |
| --- | --- |
| 1 | Force sync; outbox must reach zero `pending` |
| 2 | Device sends its own count and sum for the business date |
| 3 | Server returns its count and sum for that collector and date |
| 4 | Mismatch blocks closeout and displays the difference |
| 5 | Collector declares physical cash; variance is recorded, not hidden |
| 6 | Shift moves `open → closed → remitted` |

If genuinely offline, closeout proceeds with status `closed_unsynced`, and the shift
appears on a supervisor dashboard until it reconciles.

**A device permits only one open shift at a time.** A new collector cannot sign in while
the previous collector's shift is still open — the device requires a closeout first,
`closed_unsynced` if there is no signal. Without this rule a shared tablet accumulates
overlapping open shifts and the cash accountability cannot be untangled afterwards.

This check is what makes silent data loss impossible to overlook. Without it, a
hand-rolled outbox can lose a receipt and nobody learns until an audit.

## 7. Accountable forms

### 7.1 Device-side validation

The device holds its assigned booklets with serial ranges, plus locally consumed and
spoiled numbers. On OR entry it checks:

- The number falls inside a booklet assigned to this collector
- It is not already consumed locally
- Sequence — a skip raises a **soft warning**, not a hard block; booklets legitimately
  get skipped

The server re-validates all of it authoritatively. Device checks exist to catch honest
mistakes at the point of sale, not to be trusted.

### 7.2 Booklet reconciliation

On return, a booklet must balance: used + spoiled + unused = total serials.
This reconciliation is the Report of Accountability for Accountable Forms (RAAF).

## 8. Billing rules

### 8.1 Accrual

A nightly job walks active leases and raises charges for elapsed periods, keyed on
`(lease_id, period_start)` with a unique index. **The job is idempotent** — it will be
re-run after outages, and must not double-charge.

Estimated volume for a market of this size: roughly 200,000 charge rows per year.

### 8.2 Surcharge

Once a rental charge passes `due_date + interval '1 month'` unpaid, a single surcharge
charge is raised:

- `charge_type = 'surcharge'`, `parent_charge_id` pointing at the rental
- Amount = **3% of the base rental amount**, computed as `floor((amount * 300 + 5000) / 10000)`
- **One-time.** It does not recur and does not compound.
- `surcharge_bps` is stamped onto the row as an integer, so a future ordinance change
  cannot alter a receipt already issued.

Guarded by a unique index on `(parent_charge_id, charge_type)`. Calendar-month
arithmetic, so a 31 January charge becomes delinquent on 28 February.

Bounded row count: one surcharge per rental charge. A daily stall one year delinquent
tops out around 730 rows.

### 8.3 FIFO settlement

Payment settles the **oldest period group first**, where a group is a period's rental
charge together with its surcharge. A tenant cannot settle the rental and leave the
penalty.

In the app this is enforced **by construction**: the unpaid list is ordered oldest
first, and tapping the fifth row selects rows one through five. The server re-validates
that allocations form a contiguous oldest-first prefix.

**Amount-driven entry** is the primary interaction: the collector enters what the
tenant is handing over, the app selects the oldest periods it covers and shows the
remaining balance. Whole periods only; any remainder is returned as change.

### 8.4 Condonation

Councils pass amnesty ordinances. A charge can be written off against an authorizing
reference (ordinance number), restricted to `admin`, fully audit-logged, recorded as an
adjustment row. **Never a deletion.**

## 9. Tenant QR cards

### 9.1 Card

- **A5 landscape, 210 × 148.5 mm** — half an A4 sheet, laid out two-up per page
- Stall number set large as the primary human-readable identifier
- Market, section, renter name
- QR at approximately 40 mm square

Rendered as an HTML print route with exact millimetre CSS, printed to PDF from Chrome.
No PDF library, no server rendering. QR generated inline as SVG via the `qrcode`
package — never a remote QR image service.

### 9.2 QR content

`CEEDO:1:<lease-uuid>` — **the lease identifier and nothing else.**

No name, no balance, no personal information. The device already holds the synced data
and looks everything up locally. This gives a small, forgiving-to-scan code; data that
can never go stale; and nothing readable about a tenant on a card hanging in a public
market. A reprinted card is byte-identical, so a lost card is a reprint, not a re-issue.

### 9.3 Scan flow

Scan → resolve lease in local SQLite → tenant and stall header with balance →
FIFO-ordered unpaid period list, grouped by month, collapsible → select or enter amount
→ **Proceed to Payment** → OR entry → confirm → outbox.

`expo-camera` handles scanning; no additional dependency.

### 9.4 Manual fallback is mandatory

The collector must always be able to search by stall number and reach the same screen.
Cards get soaked, torn, peeled off and stolen. A collection system that stalls on an
unreadable card fails on its first morning. The QR is an accelerator, never the only path.

### 9.5 Durability

An A5 paper card in the fish section will not survive a week. Lamination or vinyl
sticker stock affixed to the stall frame must be budgeted before a print run.

## 10. Reports

| Report | Content |
| --- | --- |
| Report of Collections and Deposits (RCD) | Per collector, per day — the core COA form |
| Abstract of Collections | Totals by fee type and accountable form |
| Report of Accountability for Accountable Forms (RAAF) | Booklets issued, used, spoiled, on hand |
| Subsidiary ledger | Per lease — charges, payments, running balance |
| Aging of receivables | 30 / 60 / 90 / over |
| Delinquency list | Drives demand letters |
| Remittance reconciliation | Collections against deposit slips |
| Exceptions and variances | By collector and by supervisor, per month |

**Every report exports to Excel as well as PDF.** Accounting staff re-key figures into
eNGAS; a PDF they cannot copy from is a report they will work around.

Heavy reports are implemented as Postgres views so the logic lives in one place rather
than in report code.

The exceptions report doubles as an oversight control. A collector generating most of
the exceptions, or a supervisor resolving everything identically, should be visible
without anyone going looking.

## 11. Security and access control

### 11.1 Roles

| Role | Scope |
| --- | --- |
| `collector` | Mobile only. Own assigned sections, own booklets, own shifts. No web access. |
| `supervisor` | Exceptions queue, shift verification, booklet assignment and return |
| `accounting` | All reports, remittance verification, read-only on transactions |
| `admin` | Master data, rates, users, condonation |

### 11.2 The append-only guarantee

**`UPDATE` and `DELETE` are never granted on `collections`, `charges` or
`collection_allocations` — to any role, including `authenticated` and the application's
own role.**

Not a convention, not application logic: the privilege is not granted. No future bug,
no rushed hotfix, and no one holding the dashboard password can alter a posted receipt.

Corrections work as the paper system does: a cancellation or adjustment row alongside
the original, both remaining visible.

### 11.3 Supervisor controls

The exceptions queue gives a supervisor authority over cash records, so it carries its
own controls:

- Three resolutions: **accept with correction**, **mark spoiled**, **escalate for
  investigation**
- A written reason is mandatory on every resolution
- Every resolution is an audit record: who, when, what changed, why
- Exceptions older than **three days** surface on the Treasurer's dashboard
- The monthly resolutions report groups by supervisor and by collector

### 11.4 Audit log

Every consequential action is logged with actor, timestamp, entity and before/after:
resolving an exception, condoning a charge, changing a rate, assigning or returning a
booklet, creating or deactivating a user.

### 11.5 Authentication

Web and app authenticate differently because their constraints differ.

**Web — Google Sign-In, invite-only.** Supabase Auth with the Google provider. Staff use
personal Gmail accounts, so there is no domain to restrict on; access is therefore granted
by invitation. An administrator creates the `app_users` row against a specific email
address beforehand, and a Google account with no matching row is refused at the
application even though Supabase authenticated it successfully.

This distinction is not cosmetic. Per §12.1, `auth.users` is shared across the whole
Supabase project: **signing in establishes who, the `app_users` row establishes whether.**

**Collector app — device credential plus PIN.**

| Layer | Mechanism | Network required |
| --- | --- | --- |
| Device | Registered once by an administrator; holds a long-lived credential | Once, at setup |
| Collector | `employee_no` + 6-digit PIN, verified against a hash synced to the device | Never |

OAuth is unusable here: it needs a round trip at exactly the moment a collector may have
no signal — a 5am market round that cannot begin is a collector sent home. Email-and-password
against Supabase fails the same test. So the device authenticates to the server, and the PIN
identifies the person, entirely offline.

**The PIN is not the security boundary — the booklet is.** Every pushed receipt is validated
server-side against the booklet assigned to the claimed collector. A person who knows
another collector's PIN still cannot post against that collector's booklet without
physically holding it, and if they are holding it that is a physical control failure no
login screen would have prevented. The PIN exists for attribution and convenience.

Hardening: PINs hashed with argon2 at a real cost factor; five failed attempts lock the
device until it next syncs; an administrator can deactivate a device server-side so its
pushes are refused, which is the answer to a lost or stolen tablet. Android 13+ encrypts
storage by default.

## 12. Shared Supabase project — required precautions

The schema `ceedo_collections` lives on a Supabase project shared with unrelated
systems. Five consequences, the first of which is a security issue rather than
configuration.

### 12.1 `auth.users` is shared — RLS must check local membership

A person who signs up for **any** system on that project is a valid `authenticated`
user against this schema.

**No RLS policy in this system may rest on `auth.uid() IS NOT NULL`.** Every policy
must join through `ceedo_collections.app_users`. One table getting this wrong exposes
the tenant ledger to another project's users.

This is a review checklist item, not a matter of care.

### 12.2 Exposed schemas

`ceedo_collections` must be added to Exposed Schemas in Settings → API, and the client
constructed with `db: { schema: 'ceedo_collections' }`. Omitting either produces a
PostgREST 404 that does not resemble a configuration problem.

### 12.3 Explicit grants

A new schema grants nothing by default. This is useful here: grant `SELECT` and
`INSERT` on ledger tables and simply never grant `UPDATE`/`DELETE` — §11.2 enforced by
omission rather than by fighting permissive defaults on `public`.

### 12.4 `search_path` on every function and trigger

`SET search_path = ceedo_collections, pg_temp`. Unqualified names on a multi-schema
instance are a search-path injection vector, and Supabase's linter flags it.

### 12.5 Edge Functions must not use `service_role`

That key bypasses RLS across **all** schemas on the instance, so a bug in the sync
function could reach another project's tables. Create a dedicated Postgres role granted
only on `ceedo_collections` and connect as that role. Small change, much smaller blast
radius.

## 13. Testing strategy

**Unit — `packages/shared`.** Rate resolution, money arithmetic and rounding, OR
validation, FIFO prefix computation, surcharge calculation. Pure functions, run in Node,
no device or emulator.

**Integration — sync protocol.** Against a local Supabase (`supabase start`): duplicate
push, rejected push, partial batch failure, out-of-order delivery, cursor correctness
across a gap.

**Scenario — the simulated collection day.** The test that actually protects the system:

> 200 collections recorded offline, network dropping mid-sync, app killed and restarted,
> then closeout. Assert that device count and server count agree, and that no receipt is
> lost or doubled.

If this passes reliably, the hand-rolled sync engine has earned its place. If it cannot
be made to pass, that is the signal to reconsider PowerSync.

**Rounding is tested explicitly** against manually computed figures — half-up, not
banker's rounding, which is the default in some libraries and produces figures that do
not match hand computation.

## 14. Open questions

| Question | Assumption if unanswered |
| --- | --- |
| Are partial payments against a single period accepted? | **No** — whole periods only, remainder returned as change |
| Card durability: lamination or vinyl stickers? | Decide before any print run; does not block build |
| Collector device model | Android 13+, 4 GB RAM (§3); revisit stack if lower |
| Exact `due_day` convention for monthly leases | Stored per lease; office to confirm default |
| Forgotten PIN with no signal | **Known limitation.** A supervisor resets the PIN on the web and the device picks it up on its next sync; a collector who forgets mid-round offline cannot sign in. Mitigated by syncing at the office before rounds. |
| Terminal vehicle classes and slaughterhouse animal classes | From the current ordinances; modelled as `rate_class` rows, not code |

## 15. Out of scope

- Double-entry general ledger, chart of accounts, trial balance — eNGAS keeps the books
- Disbursements, payroll, budgeting and obligations
- Multi-LGU tenancy
- Online or cashless tenant payments
- Thermal receipt printing
- Cemetery and other economic enterprises not named in §2
- Slaughterhouse receivables — accredited dealers with running accounts (walk-in cash only)

Each of these is a separate project if it is ever wanted. None should be quietly
absorbed into this one.

## 16. Phased delivery

| Phase | Scope | Ships when |
| --- | --- | --- |
| 1 | Schema, Google Sign-In, roles, master data, rates, booklet management, device registration | Office can set up facilities, stalls, tenants, leases, rates, booklets and tablets |
| 2 | Accrual job, charge ledger, surcharge, subsidiary ledger view | Arrears and aging are correct on the web before any device exists |
| 3 | Collector app — market rentals, offline, sync, closeout | A collector can work a market round end to end |
| 4 | QR cards, scan flow, amount-driven FIFO entry | Cards printed and in use |
| 5 | Parking, terminal and slaughterhouse fees | Same transaction spine; classified per-unit rates |
| 6 | Full report suite with Excel and PDF export | Accounting stops re-deriving figures by hand |

Phase 2 before Phase 3 is deliberate: the ledger must be provably right on the web
before a device starts writing into it.

---

## Appendix A — Invariants

These hold at all times and every change is checked against them:

1. A posted collection is never updated or deleted.
2. Every collection carries a client-generated UUID, and posting it twice creates one record.
3. Amounts are recomputed server-side; the device's figure is never authoritative.
4. A rejected sync entry becomes an exception, never a discard.
5. Allocations form a contiguous oldest-first prefix of unpaid period groups.
6. A surcharge exists at most once per rental charge and never changes after posting.
7. A returned booklet balances: used + spoiled + unused = total.
8. No RLS policy relies on `authenticated` alone; all check `app_users` membership.
9. A collection's allocations and lines together sum to its `gross_amount`.
10. A device holds at most one open shift; a new sign-in requires the previous shift closed.
11. Outbox entries survive a change of collector and are never reattributed.
12. Authentication establishes identity; `app_users` membership establishes access.
13. Money is integer centavos in code, rounded half-up.
14. A shift reaches `closed` only when device and server totals agree; otherwise it is `closed_unsynced`.
