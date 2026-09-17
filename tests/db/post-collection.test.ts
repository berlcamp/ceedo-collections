import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createCollectionFixture,
  postCollectionAsOwner,
  type CollectionFixture,
} from "../helpers/supabase";

let db: Client;
let fx: CollectionFixture;
// Booklets built by createCollectionFixture run 1000-1999 (see the helper), so the counter
// starts inside that range: 3000 would put every post out of range and turn the whole file
// into one long assertion that or_out_of_range works.
let orNo = 1000;

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
    or_no: ++orNo,
    booklet_id: fixture.bookletId,
    collector_id: fixture.collectorId,
    device_id: fixture.deviceId,
    collected_at: "2026-10-05T02:00:00+00:00",
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

  it("recomputes the amount rather than trusting the caller", async () => {
    // The payload carries no amount at all. This is the enforcement of invariant #3.
    const result = await post({ allocations: [{ group_rank: 1 }, { group_rank: 2 }] });
    expect(Number(result.gross_amount)).toBe(100);
  });

  it("prices lines from the rate table", async () => {
    const result = await post({
      allocations: [],
      lease_id: null,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 12 }],
    });
    expect(result.status).toBe("accepted");
    // 12 hogs at the seeded per-head rate.
    expect(Number(result.gross_amount)).toBe(12 * Number(fx.perHeadRate));
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
