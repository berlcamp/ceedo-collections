# Measurement — `run_surcharge` scan cost

**Date:** 2026-09-19
**Gate for:** `docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md` §3
**Harness:** `scripts/surcharge-scan-measure.sql`
**Postgres:** `PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit`
(queried directly against the same local server with `select version();`. The harness now
prints this itself, in the SHAPE block, so future runs carry their own provenance; the three
raw logs this document cites predate that addition and do not contain it.)

Every figure below came from one of three runs of the harness against a freshly
`supabase db reset` database. Raw output is reproducible by re-running the commands in the
header of each section; nothing here was accumulated across test runs.

## Shape A — young ledger

**Command:** `psql "$DB_URL" -v leases=500 -v days=45 -v settled_pct=20 -f scripts/surcharge-scan-measure.sql`

| | |
| --- | --- |
| leases | 500 |
| charges total | 22500 |
| rental charges | 22500 |
| surcharge charges | 0 |
| month-overdue rentals | 7000 |
| unsettled rentals | 18000 |
| month-overdue unsettled rentals | 2500 |
| % of indexed rows in the seek range | 31.11 |

**Before:**

```
 Nested Loop Anti Join  (cost=27.65..29192.97 rows=357 width=16) (actual time=14.859..21.485 rows=2500 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=55371
   ->  Nested Loop Left Join  (cost=27.53..29179.47 rows=357 width=16) (actual time=14.857..21.201 rows=2500 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 4500
         Buffers: shared hit=55370
         ->  Nested Loop Left Join  (cost=18.02..18962.43 rows=1071 width=53) (actual time=0.026..15.888 rows=7000 loops=1)
               Buffers: shared hit=41370
               ->  Hash Join  (cost=1.12..849.14 rows=1071 width=21) (actual time=0.011..4.442 rows=7000 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=370
                     ->  Seq Scan on charges c  (cost=0.00..819.00 rows=7500 width=37) (actual time=0.003..2.323 rows=7000 loops=1)
                           Filter: ((charge_type = 'rental'::ceedo_collections.charge_type) AND ('2026-09-19'::date > ((due_date + '1 mon'::interval))::date))
                           Rows Removed by Filter: 15500
                           Buffers: shared hit=369
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.003..0.004 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.001..0.002 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=16.89..16.90 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=7000)
                     Buffers: shared hit=41000
                     ->  Nested Loop Anti Join  (cost=0.70..16.89 rows=1 width=5) (actual time=0.001..0.001 rows=1 loops=7000)
                           Buffers: shared hit=41000
                           ->  Nested Loop  (cost=0.55..16.62 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=7000)
                                 Buffers: shared hit=32000
                                 ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.28..8.30 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=7000)
                                       Index Cond: (charge_id = c.id)
                                       Buffers: shared hit=18500
                                 ->  Index Only Scan using collections_pkey on collections col  (cost=0.27..8.29 rows=1 width=16) (actual time=0.000..0.000 rows=1 loops=4500)
                                       Index Cond: (id = a.collection_id)
                                       Heap Fetches: 4500
                                       Buffers: shared hit=13500
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.26 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=4500)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=9000
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=7000)
               Buffers: shared hit=14000
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=7000)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=14000
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=7000)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=14000
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=2500)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.001..0.001 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=52
 Planning Time: 0.374 ms
 Execution Time: 21.582 ms
```

**After:**

```
 Nested Loop Anti Join  (cost=27.94..28682.26 rows=357 width=16) (actual time=14.061..21.165 rows=2500 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=55117 read=8
   ->  Nested Loop Left Join  (cost=27.82..28668.76 rows=357 width=16) (actual time=14.058..20.803 rows=2500 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 4500
         Buffers: shared hit=55116 read=8
         ->  Nested Loop Left Join  (cost=18.31..18451.72 rows=1071 width=53) (actual time=0.031..14.784 rows=7000 loops=1)
               Buffers: shared hit=41116 read=8
               ->  Hash Join  (cost=1.41..338.43 rows=1071 width=21) (actual time=0.019..2.946 rows=7000 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=116 read=8
                     ->  Index Scan using charges_surcharge_due_idx on charges c  (cost=0.29..308.29 rows=7500 width=37) (actual time=0.011..0.791 rows=7000 loops=1)
                           Index Cond: (((due_date + '1 mon'::interval))::date < '2026-09-19'::date)
                           Filter: (charge_type = 'rental'::ceedo_collections.charge_type)
                           Buffers: shared hit=115 read=8
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.004..0.005 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.002..0.003 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=16.89..16.90 rows=1 width=32) (actual time=0.002..0.002 rows=1 loops=7000)
                     Buffers: shared hit=41000
                     ->  Nested Loop Anti Join  (cost=0.70..16.89 rows=1 width=5) (actual time=0.001..0.001 rows=1 loops=7000)
                           Buffers: shared hit=41000
                           ->  Nested Loop  (cost=0.55..16.62 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=7000)
                                 Buffers: shared hit=32000
                                 ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.28..8.30 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=7000)
                                       Index Cond: (charge_id = c.id)
                                       Buffers: shared hit=18500
                                 ->  Index Only Scan using collections_pkey on collections col  (cost=0.27..8.29 rows=1 width=16) (actual time=0.000..0.000 rows=1 loops=4500)
                                       Index Cond: (id = a.collection_id)
                                       Heap Fetches: 4500
                                       Buffers: shared hit=13500
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.26 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=4500)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=9000
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=7000)
               Buffers: shared hit=14000
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=7000)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=14000
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=7000)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=14000
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=2500)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.001..0.001 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=63 read=1
 Planning Time: 0.344 ms
 Execution Time: 21.283 ms
```

