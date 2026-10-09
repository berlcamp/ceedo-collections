import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, createSyncFixture, uniqueCode, type CollectionFixture } from "../helpers/supabase";

let db: Client;
let orNo = 1100;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => db.end());

async function keyedFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode) values ($1, $1, 'market', 'keyed') returning id`,
    [uniqueCode("KEY")],
  );
  return rows[0].id as string;
}

async function post(fx: CollectionFixture, fee: string, line: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { rows } = await db.query(`select ceedo_collections.post_collection($1::jsonb) r`, [
    JSON.stringify({
      id: randomUUID(), or_no: ++orNo, booklet_id: fx.bookletId, collector_id: fx.collectorId,
      device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: fee,
      lease_id: null, allocations: [], lines: [{ fee_type_id: fee, ...line }], ...extra,
    }),
  ]);
  return rows[0].r as { status: string; reason?: string; collection_id?: string; gross_amount?: string };
}

describe("keyed lines", () => {
  it("takes the typed amount as one line of quantity 1", async () => {
    const fx = await createCollectionFixture(db);
    const fee = await keyedFee();
    const r = await post(fx, fee, { quantity: 1, amount: "1722.50" });
    expect(r.status).toBe("accepted");
    const { rows } = await db.query(
      `select quantity, unit_rate::text, amount::text from ceedo_collections.collection_lines where collection_id = $1`,
      [r.collection_id],
    );
    expect(rows).toEqual([{ quantity: 1, unit_rate: "1722.50", amount: "1722.50" }]);
  });

  it.each([
    [{ quantity: 1, amount: "0" }],
    [{ quantity: 1, amount: "-5" }],
    [{ quantity: 1 }],
    [{ quantity: 2, amount: "10" }],
    [{ quantity: 1, amount: "0.004" }],
    [{ quantity: 1, amount: "abc" }],
    [{ quantity: 1, amount: "1e400" }],
    [{ quantity: 1, amount: "999999999999.999" }],
  ])("refuses %j with amount_mismatch", async (line) => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, await keyedFee(), line);
    expect(r).toMatchObject({ status: "rejected", reason: "amount_mismatch" });
  });

  it("ignores a typed amount on a rate fee: the rate table decides", async () => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, fx.perHeadFeeTypeId, { quantity: 2, amount: "99999", rate_class: "hog" });
    expect(r.status).toBe("accepted");
    expect(Number(r.gross_amount)).toBe(2 * Number(fx.perHeadRate));
  });

  it("records an occupancy fee on a lease with no allocations", async () => {
    const fx = await createCollectionFixture(db);
    const fee = await keyedFee();
    const r = await post(fx, fee, { quantity: 1, amount: "200" }, { lease_id: fx.leaseId });
    expect(r.status).toBe("accepted");
    const { rows } = await db.query(`select lease_id from ceedo_collections.collections where id = $1`, [r.collection_id]);
    expect(rows[0].lease_id).toBe(fx.leaseId);
  });
});

describe("payment mode", () => {
  it("defaults to cash", async () => {
    const fx = await createCollectionFixture(db);
    const r = await post(fx, fx.perHeadFeeTypeId, { quantity: 1, rate_class: "hog" });
    const { rows } = await db.query(`select payment_mode from ceedo_collections.collections where id = $1`, [r.collection_id]);
    expect(rows[0].payment_mode).toBe("cash");
  });
});

describe("sync_push", () => {
  it("rejects a tablet receipt that claims a check, and posts its neighbour", async () => {
    const sx = await createSyncFixture(db);
    const entry = (extra: Record<string, unknown>) => ({
      type: "collection",
      payload: {
        id: randomUUID(), or_no: ++orNo, booklet_id: sx.bookletId, collector_id: sx.collectorId,
        collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: sx.perHeadFeeTypeId, lease_id: null,
        allocations: [], lines: [{ fee_type_id: sx.perHeadFeeTypeId, quantity: 1, rate_class: "hog" }], ...extra,
      },
    });
    const { rows } = await db.query(`select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`, [
      sx.deviceId,
      JSON.stringify([entry({ payment_mode: "check", check_no: "1", bank: "LBP", check_date: "2026-10-05" }), entry({})]),
    ]);
    const results = rows[0].result as { status: string; reason?: string; detail?: string }[];
    expect(results[0]).toMatchObject({ status: "rejected", reason: "server_error" });
    expect(results[0].detail).toMatch(/office only/);
    expect(results[1].status).toBe("accepted");
  });
});
