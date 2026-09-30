# Office Recovery of Lost Receipts — Design Spec

**Date:** 2026-09-30
**Status:** Draft for review
**Scope:** An admin-only web path that re-enters receipts lost when a tablet's local data
was wiped before it synced, and closes the shift the wiped tablet left open.
**Amends:** D7 of `2026-09-18-phase-2-ledger-design.md` (§7 below).

---

## 1. Problem

Every receipt is written first to the tablet's SQLite outbox and reaches the server only on
a sync. Clearing the app's data or uninstalling it before that sync deletes the only copy.
Today nothing recovers it:

- The receipt exists only on the paper booklet stub.
- The collector's shift is usually left **open** on the server (the `shift_open` synced, the
  close never did), or does not exist at all (the wipe came before the first sync of the
  shift).
- An open shift blocks the tablet: `shifts_one_open_per_device` refuses the next
  `shift_open`, and every receipt of the new shift is filed as an exception (production,
  2026-09-29).
- There is no way for the office to post a receipt (D7) or to close a shift. Migration 0059
  says "a supervisor must close it"; no function for that exists.

Options 2 and 4 of the same discussion (the unsent-receipts notice and automatic sync,
commit 405c19f) shrink the window in which this happens. This spec handles the case that
still gets through.

## 2. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| R1 | Is D7 dropped? | **No. A narrow exception** (§7) | D7's reason (a second posting path is the weaker one to abuse) still holds for everyday posting. Recovery is limited to the case where the tablet's copy is gone. |
| R2 | What does the admin enter? | What the stub records: serial, date, payer/lease, **months paid**, total. Cash-fee receipts: fee type and quantity. | The paper is the only source. The stub total is a cross-check, never the amount posted. |
| R3 | Which kinds of receipts? | **Lease and cash-fee (ambulant etc.)** | A wiped tablet loses both, and the shift cannot close correctly with either missing. |
| R4 | Which shift? | **The collector's shift for that tablet and day**, created if the server never saw it, then closed by the office with the cash handed over. | Every recovered peso is still reconciled against cash. Posting into no shift would skip the closeout that is the system's theft check. |
| R5 | Two-person check? | **No.** One admin posts; it counts at once. | Recovery only goes into an open shift, and closing it against the real cash is an independent check: a fabricated receipt produces a shortage someone must settle. |
| R6 | Who may do it? | **Admin only** (`is_admin()`). | Smallest set of people holding the exception. |
| R7 | How does a recovered receipt get validated? | **Through `post_collection`**, the function every tablet receipt goes through. | Same booklet, serial, prefix, rate and balance rules; nothing re-implemented. Mirrors `resolve_exception_corrected` (0036/0044). |

## 3. Database (one migration)

All three functions: `security definer`, `set search_path = ceedo_collections, pg_temp`,
`is_admin()` checked first with `errcode = 'insufficient_privilege'` and an operator-readable
sentence, a written reason required, `revoke ... from public; grant execute ... to
authenticated`.

### 3.1 `collection_recoveries`

```
collection_id  uuid primary key references collections(id)
reason         text not null check (length(trim(reason)) > 0)
recorded_by    uuid not null
recorded_at    timestamptz not null default now()
```

RLS on, `authenticated` gets `SELECT` only (D6), `attach_audit('collection_recoveries')`.
A receipt is **office-encoded** iff it has a row here. `collections.posted_by` is also the
admin's uid (`post_collection` already writes `auth.uid()`; tablet receipts post as
`ceedo_app` and leave it null), but the recovery row is the authoritative marker because it
carries the reason.

### 3.2 `recovery_shift(p_collector_id, p_device_id, p_business_date, p_reason) returns uuid`

- Locks and returns the **open** shift for (collector, device, business date).
- If none exists and the device has no other open shift, inserts one (`opened_at` =
  business date 00:00 Asia/Manila, status `open`) and returns it.
- Refuses:
  - a closed shift is never reopened; if none is open, a new one is created even when a
    closed shift exists that day (a second, lost shift);
  - the device holding an open shift for a **different** collector or date (names it);
  - an inactive device or a collector without the `collector` role.
- Writes an `audit_log` row (`action 'recovery_shift'`, with the reason) when it creates a
  shift.

### 3.3 `recover_collection(p_shift_id, p_receipt jsonb, p_stub_total numeric, p_reason text) returns uuid`

`p_receipt` is the tablet payload shape (`packages/sync-engine/src/collect.ts`): `or_no`,
`booklet_id`, `collected_at`, `fee_type_id`, `lease_id`, `payer_ref`, `notes`,
`allocations: [{group_rank}]`, `lines: [{fee_type_id, rate_class?, quantity}]`.

1. Lock the shift; refuse unless `status = 'open'`.
2. Refuse if `collected_at` (Asia/Manila) is not the shift's business date.
3. Build the payload with a **server-generated** `id`, and `collector_id`, `device_id`,
   `shift_id` taken **from the shift**, never from `p_receipt`.
4. `perform post_collection(payload)`. Any result other than `accepted` (including `duplicate`) raises with a readable
   sentence mapped from its reason code (§5).
5. Compare the posted `gross_amount` with `p_stub_total`. Unequal → raise "The stub says
   ₱X; those months/lines come to ₱Y." The raise rolls back steps 4–6.
6. Insert `collection_recoveries`.

### 3.4 `office_close_shift(p_shift_id, p_declared_total numeric, p_reason text)`