Date test lands in: **`Index Cond`**.
Wall clock: 21.582 ms → 21.283 ms. Shared buffers hit+read: hit=55371 (0 read) → hit=55117 read=8 (55125 total).

Index size: 176 kB. Heap size: 2952 kB.

## Shape B — the development-database figure, rebuilt

**Command:** `psql "$DB_URL" -v leases=210 -v days=400 -v settled_pct=90 -f scripts/surcharge-scan-measure.sql`

| | |
| --- | --- |
| leases | 210 |
| charges total | 84000 |
| rental charges | 84000 |
| surcharge charges | 0 |
| month-overdue rentals | 77490 |
| unsettled rentals | 8400 |
| month-overdue unsettled rentals | 1890 |
| % of indexed rows in the seek range | 92.25 |

**Before:**

```
 Nested Loop Anti Join  (cost=27.26..107442.06 rows=1333 width=16) (actual time=1631.200..1638.178 rows=1890 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=993630
   ->  Nested Loop Left Join  (cost=27.14..107413.92 rows=1333 width=16) (actual time=1631.129..1637.887 rows=1890 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 75600
         Buffers: shared hit=993629
         ->  Nested Loop Left Join  (cost=17.63..69255.04 rows=4000 width=53) (actual time=0.073..1557.161 rows=77490 loops=1)
               Buffers: shared hit=838649
               ->  Hash Join  (cost=1.12..3167.45 rows=4000 width=21) (actual time=0.022..50.164 rows=77490 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=1379
                     ->  Seq Scan on charges c  (cost=0.00..3058.00 rows=28000 width=37) (actual time=0.004..21.864 rows=77490 loops=1)
                           Filter: ((charge_type = 'rental'::ceedo_collections.charge_type) AND ('2026-09-19'::date > ((due_date + '1 mon'::interval))::date))
                           Rows Removed by Filter: 6510
                           Buffers: shared hit=1378
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.004..0.005 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.002..0.003 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=16.50..16.51 rows=1 width=32) (actual time=0.019..0.019 rows=1 loops=77490)
                     Buffers: shared hit=837270
                     ->  Nested Loop Anti Join  (cost=8.60..16.50 rows=1 width=5) (actual time=0.011..0.019 rows=1 loops=77490)
                           Buffers: shared hit=837270
                           ->  Hash Join  (cost=8.45..16.11 rows=1 width=21) (actual time=0.010..0.018 rows=1 loops=77490)
                                 Hash Cond: (col.id = a.collection_id)
                                 Buffers: shared hit=686070
                                 ->  Seq Scan on collections col  (cost=0.00..7.10 rows=210 width=16) (actual time=0.000..0.008 rows=210 loops=75600)
                                       Buffers: shared hit=378000
                                 ->  Hash  (cost=8.44..8.44 rows=1 width=21) (actual time=0.002..0.002 rows=1 loops=77490)
                                       Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                       Buffers: shared hit=308070
                                       ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.42..8.44 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=77490)
                                             Index Cond: (charge_id = c.id)
                                             Buffers: shared hit=308070
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.38 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=75600)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=151200
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=77490)
               Buffers: shared hit=154980
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=77490)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=154980
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=77490)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=154980
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=1890)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.053..0.053 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=50
 Planning Time: 0.448 ms
 Execution Time: 1638.904 ms
```

**After:**

