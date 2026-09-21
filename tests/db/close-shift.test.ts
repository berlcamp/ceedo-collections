import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
const BUSINESS_DATE = "2026-10-05";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;

async function openShift(fx: Fixture): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, $4::date, now(), 'open')`,
    [id, fx.collectorId, fx.deviceId, BUSINESS_DATE],
  );
  return id;
}

async function close(
  shiftId: string,
  fx: Fixture,
  opts: { declared: string | null; count: number; total: string },
): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `select ceedo_collections.close_shift($1::uuid, $2::uuid, $3::numeric, $4::int, $5::numeric)
            as result`,
    [shiftId, fx.deviceId, opts.declared, opts.count, opts.total],
  );
  return rows[0].result;
}

/**
 * postCollectionAsOwner returns only the new collection's bare id -- it throws on
 * anything but `accepted`, so acceptance needs no separate assertion here. gross_amount is
 * read back from the ledger row rather than re-derived, so a rate change cannot silently
 * desync the fixture from the assertion.
 */
async function postAndRead(
  fx: Fixture,
  opts: Parameters<typeof postCollectionAsOwner>[2],
): Promise<{ collectionId: string; grossAmount: string }> {
  const collectionId = await postCollectionAsOwner(db, fx, opts);
  const { rows } = await db.query(
    `select gross_amount from ceedo_collections.collections where id = $1`,
    [collectionId],
  );
  return { collectionId, grossAmount: rows[0].gross_amount as string };
}

/**
 * Collects one receipt INTO a shift. Since migration 0043 close_shift counts by
 * collections.shift_id, so every test here opens its shift first and posts against it --
 * which is the real sequence anyway (a shift opens, then receipts are collected during it).
 * A receipt posted with no shift_id belongs to no shift and is counted by no closeout.
 */
async function collectOnce(fx: Fixture, shiftId: string): Promise<string> {
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
  const { grossAmount } = await postAndRead(fx, {
    groupRanks: [1],
    shiftId,
    collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
  });
  return grossAmount;
}

describe("close_shift — record reconciliation", () => {
  it("closes when the device and the server agree", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);

    const result = await close(shiftId, fx, { declared: amount, count: 1, total: amount });

    expect(result).toMatchObject({ status: "closed" });
    const { rows } = await db.query(
      `select status, system_count, variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "closed", system_count: 1 });
    expect(Number(rows[0].variance)).toBe(0);
  });

  it("refuses and writes nothing when the counts disagree", async () => {
    // §6.5 step 4. A device holding an unpushed receipt has a count the server cannot
    // match, and THAT is what makes silent data loss impossible to overlook.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);

    const result = await close(shiftId, fx, { declared: amount, count: 2, total: amount });

    expect(result).toMatchObject({ status: "mismatch", device_count: 2, system_count: 1 });
    const { rows } = await db.query(
      `select status, closed_at from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "open", closed_at: null });
  });

  it("refuses when the sums disagree even though the counts match", async () => {
    // Both halves are load-bearing. Comparing only the sum would let a shift with one
    // missing receipt and one duplicated amount close cleanly.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);

    const result = await close(shiftId, fx, { declared: amount, count: 1, total: "999.00" });

    expect(result).toMatchObject({ status: "mismatch" });
  });

  it("returns both sides so the device can display the difference", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);

    const result = await close(shiftId, fx, { declared: amount, count: 3, total: "1.00" });

    // device_total/system_total round-trip through jsonb, which the pg driver parses with
    // JSON.parse -- a numeric jsonb member comes back as a JS number, not the original
    // decimal-formatted string (the same reason tests elsewhere read jsonb money fields
    // with Number(...) rather than asserting the raw string; see
    // tests/db/post-collection.test.ts's `Number(result.gross_amount)`).
    expect(result).toMatchObject({ status: "mismatch", device_count: 3, system_count: 1 });
    expect(Number(result.device_total)).toBe(1);
    expect(result.system_total).toBeDefined();
  });

  it("excludes a cancelled collection from the server's figures", async () => {
    // Otherwise a cancelled receipt inflates the number a collector is asked to match, and
    // an honest closeout is refused for a receipt that no longer counts.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
    const keep = await postAndRead(fx, {
      groupRanks: [1],
      shiftId,
      collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
    });
    // NOT another lease allocation: unpaid_period_groups renumbers from 1 over whatever
    // remains unpaid, so once `keep` settles the lease's only unpaid period there is no
    // rank 2 to allocate against. A cash-only, non-lease line (the same shape §D7's
    // "parking, terminal and slaughterhouse" streams use) keeps this test about
    // cancellation, not about a second FIFO period existing.
    const drop = await postAndRead(fx, {
      groupRanks: [],
      leaseId: null,
      feeTypeId: fx.perHeadFeeTypeId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
      shiftId,
      collectedAt: `${BUSINESS_DATE}T02:00:00+00:00`,
    });
    await db.query(
      `insert into ceedo_collections.collection_cancellations
         (collection_id, cancelled_by, reason)
       values ($1, $2, 'Wrong tenant')`,
      [drop.collectionId, fx.collectorId],
    );

    const result = await close(shiftId, fx, {
      declared: keep.grossAmount,
      count: 1,
      total: keep.grossAmount,
    });

    expect(result).toMatchObject({ status: "closed" });
  });
});

describe("close_shift — cash variance", () => {
  it("closes a short shift and records the variance", async () => {
    // §6.5 step 5: "Collector declares physical cash; variance is recorded, not hidden."
    // Blocking here would be worse than useless -- it would give a collector who is short
    // a direct incentive to adjust the declaration until it matched.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);
    const declared = (Number(amount) - 50).toFixed(2);

    const result = await close(shiftId, fx, { declared, count: 1, total: amount });

    expect(result).toMatchObject({ status: "closed" });
    const { rows } = await db.query(
      `select variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].variance)).toBeCloseTo(-50, 2);
  });

  it("records an over as a positive variance", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    const amount = await collectOnce(fx, shiftId);
    const declared = (Number(amount) + 25).toFixed(2);

    await close(shiftId, fx, { declared, count: 1, total: amount });

    const { rows } = await db.query(
      `select variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].variance)).toBeCloseTo(25, 2);
  });
});

describe("close_shift — guards", () => {
  it("refuses a shift belonging to another device", async () => {
    const mine = await createSyncFixture(db);
    const theirs = await createSyncFixture(db);
    const shiftId = await openShift(mine);

    await expect(
      close(shiftId, theirs, { declared: "0.00", count: 0, total: "0.00" }),
    ).rejects.toThrow(/device/i);
  });

  it("returns already_closed rather than closing twice", async () => {
    // Idempotency: a push retried after a dropped ack must not rewrite the variance.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);
    await close(shiftId, fx, { declared: "0.00", count: 0, total: "0.00" });

    const second = await close(shiftId, fx, { declared: "500.00", count: 0, total: "0.00" });

    expect(second).toMatchObject({ status: "already_closed" });
    const { rows } = await db.query(
      `select declared_total from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(Number(rows[0].declared_total)).toBe(0);
  });

  it("refuses a closeout that declares no cash at all", async () => {
    // §6.5 step 5, "variance is recorded, not hidden". Before migration 0040
    // `p_declared_total` was never NULL-checked, so an omitted declaration closed the shift
    // with `declared_total = null` and — since `null - total` is null — `variance = null`.
    // The already_closed guard then made that permanent: a shortfall erased by an ABSENT
    // field rather than a wrong one, which is the one way to defeat §6.5 without lying.
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);

    await expect(
      close(shiftId, fx, { declared: null, count: 0, total: "0.00" }),
    ).rejects.toThrow(/declare the physical cash/i);

    const { rows } = await db.query(
      `select status, declared_total, variance from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    // Still open, so the real closeout can still be made.
    expect(rows[0].status).toBe("open");
    expect(rows[0].declared_total).toBeNull();
    expect(rows[0].variance).toBeNull();
  });

  it("raises on a shift that does not exist", async () => {
    const fx = await createSyncFixture(db);
    await expect(
      close(randomUUID(), fx, { declared: "0.00", count: 0, total: "0.00" }),
    ).rejects.toThrow(/no such shift/i);
  });

  it("closes an empty shift with zero on both sides", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = await openShift(fx);

    const result = await close(shiftId, fx, { declared: "0.00", count: 0, total: "0.00" });

    expect(result).toMatchObject({ status: "closed" });
  });
});
