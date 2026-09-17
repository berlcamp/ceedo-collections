import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  assertOrNoInFixtureRange,
  createCollectionFixture,
  FIXTURE_BOOKLET_DATE,
  FIXTURE_BOOKLET_START_NO,
  postCollectionAsOwner,
  resetCutover,
  type CollectionFixture,
} from "../helpers/supabase";

let db: Client;
let fx: CollectionFixture;
// Every test gets a fresh fixture, and so a fresh booklet, so the counter is reset in
// beforeEach rather than walking the whole file's worth of tests toward the end of the
// range. It is also range-checked on every use: an OR number past the end of the booklet
// comes back as a perfectly valid `or_out_of_range` rejection, which would fail some
// unrelated test with a misleading reason -- or keep the or_out_of_range test passing for
// the wrong cause. FIXTURE_BOOKLET_START_NO is the fixture's own constant, so this cannot
// drift from the booklet the way the brief's `orNo = 3000` had.
let orNo = FIXTURE_BOOKLET_START_NO;

/**
 * The business date every post in this file resolves to. 02:00Z is 10:00 in Asia/Manila,
 * so the timezone conversion cannot move it across a day boundary either way.
 *
 * Fixed, not derived from today: the suite's real wall-clock date is before the seeded
 * 2026-10-01 cutover, so nothing accrues at `current_date` at all.
 */
const BUSINESS_DATE = "2026-10-05";

type PostResult = {
  status: string;
  collection_id?: string;
  reason?: string;
  detail?: string;
  gross_amount?: string;
};

function payloadFor(
  fixture: CollectionFixture,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: randomUUID(),
    or_no: assertOrNoInFixtureRange(++orNo),
    booklet_id: fixture.bookletId,
    collector_id: fixture.collectorId,
    device_id: fixture.deviceId,
    collected_at: `${BUSINESS_DATE}T02:00:00+00:00`,
    fee_type_id: fixture.feeTypeId,
    lease_id: fixture.leaseId,
    allocations: [{ group_rank: 1 }],
    lines: [],
    ...overrides,
  };
}

async function postOn(
  conn: Client,
  payload: Record<string, unknown>,
): Promise<PostResult> {
  const { rows } = await conn.query(
    "select ceedo_collections.post_collection($1::jsonb) as result",
    [JSON.stringify(payload)],
  );
  return rows[0].result as PostResult;
}

async function post(overrides: Record<string, unknown> = {}): Promise<PostResult> {
  return postOn(db, payloadFor(fx, overrides));
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  orNo = FIXTURE_BOOKLET_START_NO;
  await db.query("delete from ceedo_collections.settings");
  await db.query("insert into ceedo_collections.settings (cutover_date) values ('2026-10-01')");
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily",
    startDate: "2026-10-01",
    rateAmount: "50.00",
  });
  await db.query("select ceedo_collections.run_accrual('2026-10-03')");
});

afterAll(async () => {
  // Leave the cutover as this file found it: `settings` is a shared singleton and
  // fileParallelism is off, so whatever is left here is what the next file starts from.
  await resetCutover(db);
  await db.end();
});