```
 Nested Loop Anti Join  (cost=27.56..105507.35 rows=1333 width=16) (actual time=1569.476..1574.772 rows=1890 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=993523 read=68
   ->  Nested Loop Left Join  (cost=27.43..105479.21 rows=1333 width=16) (actual time=1569.468..1574.539 rows=1890 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 75600
         Buffers: shared hit=993522 read=68
         ->  Nested Loop Left Join  (cost=17.92..67320.34 rows=4000 width=53) (actual time=0.102..1501.272 rows=77490 loops=1)
               Buffers: shared hit=838542 read=68
               ->  Hash Join  (cost=1.42..1232.74 rows=4000 width=21) (actual time=0.049..42.593 rows=77490 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=1272 read=68
                     ->  Index Scan using charges_surcharge_due_idx on charges c  (cost=0.29..1123.29 rows=28000 width=37) (actual time=0.016..16.431 rows=77490 loops=1)
                           Index Cond: (((due_date + '1 mon'::interval))::date < '2026-09-19'::date)
                           Filter: (charge_type = 'rental'::ceedo_collections.charge_type)
                           Buffers: shared hit=1271 read=68
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.018..0.019 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.016..0.017 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=16.50..16.51 rows=1 width=32) (actual time=0.019..0.019 rows=1 loops=77490)
                     Buffers: shared hit=837270
                     ->  Nested Loop Anti Join  (cost=8.60..16.50 rows=1 width=5) (actual time=0.011..0.018 rows=1 loops=77490)
                           Buffers: shared hit=837270
                           ->  Hash Join  (cost=8.45..16.11 rows=1 width=21) (actual time=0.010..0.018 rows=1 loops=77490)
                                 Hash Cond: (col.id = a.collection_id)
                                 Buffers: shared hit=686070
                                 ->  Seq Scan on collections col  (cost=0.00..7.10 rows=210 width=16) (actual time=0.000..0.007 rows=210 loops=75600)
                                       Buffers: shared hit=378000
                                 ->  Hash  (cost=8.44..8.44 rows=1 width=21) (actual time=0.002..0.002 rows=1 loops=77490)
                                       Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                       Buffers: shared hit=308070
                                       ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.42..8.44 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=77490)
                                             Index Cond: (charge_id = c.id)
                                             Buffers: shared hit=308070
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.38 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=75600)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=151200
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=77490)
               Buffers: shared hit=154980
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=77490)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=154980
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=77490)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=154980
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=1890)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.005..0.005 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=58 read=1
 Planning Time: 0.605 ms
 Execution Time: 1574.895 ms
```

Date test lands in: **`Index Cond`**.
Wall clock: 1638.904 ms → 1574.895 ms. Shared buffers hit+read: hit=993630 (0 read) → hit=993523 read=68 (993591 total).

Index size: 600 kB. Heap size: 11 MB.

## Shape C — §8.1's one-year projection (the gate)

**Command:** `psql "$DB_URL" -v leases=500 -v days=400 -v settled_pct=90 -f scripts/surcharge-scan-measure.sql`

| | |
| --- | --- |
| leases | 500 |
| charges total | 200000 |
| rental charges | 200000 |
| surcharge charges | 0 |
| month-overdue rentals | 184500 |
| unsettled rentals | 20000 |
| month-overdue unsettled rentals | 4500 |
| % of indexed rows in the seek range | 92.25 |

**Before:**

```
 Nested Loop Anti Join  (cost=27.79..260834.38 rows=3175 width=16) (actual time=804.770..820.802 rows=4500 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=2005781
   ->  Nested Loop Left Join  (cost=27.67..260778.61 rows=3175 width=16) (actual time=804.726..820.233 rows=4500 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 180000
         Buffers: shared hit=2005780
         ->  Nested Loop Left Join  (cost=18.16..169922.33 rows=9524 width=53) (actual time=0.059..653.759 rows=184500 loops=1)
               Buffers: shared hit=1636780
               ->  Hash Join  (cost=1.12..7538.07 rows=9524 width=21) (actual time=0.039..97.616 rows=184500 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=3280
                     ->  Seq Scan on charges c  (cost=0.00..7279.00 rows=66667 width=37) (actual time=0.005..38.174 rows=184500 loops=1)
                           Filter: ((charge_type = 'rental'::ceedo_collections.charge_type) AND ('2026-09-19'::date > ((due_date + '1 mon'::interval))::date))
                           Rows Removed by Filter: 15500
                           Buffers: shared hit=3279
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.013..0.014 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.008..0.009 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=17.03..17.04 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=184500)
                     Buffers: shared hit=1633500
                     ->  Nested Loop Anti Join  (cost=0.84..17.03 rows=1 width=5) (actual time=0.002..0.003 rows=1 loops=184500)
                           Buffers: shared hit=1633500
                           ->  Nested Loop  (cost=0.69..16.76 rows=1 width=21) (actual time=0.002..0.002 rows=1 loops=184500)
                                 Buffers: shared hit=1273500
                                 ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.42..8.44 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=184500)
                                       Index Cond: (charge_id = c.id)
                                       Buffers: shared hit=733500
                                 ->  Index Only Scan using collections_pkey on collections col  (cost=0.27..8.29 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=180000)
                                       Index Cond: (id = a.collection_id)
                                       Heap Fetches: 180000
                                       Buffers: shared hit=540000
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.26 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=180000)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=360000
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=184500)
               Buffers: shared hit=369000
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=184500)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=369000
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=184500)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=369000
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=4500)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.023..0.023 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=59
 Planning Time: 0.574 ms
 Execution Time: 820.989 ms
```

