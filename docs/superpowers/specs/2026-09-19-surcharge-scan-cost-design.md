# CEEDO Collections — Surcharge Scan Cost Design

**Date:** 2026-09-19
**Status:** Approved for planning
**Scope:** Make the nightly surcharge job scale, and correct the upgrade path the Phase 3a
design named for it.
**Parent spec:** `docs/superpowers/specs/2026-09-17-ceedo-collections-design.md`
**Amends:** `docs/superpowers/specs/2026-09-18-phase-3a-sync-design.md` §9
**Predecessor:** `docs/superpowers/phase-3a-handover.md`

This document exists mostly to stop someone doing what Phase 3a's §9 tells them to do.

---

## 1. The problem, as actually measured

Phase 2's handover and Phase 3a's §9 both record that `run_surcharge` scans
`charge_balances` system-wide with no lease filter, and that its cost grows with total
ledger size rather than with the night's activity. Both are right about the symptom.

Both name the wrong cause, and §9 names a fix that is unsafe.

Measured against the development database at **83,257 charges** — not a toy fixture, and
within sight of §8.1's ~200,000 rows/year projection:

```
Bitmap Heap Scan on charges c
  Recheck Cond: (charge_type <> 'surcharge')
  Filter: (charge_type = 'rental'
           AND CURRENT_DATE > ((due_date + '1 mon'::interval))::date)
  ->  Bitmap Index Scan on charges_due_date_idx
```

The date test sits in **`Filter`**, not **`Index Cond`**. `charges_due_date_idx` is serving
only its own partial predicate (`charge_type <> 'surcharge'`), so every non-surcharge charge
in the database is read and then discarded. The expensive part is not that
`charge_balances` is a view — it is that the one highly selective predicate available
cannot be used to seek.

`run_surcharge`'s `where` clause has four predicates. Only one needs a balance at all:

| Predicate | Source | Selective? |
| --- | --- | --- |
| `charge_type = 'rental'` | `charges` | moderately |
| `f.surcharge_bps > 0` | `fee_types` (tiny) | no |
| `v_date > (due_date + interval '1 month')::date` | `charges` | **very** |
| `not b.is_settled` | the lateral joins | the expensive one |

Postgres already pushes the cheap predicates down into the `charges` scan — the plan above
shows it. The lateral joins are evaluated per surviving row. So if the date predicate could
seek, the nightly job's cost would track *overdue unsettled rentals*, which is a small and
slowly-growing set, rather than *every charge ever raised*.

---

## 2. What this ships

One index.

```sql
create index charges_surcharge_due_idx
  on ceedo_collections.charges (((due_date + interval '1 month')::date))
  where charge_type <> 'surcharge';
```

**The indexed expression must be byte-identical to `run_surcharge`'s predicate.** That is
the entire safety argument: `run_surcharge`'s `where` clause does not change, so surcharge
behaviour cannot change. An index alters cost, never results. There is no month-end edge
case to re-derive, nothing to re-check against the ordinance, and no new way for the
nightly job to be wrong.

The partial predicate mirrors `charges_due_date_idx`'s, for the same reason: a surcharge
charge is never itself a surcharge candidate, so indexing those rows costs writes and buys
nothing.

**Nothing else changes.** No view is materialised, no reader is repointed, no function body
is touched.

---

## 3. The measurement that gates it

**The index ships only if it is measured to work.** This is not ceremony: a probe during
design showed the planner *selecting* an index of this shape and still filtering rather
than range-scanning. That probe ran without `ANALYZE`, so it proves nothing either way —
but it is exactly why the measurement is a gate and not a formality.

1. `EXPLAIN (ANALYZE, BUFFERS)` on `run_surcharge`'s query before and after, with
   `ANALYZE ceedo_collections.charges` run after index creation.

   **Generate the volume; do not assume it is there.** The 83,257-charge figure in §1 came
   from a development database that had accumulated fixtures across many un-reset test
   runs. `supabase db reset` returns it to zero, so a fresh clone measures nothing. The
   first step of any measurement is building a known ledger — and stating its shape
   alongside the numbers, because "83k charges" means nothing without knowing how many
   leases, how many settled, and how many overdue produced it.
