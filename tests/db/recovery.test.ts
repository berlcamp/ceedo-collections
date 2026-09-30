import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createCollectionFixture,
  resetCutover,
  type CollectionFixture,
  type TestClient,
} from "../helpers/supabase";

/**
 * Office recovery (spec 2026-09-30): an admin re-enters receipts a wiped tablet lost, into
 * the collector's open shift, and closes it. is_admin() resolves through auth.uid(), so the
 * RPCs go through signed-in supabase-js clients; fixtures and assertions use the owner `db`.
 */
let db: Client;
let admin: TestClient;
let adminId: string;
let supervisor: TestClient;
const BUSINESS_DATE = "2026-10-05";
const REASON = "Tablet data cleared before sync; entered from booklet stubs";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin, userId: adminId } = await createAppUser({ email: "recovery-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "recovery-supervisor", role: "supervisor" }));
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

async function openShiftFor(fx: CollectionFixture, status = "open"): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, $4::date, now(), $5)`,
    [id, fx.collectorId, fx.deviceId, BUSINESS_DATE, status],
  );
  return id;
}

async function recoveryShift(client: TestClient, fx: CollectionFixture, date = BUSINESS_DATE) {
  return client.rpc("recovery_shift", {
    p_collector_id: fx.collectorId,
    p_device_id: fx.deviceId,
    p_business_date: date,
    p_reason: REASON,
  });
}

describe("recovery_shift", () => {
  it("refuses anyone but an admin", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await recoveryShift(supervisor, fx);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("returns the collector's open shift on that tablet and day", async () => {
    const fx = await createCollectionFixture(db);
    const shiftId = await openShiftFor(fx);
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    expect(data).toBe(shiftId);
  });

  it("creates the shift when the tablet never synced its opening, and audits it", async () => {
    const fx = await createCollectionFixture(db);
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select collector_id, device_id, business_date::text as d, status
         from ceedo_collections.shifts where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({
      collector_id: fx.collectorId, device_id: fx.deviceId, d: BUSINESS_DATE, status: "open",
    });
    const audit = await db.query(
      `select actor_id, after ->> 'reason' as reason from ceedo_collections.audit_log
        where action = 'recovery_shift' and entity_id = $1`,
      [data],
    );
    expect(audit.rows).toEqual([{ actor_id: adminId, reason: REASON }]);
  });

  it("opens a second shift when the day's first one is already closed", async () => {
    const fx = await createCollectionFixture(db);
    const closed = await openShiftFor(fx, "closed");
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    expect(data).not.toBe(closed);
  });

  it("refuses when the tablet holds an open shift for another day", async () => {
    const fx = await createCollectionFixture(db);
    await openShiftFor(fx);
    const { error } = await recoveryShift(admin, fx, "2026-10-06");
    expect(error?.message).toMatch(/already has an open shift/);
  });

  it("refuses without a reason", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await admin.rpc("recovery_shift", {
      p_collector_id: fx.collectorId, p_device_id: fx.deviceId,
      p_business_date: BUSINESS_DATE, p_reason: "  ",
    });
    expect(error?.message).toMatch(/reason/);
  });
});