**After:**

```
 Nested Loop Anti Join  (cost=28.09..256229.01 rows=3175 width=16) (actual time=779.551..790.743 rows=4500 loops=1)
   Join Filter: (s.parent_charge_id = c.id)
   Buffers: shared hit=2005527 read=165
   ->  Nested Loop Left Join  (cost=27.96..256173.24 rows=3175 width=16) (actual time=779.459..790.120 rows=4500 loops=1)
         Filter: (((c.amount - COALESCE((sum(a.amount)), '0'::numeric)) - COALESCE((sum(k.amount)), '0'::numeric)) > '0'::numeric)
         Rows Removed by Filter: 180000
         Buffers: shared hit=2005526 read=165
         ->  Nested Loop Left Join  (cost=18.45..165316.96 rows=9524 width=53) (actual time=0.068..631.319 rows=184500 loops=1)
               Buffers: shared hit=1636526 read=165
               ->  Hash Join  (cost=1.42..2932.71 rows=9524 width=21) (actual time=0.050..90.819 rows=184500 loops=1)
                     Hash Cond: (c.fee_type_id = f.id)
                     Join Filter: (((round((c.amount * '100'::numeric), 0) * (f.surcharge_bps)::numeric) + '5000'::numeric) >= '10000'::numeric)
                     Buffers: shared hit=3026 read=165
                     ->  Index Scan using charges_surcharge_due_idx on charges c  (cost=0.29..2673.64 rows=66667 width=37) (actual time=0.026..32.052 rows=184500 loops=1)
                           Index Cond: (((due_date + '1 mon'::interval))::date < '2026-09-19'::date)
                           Filter: (charge_type = 'rental'::ceedo_collections.charge_type)
                           Buffers: shared hit=3025 read=165
                     ->  Hash  (cost=1.09..1.09 rows=3 width=20) (actual time=0.009..0.012 rows=3 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           Buffers: shared hit=1
                           ->  Seq Scan on fee_types f  (cost=0.00..1.09 rows=3 width=20) (actual time=0.006..0.007 rows=3 loops=1)
                                 Filter: (surcharge_bps > 0)
                                 Rows Removed by Filter: 4
                                 Buffers: shared hit=1
               ->  Aggregate  (cost=17.03..17.04 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=184500)
                     Buffers: shared hit=1633500
                     ->  Nested Loop Anti Join  (cost=0.84..17.03 rows=1 width=5) (actual time=0.002..0.002 rows=1 loops=184500)
                           Buffers: shared hit=1633500
                           ->  Nested Loop  (cost=0.69..16.76 rows=1 width=21) (actual time=0.002..0.002 rows=1 loops=184500)
                                 Buffers: shared hit=1273500
                                 ->  Index Scan using collection_allocations_charge_idx on collection_allocations a  (cost=0.42..8.44 rows=1 width=21) (actual time=0.001..0.001 rows=1 loops=184500)
                                       Index Cond: (charge_id = c.id)
                                       Buffers: shared hit=733500
                                 ->  Index Only Scan using collections_pkey on collections col  (cost=0.27..8.29 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=180000)
                                       Index Cond: (id = a.collection_id)
                                       Heap Fetches: 180000
                                       Buffers: shared hit=540000
                           ->  Index Only Scan using collection_cancellations_collection_id_key on collection_cancellations x  (cost=0.15..0.26 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=180000)
                                 Index Cond: (collection_id = col.id)
                                 Heap Fetches: 0
                                 Buffers: shared hit=360000
         ->  Aggregate  (cost=9.51..9.52 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=184500)
               Buffers: shared hit=369000
               ->  Bitmap Heap Scan on charge_condonations k  (cost=4.16..9.50 rows=2 width=18) (actual time=0.000..0.000 rows=0 loops=184500)
                     Recheck Cond: (charge_id = c.id)
                     Buffers: shared hit=369000
                     ->  Bitmap Index Scan on charge_condonations_charge_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.000..0.000 rows=0 loops=184500)
                           Index Cond: (charge_id = c.id)
                           Buffers: shared hit=369000
   ->  Materialize  (cost=0.12..8.14 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=4500)
         Buffers: shared hit=1
         ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (cost=0.12..8.14 rows=1 width=16) (actual time=0.045..0.045 rows=0 loops=1)
               Heap Fetches: 0
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=61 read=1
 Planning Time: 0.684 ms
 Execution Time: 790.965 ms
```

