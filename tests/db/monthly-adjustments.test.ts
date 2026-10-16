import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, uniqueCode, type TestClient } from "../helpers/supabase";
import { accountId, createAccount } from "../helpers/accounts";

let db: Client;
let accounting: TestClient;
let admin: TestClient;
let supervisor: TestClient;
let collector: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: accounting } = await createAppUser({ email: "adj-accounting", role: "accounting" }));
  ({ client: admin } = await createAppUser({ email: "adj-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "adj-supervisor", role: "supervisor" }));
  ({ client: collector } = await createAppUser({ email: "adj-collector", role: "collector" }));
});
afterAll(async () => db.end());

const record = (c: TestClient, account: string, month: string, amount: number, note = "Over-deposit returned") =>
  c.rpc("record_monthly_adjustment", { p_account_id: account, p_month: month, p_amount: amount, p_note: note });

const control = (c: TestClient, month: string, amount: number, note: string) =>
  c.rpc("record_monthly_control_total", { p_month: month, p_amount: amount, p_note: note });

describe("record_monthly_adjustment", () => {
  it("records a negative adjustment for accounting, filed under the first of the month", async () => {
    const account = await createAccount(db);
    const { data, error } = await record(accounting, account, "2026-10-17", -250.5);
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select month::text, amount::text, note, cancelled_at from ceedo_collections.monthly_adjustments where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({ month: "2026-10-01", amount: "-250.50", note: "Over-deposit returned", cancelled_at: null });
  });

  it("lets an administrator record, and refuses a supervisor and a collector", async () => {
    const account = await createAccount(db);
    expect((await record(admin, account, "2026-10-01", 10)).error).toBeNull();
    expect((await record(supervisor, account, "2026-10-01", 10)).error?.message).toMatch(/accounting/);
    expect((await record(collector, account, "2026-10-01", 10)).error).not.toBeNull();
  });

  it("refuses a zero amount, an empty note, and a month that has not started", async () => {
    const account = await createAccount(db);
    expect((await record(accounting, account, "2026-10-01", 0)).error?.message).toMatch(/zero/);
    expect((await record(accounting, account, "2026-10-01", 5, "  ")).error?.message).toMatch(/note/);
    expect((await record(accounting, account, "2999-01-01", 5)).error?.message).toMatch(/not started/);
  });

  it("refuses UNCLASSIFIED and an inactive account", async () => {
    const unc = await accountId(db, "UNCLASSIFIED");
    expect((await record(accounting, unc, "2026-10-01", 5)).error?.message).toMatch(/Unclassified/);
    const old = await createAccount(db);
    await db.query(`update ceedo_collections.collection_accounts set active = false where id = $1`, [old]);
    expect((await record(accounting, old, "2026-10-01", 5)).error?.message).toMatch(/inactive/);
  });
});

describe("cancel_monthly_adjustment", () => {
  it("needs a reason, keeps the row marked cancelled, and refuses a second cancel", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 75);
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: " " })).error?.message)
      .toMatch(/reason/);
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "Wrong month" })).error)
      .toBeNull();
    const { rows } = await db.query(
      `select cancel_reason, cancelled_at is not null as cancelled from ceedo_collections.monthly_adjustments where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ cancel_reason: "Wrong month", cancelled: true });
    expect((await accounting.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "again" })).error?.message)
      .toMatch(/already cancelled/);
  });

  it("refuses a supervisor", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 75);
    expect((await supervisor.rpc("cancel_monthly_adjustment", { p_adjustment_id: id!, p_reason: "x" })).error)
      .not.toBeNull();
  });
});

describe("record_monthly_control_total", () => {
  it("records for accounting, and keeps every entry: a correction is a new row", async () => {
    const note = uniqueCode("CASHIER");
    expect((await control(accounting, "2026-10-09", 1000, note)).error).toBeNull();
    expect((await control(accounting, "2026-10-01", 1200, note)).error).toBeNull();
    const { rows } = await db.query(
      `select month::text, amount::text from ceedo_collections.monthly_control_totals where note = $1 order by entered_at`,
      [note],
    );
    expect(rows).toEqual([{ month: "2026-10-01", amount: "1000.00" }, { month: "2026-10-01", amount: "1200.00" }]);
  });

  it("refuses a negative figure, a month not started, and a supervisor", async () => {
    expect((await control(accounting, "2026-10-01", -1, "x")).error?.message).toMatch(/negative/);
    expect((await control(accounting, "2999-01-01", 1, "x")).error?.message).toMatch(/not started/);
    expect((await control(supervisor, "2026-10-01", 1, "x")).error).not.toBeNull();
  });
});

describe("access", () => {
  it("lets a supervisor read, and shows a collector nothing", async () => {
    const account = await createAccount(db);
    const { data: id } = await record(accounting, account, "2026-10-01", 33);
    const seen = await supervisor.from("monthly_adjustments").select("id").eq("id", id!);
    expect(seen.data).toEqual([{ id }]);
    const hidden = await collector.from("monthly_adjustments").select("id").eq("id", id!);
    expect(hidden.data ?? []).toEqual([]);
  });

  it("refuses direct writes, even from an administrator", async () => {
    expect((await admin.from("monthly_adjustments").insert({} as never)).error?.code).toBe("42501");
    expect((await admin.from("monthly_control_totals").insert({} as never)).error?.code).toBe("42501");
  });

  it("seeds the monthly summary's signatories without names", async () => {
    const { rows } = await db.query(
      `select label, name from ceedo_collections.report_signatories where report_key = 'monthly-summary' order by sort_order`,
    );
    expect(rows).toEqual([{ label: "Prepared by", name: null }, { label: "Noted by", name: null }]);
  });
});
