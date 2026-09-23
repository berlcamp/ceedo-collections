import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  type TestClient,
} from "../helpers/supabase";

let db: Client;
let fx: Awaited<ReturnType<typeof createSyncFixture>>;
let supervisor: TestClient;
let accounting: TestClient;
let admin: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createSyncFixture(db);
  supervisor = (await createAppUser({ email: "remit-sup@example.com", role: "supervisor" })).client;
  accounting = (await createAppUser({ email: "remit-acct@example.com", role: "accounting" })).client;
  admin = (await createAppUser({ email: "remit-admin@example.com", role: "admin" })).client;
});

afterAll(async () => {
  await db.end();
});

/** A shift in the given state for the fixture's collector, holding `total` pesos. */
async function shift(status = "closed", collectorId = fx.collectorId, total = 1000): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, closed_at, status,
        declared_total, system_total, system_count, variance)
     values ($1, $2, $3, '2026-09-01', now(), case when $4 = 'open' then null else now() end,
             $4, $5, $5, 1, 0)`,
    [id, collectorId, fx.deviceId, status, total],
  );
  return id;
}

function slip() {
  return `DS-${randomUUID().slice(0, 8)}`;
}

async function record(client: TestClient, shiftIds: string[], slipNo = slip(), amount = 1000) {
  return client.rpc("record_remittance", {
    p_collector_id: fx.collectorId,
    p_deposit_slip_no: slipNo,
    p_bank: "Land Bank",
    p_amount: amount,
    p_deposited_at: "2026-09-02",
    p_shift_ids: shiftIds,
  });
}

async function shiftRow(id: string) {
  const { rows } = await db.query(
    "select status, remittance_id from ceedo_collections.shifts where id = $1",
    [id],
  );
  return rows[0] as { status: string; remittance_id: string | null };
}

describe("record_remittance", () => {
  it("lets a supervisor record a slip covering closed shifts, and links them", async () => {
    const a = await shift();
    const b = await shift();
    const { data: id, error } = await record(supervisor, [a, b], slip(), 2000);
    expect(error).toBeNull();
    expect(await shiftRow(a)).toEqual({ status: "closed", remittance_id: id });
    expect(await shiftRow(b)).toEqual({ status: "closed", remittance_id: id });
  });

  it("refuses accounting: recording and verifying are different people's jobs", async () => {
    const { error } = await record(accounting, [await shift()]);
    expect(error?.message).toMatch(/Only a supervisor or administrator/);
  });

  it("refuses an open shift, a closed_unsynced one, and another collector's", async () => {
    const other = await createSyncFixture(db);
    for (const id of [
      await shift("open"),
      await shift("closed_unsynced"),
      await shift("closed", other.collectorId),
    ]) {
      const { error } = await record(supervisor, [id]);
      expect(error?.message).toMatch(/closed, not yet deposited shift of this collector/);
    }
  });

  it("refuses a shift already on a live slip, and a slip recorded twice", async () => {
    const a = await shift();
    const slipNo = slip();
    expect((await record(supervisor, [a], slipNo)).error).toBeNull();

    expect((await record(supervisor, [a])).error?.message).toMatch(/not yet deposited/);
    expect((await record(supervisor, [await shift()], slipNo)).error?.message).toMatch(
      /already recorded/,
    );
  });

  it("refuses a deposit with no shifts or no amount", async () => {
    expect((await record(supervisor, [])).error?.message).toMatch(/Choose the shifts/);
    expect((await record(supervisor, [await shift()], slip(), 0)).error?.message).toMatch(
      /more than zero/,
    );
  });
});

describe("verify_remittance", () => {
  it("lets accounting verify, which moves the covered shifts to remitted", async () => {
    const a = await shift();
    const { data: id } = await record(supervisor, [a]);
    const { error } = await accounting.rpc("verify_remittance", { p_remittance_id: id });
    expect(error).toBeNull();
    expect((await shiftRow(a)).status).toBe("remitted");
  });

  it("refuses a supervisor", async () => {
    const { data: id } = await record(supervisor, [await shift()]);
    const { error } = await supervisor.rpc("verify_remittance", { p_remittance_id: id });
    expect(error?.message).toMatch(/Only accounting or an administrator/);
  });

  it("refuses the person who recorded the slip, even an administrator", async () => {
    const { data: id } = await record(admin, [await shift()]);
    const { error } = await admin.rpc("verify_remittance", { p_remittance_id: id });
    expect(error?.message).toMatch(/recorded a deposit may not also verify it/);
  });

  it("refuses verifying twice", async () => {
    const { data: id } = await record(supervisor, [await shift()]);
    await accounting.rpc("verify_remittance", { p_remittance_id: id });
    const { error } = await accounting.rpc("verify_remittance", { p_remittance_id: id });
    expect(error?.message).toMatch(/already verified/);
  });
});

describe("cancel_remittance", () => {
  it("cancels an unverified slip with a reason and frees its shifts for a new slip", async () => {
    const a = await shift();
    const slipNo = slip();
    const { data: id } = await record(supervisor, [a], slipNo);

    expect(
      (await supervisor.rpc("cancel_remittance", { p_remittance_id: id, p_reason: "" })).error
        ?.message,
    ).toMatch(/written reason/);
    const { error } = await supervisor.rpc("cancel_remittance", {
      p_remittance_id: id,
      p_reason: "Wrong amount typed",
    });
    expect(error).toBeNull();
    expect(await shiftRow(a)).toEqual({ status: "closed", remittance_id: null });

    // The same slip number can be recorded again once the wrong entry is cancelled.
    expect((await record(supervisor, [a], slipNo)).error).toBeNull();
  });

  it("refuses to cancel a verified slip", async () => {
    const { data: id } = await record(supervisor, [await shift()]);
    await accounting.rpc("verify_remittance", { p_remittance_id: id });
    const { error } = await supervisor.rpc("cancel_remittance", {
      p_remittance_id: id,
      p_reason: "Too late",
    });
    expect(error?.message).toMatch(/verified deposit cannot be cancelled/);
  });
});

describe("remittances table privileges", () => {
  it("is readable by the back office but writable only through the functions", async () => {
    expect((await accounting.from("remittances").select("id").limit(1)).error).toBeNull();
    const { error } = await admin.from("remittances").insert({
      collector_id: fx.collectorId,
      deposit_slip_no: slip(),
      bank: "Land Bank",
      amount: 1,
      deposited_at: "2026-09-02",
      recorded_by: fx.collectorId,
    });
    expect(error).not.toBeNull();
  });
});
