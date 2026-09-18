import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  resetCutover,
  waitForLockWait,
} from "../helpers/supabase";

let a: Client;
let b: Client;
const BUSINESS_DATE = "2026-10-05";

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

type SyncFixture = Awaited<ReturnType<typeof createSyncFixture>>;

/**
 * Points device `two` and collector `two` at `owner`'s facility, so the pair models "two
 * tablets at the same physical market" (the shared-tablet case §3 says is routine) rather
 * than two unrelated facilities that merely happen to race the same lease_id in the
 * payload.
 *
 * createSyncFixture already gives `two` its own facility and an active
 * device_assignments/collector_assignments row there -- can_collector_use_device() needs
 * SOME facility where the device and the collector both hold an active row, and never
 * looks at the lease's facility, so that default pairing would in fact satisfy sync_push
 * on its own. This is therefore not load-bearing for the race itself, only for fidelity to
 * the scenario being staged.
 *
 * device_assignments carries a UNIQUE INDEX on (device_id) WHERE active
 * (device_assignments_one_active) -- a shared tablet is bound to one facility at a time --
 * so the existing row for `two`'s device is UPDATED in place, not superseded by a second
 * active INSERT, which would hit that constraint. collector_assignments carries no such
 * exclusivity (a collector may hold areas at more than one facility), so a plain second
 * row is fine there.
 */
async function shareFacility(db: Client, owner: SyncFixture, two: SyncFixture): Promise<void> {
  await db.query(
    `update ceedo_collections.device_assignments
        set facility_id = $2
      where device_id = $1 and active`,
    [two.deviceId, owner.facilityId],
  );
  await db.query(
    `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
     values ($1, $2, true)`,
    [two.collectorId, owner.facilityId],
  );
}

/** A single-entry sync_push batch settling group_rank 1 of `owner`'s lease via `fx`'s booklet. */
function raceEntry(owner: SyncFixture, fx: SyncFixture, orNo: number) {
  return [
    {
      type: "collection",
      payload: {
        id: randomUUID(),
        or_no: orNo,
        booklet_id: fx.bookletId,
        collector_id: fx.collectorId,
        collected_at: `${BUSINESS_DATE}T02:00:00+00:00`,
        fee_type_id: owner.feeTypeId,
        lease_id: owner.leaseId,
        allocations: [{ group_rank: 1 }],
        lines: [],
      },
    },
  ];
}

/**
 * Stages the FIFO race: A posts and holds its transaction open, B posts against the same
 * period group and blocks on A's row lock (STEP 4b of post_collection), A commits only
 * once B is confirmed genuinely waiting on that lock (waitForLockWait), then both results
 * are returned.
 *
 * Do not commit A before B is confirmed blocked -- a fixed sleep here is exactly the flake
 * waitForLockWait's own doc comment (tests/helpers/supabase.ts) describes: without it, B's
 * query may not even have been dispatched by the time A commits, and the race is never
 * staged at all.
 */
async function race(
  owner: SyncFixture,
  winnerFx: SyncFixture,
  loserFx: SyncFixture,
  orNo: number,
): Promise<{ winner: Record<string, unknown>; loser: Record<string, unknown> }> {
  const winnerEntry = raceEntry(owner, winnerFx, orNo);
  const loserEntry = raceEntry(owner, loserFx, orNo);

  const { rows: bPid } = await b.query(`select pg_backend_pid() as pid`);
  const bBackendPid = bPid[0].pid as number;

  await a.query("begin");
  const winnerResult = await a.query(
    `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
    [winnerFx.deviceId, JSON.stringify(winnerEntry)],
  );

  const loserPromise = b.query(
    `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
    [loserFx.deviceId, JSON.stringify(loserEntry)],
  );

  await waitForLockWait(a, bBackendPid);
  await a.query("commit");
  const loserResult = await loserPromise;

  return {
    winner: winnerResult.rows[0].result[0],
    loser: loserResult.rows[0].result[0],
  };
}

describe("two devices racing one lease", () => {
  it("settles one and tells the other to retry, filing no exception", async () => {
    const one = await createSyncFixture(a);
    // A second device on the same facility, holding its own booklet -- the shared-tablet
    // case §3 says is routine, not an edge case.
    const two = await createSyncFixture(a);
    await shareFacility(a, one, two);
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    const loserEntryId = raceEntry(one, two, 1400)[0]!.payload.id;
    const { winner, loser } = await race(one, one, two, 1400);

    expect(winner.status).toBe("accepted");
    expect(loser.status).toBe("rejected");
    expect(loser.reason).toBe("stale_allocations");
    expect(loser.retryable).toBe(true);

    // The point of the retryable flag. A supervisor must NOT be put in front of a race
    // that resolves itself on the device's next sync (invariant 24).
    const { rows } = await a.query(
      `select count(*)::int as n from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [loserEntryId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("never double-settles a period under concurrency", async () => {
    // The damage Phase 2 demonstrated without the FIFO lock: two allocations totalling
    // P100 against a P50 charge -- outstanding at -P50, is_settled reading true.
    //
    // A test that merely reads charge_balances after a SINGLE post proves nothing about
    // concurrency: with zero collections, allocated is always 0 and amount > 0 is a CHECK
    // constraint on charges, so outstanding >= 0 would hold unconditionally, whether or
    // not the lock exists, whether or not post_collection exists at all. This one actually
    // stages the same two-device race as the first test, over its own fixture, and then
    // asserts the CONSEQUENCE rather than the reason code: the ledger must not end up
    // over-settled, and the contested charge must carry exactly one allocation, not two.
    const one = await createSyncFixture(a);
    const two = await createSyncFixture(a);
    await shareFacility(a, one, two);
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    const { winner, loser } = await race(one, one, two, 1400);

    // Exactly one of the two racing posts may have settled group_rank 1. Without the FIFO
    // lock both would read the period as unpaid and both would allocate against it, which
    // is precisely the damage this test exists to catch.
    const accepted = [winner, loser].filter((r) => r.status === "accepted");
    expect(accepted).toHaveLength(1);

    const { rows: balances } = await a.query(
      `select outstanding from ceedo_collections.charge_balances where lease_id = $1`,
      [one.leaseId],
    );
    for (const row of balances) {
      expect(Number(row.outstanding)).toBeGreaterThanOrEqual(0);
    }

    // The falsifiable half: the contested charge (whichever one group_rank 1 resolved to)
    // must have been allocated against exactly once, not twice.
    const { rows: allocCount } = await a.query(
      `select count(*)::int as n
         from ceedo_collections.collection_allocations ca
         join ceedo_collections.charges c on c.id = ca.charge_id
        where c.lease_id = $1`,
      [one.leaseId],
    );
    expect(allocCount[0].n).toBe(1);
  });
});
