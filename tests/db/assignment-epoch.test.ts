import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, uniqueCode } from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function epochOf(deviceId: string): Promise<number> {
  const { rows } = await db.query(
    `select assignment_epoch from ceedo_collections.devices where id = $1`,
    [deviceId],
  );
  return Number(rows[0].assignment_epoch);
}

describe("assignment epoch", () => {
  it("starts at zero on a device with no assignment", async () => {
    const { rows } = await db.query(
      `insert into ceedo_collections.devices (label) values ($1) returning id`,
      [uniqueCode("DEV")],
    );
    expect(await epochOf(rows[0].id)).toBe(0);
  });

  it("bumps when an assignment is created", async () => {
    // createSyncFixture inserts one device_assignments row.
    const fx = await createSyncFixture(db);
    expect(await epochOf(fx.deviceId)).toBeGreaterThan(0);
  });

  it("bumps when an assignment is deactivated", async () => {
    const fx = await createSyncFixture(db);
    const before = await epochOf(fx.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );

    expect(await epochOf(fx.deviceId)).toBeGreaterThan(before);
  });

  it("bumps when a device is reassigned to another facility", async () => {
    // The case the whole mechanism exists for. Reassignment changes NOTHING on the leases
    // the device previously held, so no row_version moves, so a cursor delta is empty and
    // the tablet silently keeps a section's worth of data it must no longer show.
    const fx = await createSyncFixture(db);
    const other = await createSyncFixture(db);
    const before = await epochOf(fx.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );
    await db.query(
      `insert into ceedo_collections.device_assignments (device_id, facility_id, active)
       values ($1, $2, true)`,
      [fx.deviceId, other.facilityId],
    );

    expect(await epochOf(fx.deviceId)).toBeGreaterThan(before + 1);
  });

  it("does not bump another device's epoch", async () => {
    const a = await createSyncFixture(db);
    const b = await createSyncFixture(db);
    const bBefore = await epochOf(b.deviceId);

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [a.deviceId],
    );

    expect(await epochOf(b.deviceId)).toBe(bBefore);
  });

  it("bumps the device's row_version too, so the change is itself syncable", async () => {
    const fx = await createSyncFixture(db);
    const { rows: before } = await db.query(
      `select row_version from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );

    await db.query(
      `update ceedo_collections.device_assignments
          set active = false where device_id = $1 and active`,
      [fx.deviceId],
    );

    const { rows: after } = await db.query(
      `select row_version from ceedo_collections.devices where id = $1`,
      [fx.deviceId],
    );
    expect(Number(after[0].row_version)).toBeGreaterThan(Number(before[0].row_version));
  });
});