describe("post_collection — the happy path", () => {
  it("accepts a payment settling the oldest period", async () => {
    const result = await post();
    expect(result.status).toBe("accepted");
    expect(Number(result.gross_amount)).toBe(50);
  });

  it("settles the charge it allocated against", async () => {
    await post();
    const { rows } = await db.query(
      `select is_settled from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date limit 1`,
      [fx.leaseId],
    );
    expect(rows[0].is_settled).toBe(true);
  });

  // Invariant #3: the device's figure is a claim to be checked, never truth. The engine
  // enforces it by never reading a figure at all, so these two tests SEND figures -- wrong
  // ones, wrong by orders of magnitude -- and assert the server's own numbers come back and
  // get stored. A test that merely omits the amounts would pass just as happily against a
  // function that did `coalesce((a->>'amount')::numeric, b.outstanding)`, which is exactly
  // the refactor these exist to catch.
  it("ignores a gross_amount and allocation amounts sent by the caller", async () => {
    const result = await post({
      gross_amount: 999999,
      allocations: [
        { group_rank: 1, amount: 1 },
        { group_rank: 2, amount: 1 },
      ],
    });
    expect(result.status).toBe("accepted");
    expect(Number(result.gross_amount)).toBe(100);

    // Not just the response: what was stored.
    const { rows } = await db.query(
      `select c.gross_amount::text as gross,
              (select array_agg(a.amount::text order by a.amount::text)
                 from ceedo_collections.collection_allocations a
                where a.collection_id = c.id) as amounts
         from ceedo_collections.collections c where c.id = $1`,
      [result.collection_id],
    );
    expect(Number(rows[0].gross)).toBe(100);
    expect(rows[0].amounts).toEqual(["50.00", "50.00"]);
  });

  it("prices lines from the rate table, ignoring a unit_rate sent by the caller", async () => {
    const result = await post({
      allocations: [],
      lease_id: null,
      gross_amount: 999999,
      lines: [
        {
          fee_type_id: fx.perHeadFeeTypeId,
          rate_class: "hog",
          quantity: 12,
          unit_rate: 1,
          amount: 1,
        },
      ],
    });
    expect(result.status).toBe("accepted");
    // 12 hogs at the seeded per-head rate, not at the 1.00 the caller asked to be charged.
    expect(Number(result.gross_amount)).toBe(12 * Number(fx.perHeadRate));

    const { rows } = await db.query(
      `select c.gross_amount::text as gross, l.unit_rate::text as unit_rate,
              l.quantity, l.amount::text as amount
         from ceedo_collections.collections c
         join ceedo_collections.collection_lines l on l.collection_id = c.id
        where c.id = $1`,
      [result.collection_id],
    );
    expect(Number(rows[0].unit_rate)).toBe(Number(fx.perHeadRate));
    expect(rows[0].quantity).toBe(12);
    expect(Number(rows[0].amount)).toBe(12 * Number(fx.perHeadRate));
    expect(Number(rows[0].gross)).toBe(12 * Number(fx.perHeadRate));
  });

  // postCollectionAsOwner is the helper Tasks 13, 14 and 20 build their fixtures on. It is
  // exercised here rather than only there, so a break in it fails next to the engine it
  // wraps instead of somewhere in a suite that merely depends on it.
  it("postCollectionAsOwner settles through the engine and returns the id", async () => {
    const collectionId = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const { rows } = await db.query(
      `select c.gross_amount::text as gross,
              (select bool_and(b.is_settled) from ceedo_collections.charge_balances b
                join ceedo_collections.collection_allocations a on a.charge_id = b.id
               where a.collection_id = c.id) as settled
         from ceedo_collections.collections c where c.id = $1`,
      [collectionId],
    );
    expect(Number(rows[0].gross)).toBe(50);
    expect(rows[0].settled).toBe(true);
  });

  it("postCollectionAsOwner throws the reason code rather than returning quietly", async () => {
    await expect(postCollectionAsOwner(db, fx, { groupRanks: [2] })).rejects.toThrow(
      /allocation_not_prefix/,
    );
  });

  it("writes the parent and both kinds of part in one transaction", async () => {
    // Invariant #9's trigger fires on INSERT into collections and checks the parts present
    // in THAT transaction. If parts were ever appended later, it would never weigh them.
    // This asserts the engine writes everything together: the row exists with parts, and
    // the deferred check passed at commit rather than being skipped.
    const result = await post({
      allocations: [{ group_rank: 1 }],
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 2 }],
    });
    expect(result.status).toBe("accepted");

    const { rows } = await db.query(
      `select c.gross_amount::text as gross,
              (select count(*)::int from ceedo_collections.collection_allocations a
                where a.collection_id = c.id) as allocs,
              (select count(*)::int from ceedo_collections.collection_lines l
                where l.collection_id = c.id) as lines
         from ceedo_collections.collections c where c.id = $1`,
      [result.collection_id],
    );
    expect(rows[0].allocs).toBe(1);
    expect(rows[0].lines).toBe(1);
    expect(Number(rows[0].gross)).toBe(50 + 2 * Number(fx.perHeadRate));
  });
});

