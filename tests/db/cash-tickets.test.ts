// tests/db/cash-tickets.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, createCollectionFixture, uniqueCode, type CollectionFixture, type TestClient } from "../helpers/supabase";

let db: Client;
let supervisor: TestClient;
let accounting: TestClient;
let accountingId: string;
let collectorClient: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: supervisor } = await createAppUser({ email: "ct-supervisor", role: "supervisor" }));
  ({ client: accounting, userId: accountingId } = await createAppUser({ email: "ct-accounting", role: "accounting" }));
  ({ client: collectorClient } = await createAppUser({ email: "ct-collector", role: "collector" }));
});
afterAll(async () => db.end());

async function ticketFee(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type, amount_mode) values ($1, 'PM CR cash ticket', 'market', 'keyed') returning id`,
    [uniqueCode("CR")],
  );
  return rows[0].id as string;
}

async function shift(fx: CollectionFixture, s: { status: string; declared?: string; system?: string }) {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status, declared_total, system_total, variance)
     values ($1, $2, $3, '2026-10-05', now(), $4, $5::numeric, $6::numeric, $5::numeric - $6::numeric)`,
    [id, fx.collectorId, fx.deviceId, s.status, s.declared ?? null, s.system ?? null],
  );
  return id;
}

const record = (client: TestClient, shiftId: string, fee: string, amount: number) =>
  client.rpc("record_cash_ticket_sale", {
    p_shift_id: shiftId, p_fee_type_id: fee, p_amount: amount, p_ticket_from: null, p_ticket_to: null, p_note: null,
  });

const totals = async (id: string) =>
  (await db.query(`select system_total::text s, variance::text v from ceedo_collections.shifts where id = $1`, [id])).rows[0];

describe("record_cash_ticket_sale", () => {
  it("refuses a collector's login", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await record(collectorClient, await shift(fx, { status: "open" }), await ticketFee(), 100);
    expect(error).not.toBeNull();
  });

  it("raises a closed shift's system total and turns its overage into balance", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "closed", declared: "4000.00", system: "1000.00" });
    const { error } = await record(accounting, id, await ticketFee(), 3000);
    expect(error).toBeNull();
    expect(await totals(id)).toEqual({ s: "4000.00", v: "0.00" });
  });

  it("leaves an open shift's totals for close to compute", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "open" });
    await record(supervisor, id, await ticketFee(), 500);
    expect(await totals(id)).toEqual({ s: null, v: null });
  });

  it("refuses a remitted shift and a rate (not keyed) fee", async () => {
    const fx = await createCollectionFixture(db);
    const remitted = await shift(fx, { status: "remitted", declared: "1", system: "1" });
    expect((await record(supervisor, remitted, await ticketFee(), 1)).error?.message).toMatch(/remitted/);
    const open = await shift(fx, { status: "open" });
    expect((await record(supervisor, open, fx.perHeadFeeTypeId, 1)).error?.message).toMatch(/cash-ticket fee/);
  });
});

describe("cancel_cash_ticket_sale", () => {
  it("needs a reason, and lowers the system total again", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "closed", declared: "4000.00", system: "1000.00" });
    const { data: saleId } = await record(accounting, id, await ticketFee(), 3000);
    expect((await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: " " })).error?.message)
      .toMatch(/reason/);
    expect((await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: "Wrong shift" })).error).toBeNull();
    expect(await totals(id)).toEqual({ s: "1000.00", v: "3000.00" });
  });

  it("refuses when settlements would exceed the shortage that remains", async () => {
    const fx = await createCollectionFixture(db);
    // Short 500 after a 3000 ticket; 400 already settled. Cancelling the ticket would make
    // the shift 2500 OVER, with 400 settled against a shortage that no longer exists.
    const id = await shift(fx, { status: "closed", declared: "3500.00", system: "1000.00" });
    const { data: saleId } = await record(accounting, id, await ticketFee(), 3000);
    await db.query(
      `insert into ceedo_collections.variance_settlements (shift_id, amount, reference, received_at, recorded_by)
       values ($1, 400, 'OR 1', '2026-10-06', $2)`,
      [id, accountingId],
    );
    const { error } = await accounting.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: "test" });
    expect(error?.message).toMatch(/settled/);
  });
});

describe("close_shift", () => {
  it("compares the device's figures with receipts only, and stores receipts plus tickets", async () => {
    const fx = await createCollectionFixture(db);
    const id = await shift(fx, { status: "open" });
    await record(supervisor, id, await ticketFee(), 250);
    const { rows } = await db.query(
      `select ceedo_collections.close_shift($1, $2, 250, 0, 0) r`,
      [id, fx.deviceId],
    );
    expect(rows[0].r.status).toBe("closed");
    expect(await totals(id)).toEqual({ s: "250.00", v: "0.00" });
  });
});

describe("role and ownership", () => {
  it("refuses cancel_cash_ticket_sale from a collector's login", async () => {
    const fx = await createCollectionFixture(db);
    const { data: saleId } = await record(accounting, await shift(fx, { status: "open" }), await ticketFee(), 100);
    const { error } = await collectorClient.rpc("cancel_cash_ticket_sale", { p_sale_id: saleId, p_reason: "x" });
    expect(error).not.toBeNull();
  });

  it("refuses a tablet closing an office shift", async () => {
    const fx = await createCollectionFixture(db);
    const id = randomUUID();
    await db.query(
      `insert into ceedo_collections.shifts (id, collector_id, device_id, business_date, opened_at, status, kind)
       values ($1, $2, null, '2026-10-05', now(), 'open', 'office')`,
      [id, fx.collectorId],
    );
    await expect(db.query(`select ceedo_collections.close_shift($1, $2, 0, 0, 0)`, [id, fx.deviceId]))
      .rejects.toThrow(/does not belong/);
  });
});
