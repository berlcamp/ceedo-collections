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

describe("two devices racing one lease", () => {
  it("settles one and tells the other to retry, filing no exception", async () => {
    const one = await createSyncFixture(a);
    // A second device on the same facility, holding its own booklet -- the shared-tablet
    // case §3 says is routine, not an edge case.
    const two = await createSyncFixture(a);
    //
    // createSyncFixture already gives `two` its own facility and an active
    // device_assignments/collector_assignments row there (can_collector_use_device needs
    // SOME facility where the device and the collector both hold an active row -- it never
    // looks at the lease's facility, so that default pairing would in fact satisfy
    // sync_push on its own). Repointing both rows at `one`'s facility instead is what
    // actually stages "two tablets at the same market" rather than two unrelated ones that
    // merely happen to race the same lease_id in the payload.
    //
    // device_assignments carries a UNIQUE INDEX on (device_id) WHERE active
    // (device_assignments_one_active) -- a shared tablet is bound to one facility at a
    // time -- so the existing row for `two`'s device is UPDATED in place, not
    // superseded by a second active INSERT, which would hit that constraint.
    await a.query(
      `update ceedo_collections.device_assignments
          set facility_id = $2
        where device_id = $1 and active`,
      [two.deviceId, one.facilityId],
    );
    // collector_assignments carries no such exclusivity (a collector may hold areas at
    // more than one facility), so a plain second row is fine here.
    await a.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
       values ($1, $2, true)`,
      [two.collectorId, one.facilityId],
    );
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    function entry(fx: typeof one, orNo: number) {
      return [
        {
          type: "collection",
          payload: {
            id: randomUUID(),
            or_no: orNo,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: `${BUSINESS_DATE}T02:00:00+00:00`,
            fee_type_id: one.feeTypeId,
            lease_id: one.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ];
    }

    const first = entry(one, 1400);
    const second = entry(two, 1400);
    // entry() always returns a single-element array; second[0] is never undefined, but
    // TypeScript's noUncheckedIndexedAccess cannot know that from the array type alone.
    const secondId = second[0]!.payload.id;

    const { rows: bPid } = await b.query(`select pg_backend_pid() as pid`);
    const bBackendPid = bPid[0].pid as number;

    await a.query("begin");
    // A wins the lock and holds it.
    const winner = await a.query(
      `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
      [one.deviceId, JSON.stringify(first)],
    );
    expect(winner.rows[0].result[0].status).toBe("accepted");

    // B blocks on the same charge row `one`'s post locked.
    const loserPromise = b.query(
      `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
      [two.deviceId, JSON.stringify(second)],
    );

    // Do not commit until B is genuinely waiting on the lock A holds -- a fixed sleep here
    // is exactly the flake waitForLockWait's own doc comment (tests/helpers/supabase.ts)
    // describes: without it, B's query may not even have been dispatched by the time A
    // commits, and the race is never staged at all.
    await waitForLockWait(a, bBackendPid);

    await a.query("commit");
    const loser = (await loserPromise).rows[0].result[0];

    expect(loser.status).toBe("rejected");
    expect(loser.reason).toBe("stale_allocations");
    expect(loser.retryable).toBe(true);

    // The point of the retryable flag. A supervisor must NOT be put in front of a race
    // that resolves itself on the device's next sync (invariant 24).
    const { rows } = await a.query(
      `select count(*)::int as n from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [secondId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("never double-settles a period under concurrency", async () => {
    // The damage Phase 2 demonstrated without the lock: two allocations totalling P100
    // against a P50 charge, outstanding at -P50, is_settled reading true.
    const fx = await createSyncFixture(a);
    await a.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    // charge_balances already carries lease_id directly (it selects straight off
    // charges.id, not a separate charge_id column) -- no join to charges needed.
    const { rows } = await a.query(
      `select outstanding from ceedo_collections.charge_balances where lease_id = $1`,
      [fx.leaseId],
    );
    for (const row of rows) {
      expect(Number(row.outstanding)).toBeGreaterThanOrEqual(0);
    }
  });
});
