import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, uniqueCode, uniqueEmail } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function epoch(deviceId: string): Promise<number> {
  const { rows } = await db.query(
    `select assignment_epoch from ceedo_collections.devices where id = $1`,
    [deviceId],
  );
  return Number(rows[0].assignment_epoch);
}

async function device(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.devices (label) values ($1) returning id`,
    [uniqueCode("RESYNC")],
  );
  return rows[0].id as string;
}

async function feeType(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, accrues, surcharge_bps, facility_type)
     values ($1, 'Resync fixture fee', false, 0, 'parking') returning id`,
    [uniqueCode("RESYNC_FEE")],
  );
  return rows[0].id as string;
}

async function rate(feeTypeId: string): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
     values ($1, '', '2026-01-01', 10.00, 'per_day') returning id`,
    [feeTypeId],
  );
  return rows[0].id as string;
}

// Migration 20260929000056: a tablet cannot learn from a cursor delta that a row is gone,
// so deleting a fee type or a rate makes every tablet pull from cursor 0.
describe("deleting a fee type or rate re-syncs every tablet", () => {
  it("bumps every device's epoch when a rate is deleted", async () => {
    const deviceId = await device();
    const rateId = await rate(await feeType());
    const before = await epoch(deviceId);

    await db.query(`delete from ceedo_collections.rates where id = $1`, [rateId]);

    expect(await epoch(deviceId)).toBe(before + 1);
  });

  it("leaves the epoch alone when a delete matches nothing", async () => {
    const deviceId = await device();
    const before = await epoch(deviceId);

    await db.query(
      `delete from ceedo_collections.rates where id = '00000000-0000-0000-0000-000000000000'`,
    );

    expect(await epoch(deviceId)).toBe(before);
  });

  it("refuses a fee type that still has rates, and deletes one that has none", async () => {
    const deviceId = await device();
    const feeTypeId = await feeType();
    const rateId = await rate(feeTypeId);

    await expect(
      db.query(`delete from ceedo_collections.fee_types where id = $1`, [feeTypeId]),
    ).rejects.toMatchObject({ code: "23503" });

    await db.query(`delete from ceedo_collections.rates where id = $1`, [rateId]);
    const before = await epoch(deviceId);
    await db.query(`delete from ceedo_collections.fee_types where id = $1`, [feeTypeId]);

    expect(await epoch(deviceId)).toBe(before + 1);
  });
});

/**
 * One receipt priced by `feeTypeId`, class '', on 2026-03-10. A direct insert, not
 * post_collection(): the guard reads collection_lines, whoever wrote them. Both rows share
 * one transaction because the lines-sum-to-gross check is DEFERRED to commit.
 */
async function receipt(feeTypeId: string): Promise<void> {
  const { userId: collectorId } = await createAppUser({
    email: uniqueEmail("rate-guard@example.com"),
    role: "collector",
  });
  const { rows: formTypeRows } = await db.query(
    `select id from ceedo_collections.form_types where code = 'OR51'`,
  );
  const { rows: bookletRows } = await db.query(
    `insert into ceedo_collections.booklets
       (form_type_id, serial_prefix, start_no, end_no, received_date)
     values ($1, $2, 1, 50, '2026-01-01') returning id`,
    [formTypeRows[0].id, uniqueCode("RATEG-BK")],
  );
  const bookletId = bookletRows[0].id as string;
  await db.query(
    `insert into ceedo_collections.booklet_assignments (booklet_id, collector_id, assigned_at)
     values ($1, $2, '2026-01-01')`,
    [bookletId, collectorId],
  );
  const deviceId = await device();

  await db.query("begin");
  try {
    const { rows } = await db.query(
      `insert into ceedo_collections.collections
         (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
          fee_type_id, gross_amount, posted_by)
       values (gen_random_uuid(), 1, $1, $2, $3, '2026-03-10 09:00+08', '2026-03-10', $4,
               10.00, $2)
       returning id`,
      [bookletId, collectorId, deviceId, feeTypeId],
    );
    await db.query(
      `insert into ceedo_collections.collection_lines
         (collection_id, fee_type_id, rate_class, quantity, unit_rate)
       values ($1, $2, '', 1, 10.00)`,
      [rows[0].id, feeTypeId],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

// Migration 20260929000057: a rate that priced a receipt must be end-dated, not deleted.
describe("deleting a rate that priced receipts", () => {
  it("refuses a rate a receipt was priced under, and keeps it", async () => {
    const feeTypeId = await feeType();
    const rateId = await rate(feeTypeId);
    await receipt(feeTypeId);

    await expect(
      db.query(`delete from ceedo_collections.rates where id = $1`, [rateId]),
    ).rejects.toMatchObject({ code: "23503" });

    const { rows } = await db.query(`select 1 from ceedo_collections.rates where id = $1`, [
      rateId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("deletes a rate of a class no receipt used, on a fee type that has receipts", async () => {
    const feeTypeId = await feeType();
    await rate(feeTypeId); // from 2026-01-01, priced the receipt below
    await receipt(feeTypeId);
    const { rows } = await db.query(
      `insert into ceedo_collections.rates (fee_type_id, rate_class, effective_from, amount, basis)
       values ($1, 'bus', '2026-01-01', 30.00, 'per_day') returning id`,
      [feeTypeId],
    );

    await db.query(`delete from ceedo_collections.rates where id = $1`, [rows[0].id]);

    const { rows: left } = await db.query(
      `select 1 from ceedo_collections.rates where id = $1`,
      [rows[0].id],
    );
    expect(left).toHaveLength(0);
  });
});
