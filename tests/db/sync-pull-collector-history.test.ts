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