Date test lands in: **`Index Cond`**.
Wall clock: 820.989 ms → 790.965 ms. Shared buffers hit+read: hit=2005781 (0 read) → hit=2005527 read=165 (2005692 total).

Index size: 1440 kB. Heap size: 26 MB.

## What the numbers say

The `pct_of_indexed_rows_in_seek_range` figure rises with ledger depth exactly as expected:
31.11% at 45 days (Shape A), 92.25% at 400 days (Shapes B and C — both use `days=400`, so
both land on the same overdue fraction despite the tenfold difference in row count between
them).

**The design's premise is contradicted by this measurement, not confirmed by it.** §1's table
classifies `v_date > (due_date + interval '1 month')::date` as **"very"** selective, and
argues that if this predicate could seek, "the nightly job's cost would track *overdue
unsettled rentals*, which is a small and slowly-growing set, rather than *every charge ever
raised*." At the gate shape, 184,500 of 200,000 charges (92.25%) satisfy the date test —
that is the opposite of very selective, on a ledger only one year deep, which is what §8.1
projects as the near-term steady state. And the cost does not track *unsettled* rentals
either: whether a charge is settled is a property of `charge_balances`'s lateral joins, not
of `charges` itself, so those laterals must run for every row that clears the date test
before settlement status is known. At Shape C the `charges` scan yields 184,500 rows with or
without the index, the lateral that computes `alloc.allocated` runs 184,500 times either way
(`loops=184500` on the `Aggregate` node under the `Nested Loop Left Join`, in both the BEFORE
and AFTER plans), and only 4,500 of those rows survive the `is_settled` filter that comes
*after* the laterals have already paid their cost. The job's expensive part scales with
*month-overdue rentals*, settled or not — not with the small, slowly-growing set §1
described. Shipping the index does not restore that premise; it changes how the 184,500 rows
are fetched, not how many of them there are or how many lateral evaluations follow.

**The planner's row estimate never reflects this 92.25% either.** At every shape, the
`charges` scan's row estimate is exactly one-third of the row count passing the
`charge_type` filter — 7,500 of 22,500 (Shape A), 28,000 of 84,000 (Shape B), 66,667 of
200,000 (Shape C) — identical in the BEFORE and AFTER plans, and identical to Postgres's
`DEFAULT_INEQ_SEL` constant (1/3) for an inequality with no usable statistics. This holds
even though `analyze ceedo_collections.charges` runs immediately after `create index
charges_surcharge_due_idx`, which should let Postgres collect statistics on the indexed
expression. At the gate shape the estimate (66,667) is off by 2.8× against the actual
(184,500). So Shape C's AFTER plan did not choose the index *because* it knew the seek range
was 92.25% and costed accordingly — it costed a flat 33% seek range at every shape, and
happened to prefer the index anyway. The gate condition (`Index Cond` in the AFTER plan) is
what §3 asks for and it was met, but "the planner chose the index knowing it covered 92% of
the table" is not a claim this measurement supports.

