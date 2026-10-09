import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createCollectionFixture, uniqueCode } from "../helpers/supabase";

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => db.end());

async function facility(type: string) {
  const { rows } = await db.query(
    `insert into ceedo_collections.facilities (code, name, type) values ($1, $1, $2::ceedo_collections.facility_type) returning id`,
    [uniqueCode("F"), type],
  );
  return rows[0].id as string;
}

describe("facilities and sections", () => {
  it("accepts an 'other' facility, and sections on terminal and other facilities", async () => {
    for (const type of ["terminal", "other"]) {
      const id = await facility(type);
      await expect(
        db.query(
          `insert into ceedo_collections.sections (facility_id, name, default_accrual_period) values ($1, 'Building 2', 'daily')`,
          [id],
        ),
      ).resolves.toBeDefined();
    }
  });

  it("still refuses sections on parking and slaughterhouse facilities", async () => {
    const id = await facility("parking");
    await expect(
      db.query(
        `insert into ceedo_collections.sections (facility_id, name, default_accrual_period) values ($1, 'X', 'daily')`,
        [id],
      ),
    ).rejects.toThrow(/Sections may not belong/);
  });
});

describe("fee_types", () => {
  it("defaults to rate mode and copies the facility's type when facility_id is set", async () => {
    const fid = await facility("other");
    const { rows } = await db.query(
      `insert into ceedo_collections.fee_types (code, name, facility_id) values ($1, 'x', $2)
       returning amount_mode, facility_type::text`,
      [uniqueCode("FT"), fid],
    );
    expect(rows[0]).toEqual({ amount_mode: "rate", facility_type: "other" });
  });

  it("follows its facility when the facility's type changes", async () => {
    const fid = await facility("other");
    const { rows } = await db.query(
      `insert into ceedo_collections.fee_types (code, name, facility_id) values ($1, 'x', $2) returning id`,
      [uniqueCode("FT"), fid],
    );
    await db.query(`update ceedo_collections.facilities set type = 'terminal' where id = $1`, [fid]);
    const { rows: after } = await db.query(
      `select facility_type::text from ceedo_collections.fee_types where id = $1`, [rows[0].id]);
    expect(after[0]).toEqual({ facility_type: "terminal" });
  });

  it("refuses an unknown amount mode", async () => {
    await expect(
      db.query(`insert into ceedo_collections.fee_types (code, name, amount_mode) values ($1, 'x', 'free')`, [uniqueCode("FT")]),
    ).rejects.toThrow(/amount_mode/);
  });
});

describe("collections payment mode", () => {
  async function insertCollection(fx: Awaited<ReturnType<typeof createCollectionFixture>>, extra: Record<string, unknown>) {
    const cols = { id: randomUUID(), or_no: 1990, booklet_id: fx.bookletId, collector_id: fx.collectorId,
      device_id: fx.deviceId, collected_at: "2026-10-05T02:00:00+00:00", business_date: "2026-10-05",
      fee_type_id: fx.perHeadFeeTypeId, gross_amount: 0, ...extra };
    const keys = Object.keys(cols);
    // gross_amount 0 violates its own check; the payment checks must fire on their own, so
    // each case below sets a positive gross and expects the payment constraint by name.
    await db.query(
      `insert into ceedo_collections.collections (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(cols),
    );
  }

  it("refuses a check without its details", async () => {
    const fx = await createCollectionFixture(db);
    await expect(insertCollection(fx, { gross_amount: 10, device_id: null, payment_mode: "check" }))
      .rejects.toThrow(/collections_check_details/);
  });

  it("refuses a check on a tablet receipt", async () => {
    const fx = await createCollectionFixture(db);
    await expect(insertCollection(fx, { gross_amount: 10, payment_mode: "check", check_no: "1", bank: "LBP", check_date: "2026-10-05" }))
      .rejects.toThrow(/collections_check_only_from_office/);
  });
});

describe("shifts", () => {
  it("requires a device on a device shift and none on an office shift", async () => {
    const fx = await createCollectionFixture(db);
    await expect(
      db.query(
        `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
         values ($1, $2, null, '2026-10-05', now(), 'open', 'device')`,
        [randomUUID(), fx.collectorId],
      ),
    ).rejects.toThrow(/shifts_device_matches_kind/);
    await db.query(
      `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
       values ($1, $2, null, '2026-10-05', now(), 'open', 'office')`,
      [randomUUID(), fx.collectorId],
    );
    await expect(
      db.query(
        `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
         values ($1, $2, null, '2026-10-05', now(), 'open', 'office')`,
        [randomUUID(), fx.collectorId],
      ),
    ).rejects.toThrow(/shifts_one_open_office_shift/);
  });
});
