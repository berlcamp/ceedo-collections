// tests/db/office-receipts.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, createCollectionFixture, resetCutover, type CollectionFixture, type TestClient } from "../helpers/supabase";

let db: Client;
let supervisor: TestClient;
let accounting: TestClient;
const DAY = "2026-10-05";
let orNo = 1200;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: supervisor } = await createAppUser({ email: "office-supervisor", role: "supervisor" }));
  ({ client: accounting } = await createAppUser({ email: "office-accounting", role: "accounting" }));
});
afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

const shiftFor = async (client: TestClient, fx: CollectionFixture) =>
  client.rpc("office_shift", { p_collector_id: fx.collectorId, p_business_date: DAY });

function cashLine(fx: CollectionFixture, extra: Record<string, unknown> = {}) {
  return {
    booklet_id: fx.bookletId, or_no: ++orNo, collected_at: `${DAY}T12:00:00+08:00`,
    fee_type_id: fx.perHeadFeeTypeId, lease_id: null, payer_ref: "Walk-in",
    allocations: [], lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 2 }], ...extra,
  };
}

describe("office_shift", () => {
  it("refuses accounting; opens one office shift per officer and day for a supervisor", async () => {
    const fx = await createCollectionFixture(db);
    expect((await shiftFor(accounting, fx)).error?.message).toMatch(/supervisor or administrator/);
    const a = await shiftFor(supervisor, fx);
    const b = await shiftFor(supervisor, fx);
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    const { rows } = await db.query(`select kind, device_id, status from ceedo_collections.shifts where id = $1`, [a.data]);
    expect(rows[0]).toEqual({ kind: "office", device_id: null, status: "open" });
  });
});

describe("post_office_receipt", () => {
  it("posts a cash receipt with no tablet into the office shift", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const { data, error } = await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select device_id, shift_id, payment_mode, collector_id from ceedo_collections.collections where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({ device_id: null, shift_id: shiftId, payment_mode: "cash", collector_id: fx.collectorId });
  });

  it("posts a check with its details, and refuses one without them", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const bad = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { payment_mode: "check", bank: "LBP" }),
    });
    expect(bad.error?.message).toMatch(/check number, bank and check date/);
    const good = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId,
      p_receipt: cashLine(fx, { payment_mode: "check", check_no: "000123", bank: "LBP", check_date: DAY }),
    });
    expect(good.error).toBeNull();
  });

  it("refuses a receipt dated another day and a closed office shift", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const wrongDay = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { collected_at: "2026-10-06T12:00:00+08:00" }),
    });
    expect(wrongDay.error?.message).toMatch(/must be dated/);
    await supervisor.rpc("close_office_shift", { p_shift_id: shiftId, p_declared_total: 0 });
    const closed = await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    expect(closed.error?.message).toMatch(/not open/);
  });

  it("turns post_collection's refusals into sentences", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const { error } = await supervisor.rpc("post_office_receipt", {
      p_shift_id: shiftId, p_receipt: cashLine(fx, { or_no: 5 }),
    });
    expect(error?.message).toMatch(/outside the booklet/);
  });
});

describe("post_office_receipt roles", () => {
  it("refuses an accounting user", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    const { error } = await accounting.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    expect(error?.message).toMatch(/supervisor or administrator/);
  });
});

describe("close_office_shift", () => {
  it("closes with the server's totals and a signed variance", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await shiftFor(supervisor, fx);
    await supervisor.rpc("post_office_receipt", { p_shift_id: shiftId, p_receipt: cashLine(fx) });
    const gross = 2 * Number(fx.perHeadRate);
    const { data, error } = await supervisor.rpc("close_office_shift", { p_shift_id: shiftId, p_declared_total: gross - 1 });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "closed", system_count: 1 });
    expect(Number((data as { variance: number }).variance)).toBe(-1);
  });
});