**Why the index won anyway, precisely stated.** The harness's own seeding query
(`scripts/surcharge-scan-measure.sql:130-132`) inserts charges with
`from ceedo_collections.leases l ... cross join lateral (select ... from generate_series(...)) d`
— and the lateral subquery `d` does not reference `l` at all. With no correlation to hoist,
Postgres is free to execute that cross join in whichever order it costs cheapest, and the
buffer evidence shows it did *not* run lease-by-lease: at Shape A, the AFTER plan's `Index
Scan using charges_surcharge_due_idx` shows `Buffers: shared hit=115 read=8`, against the
BEFORE plan's `Seq Scan on charges` showing `hit=369` for a full pass over the heap. So the
index scan paid roughly a third of a full heap pass to retrieve the oldest 31.11% of dates.
That is a same-ballpark comparison, not an exact one, and it should not be read as a match to
within a page: a scan node's buffer count includes the index pages it descends as well as the
heap pages it fetches, and this index is 176 kB — about 22 pages — on its own, so the
heap-only component of `hit=115` is smaller than 115 by an amount this plan does not report.
What survives the imprecision is the order of magnitude: retrieving 31.11% of the rows cost on
the order of 31% of a full heap pass, nothing like the many-times-a-full-pass cost that random
heap access across a third of the table would incur. A ratio in that range only happens if the
heap pages holding overdue rows are contiguous and separable from the rest of the heap — i.e.
the heap is laid out as a contiguous run of pages by `due_date`, meaning the seeding INSERT
executed in date-major order (all leases for day 0, then all leases for day 1, ...), not
lease-major order (which would scatter each day's rows across the whole heap instead of
clustering them).
That date-major heap layout is what lets an index scan over 92% of the rows cost about the
same as a sequential scan — it is not paying for out-of-order heap access, because the heap
is already close to sorted by the indexed expression. This is a real property of the ledger
the harness built, but it is a side effect of how Postgres chose to execute an uncorrelated
lateral join in *this* run, not something the harness's SQL pins down or guarantees. A
different join order for that same INSERT — a different Postgres version, a different row
count, a different planner mood — would produce a different heap layout and could change
this measurement's outcome. The gate result rests on this correlation existing in the
seeded data, and the harness does not make it happen on purpose.

**The timing and buffer deltas are not a demonstrated improvement.** Each condition
(BEFORE, AFTER) was run exactly once, so a difference between two single runs is not evidence
of a causal effect by itself. At the gate shape, the `Nested Loop Left Join` that joins the
`charges` scan to the per-charge allocation lateral shows a *cumulative actual time* of
653.759 ms (BEFORE) vs 631.319 ms (AFTER) — a 22.4 ms difference — even though the `Aggregate`
node beneath it (the allocation lateral itself) reports identical buffer traffic
(`Buffers: shared hit=1633500`) and an identical per-loop time (`0.003 ms × 184500 loops`) in
both runs. That 22.4 ms alone is most of the plan's entire 30.0 ms execution-time delta
(820.989 ms → 790.965 ms), which means most of the apparent "speedup" is timing noise inside
a subtree that should not differ between the two conditions at all, not a measured effect of
the index. Total shared-buffer traffic at Shape C changes from 2,005,781 (all hits) to
2,005,527 hits + 165 reads = 2,005,692 — 89 fewer buffer touches out of just over two
million, about 0.004%. The honest claim from this data is that the index **is not slower**
at any shape measured, and that its effect on buffer traffic at the gate shape is
indistinguishable from noise given a single run per condition — not that it measurably
speeds anything up.

Every AFTER plan across all three shapes shows `Index Cond` on the `charges` scan, not
`Filter` — including Shape C, the gate. That plan-shape fact is real, reproducible from the
pasted plans above, and independent of the timing-noise question: `Index Cond` vs `Filter`
is read directly off the plan text, not measured with a stopwatch.

## Limits of what was measured

**The largest realism gap: the ledger carries no surcharges at all.** Every shape's table
reads `surcharge charges | 0`. `run_surcharge`'s `not exists (… charge_type = 'surcharge')`
anti-join therefore removed nothing in any run — visible in the plans as the `Materialize`
node's `rows=0`, and in the planner's costing of that anti-join at zero benefit. What was
measured is a one-year-old ledger **on which the nightly job has never run once**. That is a
worst case, not a steady state. In production the job runs nightly, so nearly every
month-overdue unsettled rental already carries its surcharge; the anti-join becomes highly
selective, and the planner may push it much earlier in the plan than it did here. That would
change the whole cost profile against which this index was judged — possibly for the better
(far fewer rows reaching the laterals), possibly for the worse (a different plan shape in
which this index is not chosen at all). Nothing in this document speaks to that case. A
measurement of a ledger that has already been surcharged is the obvious follow-up, and it has
not been done.

**`charge_condonations` is empty too.** The condonation lateral returns `rows=0` on all
184,500 loops at the gate shape, so what it cost here is the cost of probing an empty table.
That one is deliberate — the harness settles through collections and allocations precisely so
the expensive lateral is exercised (`scripts/surcharge-scan-measure.sql:135-138`) — but it
still means a ledger with real condonations pays more per loop than anything measured above.

**The surcharge gap, by contrast, was not designed in.** The harness seeds rentals only and
has no switch for pre-existing surcharges. Closing it is a change to
`scripts/surcharge-scan-measure.sql`, not a re-interpretation of these numbers.

## An alternative nobody considered

**A redundant conjunct on the existing index — unimplemented and unmeasured.** Because
`(due_date + interval '1 month')::date >= due_date + 28` holds for every date (no calendar
month is shorter than 28 days), the original predicate
`v_date > (due_date + interval '1 month')::date` *implies* `due_date < v_date - interval
'28 days'`. Adding that second test as an **additional conjunct alongside** the exact
predicate — not in place of it — is therefore provably behaviour-preserving: an implied
predicate removes no row the original kept, and the original stays in the `where` clause to
remove the rows between 28 days and a calendar month. It would seek on the **existing**
`charges_due_date_idx` and would need no new index at all.

This is strictly better-founded than the sargable *rewrite* §5 of the design rejected. That
one was a **replacement**, which is exactly why it changed behaviour on 10 date pairs; a
redundant conjunct cannot, because the exact predicate is still there.

It is recorded here only as a future option. It touches `run_surcharge`'s `where` clause,
which this branch's scope explicitly excluded, so **it has not been implemented and has not
been measured** — in particular, nobody has checked whether it would actually beat the
expression index that shipped, or whether the planner would use `charges_due_date_idx` for it.
Note also that it would not help with the finding that dominates this document: it changes how
the month-overdue rows are found, not how many of them reach the laterals.

## Open question

**Why did the planner's estimate stay a flat one-third at every shape?** The harness runs
`analyze ceedo_collections.charges` immediately after `create index charges_surcharge_due_idx`,
inside the same transaction. Postgres normally collects statistics for an expression index's
expression on ANALYZE, which should have given the planner a real selectivity for
`((due_date + '1 mon'::interval))::date < '2026-09-19'::date` instead of `DEFAULT_INEQ_SEL`.
It did not: the estimate is exactly one-third of the post-`charge_type` row count in the
AFTER plan at all three shapes, identical to the BEFORE plan's. No one has explained this.
This document does not offer a theory, because it has not tested one.

It matters more than a curiosity. The index keeps being chosen *despite* the planner costing
it on a wrong estimate, so the continued selection of the index — which is the entire gate
this measurement passed — depends on a planner behaviour nobody here understands. Anyone
revisiting this index should start by resolving it: inspect `pg_stats` for the index's
expression column after the harness's ANALYZE and find out whether statistics were collected
and ignored, or never collected.

## Follow-up — the steady state, and a controlled re-timing

Everything above this heading was written before the steady state was measured. This section
closes the gap "Limits of what was measured" named as the obvious follow-up, and it changes
the Decision. Nothing above has been edited; it is the record this section corrects.

**Command:** `psql "$DB_URL" -v leases=500 -v days=400 -v settled_pct=90 -v steady_state=1
-f scripts/surcharge-scan-measure.sql`

`steady_state=1` calls the real `ceedo_collections.run_surcharge()` once against the seeded
ledger — raising the surcharges a first nightly run would raise — and then measures the run
after it. The function itself is called rather than surcharge rows being seeded by hand, so
the anti-join under measurement is answering exactly the question production asks.

| | Shape C, night one | Shape C, steady state |
| --- | --- | --- |
| leases | 500 | 500 |
| charges total | 200,000 | 204,500 |
| rental charges | 200,000 | 200,000 |
| surcharge charges | 0 | 4,500 |
| month-overdue rentals | 184,500 | 184,500 |
| month-overdue unsettled rentals | 4,500 | 4,500 |
| **tonight's candidates** | **4,500** | **0** |

`run_surcharge` raised 4,500 surcharges on the first night. On the second night there is
nothing left to raise.

### The anti-join cannot help, because it runs last

The hoped-for effect was that a highly selective "already surcharged" anti-join would shrink
the candidate set before the expensive work. It does not, and the plan says why — the
anti-join is the **outermost** node:

```
Nested Loop Anti Join  (actual time=1204.173..1204.196 rows=0 loops=1)
  ->  Nested Loop Left Join  (actual time=9.922..1194.280 rows=4500 loops=1)
        ->  Nested Loop Left Join  (actual time=0.566..954.952 rows=184500 loops=1)
              ->  Seq Scan on charges c  (actual time=0.013..77.595 rows=184500 loops=1)
  ->  Index Only Scan using charges_one_surcharge_per_parent on charges s  (loops=4500)