describe("post_collection — the fixture does not expire", () => {
  it("dates the booklet and its assignment fixed, not relative to today", async () => {
    // This file posts at a FIXED business date, so a fixture dated relative to today walks
    // toward it and eventually past it. `assigned_at = current_date - 7` did exactly that:
    // it was due to overtake 2026-10-05 on 2026-10-13 and fail every post here with
    // `booklet_not_assigned`, on a morning nobody changed anything, blaming whichever
    // commit happened to land. Reintroducing an offset from current_date fails here, on
    // the day it is written, instead of silently months later.
    const { rows } = await db.query(
      `select a.assigned_at::text as assigned_at, a.returned_at,
              b.received_date::text as received_date
         from ceedo_collections.booklet_assignments a
         join ceedo_collections.booklets b on b.id = a.booklet_id
        where a.booklet_id = $1`,
      [fx.bookletId],
    );
    expect(rows[0].assigned_at).toBe(FIXTURE_BOOKLET_DATE);
    expect(rows[0].received_date).toBe(FIXTURE_BOOKLET_DATE);
    expect(rows[0].returned_at).toBeNull();
    // ::text casts above, then a plain string compare: ISO dates order lexicographically,
    // and nothing round-trips through a JS Date.
    expect(rows[0].assigned_at < BUSINESS_DATE).toBe(true);
  });
});

