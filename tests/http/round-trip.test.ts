import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

// Design §1's exit criterion, taken literally: "Phase 3a ships when the full round-trip
// can be exercised over HTTP without a tablet." Everything below goes through
// callFunction() -- real HTTP, through Kong, into the deployed Edge Functions, and from
// there into the real SQL functions -- never a direct call to Postgres for the sync steps
// themselves. `db` is used only to seed the fixture and to read the exception row a
// supervisor would see; the collector's whole day is played entirely over HTTP.
let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

describe("a market round, end to end, without a tablet", () => {
  it("authenticates, pulls, pushes a mixed batch, files one exception, and closes out", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const creds = { credential_id: fx.credentialId, secret: fx.secret };

    // 1. Pull the scoped world.
    const pull = await callFunction("sync-pull", { ...creds, cursor: 0 });
    expect(pull.status).toBe(200);
    expect(pull.body.leases.map((l: any) => l.id)).toContain(fx.leaseId);
    const cursor = pull.body.cursor;

    // 2. Open a shift.
    const shiftId = randomUUID();
    const opened = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "shift_open",
          payload: {
            id: shiftId,
            collector_id: fx.collectorId,
            business_date: "2026-10-05",
            opened_at: "2026-10-05T02:00:00+00:00",
          },
        },
      ],
    });
    expect(opened.body[0].status).toBe("accepted");

    // 3. A mixed batch: one good receipt, one that can never succeed, one spoiled form.
    const good = randomUUID();
    const doomed = randomUUID();
    const batch = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "collection",
          payload: {
            id: good,
            or_no: 1600,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            shift_id: shiftId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
        {
          type: "collection",
          payload: {
            id: doomed,
            or_no: 999999,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            shift_id: shiftId,
            allocations: [{ group_rank: 2 }],
            lines: [],
          },
        },
        {
          type: "spoiled_form",
          payload: {
            booklet_id: fx.bookletId,
            or_no: 1601,
            collector_id: fx.collectorId,
            reason: "Torn",
          },
        },
      ],
    });

    // The poison entry cost its own receipt, not the round's.
    expect(batch.body.map((r: any) => r.status)).toEqual([
      "accepted",
      "rejected",
      "accepted",
    ]);

    // 4. The rejection is a supervisor's problem, not a discard.
    const { rows: ex } = await db.query(
      `select status, reason_code from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [doomed],
    );
    expect(ex[0]).toMatchObject({ status: "open", reason_code: "or_out_of_range" });

    // 5. A retry of the whole batch is idempotent.
    const retry = await callFunction("sync-push", {
      ...creds,
      entries: [
        {
          type: "collection",
          payload: {
            id: good,
            or_no: 1600,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            shift_id: shiftId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });
    expect(retry.body[0].status).toBe("duplicate");

    // 6. The next pull carries the collection, though no charge row moved.
    const delta = await callFunction("sync-pull", { ...creds, cursor });
    expect(delta.body.collections.map((c: any) => c.id)).toContain(good);

    // 7. Closeout: wrong figures are refused. The shift holds the one receipt that landed
    // (the rejected one wrote nothing), so a declaration of nothing cannot reconcile.
    const wrong = await callFunction("closeout", {
      ...creds,
      shift_id: shiftId,
      declared_total: "0.00",
      device_count: 0,
      device_total: "0.00",
    });
    expect(wrong.body.status).toBe("mismatch");

    // 8. Right figures close it, and a short drawer does not block.
    const right = await callFunction("closeout", {
      ...creds,
      shift_id: shiftId,
      declared_total: (Number(wrong.body.system_total) - 5).toFixed(2),
      device_count: wrong.body.system_count,
      device_total: wrong.body.system_total,
    });
    expect(right.body.status).toBe("closed");
    expect(Number(right.body.variance)).toBeCloseTo(-5, 2);
  });
});