```

It receives 4,500 rows — already past the laterals and past `is_settled` — and emits 0. The
laterals still execute `loops=184500`. The anti-join filters the *output*, not the input, and
no index on `charges` can move it earlier: it depends on `b.id` from the view, so it cannot
be evaluated until the view's row exists.

**The steady state is therefore more expensive than night one, not less** (≈900–1200 ms
against ≈820 ms): the surcharge rows enlarge the heap while the lateral work is unchanged.
Every night after the first, this job does ~185,000 lateral evaluations to produce nothing.

### The single-shot harness overstates the index, and by how much

The steady-state run reported 1204.700 ms without the index and 851.035 ms with it — a 29%
gap that would look like a strong result. It is not one. Buffers are effectively identical
(2,019,362 hit / 0 read versus 2,019,280 hit / 165 read, 0.004% apart), so no additional work
was avoided; and **this harness always runs BEFORE first**, which hands the entire
first-execution warm-up to the no-index side.

Measured properly — one steady-state ledger, one transaction, the two conditions interleaved
A/B/A/B/A/B with the index created and dropped between, so drift hits both equally:

| Round | No index | With index |
| --- | --- | --- |
| 1 | 1133.502 ms | 782.838 ms |
| 2 | 955.042 ms | 902.397 ms |
| 3 | 890.080 ms | 870.437 ms |

The no-index series falls monotonically (1133 → 955 → 890), which is warm-up. The with-index
series has no trend and its *fastest* run is its first. Discarding the warm-up round leaves
≈922 ms against ≈886 ms: about 36 ms, ~4%, inside a spread of 65 ms and 32 ms respectively.

That is the same ~4% seen at night one, and it is the honest size of the effect in both
regimes. **The 29% was an artifact of measurement order.** Any residual advantage is
consistent with the index storing `(due_date + interval '1 month')::date` precomputed, so the
expression is never evaluated per row — a CPU saving that buffer counts cannot show and that
this sample size cannot separate from noise.

**This is a defect in the harness's design, not just in one reading of it.** A
BEFORE-then-AFTER script cannot measure an effect smaller than its warm-up. Anyone re-running
it for a decision should use the interleaved form.

## Decision

**DO NOT SHIP — superseded.** The original decision below was SHIP, taken against §3's
plan-shape gate before the steady state had been measured. The index was shipped as
`20260919000043_surcharge_due_idx.sql` and has since been reverted. What changed:

- The steady state — the case production runs every night after the first — is **more**
  expensive than the case measured, and the index does not help it either.
- The effect in both regimes is ~4%, inside run-to-run variance, and the one measurement that
  looked decisive (29%) was an ordering artifact.
- The anti-join that might have narrowed the candidate set provably cannot: it is the
  outermost plan node and filters output, not input.
- Against that, the index carried a permanent cost: a byte-identity obligation between
  `run_surcharge`'s `WHERE` clause and the index expression, split across two files and kept
  in step by hand, plus its presence in the schema standing as a claim that the nightly job's
  scan problem had been addressed. It had not been. The scan is ~6% of this query; the
  laterals are ~80%.

§3's gate asked whether the planner would seek on the expression. It would, and it did. That
turned out to be the wrong question — a proxy for "does this help" that diverges from it
exactly here. The gate is the defect, and this document is the evidence.

The measurement, the harness and the two corrected design documents are what this work
delivers. §7 of the design said it plainly in advance: *"If it does not work, the finding is
still worth having."*

<details>
<summary>The original SHIP decision, superseded but preserved</summary>

**SHIP** — Shape C's AFTER plan shows `Index Scan using charges_surcharge_due_idx on charges c`
with `Index Cond: (((due_date + '1 mon'::interval))::date < '2026-09-19'::date)`, not a
`Filter:` line, which is the gate condition §3 sets, and that condition held at all three
shapes. This SHIP does **not** rest on the design's stated rationale for the index: §1's
classification of the date predicate as "very" selective, and its expectation that cost
would track *overdue unsettled rentals* rather than *every charge ever raised*, are both
contradicted at the gate shape (92.25% of the table matches the date test; the expensive
laterals run against all 184,500 month-overdue rows, settled or not, before settlement status
is even known). The index ships because the planner picked it under a real ANALYZE, on a real
schema, at all three measured shapes — not because the selectivity story that motivated it
turned out to be true, and not because a measured speed advantage was demonstrated (see "The
timing and buffer deltas" above). That ground is narrower than "picked under a real ANALYZE"
sounds: the planner made the choice on `DEFAULT_INEQ_SEL`, a flat one-third guess, not on any
statistic about the indexed expression, and it never saw the real 92.25% (see "The planner's
row estimate" above, and the open question about why the ANALYZE did not change that). A
future Postgres — or a future ANALYZE that does collect usable expression statistics — would
cost this scan at its true selectivity and may well choose differently. A later task that
revisits this index's value under a differently-correlated heap, or that wants to explain
*why* it keeps winning, should treat that as open, not settled by this document.

</details>

## What the next person should look at

Not the scan. At the gate shape the query pays ~185,000 lateral evaluations — one
`collection_allocations` probe and one `charge_condonations` probe per month-overdue rental —
to produce 4,500 rows on the first night and **zero** every night after. That is ~80% of the
runtime and it is untouched by anything this work shipped.

The directions that remain open, none of them measured:

- **Narrow the input before `charge_balances` is joined at all.** The anti-join and
  `is_settled` both filter output. A candidate set built from `charges` and
  `collection_allocations` directly — or a per-lease pre-filter — would cut the lateral count
  rather than the rows surviving it.
- **The redundant conjunct** described under "An alternative nobody considered". It seeks on
  the existing `charges_due_date_idx` and needs no new index, but it touches `run_surcharge`'s
  `WHERE` clause and so needs the equivalence argument made properly.
- **Materialising `charge_balances` is still not available**, for the two reasons in
  `docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md` §4 — it breaks
  `post_collection`'s post-lock re-read, and a matview cannot be `security_invoker`. Those
  hold regardless of anything measured here.

Use `scripts/surcharge-scan-measure.sql` with `-v steady_state=1` as the baseline, and
interleave the conditions rather than trusting its BEFORE/AFTER ordering.