describe("post_collection — idempotency", () => {
  it("returns duplicate for a repeated id, and issues no second receipt", async () => {
    const id = randomUUID();
    const first = await post({ id });
    const second = await post({ id, or_no: orNo + 50 });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(second.collection_id).toBe(id);

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collections where id = $1",
      [id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("post_collection — rejections", () => {
  it("rejects an OR outside the booklet range", async () => {
    const result = await post({ or_no: 999999 });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_out_of_range");
  });

  it("rejects a serial already recorded", async () => {
    const used = ++orNo;
    await post({ or_no: used });
    const result = await post({ or_no: used });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_already_used");
  });

  it("rejects a serial recorded spoiled", async () => {
    const spoiled = ++orNo;
    await db.query(
      `insert into ceedo_collections.spoiled_forms (booklet_id, or_no, reason, recorded_by)
       values ($1, $2, 'torn', $3)`,
      [fx.bookletId, spoiled, fx.collectorId],
    );
    const result = await post({ or_no: spoiled });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("or_spoiled");
  });

  it("rejects a booklet not assigned to this collector", async () => {
    const other = await createCollectionFixture(db);
    const result = await post({ collector_id: other.collectorId });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("booklet_not_assigned");
  });

  it("rejects a booklet that does not exist", async () => {
    const result = await post({ booklet_id: randomUUID() });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("booklet_not_assigned");
  });

  it("rejects allocations that skip the oldest period", async () => {
    const result = await post({ allocations: [{ group_rank: 2 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects allocations with a gap", async () => {
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 3 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a duplicated rank", async () => {
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 1 }] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a collection with neither allocations nor lines", async () => {
    const result = await post({ allocations: [], lines: [] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("no_parts");
  });

  it("rejects allocations with no lease", async () => {
    const result = await post({ lease_id: null });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("lease_not_found");
  });

  it("rejects when a requested rank is already settled", async () => {
    await post({ allocations: [{ group_rank: 1 }] });
    // Rank 1 is now settled, so the caller's ranks are stale: what it thinks is rank 2
    // has become rank 1, and asking for two groups finds only one.
    const result = await post({
      allocations: [{ group_rank: 1 }, { group_rank: 2 }, { group_rank: 3 }],
    });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });

  it("rejects a line whose fee type has no rate on the collection date", async () => {
    const result = await post({
      allocations: [],
      lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "unicorn", quantity: 1 }],
    });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("rate_not_found");
  });

  it("leaves nothing behind when it rejects", async () => {
    const id = randomUUID();
    await post({ id, allocations: [{ group_rank: 2 }] });
    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.collections where id = $1",
      [id],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("post_collection — who may call it", () => {
  // Granted to no web role. service_role is the break-glass key the integration tests
  // reach the function through over PostgREST; Phase 3 grants ceedo_app and revokes it.
  // A grant to `authenticated` would put the settlement engine behind every signed-in
  // account on a Supabase project whose auth.users is shared with unrelated systems.
  it.each([
    ["anon", false],
    ["authenticated", false],
    ["service_role", true],
  ])("execute for %s is %s", async (role, allowed) => {
    const { rows } = await db.query(
      `select has_function_privilege($1, 'ceedo_collections.post_collection(jsonb)', 'execute') as ok`,
      [role],
    );
    expect(rows[0].ok).toBe(allowed);
  });
});

/**
 * Two shared tablets syncing the same lease at the same moment is the Phase 3 case these
 * exist for. `unique (collection_id, charge_id)` stops ONE collection allocating twice to a
 * charge; it does not stop two collections allocating to the same charge. Nothing else in
 * the schema does either, and because `is_settled` is `outstanding <= 0`, a period settled
 * twice reads as settled and looks entirely fine.
 *
 * These are demonstrations, not assertions about the design: each opens two real
 * transactions on separate connections, proves the second is still blocked while the first
 * holds its locks, and then reads what the second actually did once it woke up.
 */
describe("post_collection — concurrency", () => {
  const OPEN_TX_WAIT_MS = 400;

  /** Resolves to true if `promise` is still pending after `ms`. */
  async function stillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let pending = true;
    void promise.then(
      () => {
        pending = false;
      },
      () => {
        pending = false;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, ms));
    return pending;
  }

  it("blocks a second post against the same period group, then rejects it", async () => {
    const a = new Client({ connectionString: POSTGRES_URL });
    const b = new Client({ connectionString: POSTGRES_URL });
    await a.connect();
    await b.connect();

    const { rows: before } = await db.query(
      `select id from ceedo_collections.charge_balances
        where lease_id = $1 order by due_date, period_start limit 1`,
      [fx.leaseId],
    );
    const oldestChargeId = before[0].id as string;

    try {
      await a.query("begin");
      await b.query("begin");

      const firstPayload = payloadFor(fx);
      const secondPayload = payloadFor(fx);

      const first = await postOn(a, firstPayload);
      expect(first.status).toBe("accepted");

      // A holds the row lock on the oldest charge and has not committed. B must wait.
      const secondPromise = postOn(b, secondPayload);
      const blocked = await stillPending(secondPromise, OPEN_TX_WAIT_MS);
      expect(blocked).toBe(true);

      await a.query("commit");

      const second = await secondPromise;
      await b.query("commit");

      // What B does once it wakes: it re-reads, sees the period it locked is gone, and
      // refuses rather than silently aiming this tenant's money at the next period.
      expect(second.status).toBe("rejected");
      expect(second.reason).toBe("allocation_not_prefix");

      const { rows: allocs } = await db.query(
        `select count(*)::int as n from ceedo_collections.collection_allocations
          where charge_id = $1`,
        [oldestChargeId],
      );
      expect(allocs[0].n).toBe(1);

      const { rows: collections } = await db.query(
        `select count(*)::int as n from ceedo_collections.collections where id = any($1::uuid[])`,
        [[firstPayload.id, secondPayload.id]],
      );
      expect(collections[0].n).toBe(1);
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end();
      await b.end();
    }
  });

  /**
   * Both of these drive the `collections_pkey` branch of the unique_violation handler,
   * which the sequential idempotency test cannot reach: a sequential retry exits at the
   * STEP 1 lookup and never gets near the insert. Only a concurrent pair, where both passed
   * that lookup before either had committed, reaches the handler at all.
   *
   * Lines-only, with no lease: an allocation would make the second post block on the charge
   * row lock and be rejected there, before it ever reached the insert.
   */
  async function racingRetry(sameSerial: boolean): Promise<PostResult> {
    const a = new Client({ connectionString: POSTGRES_URL });
    const b = new Client({ connectionString: POSTGRES_URL });
    await a.connect();
    await b.connect();

    const id = randomUUID();
    const linesOnly = {
      id,
      allocations: [],
      lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    };
    const firstPayload = payloadFor(fx, linesOnly);
    const secondPayload = payloadFor(fx, {
      ...linesOnly,
      ...(sameSerial ? { or_no: firstPayload.or_no } : {}),
    });

    try {
      await a.query("begin");
      await b.query("begin");

      const first = await postOn(a, firstPayload);
      expect(first.status).toBe("accepted");

      const secondPromise = postOn(b, secondPayload);
      const blocked = await stillPending(secondPromise, OPEN_TX_WAIT_MS);
      expect(blocked).toBe(true);

      await a.query("commit");
      const second = await secondPromise;
      await b.query("commit");

      const { rows } = await db.query(
        "select count(*)::int as n from ceedo_collections.collections where id = $1",
        [id],
      );
      expect(rows[0].n).toBe(1);
      return second;
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end();
      await b.end();
    }
  }

  it("blocks a second post of the same id, then answers duplicate", async () => {
    // Different serials, so collections_pkey is the only constraint in play and this pins
    // that branch on its own.
    const second = await racingRetry(false);
    expect(second.status).toBe("duplicate");
    expect(second.reason).toBeUndefined();
  });

  it("answers duplicate, not or_already_used, when a true retry races itself", async () => {
    // The field's common case: the same receipt re-sent, so the same id AND the same
    // serial. BOTH unique constraints are violated at once and the handler's branch order
    // decides what the device hears. Postgres reports the constraint whose index it checks
    // first, and the primary key is created before collections_serial_spent_once, so
    // CONSTRAINT_NAME comes back as collections_pkey -- verified directly, and pinned here
    // because it is an ordering the engine depends on rather than one it controls.
    //
    // duplicate is the right answer: this IS one receipt sent twice. or_already_used would
    // send a supervisor hunting for a second receipt that was never written.
    const second = await racingRetry(true);
    expect(second.status).toBe("duplicate");
    expect(second.reason).toBeUndefined();
  });

  it("blocks a second post claiming the same serial, then rejects it as or_already_used", async () => {
    // Two different collections, one OR number. Both pass the or_already_used lookup
    // because neither can see the other's uncommitted row, so the unique index is what
    // catches it — and the handler has to tell that constraint apart from the primary key,
    // which means the opposite thing.
    const a = new Client({ connectionString: POSTGRES_URL });
    const b = new Client({ connectionString: POSTGRES_URL });
    await a.connect();
    await b.connect();

    const shared = ++orNo;
    const linesOnly = {
      or_no: shared,
      allocations: [],
      lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    };

    try {
      await a.query("begin");
      await b.query("begin");

      const first = await postOn(a, payloadFor(fx, linesOnly));
      expect(first.status).toBe("accepted");

      const secondPromise = postOn(b, payloadFor(fx, linesOnly));
      const blocked = await stillPending(secondPromise, OPEN_TX_WAIT_MS);
      expect(blocked).toBe(true);

      await a.query("commit");

      const second = await secondPromise;
      await b.query("commit");

      expect(second.status).toBe("rejected");
      expect(second.reason).toBe("or_already_used");

      const { rows } = await db.query(
        `select count(*)::int as n from ceedo_collections.collections
          where booklet_id = $1 and or_no = $2`,
        [fx.bookletId, shared],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end();
      await b.end();
    }
  });
});