- Lock the shift; refuse unless `status = 'open'`.
- `system_count` / `system_total` computed on the server exactly as `close_shift` does
  (collections on the shift, excluding standing cancellations). No device figures to
  compare, so there is no `mismatch` outcome.
- Set `closed_at = now()`, `declared_total`, `system_*`, `variance = declared - system`,
  `status = 'closed'`. A negative variance enters the existing shortage settlement flow
  (0058) unchanged.
- `audit_log` row (`action 'office_close_shift'`) with the reason.
- Not limited to recovery: it is also the missing "supervisor must close it" action for any
  stuck shift. Still admin-only (R6).

## 4. Web

### 4.1 Ledger → Recovery (`apps/web/app/(admin)/ledger/recovery`)

Admin only (page gate and every action). Three steps on one page:

1. **Shift.** Pick collector, tablet, business date; enter the reason (reused for every
   receipt in this session, editable). Calls `recovery_shift`. Shows the tablet's
   `last_seen_at` prominently.
2. **Receipts.** The shift's existing receipts first, each labelled **From tablet** or
   **Office-encoded**, with a running count and total. Then an entry form:
   - booklet (those the collector held that day) and serial;
   - date (fixed to the shift's) and optional time, default 12:00 Asia/Manila;
   - **Lease:** pick the lease; its unpaid months are listed oldest first as checkboxes,
     and only a contiguous run from the oldest can be ticked (mapped to `group_rank`s);
   - **Cash fee:** fee type, rate class where the fee has classes, quantity;
   - stub total.
   Server refusals are shown verbatim beside the form; the form keeps its values.
3. **Close.** Cash handed over, a required checkbox "This tablet's data was lost; it will
   not send this shift's receipts", then `office_close_shift`. Shows the resulting
   variance and links to Shortages when negative.

Server actions follow `apps/web/lib/ledger/actions.ts`: `requireStaff()`, admin check, zod
schema, `rpc(...)`, `rpcFailure` for the error, `revalidatePath`.

### 4.2 Elsewhere

- **Devices credential panel:** before issuing a credential to a device that has an open
  shift, a warning: "This tablet has an open shift from <date>. Recover and close it
  first." Warning, not block.
- **Shifts list and collection listings:** an **Office-encoded** badge on recovered
  receipts; a shift with any shows it.
- **Reports** that list receipts show the same badge. Totals are unchanged: a recovered
  receipt is a receipt.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Receipt synced before the wipe | Listed as **From tablet**; entering it again is refused by `or_already_used`. |
| Months entered out of order | `allocation_not_prefix` → "<Month> is still unpaid. Enter the receipt that paid <Month> first." |
| Stub total ≠ server total | Refused, nothing written, both figures shown. |
| Rate missing for that date | `rate_not_found` → "No rate for <fee> on <date>." |
| Serial outside booklet / booklet not held that day / spoiled | `or_out_of_range` / `booklet_not_assigned` / `or_spoiled`, each as a sentence. |
| Shift already closed or remitted | Refused (§3.2, §3.3). Totals stay frozen. |
| Tablet not actually wiped, still collecting | Mitigated, not prevented: `last_seen_at` shown, confirmation checkbox at close. A later push of the same serial is refused as `or_already_used` and lands in exceptions. Changing `post_collection` to refuse receipts into closed shifts is **out of scope** (it changes tablet behaviour). |
| Re-registered tablet opens a new shift before recovery | The new `shift_open` is refused as today. The credential-panel warning (§4.2) is the guard; after `office_close_shift`, the tablet's queued entries go up on its next sync. |
| Any refusal | Atomic: no collection, allocation, line or recovery row. |

## 6. Testing

**`tests/db`** (existing Postgres harness), new `recovery.test.ts`:

- non-admin (supervisor, accounting, collector, `ceedo_app`) refused on all three functions;
- `recovery_shift`: returns the existing open shift; creates one when missing; refuses a
  closed shift and a device held open by another collector/date;
- `recover_collection`: lease receipt settles the ticked months; cash-fee receipt priced by
  the day's rate; stub mismatch rolls everything back; every §5 refusal; ids and
  collector/device/shift taken from the shift, not the payload; `collection_recoveries` row
  and its `audit_log` row written;
- `office_close_shift`: system totals include recovered receipts and exclude standing
  cancellations; variance sign; negative variance accepted by `record_variance_settlement`;
  refused on a closed shift;
- privileges: `collection_recoveries` is `SELECT`-only for `authenticated`.

**Web:** unit tests beside `apps/web/lib/ledger/shifts.test.ts` for the month-checkbox to
`group_rank` mapping and the contiguous-run rule.

## 7. Amendment to D7

Append to the D7 row of `2026-09-18-phase-2-ledger-design.md`:

> **Amended 2026-09-30 (office recovery spec).** One exception: an admin may re-enter a
> receipt whose tablet copy was destroyed before it synced, through `recover_collection`,
> only into that collector's still-open shift, with a written reason, validated by
> `post_collection` exactly as a tablet receipt, marked office-encoded, and reconciled
> against cash by `office_close_shift`. Everyday posting stays on the tablet.

## 8. Deployment

- Migration → a `dist-sql` bundle built with `--after` production's current version
  (`select max(version) from ceedo_collections.deployed_migrations;`), run by hand.
- Web deploys from `main`.
- No tablet change.

## 9. Out of scope

- Maker-checker verification of recovered receipts (R5).
- Refusing tablet receipts into closed shifts.
- Reopening or recomputing a closed shift.
- Recovering spoiled-form records lost with the tablet (the booklet reconciliation already
  surfaces unused serials).
