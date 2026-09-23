# Phase 3b-ii — Device smoke checklist

**Tablet:** JDY-LX2 ("llejo android"), Android 16
**Build:** dev client (`expo run:android`), commit 11f8106
**Date:** 2026-09-23
**Run by:** Berl

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
| 1 | Sign in, open a shift | Shift screen shows 0 receipts · 0.00 | As expected. Sign-in ~0.5 s with PIN |
| 2 | Collect → search a stall number | The lease appears | As expected (Dry Goods-01) |
| 3 | Search the tenant's name instead | The same lease appears | As expected (Rosalinda Bautista) |
| 4 | Open the lease | Periods oldest first; balance matches the web | As expected: Jun, Jul, Aug; ₱5,550.00 matches the web ledger |
| 5 | Read the staleness line | States when the device last fully synced | As expected |
| 6 | Tap the third period | Rows 1–3 selected; total is their sum | As expected: ₱5,550.00 |
| 7 | Tap the third period again | Selection clears | As expected |
| 8 | Type an amount covering 2 periods exactly | Rows 1–2 selected; no change shown | As expected: 3,700.00 → Jun+Jul, no change |
| 9 | Type an amount covering 2 periods plus 50.00 | Rows 1–2 selected; change 50.00 | As expected: 3,750.00 → change 50.00 |
| 10 | Type an amount below the oldest period | Button off; message names both figures; **no change figure shown** | As expected (typed 1,000.00) |
| 11 | Type a lone "." then a digit | No crash at any keystroke | As expected: no crash |
| 12 | Proceed, enter an OR from the booklet | Serial shown formatted; button on | As expected |
| 13 | Enter an OR outside the booklet | Refused, naming the reason | As expected (tried 2000) |
| 14 | Enter "12a" | Refused as not a number — **not** silently truncated to 12 | As expected |
| 15 | Enter an OR skipping a number | Warning, confirmable, NOT a block | As expected: OR 1002 warned that 1001 was skipped; confirmable |
| 16 | Record it | Returns to shift; count and total updated | As expected: OR 1002, ₱3,700.00, allocated to Jun+Jul |
| 17 | Reopen the same lease | Paid periods GONE; ranks closed up | As expected: only August left |
| 18 | **Airplane mode on.** Collect a second receipt | Records normally; no network error | As expected: OR 1003, ₱1,850.00, recorded offline |
| 19 | Shift screen, still offline | Count and total include the offline receipt | As expected |
| 20 | Force-quit and reopen, still offline | Both receipts still counted | As expected |
| 21 | Spoil a form, still offline | Accepted with a reason; refuses a used serial | As expected: OR 1004 spoiled offline ("Asdf") |
| 22 | Immediately write the NEXT serial as a receipt, offline | Accepted with **no** sequence-skip warning | As expected |
| 23 | Try to spoil that same serial | Refused — it carries a receipt | As expected |
| 24 | Ambulant: pick a class, quantity 3 | Line priced from the rate table | As expected: OR 1006, 3 × 20.00 = 60.00 |
| 25 | Ambulant: add a second class, same fee type | Accepted on the same receipt | As expected |
| 26 | Ambulant: try a DIFFERENT fee type | Refused, naming both fees and what to do | As expected |
| 27 | Ambulant: remove a line, then re-pick the other fee type | Now accepted — the lock released | As expected |
| 28 | Ambulant with a fee type having no current rate | Refusal names the fee and the date | As expected |
| 29 | Tap "Sync now" while offline (lease screen) | Says it could not sync; does not fail silently | As expected |
| 30 | **Airplane mode off.** Sync | Outbox reaches 0 pending | As expected: offline receipts posted at 08:52; 0 sync_exceptions |
| 31 | Reopen the lease | Server's own rows now shown; no double subtraction | As expected: lease fully paid, no double subtraction |
| 32 | Close out, declare the exact cash | Closes; variance 0.00 | As expected: declared 5,610.00 = system 5,610.00, variance 0.00 |
| 33 | (Second shift) Close out declaring 20.00 short | Variance −20.00, signed, recorded not hidden | As expected, but declared 10.00 short against 20.00: variance −10.00, recorded |

## The one thing tests could not check

| # | Step | Expected | Observed |
| --- | --- | --- | --- |
| 34 | Leave a screen open for several minutes, watching CPU/battery | The screen settles — it does **not** re-query continuously | As expected: settled |

Row 34 exists because the driver re-render loop fixed this phase was verified only by an
isolated logic harness reproducing React's dependency comparison, never by a live render.
It is the one finding whose fix has not been observed on real hardware, and this is the only
place it can be.

---

## Bugs found

None found. Every row matched its expected result.

## Notes

- **Setup, not the app:** the first sync failed with `sync-pull failed with 503`. The cause was the
  `supabase_edge_runtime_ceedo-collections` container, which had exited a day earlier and did not come back with
  `db reset`. The fix was `docker start supabase_edge_runtime_ceedo-collections`. Check `docker ps -a | grep edge`
  before a device session.
- Setup used `scripts/dev-seed-round.sql` (collector Maria Santos, lease Dry Goods-01 with Jun–Aug
  unpaid at 1,850.00, booklet OR-2026 1001–1050), then `dev-wire-tablet.sql` with PIN 246813,
  instead of `run_accrual()`.
- OR 1001 was never used or spoiled, so it remains a gap in the booklet. The run started on 1002 to test the skip warning (row 15).
- OR 1005 was also spoiled ("Torn"), and OR 1007 (1 × 20.00) was the receipt for shift 2.
- A third shift was left open on the tablet at the end of the run.
