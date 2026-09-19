# Measurement — `run_surcharge` scan cost

**Date:** 2026-09-19
**Gate for:** `docs/superpowers/specs/2026-09-19-surcharge-scan-cost-design.md` §3
**Harness:** `scripts/surcharge-scan-measure.sql`
**Postgres:** `PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit`

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

The `pct_of_indexed_rows_in_seek_range` figure rises with ledger depth exactly as expected: 31.11% at 45 days (Shape A), 92.25% at 400 days (Shapes B and C — both use `days=400`, so both land on the same overdue fraction despite the tenfold difference in row count between them). At Shape A's selectivity the planner's preference for `charges_surcharge_due_idx` over a sequential scan is unsurprising: the index only needs to visit roughly a third of the partial index's entries, and the scan cost drops from 819.00 to 308.29 in the planner's own units.

The design's stated concern was that Shapes B and C, at 92.25% overdue, would tip the other way — an index scan over 92% of a table's rows should ordinarily lose to a sequential scan, because visiting almost every row through a B-tree costs more than reading the heap in physical order. That did not happen here. In both Shape B and Shape C the AFTER plan still chose `Index Scan using charges_surcharge_due_idx`, and the estimated total plan cost dropped slightly (Shape C: 260834.38 → 256229.01; Shape B: 107442.06 → 105507.35), with a matching small drop in real execution time and in shared-buffer hits. The reason is visible in the BEFORE plan's own `Seq Scan on charges` buffer count: at Shape C it reads only 3279 shared buffers to answer the query, essentially the same 3025 (hit) + 165 (read) buffers the AFTER index scan touches. The synthetic ledger's `charges` rows are inserted lease-by-lease, day-by-day — the same order a nightly accrual job inserts them in production — so `due_date` is strongly correlated with physical row order in the heap. An index scan ordered by `(due_date + '1 mon'::interval)::date` therefore visits heap pages in almost the same sequence a full table scan would, so the index scan is not paying the "random heap access" penalty that would normally make a 92%-selective index scan lose to a sequential scan. Because it is not paying that penalty, the extra cost of a B-tree traversal on top of that near-sequential heap access is what determines the (small) winner, and the index wins it in both directions across all three shapes and both true selectivity regimes tested (31% and 92%).

This result does not contradict the general principle that a 92%-selective seek range should be uncompetitive against a sequential scan — it shows that principle's precondition (an uncorrelated heap) does not hold for this table under this insert pattern, and that insert pattern (append oldest-charge-first via nightly accrual) is also how `run_surcharge` itself is expected to receive rows in production. Every AFTER plan across all three shapes shows `Index Cond` on the `charges` scan, not `Filter` — including Shape C, the gate.

## Decision

**SHIP** — Shape C's AFTER plan shows `Index Scan using charges_surcharge_due_idx on charges c` with `Index Cond: (((due_date + '1 mon'::interval))::date < '2026-09-19'::date)`, not a `Filter:` line, which is the gate condition §3 sets. The planner chose the index over a sequential scan at all three measured shapes, including the 92.25%-overdue one-year projection that was expected to be the hardest case for it.
