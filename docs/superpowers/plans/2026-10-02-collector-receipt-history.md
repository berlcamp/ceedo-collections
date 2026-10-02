# Collector Transaction History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collector signed in on a tablet opens a "Transaction history" tile and sees every receipt the server holds under their name plus this tablet's unsynced ones, offline.

**Architecture:** `sync_pull` additionally sends every receipt (and its allocations, cancellations, reinstatements) whose `collector_id` is an active collector with an active area; a one-off epoch bump makes each tablet re-pull once. On the tablet, `receiptHistory` in sync-engine unions the mirrored `collections` with device-only `local_collections`, pages by business day, and a new `history.tsx` screen renders it. A tile on the Shift screen opens it.

**Tech Stack:** Postgres/Supabase plpgsql, vitest + pg (tests/db), vitest + better-sqlite3 (sync-engine), Expo Router / React Native (apps/collector).

**Spec:** `docs/superpowers/specs/2026-10-02-collector-receipt-history-design.md`

## Global Constraints

- Money is never interpolated: render through `format()` / `fromWire()`; sum in centavos via `parsePesoInput` / `fromCentavos` / `toDecimalString`.
- Every non-key mirrored column is nullable; queries must tolerate nulls (`coalesce`, left joins).
- No time window on history; no web-app change; no line items for receipts from other tablets.
- The migration file is `supabase/migrations/20261002000061_pull_collector_history.sql`.
- Production DB deploy is a dist-sql bundle the user runs; ask for `select max(version) from ceedo_collections.deployed_migrations;` first. OTA: `pnpm ota:production --platform android`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. Mixed timestamp formats (`...Z` from the device, `...+00:00` from Postgres) must still sort newest-first -- pinned in Task 2 test "orders mixed timestamp formats".
2. A receipt present in both `collections` and `local_collections` appears once with the server's status -- Task 2 "a synced receipt appears once".
3. A cancelled-then-reinstated receipt counts in the day total -- Task 2 "reinstated counts".
4. A receipt matching both the lease scope and the collector scope is sent once by `sync_pull` -- Task 1 "no duplicate ids".
5. `gross_amount` arriving as a number-ish string ("1250", "1250.5") or null must not crash the day total -- Task 2 "tolerates odd amounts".

## Files

- Create: `supabase/migrations/20261002000061_pull_collector_history.sql` -- sync_pull with collector scope, index, epoch bump.
- Create: `tests/db/sync-pull-collector-history.test.ts`
- Create: `packages/sync-engine/src/history.ts` -- `receiptHistory`.
- Create: `packages/sync-engine/src/history.test.ts`
- Modify: `packages/sync-engine/src/index.ts` -- export it.
- Create: `apps/collector/src/app/history.tsx` -- the screen.
- Modify: `apps/collector/src/app/shift.tsx` -- the tile.

---

### Task 1: sync_pull sends each collector's own receipts

**Files:**
- Create: `supabase/migrations/20261002000061_pull_collector_history.sql`
- Test: `tests/db/sync-pull-collector-history.test.ts`

**Interfaces:**
- Produces: `sync_pull(p_device_id uuid, p_cursor bigint)` -- same signature and keys; `collections`, `collection_allocations`, `collection_cancellations`, `collection_reinstatements` now also include rows of every active collector with an active area.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
  retireCollectionAreas,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  await retireCollectionAreas(db);
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Pull = {
  cursor: string;
  collections: { id: string }[];
  collection_cancellations: { collection_id: string }[];
};

async function pull(deviceId: string, cursor = 0): Promise<Pull> {
  const { rows } = await db.query(
    `select ceedo_collections.sync_pull($1::uuid, $2::bigint) as result`,
    [deviceId, cursor],
  );
  return rows[0].result as Pull;
}

