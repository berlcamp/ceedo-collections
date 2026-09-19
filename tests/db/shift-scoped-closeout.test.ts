import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  postCollectionAsOwner,
  type TestClient,
} from "../helpers/supabase";

/**
 * Two shifts, one collector, one business date -- the case the Phase 3a handover records as
 * deferred. Before shift_id, close_shift summed EVERY collection for (collector, date), so
 * closing the first shift saw the second shift's receipts too, fell short on count, and
 * refused an honest closeout.
 *
 * Fails safe, never silent -- but it refuses a collector who has done nothing wrong, and
 * the fix needs a schema change, which is why it waited for this phase.
 */
describe("closeout scoped by shift_id", () => {
  let db: PgClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    fx = await createSyncFixture(db);
  }, 60_000);

  afterAll(async () => {
    await db.end();
  });

  it("closes the first of two shifts on the same collector and date", async () => {
    const businessDate = "2026-10-05";
    const shiftA = randomUUID();
    const shiftB = randomUUID();

    for (const id of [shiftA, shiftB]) {
      await db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, status)
         values ($1, $2, $3, $4::date, now(), 'open')`,
        [id, fx.collectorId, fx.deviceId, businessDate],
      );
      // shifts_one_open_per_device forbids two SIMULTANEOUSLY open shifts on one device,
      // so the first is closed out of the way before the second opens -- which is exactly
      // the real sequence (a morning shift, then an afternoon one).
      if (id === shiftA) {
        await db.query(
          `update ceedo_collections.shifts set status = 'closed' where id = $1`,
          [id],
        );
      }
    }
    // B closes first, THEN A reopens: shifts_one_open_per_device is a unique index over
    // open shifts on the device, so reopening A while B is still open violates it. The end
    // state is what matters -- both shifts exist on this device and date, A open and about
    // to close out, B already closed -- and this is the only order that reaches it.
    await db.query(`update ceedo_collections.shifts set status = 'closed' where id = $1`, [
      shiftB,
    ]);
    await db.query(`update ceedo_collections.shifts set status = 'open' where id = $1`, [
      shiftA,
    ]);

    // One collection in each shift, posted through post_collection rather than inserted.
    // The engine is what sets shift_id from the payload, so an INSERT would leave the
    // post_collection half of this migration untested -- and the collections_balance
    // trigger refuses a hand-built row with no parts anyway.
    for (const [shiftId, orNo] of [
      [shiftA, 1101],
      [shiftB, 1102],
    ] as const) {
      await postCollectionAsOwner(db, fx, {
        orNo,
        shiftId,
        leaseId: null,
        feeTypeId: fx.perHeadFeeTypeId,
        groupRanks: [],
        lines: [
          { fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 },
        ],
        collectedAt: `${businessDate}T02:00:00+00:00`,
      });
    }

    // The guard that keeps this test from passing vacuously: the OLD scoping
    // (collector_id, business_date) sees TWO collections here. If a later change made
    // post_collection drop shift_id, or made this fixture post only one receipt, the
    // closeout below would answer `closed` for the wrong reason and prove nothing.
    const { rows: byCollector } = await db.query(
      `select count(*)::int as n
         from ceedo_collections.collections
        where collector_id = $1 and business_date = $2::date`,
      [fx.collectorId, businessDate],
    );
    expect(byCollector[0].n).toBe(2);

    // One head at the fixture's per-head rate. The figure is read from the fixture rather
    // than written in, because the assertion under test is that close_shift counts ONE
    // collection and not two -- not what a hog costs.
    const shiftTotal = Number(fx.perHeadRate);

    // Shift A holds exactly ONE collection. Before shift_id, close_shift would have counted
    // both and answered `mismatch`.
    const { rows } = await db.query(
      `select ceedo_collections.close_shift($1, $2, $3::numeric, 1, $3::numeric) as result`,
      [shiftA, fx.deviceId, shiftTotal.toFixed(2)],
    );
    expect(rows[0].result.status).toBe("closed");
    expect(Number(rows[0].result.system_count)).toBe(1);
    expect(Number(rows[0].result.system_total)).toBe(shiftTotal);
    expect(Number(rows[0].result.variance)).toBe(0);
  });
});

/**
 * Spec E3. A correction re-posts the original UUID (D9); it must re-post the original
 * SHIFT too. A corrected receipt is cash that was physically in that collector's drawer
 * during that shift, and a correction that moved it out would unbalance a closeout that
 * had already balanced, with nothing pointing at why.
 */
describe("a correction preserves the original shift_id", () => {
  let db: PgClient;
  let supervisor: TestClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    fx = await createSyncFixture(db);
    // has_role() resolves through auth.uid(), which is NULL on the raw owner connection, so
    // the resolution RPCs are called through an authenticated supervisor -- the same reason
    // resolve-exception.test.ts does it this way.
    ({ client: supervisor } = await createAppUser({
      email: "shift-scoped-closeout-supervisor",
      role: "supervisor",
    }));
  }, 60_000);

  afterAll(async () => {
    await db.end();
  });

  it("re-posts into the shift the receipt was collected in, not the supervisor's claim", async () => {
    const businessDate = "2026-10-05";
    const shiftId = randomUUID();
    const otherShiftId = randomUUID();

    for (const id of [shiftId, otherShiftId]) {
      await db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, closed_at, status)
         values ($1, $2, $3, $4::date, now(), now(), 'closed')`,
        [id, fx.collectorId, fx.deviceId, businessDate],
      );
    }

    // A permanently-rejectable push: the OR number is outside the booklet's range, so
    // post_collection writes nothing and sync_push files the exception with the payload
    // exactly as the device sent it -- shift_id included.
    const collectionUuid = randomUUID();
    await db.query(`select ceedo_collections.sync_push($1::uuid, $2::jsonb)`, [
      fx.deviceId,
      JSON.stringify([
        {
          type: "collection",
          payload: {
            id: collectionUuid,
            or_no: 999999,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: `${businessDate}T02:00:00+00:00`,
            fee_type_id: fx.perHeadFeeTypeId,
            shift_id: shiftId,
            lines: [
              { fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 },
            ],
            allocations: [],
          },
        },
      ]),
    ]);

    const { rows: exRows } = await db.query(
      `select id, payload from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [collectionUuid],
    );
    expect(exRows).toHaveLength(1);
    expect(exRows[0].payload.shift_id).toBe(shiftId);

    // The supervisor corrects the OR number AND -- whether by a buggy client or a hostile
    // one -- sends a different shift_id. The correction must ignore it.
    const { data, error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: exRows[0].id as string,
      p_payload: { or_no: 1201, shift_id: otherShiftId },
      p_reason: "Collector wrote the wrong serial; corrected against the paper receipt.",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "accepted" });

    const { rows } = await db.query(
      `select shift_id from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_id).toBe(shiftId);
  });
});
