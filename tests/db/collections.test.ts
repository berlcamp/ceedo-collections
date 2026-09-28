import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createLeaseFixture, createCollectionFixture } from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createCollectionFixture>>;

/** Inserts a collection and its parts in one transaction, as the table owner. */
async function postRaw(opts: {
  id?: string; orNo: number; gross: string;
  allocations?: { chargeId: string; amount: string }[];
  lines?: { quantity: number; unitRate: string }[];
}) {
  const id = opts.id ?? randomUUID();
  await db.query("begin");
  try {
    await db.query(
      `insert into ceedo_collections.collections
         (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
          fee_type_id, lease_id, gross_amount)
       values ($1, $2, $3, $4, $5, now(), current_date, $6, $7, $8)`,
      [id, opts.orNo, fx.bookletId, fx.collectorId, fx.deviceId, fx.feeTypeId,
       fx.leaseId, opts.gross],
    );
    for (const a of opts.allocations ?? []) {
      await db.query(
        `insert into ceedo_collections.collection_allocations (collection_id, charge_id, amount)
         values ($1, $2, $3)`,
        [id, a.chargeId, a.amount],
      );
    }
    for (const l of opts.lines ?? []) {
      await db.query(
        `insert into ceedo_collections.collection_lines
           (collection_id, fee_type_id, quantity, unit_rate)
         values ($1, $2, $3, $4)`,
        [id, fx.feeTypeId, l.quantity, l.unitRate],
      );
    }
    await db.query("commit");
    return id;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createCollectionFixture(db);
});

afterAll(async () => { await db.end(); });

describe("collections constraints", () => {
  it("refuses the same serial twice in the same booklet", async () => {
    await postRaw({ orNo: 1001, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] });
    await expect(
      postRaw({ orNo: 1001, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/collections_serial_spent_once/);
  });

  it("refuses a duplicate client-generated id", async () => {
    const id = randomUUID();
    await postRaw({ id, orNo: 1002, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] });
    await expect(
      postRaw({ id, orNo: 1003, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/collections_pkey/);
  });

  /**
   * The ABSENCE of a default on collections.id is the idempotency contract, and it is
   * asserted here because nothing else can see it.
   *
   * The test above proves a duplicate id is refused; it cannot prove that the id came from
   * the caller. Phase 3's tablets sync offline receipts through post_collection() carrying
   * an id they generated themselves, and a retried sync is recognised as a retry by that
   * id alone. Add `default gen_random_uuid()` to this column in some future migration and
   * an omitted id stops being an error and silently becomes a NEW row -- so every retried
   * sync issues a second official receipt for one payment. Every existing test still
   * passes, because every one of them supplies an id.
   *
   * Read from the catalog rather than inferred from behaviour: an insert omitting `id`
   * fails today with a NOT NULL violation, which is exactly what it would ALSO do if a
   * default existed and were somehow not applied, so the behavioural probe cannot
   * distinguish the two. `column_default` null is the property itself.
   */
  it("has no default on collections.id -- the tablet supplies it, and that is the idempotency key", async () => {
    const { rows } = await db.query(
      `select column_default
         from information_schema.columns
        where table_schema = 'ceedo_collections'
          and table_name = 'collections'
          and column_name = 'id'`,
    );
    // One row, or the column has been renamed and the assertion below would pass
    // vacuously on undefined.
    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toBeNull();
  });

  it("computes a line's amount from quantity and rate", async () => {
    const id = await postRaw({
      orNo: 1004, gross: "150.00", lines: [{ quantity: 3, unitRate: "50.00" }],
    });
    const { rows } = await db.query(
      "select amount from ceedo_collections.collection_lines where collection_id = $1", [id],
    );
    expect(Number(rows[0].amount)).toBe(150);
  });

  it("refuses a collection whose parts do not sum to gross_amount", async () => {
    await expect(
      postRaw({ orNo: 1005, gross: "100.00", lines: [{ quantity: 1, unitRate: "50.00" }] }),
    ).rejects.toThrow(/does not balance/);
  });

  it("refuses a collection with no parts at all", async () => {
    await expect(postRaw({ orNo: 1006, gross: "100.00" })).rejects.toThrow(/does not balance/);
  });

  it("accepts a collection balanced by allocations", async () => {
    // A fixed post-cutover date, not current_date: the seeded cutover_date is 2026-10-01
    // (supabase/seed.sql), and every other Phase 2 test drives run_accrual() with an
    // explicit date for the same reason -- the real wall-clock date the suite runs on
    // is before the cutover, so current_date raises no periods and no charges at all.
    await db.query("select ceedo_collections.run_accrual('2026-10-05')");
    const { rows } = await db.query(
      `select id from ceedo_collections.charges where lease_id = $1 limit 1`, [fx.leaseId],
    );
    const id = await postRaw({
      orNo: 1007, gross: "50.00",
      allocations: [{ chargeId: rows[0].id, amount: "50.00" }],
    });
    expect(id).toBeTruthy();
  });

  it("refuses a second cancellation of the same collection", async () => {
    const id = await postRaw({
      orNo: 1008, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }],
    });
    await db.query(
      `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
       values ($1, 'first', $2)`, [id, fx.collectorId],
    );
    await expect(
      db.query(
        `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
         values ($1, 'second', $2)`, [id, fx.collectorId],
      ),
    ).rejects.toThrow(/already cancelled/);
  });

  it("refuses a cancellation with a blank reason", async () => {
    const id = await postRaw({
      orNo: 1009, gross: "50.00", lines: [{ quantity: 1, unitRate: "50.00" }],
    });
    await expect(
      db.query(
        `insert into ceedo_collections.collection_cancellations (collection_id, reason, cancelled_by)
         values ($1, '   ', $2)`, [id, fx.collectorId],
      ),
    ).rejects.toThrow(/reason/);
  });
});