// Migration 20261002000061: a tablet carries every receipt of every collector who can sign
// in on it, so the history screen can show a collector's on-the-spot fees and receipts
// taken on other tablets.
describe("sync_pull — collector history", () => {
  it("sends a collector's on-the-spot receipt, which has no lease", async () => {
    const fx = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });

    const result = await pull(fx.deviceId);

    expect(result.collections.map((c) => c.id)).toContain(id);
  });

  it("sends it to a tablet the receipt was not taken on", async () => {
    const fx = await createSyncFixture(db);
    const other = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });

    expect((await pull(other.deviceId)).collections.map((c) => c.id)).toContain(id);
  });

  it("sends its cancellation too", async () => {
    const fx = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, cancelled_by, reason)
       values ($1, $2, 'Wrong payer')`,
      [id, fx.collectorId],
    );

    const result = await pull(fx.deviceId);

    expect(result.collection_cancellations.map((c) => c.collection_id)).toContain(id);
  });

  it("no duplicate ids when a receipt is in both the lease and collector scope", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });

    const ids = (await pull(fx.deviceId)).collections.map((c) => c.id);

    expect(ids.filter((x) => x === id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a delta pull with nothing new does not resend it", async () => {
    const fx = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });
    const first = await pull(fx.deviceId);

    const delta = await pull(fx.deviceId, Number(first.cursor));

    expect(delta.collections.map((c) => c.id)).not.toContain(id);
  });

  it("does not send a receipt of a collector with no active area", async () => {
    const fx = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });
    await db.query(
      `update ceedo_collections.collector_assignments set active = false where collector_id = $1`,
      [fx.collectorId],
    );
    const other = await createSyncFixture(db);

    expect((await pull(other.deviceId)).collections.map((c) => c.id)).not.toContain(id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm db:start` (if not running), then `pnpm vitest run tests/db/sync-pull-collector-history.test.ts`
Expected: the three "sends ..." tests FAIL (ambulant receipt id not in `collections`); the other three pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261002000061_pull_collector_history.sql`:

1. A header comment (house style) explaining: tablets now carry every receipt of every collector who can sign in, so the history screen shows on-the-spot fees and receipts from other tablets; same gate as booklets; one-off epoch bump because a delta pull cannot reach receipts older than the cursor.
2. `create index if not exists collections_collector_idx on ceedo_collections.collections (collector_id);`
3. Copy the `create or replace function ceedo_collections.sync_pull(...) ... $$;` block from `supabase/migrations/20260929000055_collector_area_decides.sql` VERBATIM (not `can_collector_use_device`), then replace its four receipt arrays (`'collections'` through `'collection_reinstatements'`) with:

```sql
    -- Migration 0061: a receipt is sent for its lease (as before) OR for its collector --
    -- any active collector with an active area, which is anyone who can sign in on this
    -- tablet. Two EXISTS in one WHERE, so a receipt matching both is sent once. The
    -- collector gate mirrors booklets': new since the cursor, or the collector or one of
    -- their areas changed since it, which sends a newly assigned collector's history whole.
    'collections', coalesce((
      select jsonb_agg(to_jsonb(c)) from ceedo_collections.collections c
       where exists (select 1 from _scope_leases sl
                      where sl.id = c.lease_id and (c.row_version > p_cursor or sl.fresh))
          or exists (select 1 from ceedo_collections.app_users u
                      where u.id = c.collector_id and u.role = 'collector' and u.status = 'active'
                        and exists (select 1 from ceedo_collections.collector_assignments ca
                                     where ca.collector_id = u.id and ca.active)
                        and (c.row_version > p_cursor or u.row_version > p_cursor
                             or exists (select 1 from ceedo_collections.collector_assignments ca
                                         where ca.collector_id = u.id
                                           and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    'collection_allocations', coalesce((
      select jsonb_agg(to_jsonb(a)) from ceedo_collections.collection_allocations a
       join ceedo_collections.collections c on c.id = a.collection_id
       where exists (select 1 from _scope_leases sl
                      where sl.id = c.lease_id and (a.row_version > p_cursor or sl.fresh))
          or exists (select 1 from ceedo_collections.app_users u
                      where u.id = c.collector_id and u.role = 'collector' and u.status = 'active'
                        and exists (select 1 from ceedo_collections.collector_assignments ca
                                     where ca.collector_id = u.id and ca.active)
                        and (a.row_version > p_cursor or u.row_version > p_cursor
                             or exists (select 1 from ceedo_collections.collector_assignments ca
                                         where ca.collector_id = u.id
                                           and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    'collection_cancellations', coalesce((
      select jsonb_agg(to_jsonb(cc)) from ceedo_collections.collection_cancellations cc
       join ceedo_collections.collections c on c.id = cc.collection_id
       where exists (select 1 from _scope_leases sl
                      where sl.id = c.lease_id and (cc.row_version > p_cursor or sl.fresh))
          or exists (select 1 from ceedo_collections.app_users u
                      where u.id = c.collector_id and u.role = 'collector' and u.status = 'active'
                        and exists (select 1 from ceedo_collections.collector_assignments ca
                                     where ca.collector_id = u.id and ca.active)
                        and (cc.row_version > p_cursor or u.row_version > p_cursor
                             or exists (select 1 from ceedo_collections.collector_assignments ca
                                         where ca.collector_id = u.id
                                           and ca.row_version > p_cursor)))
      ), '[]'::jsonb),

    'collection_reinstatements', coalesce((
      select jsonb_agg(to_jsonb(cr)) from ceedo_collections.collection_reinstatements cr
       join ceedo_collections.collection_cancellations cc on cc.id = cr.cancellation_id
       join ceedo_collections.collections c on c.id = cc.collection_id
       where exists (select 1 from _scope_leases sl
                      where sl.id = c.lease_id and (cr.row_version > p_cursor or sl.fresh))
          or exists (select 1 from ceedo_collections.app_users u
                      where u.id = c.collector_id and u.role = 'collector' and u.status = 'active'
                        and exists (select 1 from ceedo_collections.collector_assignments ca
                                     where ca.collector_id = u.id and ca.active)
                        and (cr.row_version > p_cursor or u.row_version > p_cursor
                             or exists (select 1 from ceedo_collections.collector_assignments ca
                                         where ca.collector_id = u.id
                                           and ca.row_version > p_cursor)))
      ), '[]'::jsonb),
```

4. After the function, the one-off re-pull:

```sql
-- One full re-pull per tablet, so each receives the history a delta pull cannot reach.
-- Device-authored receipts and the outbox are untouched (see migration 0056).
update ceedo_collections.devices set assignment_epoch = assignment_epoch + 1 where true;
```

- [ ] **Step 4: Apply and run the tests**

Run: `pnpm db:reset && pnpm vitest run tests/db/sync-pull-collector-history.test.ts tests/db/sync-pull.test.ts tests/db/first-sync-budget.test.ts tests/db/sync-payload-size.test.ts tests/db/assignment-epoch.test.ts`
Expected: all PASS. If a budget/size test fails, report the measured numbers rather than loosening the limit.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261002000061_pull_collector_history.sql tests/db/sync-pull-collector-history.test.ts
git commit -m "feat(db): sync_pull sends each collector's own receipts for the history screen"
```

---

### Task 2: `receiptHistory` in sync-engine

**Files:**
- Create: `packages/sync-engine/src/history.ts`
- Create: `packages/sync-engine/src/history.test.ts`
- Modify: `packages/sync-engine/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type HistoryStatus = "waiting" | "synced" | "refused" | "cancelled";
export interface HistoryRow {
  id: string;
  orNo: number | null;
  serialPrefix: string | null;
  collectedAt: string | null;   // as stored; render with clockTime
  businessDate: string;
  grossAmount: string | null;   // wire form; render with fromWire
  status: HistoryStatus;
  detail: string | null;        // refusal reason for "refused"
  stallNo: string | null;
  tenantName: string | null;
  feeTypeName: string | null;
  quantity: number | null;      // only for receipts taken on this tablet with lines
}
export interface HistoryDay {
  businessDate: string;
  count: number;                // non-cancelled receipts
  total: string;                // wire form, non-cancelled receipts
  rows: HistoryRow[];
}
export function receiptHistory(
  driver: SqliteDriver,
  collectorId: string,
  opts?: { beforeDate?: string; days?: number },
): Promise<{ days: HistoryDay[]; nextBeforeDate: string | null }>;
```

- [ ] **Step 1: Write the failing test**

`packages/sync-engine/src/history.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { receiptHistory } from "./history";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
  create table local_shifts (
    id text primary key, collector_id text not null, business_date text not null,
    opened_at text not null, status text not null default 'open', closed_at text,
    declared_total text, device_count integer, device_total text
  );
  create table local_collections (
    id text primary key, or_no integer not null, booklet_id text not null,
    collector_id text not null, shift_id text not null, collected_at text not null,
    fee_type_id text not null, lease_id text, gross_amount text not null,
    payer_ref text, notes text, created_at text not null
  );
  create table local_lines (
    id text primary key, collection_id text not null, fee_type_id text not null,
    rate_class text, quantity integer not null, unit_rate text not null, amount text not null
  );
  create table collections (
    id text primary key, or_no integer, booklet_id text, collector_id text, device_id text,
    collected_at text, business_date text, fee_type_id text, lease_id text, payer_ref text,
    gross_amount text, notes text, shift_id text, synced_at text, posted_at text,
    posted_by text, row_version integer
  );
  create table collection_cancellations (
    id text primary key, collection_id text, cancelled_by text, cancelled_at text,
    reason text, row_version integer
  );
  create table collection_reinstatements (
    id text primary key, cancellation_id text, reason text, reinstated_by text,
    reinstated_at text, row_version integer
  );
  create table booklets (id text primary key, serial_prefix text);
  create table fee_types (id text primary key, name text);
  create table leases (id text primary key, stall_id text, tenant_id text);
  create table stalls (id text primary key, stall_no text);
  create table tenants (id text primary key, full_name text);

  insert into booklets values ('bk', 'A');
  insert into fee_types values ('rent', 'Stall rental'), ('hog', 'Slaughter fee');
  insert into stalls values ('st', 'B-12');
  insert into tenants values ('tn', 'Maria Santos');
  insert into leases values ('ls', 'st', 'tn');
  insert into local_shifts (id, collector_id, business_date, opened_at)
    values ('sh1', 'me', '2026-10-02', '2026-10-02T00:00:00.000Z');
`;

let db: Database.Database;
let driver: SqliteDriver;
let seq = 0;

function server(id: string, o: Partial<Record<string, string | number | null>> = {}) {
  db.prepare(
    `insert into collections (id, or_no, booklet_id, collector_id, collected_at, business_date,
       fee_type_id, lease_id, gross_amount)
     values (@id, @or_no, 'bk', @collector_id, @collected_at, @business_date, @fee_type_id,
       @lease_id, @gross_amount)`,
  ).run({
    id,
    or_no: 1001,
    collector_id: "me",
    collected_at: "2026-10-01T02:00:00+00:00",
    business_date: "2026-10-01",
    fee_type_id: "rent",
    lease_id: "ls",
    gross_amount: "100.00",
    ...o,
  });
}

function device(id: string, o: Partial<Record<string, string | number | null>> = {}, outbox?: string) {
  db.prepare(
    `insert into local_collections (id, or_no, booklet_id, collector_id, shift_id, collected_at,
       fee_type_id, lease_id, gross_amount, created_at)
     values (@id, @or_no, 'bk', @collector_id, 'sh1', @collected_at, @fee_type_id, @lease_id,
       @gross_amount, @collected_at)`,
  ).run({
    id,
    or_no: 1002,
    collector_id: "me",
    collected_at: "2026-10-02T03:00:00.000Z",
    fee_type_id: "hog",
    lease_id: null,
    gross_amount: "50.00",
    ...o,
  });
  if (outbox) {
    db.prepare(
      `insert into outbox (id, type, payload, collector_id, created_at, state, reason_code, seq)
       values (?, 'collection', '{}', 'me', '2026-10-02', ?, ?, ?)`,
    ).run(id, outbox, outbox === "rejected" ? "or_spent" : null, ++seq);
  }
}

const all = async () => (await receiptHistory(driver, "me")).days.flatMap((d) => d.rows);

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  driver = betterSqliteDriver(db);
});

describe("receiptHistory", () => {
  it("shows a server receipt as synced with its stall and tenant", async () => {
    server("s1");
    expect(await all()).toMatchObject([
      { id: "s1", status: "synced", stallNo: "B-12", tenantName: "Maria Santos", serialPrefix: "A" },
    ]);
  });

  it("shows a device-only on-the-spot receipt with its fee and quantity", async () => {
    device("d1", {}, "pending");
    db.prepare(
      `insert into local_lines values ('l1', 'd1', 'hog', 'hog', 3, '16.67', '50.00')`,
    ).run();
    expect(await all()).toMatchObject([
      { id: "d1", status: "waiting", feeTypeName: "Slaughter fee", quantity: 3, businessDate: "2026-10-02" },
    ]);
  });

  it("in-flight is waiting, rejected is refused with its reason, purged is synced", async () => {
    device("a", { collected_at: "2026-10-02T01:00:00.000Z" }, "in_flight");
    device("b", { collected_at: "2026-10-02T02:00:00.000Z" }, "rejected");
    device("c", { collected_at: "2026-10-02T03:00:00.000Z" });
    const rows = await all();
    expect(rows.map((r) => [r.id, r.status])).toEqual([["c", "synced"], ["b", "refused"], ["a", "waiting"]]);
    expect(rows.find((r) => r.id === "b")?.detail).toBe("or_spent");
  });

  it("a synced receipt appears once, with the server's status", async () => {
    device("x", {}, "acked");
    server("x", { business_date: "2026-10-02", collected_at: "2026-10-02T03:00:00+00:00" });
    db.prepare(`insert into collection_cancellations (id, collection_id) values ('cc', 'x')`).run();
    expect((await all()).map((r) => [r.id, r.status])).toEqual([["x", "cancelled"]]);
  });

  it("excludes cancelled receipts from the day total; reinstated counts", async () => {
    server("k", { gross_amount: "100.00" });
    server("c", { gross_amount: "40.00", or_no: 1003 });
    server("r", { gross_amount: "10.00", or_no: 1004 });
    db.prepare(`insert into collection_cancellations (id, collection_id) values ('c1', 'c'), ('c2', 'r')`).run();
    db.prepare(`insert into collection_reinstatements (id, cancellation_id) values ('r1', 'c2')`).run();
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]).toMatchObject({ businessDate: "2026-10-01", count: 2, total: "110.00" });
    expect(days[0]!.rows.find((r) => r.id === "r")?.status).toBe("synced");
  });

  it("never shows another collector's receipts", async () => {
    server("theirs", { collector_id: "them" });
    device("theirs-d", { collector_id: "them" }, "pending");
    expect(await all()).toEqual([]);
  });

  it("orders mixed timestamp formats newest first", async () => {
    server("early", { business_date: "2026-10-02", collected_at: "2026-10-02T02:59:59+00:00" });
    device("late", { collected_at: "2026-10-02T03:00:00.000Z" }, "pending");
    server("mid", { business_date: "2026-10-02", collected_at: "2026-10-02T02:59:59.500+00:00", or_no: 1005 });
    expect((await all()).map((r) => r.id)).toEqual(["late", "mid", "early"]);
  });

  it("tolerates odd amounts", async () => {
    server("a", { gross_amount: "1250" });
    server("b", { gross_amount: "0.5", or_no: 1003 });
    server("c", { gross_amount: null, or_no: 1004 });
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]!.total).toBe("1250.50");
  });

  it("pages by whole business days", async () => {
    for (let d = 1; d <= 5; d++) {
      const date = `2026-09-0${d}`;
      server(`s${d}a`, { business_date: date, collected_at: `${date}T01:00:00+00:00`, or_no: 1100 + d });
      server(`s${d}b`, { business_date: date, collected_at: `${date}T02:00:00+00:00`, or_no: 1200 + d });
    }
    const first = await receiptHistory(driver, "me", { days: 2 });
    expect(first.days.map((d) => d.businessDate)).toEqual(["2026-09-05", "2026-09-04"]);
    expect(first.nextBeforeDate).toBe("2026-09-04");
    const second = await receiptHistory(driver, "me", { days: 2, beforeDate: first.nextBeforeDate! });
    expect(second.days.map((d) => d.businessDate)).toEqual(["2026-09-03", "2026-09-02"]);
    const last = await receiptHistory(driver, "me", { days: 2, beforeDate: second.nextBeforeDate! });
    expect(last.days.map((d) => d.businessDate)).toEqual(["2026-09-01"]);
    expect(last.nextBeforeDate).toBeNull();
    expect([...first.days, ...second.days, ...last.days].flatMap((d) => d.rows)).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ceedo/sync-engine exec vitest run src/history.test.ts`
Expected: FAIL, "Failed to resolve import ./history".

- [ ] **Step 3: Implement `packages/sync-engine/src/history.ts`**

```ts
import { fromCentavos, parsePesoInput, toDecimalString, type Centavos } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

export type HistoryStatus = "waiting" | "synced" | "refused" | "cancelled";

export interface HistoryRow {
  id: string;
  orNo: number | null;
  serialPrefix: string | null;
  collectedAt: string | null;
  businessDate: string;
  grossAmount: string | null;
  status: HistoryStatus;
  detail: string | null;
  stallNo: string | null;
  tenantName: string | null;
  feeTypeName: string | null;
  quantity: number | null;
}

export interface HistoryDay {
  businessDate: string;
  count: number;
  total: string;
  rows: HistoryRow[];
}

/**
 * Every receipt the signed-in collector has: the server's (mirrored `collections`, which
 * sync_pull fills with each collector's own receipts since migration 0061) and this
 * tablet's that the server has not sent back yet.
 *
 * THE SERVER'S ROW WINS. A receipt in both tables is shown once, from `collections`,
 * because only the server knows it was cancelled. A device row with no outbox entry was
 * acked and purged (purgeAcked), so it is synced, and its server copy arrives next pull.
 *
 * PAGED BY WHOLE BUSINESS DAYS, so a day's total is never cut across two pages.
 *
 * `at` normalises timestamps to UTC through strftime: the device writes `...000Z` and
 * Postgres sends `...+00:00`, and comparing those as strings misorders the same second.
 */
const HISTORY = `
  with h as (
    select c.id, c.or_no, c.booklet_id, c.collected_at, c.business_date, c.gross_amount,
           c.lease_id, c.fee_type_id,
           case when exists (
                  select 1 from collection_cancellations cc
                   where cc.collection_id = c.id
                     and not exists (select 1 from collection_reinstatements r
                                      where r.cancellation_id = cc.id))
                then 'cancelled' else 'synced' end as status,
           null as detail
      from collections c
     where c.collector_id = ?
    union all
    select lc.id, lc.or_no, lc.booklet_id, lc.collected_at,
           coalesce(ls.business_date, substr(lc.collected_at, 1, 10)), lc.gross_amount,
           lc.lease_id, lc.fee_type_id,
           case o.state when 'pending' then 'waiting' when 'in_flight' then 'waiting'
                        when 'rejected' then 'refused' else 'synced' end,
           case when o.state = 'rejected' then coalesce(o.reason_code, o.last_result) end
      from local_collections lc
      left join local_shifts ls on ls.id = lc.shift_id
      left join outbox o on o.id = lc.id
     where lc.collector_id = ?
       and not exists (select 1 from collections c where c.id = lc.id)
  )
  select h.id, h.or_no, b.serial_prefix, h.collected_at, h.business_date, h.gross_amount,
         h.status, h.detail, st.stall_no, t.full_name as tenant_name, ft.name as fee_type_name,
         (select sum(quantity) from local_lines ll where ll.collection_id = h.id) as quantity,
         strftime('%Y-%m-%dT%H:%M:%f', h.collected_at) as at
    from h
    left join booklets b on b.id = h.booklet_id
    left join leases l on l.id = h.lease_id
    left join stalls st on st.id = l.stall_id
    left join tenants t on t.id = l.tenant_id
    left join fee_types ft on ft.id = h.fee_type_id
`;

interface Raw {
  id: string;
  or_no: number | null;
  serial_prefix: string | null;
  collected_at: string | null;
  business_date: string | null;
  gross_amount: string | number | null;
  status: HistoryStatus;
  detail: string | null;
  stall_no: string | null;
  tenant_name: string | null;
  fee_type_name: string | null;
  quantity: number | null;
}

function centavos(amount: string | number | null): Centavos {
  if (amount === null || amount === undefined || String(amount).trim() === "") return fromCentavos(0);
  try {
    return parsePesoInput(String(amount));
  } catch {
    return fromCentavos(0);
  }
}

export async function receiptHistory(
  driver: SqliteDriver,
  collectorId: string,
  opts: { beforeDate?: string; days?: number } = {},
): Promise<{ days: HistoryDay[]; nextBeforeDate: string | null }> {
  const days = opts.days ?? 14;
  const before = opts.beforeDate ?? "9999-12-31";

  const dates = await driver.select<{ business_date: string }>(
    `select distinct business_date from (${HISTORY}) where business_date < ?
      order by business_date desc limit ?`,
    [collectorId, collectorId, before, days + 1],
  );
  const page = dates.slice(0, days).map((d) => d.business_date);
  if (page.length === 0) return { days: [], nextBeforeDate: null };

  const rows = await driver.select<Raw>(
    `select * from (${HISTORY})
      where business_date in (${page.map(() => "?").join(", ")})
      order by business_date desc, at desc, id desc`,
    [collectorId, collectorId, ...page],
  );

  const byDate = new Map<string, HistoryDay>(
    page.map((date) => [date, { businessDate: date, count: 0, total: "0.00", rows: [] }]),
  );
  const totals = new Map<string, Centavos>();
  for (const raw of rows) {
    const date = raw.business_date ?? "";
    const day = byDate.get(date);
    if (!day) continue;
    day.rows.push({
      id: raw.id,
      orNo: raw.or_no,
      serialPrefix: raw.serial_prefix,
      collectedAt: raw.collected_at,
      businessDate: date,
      grossAmount: raw.gross_amount === null ? null : String(raw.gross_amount),
      status: raw.status,
      detail: raw.detail,
      stallNo: raw.stall_no,
      tenantName: raw.tenant_name,
      feeTypeName: raw.fee_type_name,
      quantity: raw.quantity,
    });
    if (raw.status !== "cancelled") {
      day.count += 1;
      totals.set(date, fromCentavos((totals.get(date) ?? 0) + centavos(raw.gross_amount)));
    }
  }
  for (const [date, total] of totals) byDate.get(date)!.total = toDecimalString(total);

  return {
    days: page.map((date) => byDate.get(date)!),
    nextBeforeDate: dates.length > days ? page[page.length - 1]! : null,
  };
}
```

Add to `packages/sync-engine/src/index.ts`:

```ts
export { receiptHistory, type HistoryDay, type HistoryRow, type HistoryStatus } from "./history";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ceedo/sync-engine exec vitest run && pnpm --filter @ceedo/sync-engine typecheck`
Expected: PASS. If "orders mixed timestamp formats" fails, inspect `at` for each row before changing the query.

- [ ] **Step 5: Commit**

```bash
git add packages/sync-engine/src/history.ts packages/sync-engine/src/history.test.ts packages/sync-engine/src/index.ts
git commit -m "feat(sync-engine): receiptHistory, a collector's receipts by business day"
```

---

### Task 3: Transaction history screen and its tile

**Files:**
- Create: `apps/collector/src/app/history.tsx`
- Modify: `apps/collector/src/app/shift.tsx` (the two `TileGrid`s, and the no-shift `Card` branch)

**Interfaces:**
- Consumes: `receiptHistory`, `HistoryDay`, `HistoryRow` from `@ceedo/sync-engine`; `fromWire` (`../ui/money`); `clockTime`, `longDate` (`../ui/time`); `freshness` (`../ui/staleness`); `businessDate`, `onSyncSettled` (`../sync/device-sync`); `formatSerial` from `@ceedo/shared`.

- [ ] **Step 1: Write `apps/collector/src/app/history.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View } from "react-native";
import { formatSerial } from "@ceedo/shared";
import { receiptHistory, type HistoryDay, type HistoryRow } from "@ceedo/sync-engine";
import { Action, Body, Label, List, Note, RackHead, Register, Rift, Screen, Slot, Title, color } from "../ui";
import { fromWire } from "../ui/money";
import { clockTime, longDate } from "../ui/time";
import { freshness, type Freshness } from "../ui/staleness";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { businessDate, onSyncSettled } from "../sync/device-sync";

const STATUS: Record<HistoryRow["status"], { said: string; tone: string }> = {
  waiting: { said: "Waiting to sync", tone: color.warning },
  synced: { said: "Synced", tone: color.confirmed },
  refused: { said: "Refused", tone: color.refusal },
  cancelled: { said: "Cancelled by office", tone: color.muted },
};

/**
 * Every receipt the signed-in collector has, newest first, a business day at a time.
 *
 * READS ONLY THIS TABLET. The server's history arrives by ordinary sync (sync_pull sends
 * each collector's own receipts, migration 0061), so this screen works with no signal and
 * is as fresh as the Register in the bar says.
 */
export default function History() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [days, setDays] = useState<HistoryDay[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<Freshness | null>(null);

  const load = useCallback(async () => {
    if (!collector) return;
    const page = await receiptHistory(driver, collector.id);
    setDays(page.days);
    setNext(page.nextBeforeDate);
    setFresh(await freshness(driver, businessDate()));
    setLoaded(true);
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onSyncSettled(() => void load()), [load]);

  const older = async () => {
    if (!collector || !next) return;
    const page = await receiptHistory(driver, collector.id, { beforeDate: next });
    setDays((shown) => [...shown, ...page.days]);
    setNext(page.nextBeforeDate);
  };

  if (!collector) {
    return (
      <Screen head={<RackHead title="Transaction history" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }

  return (
    <Screen
      head={
        <RackHead
          title="Transaction history"
          subtitle={collector.full_name ?? undefined}
          onBack={() => router.back()}
          register={fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined}
        />
      }
    >
      {loaded && days.length === 0 ? (
        <Note icon="receipt-text-outline">
          No receipts yet. Sync from the shift screen to load your history.
        </Note>
      ) : null}

      {days.map((day) => (
        <View key={day.businessDate}>
          <Label>
            {`${longDate(day.businessDate)} · ${day.count} receipt${day.count === 1 ? "" : "s"} · ${
              fromWire(day.total) ?? "total unavailable"
            }`}
          </Label>
          <Rift h={8} />
          <List>
            {day.rows.map((row) => {
              const status = STATUS[row.status];
              const payer = row.stallNo
                ? `${row.stallNo}${row.tenantName ? ` · ${row.tenantName}` : ""}`
                : `${row.feeTypeName ?? "On-the-spot fee"}${row.quantity ? ` × ${row.quantity}` : ""}`;
              return (
                <Slot
                  key={row.id}
                  icon={row.stallNo ? "storefront-outline" : "cash-plus"}
                  suppressed={row.status === "cancelled"}
                  left={
                    <View style={{ gap: 2 }}>
                      <Title numberOfLines={1}>
                        {row.orNo !== null && row.serialPrefix
                          ? formatSerial(row.serialPrefix, row.orNo)
                          : `OR ${row.orNo ?? "?"}`}
                      </Title>
                      <Body>{payer}</Body>
                      <Body tone={color.muted}>{clockTime(row.collectedAt) ?? "No time recorded"}</Body>
                    </View>
                  }
                  right={fromWire(row.grossAmount) ?? "—"}
                  under={
                    <Body tone={status.tone}>
                      {row.detail ? `${status.said} · ${row.detail}` : status.said}
                    </Body>
                  }
                />
              );
            })}
          </List>
          <Rift h={20} />
        </View>
      ))}

      {next ? <Action label="Show older" icon="history" onPress={() => void older()} /> : null}
    </Screen>
  );
}
```

- [ ] **Step 2: Add the tile to `shift.tsx`**

In BOTH round `TileGrid`s, append as the last child:

```tsx
<Tile icon="history" label="Transaction history" hint="Your receipts" onPress={() => router.push("/history")} />
```

In the no-shift branch, replace the lone `<Card>...</Card>` with:

```tsx
<>
  <Card>
    {/* the existing Card children, unchanged */}
  </Card>
  {/* The round is hidden with no shift open, and the history must stay reachable after
      closeout -- that is when a collector most wants to check a day. */}
  <Rift h={16} />
  <TileGrid>
    <Tile icon="history" label="Transaction history" hint="Your receipts" onPress={() => router.push("/history")} />
  </TileGrid>
</>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @ceedo/collector typecheck && pnpm --filter @ceedo/collector lint`
Expected: no errors. If an icon name is rejected by `IconName`, pick the nearest MaterialCommunityIcons glyph that type accepts and note it.

- [ ] **Step 4: Check on a device or emulator**

Run Metro (`pnpm --filter @ceedo/collector start`), reload, then: sign in, sync, open the tile with and without an open shift; confirm day headers, statuses, "Show older", and that a just-recorded receipt shows "Waiting to sync" offline.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/app/history.tsx apps/collector/src/app/shift.tsx
git commit -m "feat(collector): Transaction history tile and screen"
```

---

### Task 4: Full verification and handoff

- [ ] **Step 1:** `pnpm typecheck && pnpm test` (local Supabase running). Expected: all green; report any failure with output.
- [ ] **Step 2:** Ask the user for `select max(version) from ceedo_collections.deployed_migrations;`, then `node scripts/bundle-migrations.mjs --after <version>` and hand over the bundle path.
- [ ] **Step 3:** After the user confirms the bundle ran, `pnpm --filter @ceedo/collector ota:production --platform android --message "Transaction history"` -- only with the user's go-ahead.
