// tests/db/account-catalogue.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, postCollectionAsOwner, resetCutover, uniqueCode } from "../helpers/supabase";

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const lines = async (collectionId: string) =>
  (await db.query(
    `select a.code, l.amount::text as amount from ceedo_collections.receipt_account_lines('2026-10-01', '2026-10-31') l
       join ceedo_collections.collection_accounts a on a.id = l.account_id
      where l.collection_id = $1 order by a.code`,
    [collectionId],
  )).rows;

async function feeId(code: string) {
  return (await db.query(`select id from ceedo_collections.fee_types where code = $1`, [code])).rows[0].id as string;
}

describe("install_account_catalogue", () => {
  it("is idempotent", async () => {
    const count = async () =>
      (await db.query(
        `select (select count(*) from ceedo_collections.collection_accounts)::int a,
                (select count(*) from ceedo_collections.account_rules)::int r,
                (select count(*) from ceedo_collections.fee_types)::int f`,
      )).rows[0];
    const before = await count();
    await db.query(`select ceedo_collections.install_account_catalogue()`);
    expect(await count()).toEqual(before);
  });

  it("seeds the monthly summary's lines on both groupings", async () => {
    const { rows } = await db.query(
      `select count(*)::int n from ceedo_collections.collection_accounts where code <> 'UNCLASSIFIED'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(100);
  });

  it("splits ante-mortem 75/25 between the slaughterhouse and NMIS", async () => {
    const fx = await createCollectionFixture(db);
    const ante = await feeId("SLH_ANTE");
    await db.query(
      `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
       values ($1, '', '2026-10-01', 100.01, 'per_head')
       on conflict do nothing`,
      [ante],
    );
    const id = await postCollectionAsOwner(db, fx, {
      leaseId: null, groupRanks: [], feeTypeId: ante, lines: [{ fee_type_id: ante, quantity: 1 }],
    });
    expect(await lines(id)).toEqual([
      { code: "NI-NMIS", amount: "25.00" },
      { code: "SLH-ANTE", amount: "75.01" },
    ]);
  });

  it("places Public Mall daily rent by section", async () => {
    await resetCutover(db);
    const fx = await createCollectionFixture(db, { accrualPeriod: "daily", startDate: "2026-10-01", rateAmount: "50.00" });
    const { rows } = await db.query(
      `select s.id from ceedo_collections.sections s join ceedo_collections.facilities f on f.id = s.facility_id
        where f.code = 'CPM' and s.name = 'Bakery'`,
    );
    const stall = await db.query(
      `insert into ceedo_collections.stalls (section_id, stall_no) values ($1, $2) returning id`,
      [rows[0].id, uniqueCode("B")],
    );
    await db.query(`update ceedo_collections.leases set stall_id = $1 where id = $2`, [stall.rows[0].id, fx.leaseId]);
    await db.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date, amount, surcharge_bps, source)
       values ($1, $2, 'rental', '2026-10-01', '2026-10-01', '2026-10-01', 50, 0, 'manual')`,
      [fx.leaseId, fx.feeTypeId],
    );
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1] });
    expect(await lines(id)).toEqual([{ code: "CPM-DR-BAKERY", amount: "50.00" }]);
  });

  it("places a keyed electricity payment on its non-income line", async () => {
    const fx = await createCollectionFixture(db);
    const elec = await feeId("ELEC_CPM");
    const { rows } = await db.query(
      `select ceedo_collections.post_collection($1::jsonb) r`,
      [JSON.stringify({
        id: randomUUID(), or_no: 1970, booklet_id: fx.bookletId, collector_id: fx.collectorId,
        device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", fee_type_id: elec,
        lease_id: null, allocations: [], lines: [{ fee_type_id: elec, quantity: 1, amount: "1722.00" }],
      })],
    );
    expect(rows[0].r.status).toBe("accepted");
    expect(await lines(rows[0].r.collection_id)).toEqual([{ code: "NI-ELEC-CPM", amount: "1722.00" }]);
  });
});