2. The same against a synthetic ledger at **~200,000 charges** — §8.1's one-year
   projection. Generated, measured, then discarded; it must not be left in the suite's
   database.
3. Record wall-clock and buffer counts for both.

**If the post-index plan still shows the date test in `Filter` rather than `Index Cond`,
the index does not ship.** An index that is not used is worse than no index: it costs write
throughput on every charge insert and every accrual run, and its presence implies a problem
was solved.

If it does not work, the finding is still worth having, and the fallback is §5.

---

## 4. Why not the materialised view §9 names

Phase 3a's §9 says the named upgrade path is *"a materialised `charge_balances` with a
scheduled refresh."* That is unsafe in two independent ways, and this section exists so
nobody implements it on the strength of that sentence.

### 4.1 It breaks the settlement engine

`post_collection` reaches `charge_balances` through `unpaid_period_groups()`, which filters
on `not b.is_settled`. Crucially it reads it **twice**: once to compute the FIFO prefix, and
again *after* taking `select ... for update` row locks, comparing the charges it locked
against the ones it first saw. That second read is the entire mechanism that produces
`stale_allocations` and stops two tablets settling the same period.

Against a materialised view, both reads return the same stale snapshot. The comparison
cannot detect a concurrent settlement, so the lock stops protecting anything. That
reintroduces precisely the damage Phase 2 documented — *"two allocations totalling ₱100.00
against a ₱50.00 charge, `outstanding` at −₱50.00, `is_settled` reading `true`"* — and the
test Phase 3a built to catch it would stop working, because that test depends on the view
being transactionally current.

Two other callers have the same requirement for the same reason: `condone_charge`, and
`sync_pull` — which feeds what a collector sees as owed while standing at a stall.

The full reader set, taken from `pg_proc`/`pg_views` rather than from grep (which also
matches comments): functions `post_collection`, `unpaid_period_groups`, `condone_charge`,
`run_surcharge`, `sync_pull`; views `aging_of_receivables`, `lease_balances`,
`subsidiary_ledger`. `close_shift` and `cancel_collection` mention `charge_balances` in
comments but do not query it — `close_shift` counts `collections` directly.

### 4.2 It punches through the RLS gate

`charge_balances` is declared `with (security_invoker = true)`, and its own comment says
why:

> Without it this view is a hole straight through the `app_users` membership gate — and
> `auth.users` is shared with unrelated systems on this project.

A materialised view cannot be `security_invoker`. It is populated by its owner at refresh
time, so per-reader RLS on the underlying tables stops applying, and reads are governed
only by table grants on the matview itself. On a Supabase project shared with unrelated
systems, that is a privacy regression, not a performance trade.

### 4.3 It changes `days_overdue` semantics

`charge_balances.days_overdue` is computed from `business_date()`. Materialising freezes it
at refresh time, so aging buckets would be correct only immediately after a refresh. Likely
tolerable for a nightly job — but it is a semantic change that aging, delinquency and the
subsidiary ledger would all silently inherit.

---

## 5. Why not the obvious sargable rewrite

The tempting one-line fix is to make the predicate seekable by algebra:

```sql
-- v_date > (b.due_date + interval '1 month')::date     -- original
   b.due_date < (v_date - interval '1 month')::date     -- "equivalent"
```

It does produce an `Index Cond` against the existing `charges_due_date_idx`. **It is also
not equivalent.**

Calendar-month arithmetic is not invertible: 31 January plus one month is 28 February, but
28 February minus one month is 28 January. Tested exhaustively over every ordered date pair
in a 16-month window — 236,196 pairs — the two predicates disagree on **10**:

| `due_date` | `v_date` | original | rewrite |
| --- | --- | --- | --- |
| 2026-02-28 | 2026-03-29 … 03-31 | surcharge | **no surcharge** |
| 2026-04-30 | 2026-05-31 | surcharge | **no surcharge** |
| 2026-06-30 | 2026-07-31 | surcharge | **no surcharge** |
| 2026-09-30 | 2026-10-31 | surcharge | **no surcharge** |
| 2026-11-30 | 2026-12-31 | surcharge | **no surcharge** |
| 2027-02-28 | 2027-03-29 … 03-31 | surcharge | **no surcharge** |

Every disagreement is a due date on the last day of a short month, and in every one the
rewrite *fails to charge a penalty the current rule charges*. Because `run_surcharge` runs
nightly and skips parents that already have a surcharge, the penalty is not lost — it is
applied up to three days late, for some tenants and not others.

`leases.due_day` is constrained to 1–28, so monthly rentals never land on these dates. Daily
and weekly charges derive their due dates from period boundaries and can. In a market of
daily stalls that is a real population, and an inconsistently-timed penalty is a fairness
and compliance problem, not a rounding detail.

**If the index in §2 does not deliver, this rewrite is still not the fallback.** The
fallback is a stored generated column carrying `(due_date + interval '1 month')::date`,
indexed — same exactness as the expression index, at the cost of a schema change and a
backfill.

---

## 6. Testing

- **A plan test.** Assert `run_surcharge`'s query plan contains `Index Cond` referencing
  the new index. This is the only test that can fail if the index silently stops being
  used — for instance after a future predicate edit breaks the expression match. Phase 3a
  learned repeatedly that a test which cannot fail is worse than none, and a timing
  assertion would be exactly that: flaky under load and green when the index is dropped.
- **An equivalence test**, pinning §5's finding in code rather than only in prose: assert
  the original and rewritten predicates disagree on those 10 pairs. It documents why the
  cheap rewrite was rejected, and it fails if someone "simplifies" the predicate later.
- **No behavioural test changes.** The `where` clause does not change, so the existing
  surcharge suite is the regression test. If any of it moves, something is wrong.

---

## 7. Risks and limits

**The index may not help, and the gate is real.** §3 exists because the design probe was
inconclusive. If the plan does not improve, nothing ships except the measurement and §4's
correction — both of which are worth the work on their own.

**This does not make `run_surcharge` cheap in the limit.** It makes its cost track overdue
unsettled rentals instead of all charges. A ledger with a large genuinely-delinquent
population still does real work each night, by design: the job must consider every unpaid
rental charge. What changes is that a paid-up ledger stops paying for its own history.

**The reporting views are untouched and unmeasured.** `aging_of_receivables`,
`lease_balances` and `subsidiary_ledger` each read `charge_balances` (verified against
`pg_views`; `delinquency_list` reads the other two rather than the balance view directly). Nobody has reported them as slow
and there is no production usage yet, so optimising them now would be speculative. They
remain the one place a materialised snapshot would be safe — they tolerate staleness and
never touch settlement — if they are ever measured to need it.

**Two accumulation ceilings in the test suite are unaffected** and remain as Phase 3a's
handover records them: `run_surcharge`'s cost growing across un-reset runs (which this
index should reduce but not eliminate), and PostgREST's 1000-row default breaking
`membership-gate` on a fourth consecutive un-reset run.

---

## 8. What this amends

Phase 3a's design §9 currently reads, at line 695:

> …and the named upgrade path remains a materialised `charge_balances` with a scheduled
> refresh.

That sentence should be corrected in place to point here: the measured cost is a
non-sargable predicate; materialisation is unsafe for the settlement path and for RLS; and
the reporting views remain the only candidates for a snapshot, none of them yet measured to
need one.

Phase 2's handover carries the same claim and is a historical record; it is not amended,
but §4 above is the answer to it.
