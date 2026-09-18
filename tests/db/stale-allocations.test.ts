import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  resetCutover,
  waitForLockWait,
  FIXTURE_BOOKLET_START_NO,
  type CollectionFixture,
} from "../helpers/supabase";

let a: Client;
let b: Client;

beforeAll(async () => {
  a = new Client({ connectionString: POSTGRES_URL });
  b = new Client({ connectionString: POSTGRES_URL });
  await a.connect();
  await b.connect();
});

afterAll(async () => {
  await resetCutover(a);
  await a.end();
  await b.end();
});

type PostResult = { status: string; collection_id?: string; reason?: string; detail?: string };

/**
 * Calls post_collection() directly and returns whatever it answers, accepted or
 * rejected. `postCollectionAsOwner` (tests/helpers/supabase.ts) throws on a rejection by
 * design -- its own doc comment says tests asserting on rejections call the RPC directly
 * instead -- which is exactly what this suite does on both branches below.
 */
async function post(conn: Client, payload: Record<string, unknown>): Promise<PostResult> {
  const { rows } = await conn.query(
    "select ceedo_collections.post_collection($1::jsonb) as result",
    [JSON.stringify(payload)],
  );
  return rows[0].result as PostResult;
}

function payloadFor(fx: CollectionFixture, orNo: number, groupRanks: number[]) {
  return {
    id: randomUUID(),
    or_no: orNo,
    booklet_id: fx.bookletId,
    collector_id: fx.collectorId,
    device_id: fx.deviceId,
    collected_at: "2026-10-05T02:00:00+00:00",
    fee_type_id: fx.feeTypeId,
    lease_id: fx.leaseId,
    allocations: groupRanks.map((group_rank) => ({ group_rank })),
    lines: [],
  };
}

// waitForLockWait now lives in tests/helpers/supabase.ts, shared with
// sync-concurrency.test.ts. See its doc comment there for why a fixed sleep does not work.

describe("stale_allocations", () => {
  it("is returned to the loser of a FIFO race, not allocation_not_prefix", async () => {
    const fx = await createSyncFixture(a);

    // Give the lease at least two unpaid period groups, so the loser's re-read finds a
    // DIFFERENT charge set rather than simply no unpaid groups at all -- which would be
    // `allocation_not_prefix` for a legitimate reason and would pass this test for the
    // wrong cause.
    await a.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const { rows: bPid } = await b.query(`select pg_backend_pid() as pid`);
    const bBackendPid = bPid[0].pid as number;

    await a.query("begin");
    // A wins the lock and holds it.
    const winner = await post(
      a,
      payloadFor(fx, FIXTURE_BOOKLET_START_NO + 1, [1]),
    );
    expect(winner.status).toBe("accepted");

    // B blocks on the same charge rows.
    const loser = post(b, payloadFor(fx, FIXTURE_BOOKLET_START_NO + 2, [1]));

    // Do not commit until B is genuinely waiting on the lock A holds -- see
    // waitForLockWait's comment for why a fixed sleep here made this test meaningless.
    await waitForLockWait(a, bBackendPid);

    await a.query("commit");
    const result = await loser;

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("stale_allocations");
  });

  it("still returns allocation_not_prefix when the prefix is genuinely wrong", async () => {
    // The two branches must stay distinguishable. A rename that collapsed them would make
    // a real data error look retryable, and the device would spin on it forever.
    const fx = await createSyncFixture(a);
    await a.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    // Skips rank 1. Not a prefix, and no concurrency involved.
    const result = await post(a, payloadFor(fx, FIXTURE_BOOKLET_START_NO + 3, [2]));

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("allocation_not_prefix");
  });
});
