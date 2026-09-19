# First-sync duration, under the real 8s ceiling

**Date:** 2026-09-19
**Task:** Phase 3b-i plan, Task 3
**Test:** `tests/db/first-sync-budget.test.ts`
**Connection:** `authenticator` → `set role ceedo_app`, i.e. the role a real device arrives as

## Why this was measured at all

Phase 3a's Task 16 measured the first-sync **payload** at ~634 KiB against an 8 MiB alarm,
and said plainly that the case which would stress it — a long-delinquent stall with full
collection and allocation history — was not exercised, estimating 1.5–3 MB.

**Nothing had ever measured how long it takes.** Every test in this repo connects as
`postgres`, where `statement_timeout` is `0`. In production `sync_pull` runs as
`authenticator`, which carries `statement_timeout = 8s`. A first sync that crossed eight
seconds would have failed on every tablet and passed the entire suite — the same shape as
the two production-blocking bugs that reached the end of Phase 3a.

## The fixture

A four-year daily lease (`2022-09-19` → `2026-09-18`), 1,461 charges, of which the oldest
730 are settled with one collection and one allocation each.

Settling them is the half Phase 3a did not build. §6.1 scopes the charges array to *"unpaid,
plus paid within 90 days"*, so a settled charge moves **out** of `charges` and **into**
`collections` and `collection_allocations`. Measuring unpaid charges alone understates the
realistic worst case in exactly the direction that matters, because design §9 flags that
collections are now part of the pull and those rows are wider than charge rows.

730 is the ceiling the fixture booklet allows: `collections_serial_spent_once` is
`UNIQUE (booklet_id, or_no)` and `createCollectionFixture`'s booklet runs 1000–1999.

## Results

| Run | Elapsed | charges | collections | allocations | Payload |
| --- | --- | --- | --- | --- | --- |
| 1 | **98 ms** | 731 | 730 | 730 | 882,585 B (862 KiB) |
| 2 | **91 ms** | 731 | 730 | 730 | 882,585 B (862 KiB) |

Each run against a freshly `supabase db reset` database.

For comparison, the same fixture with **no** payment history (1,461 unpaid charges, zero
collections) measured **45 ms** at 304,165 B — i.e. the payment history roughly doubled the
elapsed time and tripled the payload, which is the direction Phase 3a predicted.

## Against the limits

| Limit | Value | Measured | Margin |
| --- | --- | --- | --- |
| Production `statement_timeout` | 8,000 ms | 98 ms | ~82× |
| Test budget (half the ceiling) | 4,000 ms | 98 ms | ~41× |
| Design §9 payload alarm | 8 MiB | 862 KiB | ~9.5× |

Phase 3a estimated this shape at 1.5–3 MB. The measured 862 KiB is below that estimate,
so the estimate was conservative rather than optimistic — worth stating, because the
opposite would have mattered.

## Ruling on spec E9

Plan Task 3, Step 4: **under ~2s, E9 stands as specified.** At 98 ms it stands with roughly
twenty times the headroom the rule required, so the daily full re-sync runs in the ordinary
foreground path and needs neither a background mode nor a blocking splash.

E9 is affordable only while a full sync is cheap. It currently is, by a very wide margin.
`tests/db/first-sync-budget.test.ts` is the standing guard: if a future change pushes first
sync past 4,000 ms, that test fails at half the production ceiling rather than after the
tablets start failing.

## What this does NOT measure

- **One lease.** A device assigned to a whole facility pulls every lease in it. This
  fixture is a single long-delinquent stall, which is the worst case *per lease*, not the
  worst case per device. The margin is wide enough that this is unlikely to matter, but it
  is unmeasured and is named rather than assumed.
- **Local Postgres in Docker on an Apple Silicon laptop**, not the hosted instance. Hosted
  latency adds network time on top, which is not in these figures.
- **Cold cache.** Both runs followed a `db reset` and a fixture build, so the relevant pages
  were warm. A genuinely cold first sync would be slower by an unmeasured amount.
