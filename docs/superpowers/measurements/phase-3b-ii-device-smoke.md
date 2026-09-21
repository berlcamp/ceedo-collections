# Phase 3b-ii — Device smoke checklist

**Tablet:** <model, Android version>
**Build:** <release / dev client, commit sha>
**Date:** <YYYY-MM-DD>
**Run by:** <name>

Rows are left BLANK until observed. A handover that recorded outcomes nobody transcribed
would be worth less than an empty one — Phase 3b-i left its rows blank for exactly this
reason and it was the right call.

---

## Before you start

```bash
pnpm db:reset
psql "postgresql://postgres:postgres@127.0.0.1:56322/postgres" \
     -v label="'llejo android'" -v pin="'123456'" -f scripts/dev-wire-tablet.sql
```

Then, **through the web UI only** — this is what Task 1 made possible and it is worth
proving: confirm the tablet assignment on `/device-assignments` and the collection area on
`/collector-assignments`, issue a device credential on `/devices`, and enrol the tablet by
QR.

Seed a lease with several months of arrears so the FIFO list is more than one row:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:56322/postgres" \
  -c "select ceedo_collections.run_accrual(); select ceedo_collections.run_surcharge();"
```

`apps/collector/.env` must carry the machine's LAN address
(`EXPO_PUBLIC_API_URL=http://<lan-ip>:56321`) — **note the port, it is not the default**.
These values are inlined at bundle time: changing `.env` needs a Metro restart, not a
reload, and never reaches an already-installed app.

The Android package identifier changed this phase, so the app must be **rebuilt**, not
reloaded, and any previously installed copy uninstalled first.

---

## The sequence

| # | Step | Expected | Observed |
| --- | --- | --- | --- |
| 1 | Sign in, open a shift | Shift screen shows 0 receipts · 0.00 | |
| 2 | Collect → search a stall number | The lease appears | |
| 3 | Search the tenant's name instead | The same lease appears | |
| 4 | Open the lease | Periods oldest first; balance matches the web | |
| 5 | Read the staleness line | States when the device last fully synced | |
| 6 | Tap the third period | Rows 1–3 selected; total is their sum | |
| 7 | Tap the third period again | Selection clears | |
| 8 | Type an amount covering 2 periods exactly | Rows 1–2 selected; no change shown | |
| 9 | Type an amount covering 2 periods plus 50.00 | Rows 1–2 selected; change 50.00 | |
| 10 | Type an amount below the oldest period | Button off; message names both figures; **no change figure shown** | |
| 11 | Type a lone "." then a digit | No crash at any keystroke | |
| 12 | Proceed, enter an OR from the booklet | Serial shown formatted; button on | |
| 13 | Enter an OR outside the booklet | Refused, naming the reason | |
| 14 | Enter "12a" | Refused as not a number — **not** silently truncated to 12 | |
| 15 | Enter an OR skipping a number | Warning, confirmable, NOT a block | |
| 16 | Record it | Returns to shift; count and total updated | |
| 17 | Reopen the same lease | Paid periods GONE; ranks closed up | |
| 18 | **Airplane mode on.** Collect a second receipt | Records normally; no network error | |
| 19 | Shift screen, still offline | Count and total include the offline receipt | |
| 20 | Force-quit and reopen, still offline | Both receipts still counted | |
| 21 | Spoil a form, still offline | Accepted with a reason; refuses a used serial | |
| 22 | Immediately write the NEXT serial as a receipt, offline | Accepted with **no** sequence-skip warning | |
| 23 | Try to spoil that same serial | Refused — it carries a receipt | |
| 24 | Ambulant: pick a class, quantity 3 | Line priced from the rate table | |
| 25 | Ambulant: add a second class, same fee type | Accepted on the same receipt | |
| 26 | Ambulant: try a DIFFERENT fee type | Refused, naming both fees and what to do | |
| 27 | Ambulant: remove a line, then re-pick the other fee type | Now accepted — the lock released | |
| 28 | Ambulant with a fee type having no current rate | Refusal names the fee and the date | |
| 29 | Tap "Sync now" while offline (lease screen) | Says it could not sync; does not fail silently | |
| 30 | **Airplane mode off.** Sync | Outbox reaches 0 pending | |
| 31 | Reopen the lease | Server's own rows now shown; no double subtraction | |
| 32 | Close out, declare the exact cash | Closes; variance 0.00 | |
| 33 | (Second shift) Close out declaring 20.00 short | Variance −20.00, signed, recorded not hidden | |

## The one thing tests could not check

| # | Step | Expected | Observed |
| --- | --- | --- | --- |
| 34 | Leave a screen open for several minutes, watching CPU/battery | The screen settles — it does **not** re-query continuously | |

Row 34 exists because the driver re-render loop fixed this phase was verified only by an
isolated logic harness reproducing React's dependency comparison, never by a live render.
It is the one finding whose fix has not been observed on real hardware, and this is the only
place it can be.

---

## Bugs found

<one section per bug: what happened, why no Node test caught it, the fix>

## Notes

<anything surprising, slow, or awkward in a collector's hands>
