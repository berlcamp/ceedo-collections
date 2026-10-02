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
  leases: { id: string }[];
  collection_allocations: { collection_id: string }[];
  collection_cancellations: { id: string; collection_id: string }[];
  collection_reinstatements: { id: string; cancellation_id: string }[];
};

// Cancels a receipt and lifts the cancellation, as migration 20260928000051 records it:
// a reinstatement row pointing at the cancellation. Returns the reinstatement's id.
async function cancelAndReinstate(collectionId: string, by: string): Promise<string> {
  const { rows: cc } = await db.query(
    `insert into ceedo_collections.collection_cancellations (collection_id, cancelled_by, reason)
     values ($1, $2, 'Wrong payer') returning id`,
    [collectionId, by],
  );
  const { rows: cr } = await db.query(
    `insert into ceedo_collections.collection_reinstatements (cancellation_id, reinstated_by, reason)
     values ($1, $2, 'Right payer after all') returning id`,
    [cc[0].id, by],
  );
  return cr[0].id as string;
}

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

  it("sends an on-the-spot receipt's reinstatement under collector scope", async () => {
    const fx = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });
    const reinstatementId = await cancelAndReinstate(id, fx.collectorId);
    const other = await createSyncFixture(db);

    const result = await pull(other.deviceId);

    expect(result.collection_cancellations.map((c) => c.collection_id)).toContain(id);
    expect(result.collection_reinstatements.map((r) => r.id)).toContain(reinstatementId);
  });

  // An on-the-spot receipt settles no charge, so it has no allocations. The receipt here is
  // on a lease, but its collector has moved to another area and nobody covers the lease any
  // more: only the collector scope can send its allocation and reinstatement.
  it("sends allocations and reinstatements of a receipt whose lease is out of every scope", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    const reinstatementId = await cancelAndReinstate(id, fx.collectorId);
    const other = await createSyncFixture(db);
    await db.query(
      `update ceedo_collections.collector_assignments set active = false where collector_id = $1`,
      [fx.collectorId],
    );
    await db.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
       values ($1, $2, true)`,
      [fx.collectorId, other.facilityId],
    );

    const result = await pull(other.deviceId);

    expect(result.leases.map((l) => l.id)).not.toContain(fx.leaseId);
    expect(result.collections.map((c) => c.id)).toContain(id);
    expect(result.collection_allocations.map((a) => a.collection_id)).toContain(id);
    expect(result.collection_reinstatements.map((r) => r.id)).toContain(reinstatementId);
  });

  it("a delta pull sends a collector's older receipts when only their area changed", async () => {
    const fx = await createSyncFixture(db);
    const elsewhere = await createSyncFixture(db);
    const id = await postCollectionAsOwner(db, fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
    });
    const first = await pull(fx.deviceId);
    expect((await pull(fx.deviceId, Number(first.cursor))).collections.map((c) => c.id)).not.toContain(
      id,
    );

    // Nothing about the receipt changes: only the collector gains an area.
    await db.query(
      `insert into ceedo_collections.collector_assignments (collector_id, facility_id, active)
       values ($1, $2, true)`,
      [fx.collectorId, elsewhere.facilityId],
    );

    const delta = await pull(fx.deviceId, Number(first.cursor));

    expect(delta.collections.map((c) => c.id)).toContain(id);
  });
});
