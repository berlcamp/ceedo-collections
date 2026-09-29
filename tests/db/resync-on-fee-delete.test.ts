import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, uniqueCode } from "../helpers/supabase";

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
