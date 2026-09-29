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
  supervisor = (await createAppUser({ email: "settle-sup@example.com", role: "supervisor" })).client;
  accounting = (await createAppUser({ email: "settle-acct@example.com", role: "accounting" })).client;
  admin = (await createAppUser({ email: "settle-admin@example.com", role: "admin" })).client;
});

afterAll(async () => {
  await db.end();
});

/** A shift for the fixture's collector whose drawer was `variance` pesos off. */
async function shift(variance: number, status = "closed"): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, closed_at, status,
        declared_total, system_total, system_count, variance)
     values ($1, $2, $3, '2026-09-01', now(), case when $4 = 'open' then null else now() end,
             $4, 1000 + $5::numeric, 1000, 1, case when $4 = 'open' then null else $5::numeric end)`,
    [id, fx.collectorId, fx.deviceId, status, variance],
  );
  return id;
}

async function settle(
  client: TestClient,
  shiftId: string,
  amount: number,
  receivedAt = "2026-09-03",
) {
  return client.rpc("record_variance_settlement", {
    p_shift_id: shiftId,
    p_amount: amount,
    p_reference: `OR-${randomUUID().slice(0, 6)}`,
    p_received_at: receivedAt,
  });
}

async function variance(shiftId: string): Promise<string> {
  const { rows } = await db.query(
    "select variance from ceedo_collections.shifts where id = $1",
    [shiftId],
  );
  return rows[0].variance as string;
}

describe("record_variance_settlement", () => {
  it("lets a supervisor record a repayment, and leaves the shift's variance untouched", async () => {
    const id = await shift(-500);
    const { data, error } = await settle(supervisor, id, 500);
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/);
    expect(await variance(id)).toBe("-500.00");
  });

  it("allows part payments, but never more in total than the shortage", async () => {
    const id = await shift(-500);
    expect((await settle(supervisor, id, 200)).error).toBeNull();
    expect((await settle(supervisor, id, 300)).error).toBeNull();
    expect((await settle(supervisor, id, 0.01)).error?.message).toMatch(/more than is still owed/);
  });

  it("frees a cancelled settlement's amount for a corrected one", async () => {
    const id = await shift(-500);
    const { data: wrong } = await settle(supervisor, id, 500);
    await supervisor.rpc("cancel_variance_settlement", {
      p_settlement_id: wrong,
      p_reason: "Typed against the wrong shift",
    });
    expect((await settle(supervisor, id, 500)).error).toBeNull();
  });

  it("settles a shift that has already been remitted", async () => {
    expect((await settle(supervisor, await shift(-100, "remitted"), 100)).error).toBeNull();
  });

  it("refuses a shift that was balanced, over, still open or not yet synced", async () => {
    for (const id of [
      await shift(0),
      await shift(50),
      await shift(-100, "open"),
      await shift(-100, "closed_unsynced"),
    ]) {
      expect((await settle(supervisor, id, 10)).error?.message).toMatch(
        /Only a closed shift that was short/,
      );
    }
  });

  it("refuses accounting: recording and verifying are different people's jobs", async () => {
    const { error } = await settle(accounting, await shift(-100), 100);
    expect(error?.message).toMatch(/Only a supervisor or administrator/);
  });

  it("refuses a payment dated before the shift, in the future, or with no reference", async () => {
    const id = await shift(-100);
    expect((await settle(supervisor, id, 100, "2026-08-31")).error?.message).toMatch(
      /before the shift/,
    );
    expect((await settle(supervisor, id, 100, "2999-01-01")).error?.message).toMatch(
      /cannot be in the future/,
    );
    const { error } = await supervisor.rpc("record_variance_settlement", {
      p_shift_id: id,
      p_amount: 100,
      p_reference: "  ",
      p_received_at: "2026-09-03",
    });
    expect(error?.message).toMatch(/receipt or deposit slip number/);
  });
});

describe("verify_variance_settlement", () => {
  it("lets accounting verify a settlement", async () => {
    const { data: id } = await settle(supervisor, await shift(-100), 100);
    expect((await accounting.rpc("verify_variance_settlement", { p_settlement_id: id })).error)
      .toBeNull();
    const { rows } = await db.query(
      "select verified_at from ceedo_collections.variance_settlements where id = $1",
      [id],
    );
    expect(rows[0].verified_at).not.toBeNull();
  });

  it("refuses the person who recorded it, even an admin", async () => {
    const { data: id } = await settle(admin, await shift(-100), 100);
    const { error } = await admin.rpc("verify_variance_settlement", { p_settlement_id: id });
    expect(error?.message).toMatch(/may not also verify/);
  });

  it("refuses a supervisor", async () => {
    const { data: id } = await settle(supervisor, await shift(-100), 100);
    const { error } = await supervisor.rpc("verify_variance_settlement", { p_settlement_id: id });
    expect(error?.message).toMatch(/Only accounting or an administrator/);
  });
});

describe("cancel_variance_settlement", () => {
  it("needs a written reason, and refuses a verified settlement", async () => {
    const { data: id } = await settle(supervisor, await shift(-100), 100);
    expect(
      (await supervisor.rpc("cancel_variance_settlement", { p_settlement_id: id, p_reason: " " }))
        .error?.message,
    ).toMatch(/written reason/);

    await accounting.rpc("verify_variance_settlement", { p_settlement_id: id });
    expect(
      (await supervisor.rpc("cancel_variance_settlement", { p_settlement_id: id, p_reason: "x" }))
        .error?.message,
    ).toMatch(/verified settlement cannot be cancelled/);
  });
});

describe("variance_settlements table", () => {
  it("cannot be written directly, only through the functions", async () => {
    const { error } = await supervisor.from("variance_settlements").insert({
      shift_id: await shift(-100),
      amount: 100,
      reference: "direct",
      received_at: "2026-09-03",
      recorded_by: fx.collectorId,
    });
    expect(error).not.toBeNull();
  });
});
