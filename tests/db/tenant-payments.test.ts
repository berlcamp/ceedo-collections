import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createCollectionFixture,
  createOutsiderClient,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

beforeEach(async () => {
  await resetCutover(db);
  fx = await createCollectionFixture(db, {
    accrualPeriod: "daily", startDate: "2026-09-01", rateAmount: "50.00",
  });
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

async function charge(due: string, amount = "50.00", type = "rental", parent: string | null = null) {
  const { rows } = await db.query(
    `insert into ceedo_collections.charges
       (lease_id, fee_type_id, charge_type, parent_charge_id, period_start, period_end,
        due_date, amount, surcharge_bps, source)
     values ($1, $2, $3::ceedo_collections.charge_type, $4, $5::date, $5::date, $5::date, $6, 0, 'manual')
     returning id`,
    [fx.leaseId, fx.feeTypeId, type, parent, due, amount],
  );
  return rows[0].id as string;
}

const days = async (from: string, to: string) =>
  (await db.query(
    `select lease_id, business_date::text as d, base, surcharge
       from ceedo_collections.lease_receipts_by_day($1::date, $2::date)
      where lease_id = $3 order by business_date`,
    [from, to, fx.leaseId],
  )).rows;

describe("lease_receipts_by_day", () => {
  it("sums a lease's receipts per business day, splitting out surcharges", async () => {
    const rent = await charge("2026-10-01", "50.00");
    await charge("2026-10-01", "1.50", "surcharge", rent);
    await charge("2026-10-02", "50.00");
    // the 10-01 group (rent + its surcharge) and then the 10-02 group, on the same day
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T03:00:00+00:00" });

    const rows = await days("2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe("2026-10-05");
    expect(Number(rows[0].base)).toBe(100);
    expect(Number(rows[0].surcharge)).toBe(1.5);
  });

  it("drops a cancelled receipt and restores it once reinstated", async () => {
    await charge("2026-10-01");
    const id = await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    const { rows } = await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
       values ($1, 'test', $2) returning id`,
      [id, fx.collectorId],
    );
    expect(await days("2026-10-01", "2026-10-31")).toHaveLength(0);

    await db.query(
      `insert into ceedo_collections.collection_reinstatements (cancellation_id, reason, reinstated_by)
       values ($1, 'test', $2)`,
      [rows[0].id, fx.collectorId],
    );
    expect(await days("2026-10-01", "2026-10-31")).toHaveLength(1);
  });

  it("keeps to the date range", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    expect(await days("2026-10-06", "2026-10-31")).toHaveLength(0);
  });
});

describe("leases_active_between", () => {
  const active = async (from: string, to: string) =>
    (await db.query(
      `select * from ceedo_collections.leases_active_between($1::date, $2::date) where lease_id = $3`,
      [from, to, fx.leaseId],
    )).rows;

  it("lists a lease whose term overlaps the range, with its stall and tenant", async () => {
    const rows = await active("2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].stall_no).toBe("01");
    expect(Number(rows[0].rate_amount)).toBe(50);
  });

  it("omits a lease that ended before the range and took no money in it", async () => {
    await db.query(
      `update ceedo_collections.leases set end_date = '2026-09-15', status = 'ended' where id = $1`,
      [fx.leaseId],
    );
    expect(await active("2026-10-01", "2026-10-31")).toHaveLength(0);
  });

  it("keeps an ended lease that was paid in the range", async () => {
    await charge("2026-10-01");
    await postCollectionAsOwner(db, fx, { groupRanks: [1], collectedAt: "2026-10-05T02:00:00+00:00" });
    await db.query(
      `update ceedo_collections.leases set end_date = '2026-09-15', status = 'ended' where id = $1`,
      [fx.leaseId],
    );
    expect(await active("2026-10-01", "2026-10-31")).toHaveLength(1);
  });

  it("shows neither function's rows to a non-staff user", async () => {
    const outsider = await createOutsiderClient();
    const a = await outsider.rpc("leases_active_between", { p_from: "2026-10-01", p_to: "2026-10-31" });
    const b = await outsider.rpc("lease_receipts_by_day", { p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data ?? []).toEqual([]);
    expect(b.data ?? []).toEqual([]);
  });
});
