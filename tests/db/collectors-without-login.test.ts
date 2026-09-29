import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, type TestClient } from "../helpers/supabase";

/**
 * Migration 0048: a collector signs in to tablets only, so may exist without an auth.users
 * login; every web role still must have one. On a shared project, the alternative
 * (placeholder logins in auth.users) would fire the other system's triggers.
 */
let db: Client;
let admin: TestClient;
let supervisor: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  admin = (await createAppUser({ email: "collector-admin@example.com", role: "admin" })).client;
  supervisor = (await createAppUser({ email: "collector-sup@example.com", role: "supervisor" })).client;
});

afterAll(async () => {
  await db.end();
});

const employeeNo = () => `PIN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

describe("create_collector", () => {
  it("adds an active collector with no login of any kind", async () => {
    const no = employeeNo();
    const { data: id, error } = await admin.rpc("create_collector", {
      p_employee_no: no,
      p_full_name: "Juan Dela Cruz",
    });
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select a.role, a.status, (select count(*)::int from auth.users u where u.id = a.id) as logins
         from ceedo_collections.app_users a where a.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ role: "collector", status: "active", logins: 0 });
  });

  it("adds a collector with no employee number", async () => {
    const { data: id, error } = await admin.rpc("create_collector", { p_full_name: "No Number" });
    expect(error).toBeNull();
    const { rows } = await db.query(
      "select employee_no from ceedo_collections.app_users where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ employee_no: null });
  });

  it("refuses a duplicate employee number, by name", async () => {
    const no = employeeNo();
    await admin.rpc("create_collector", { p_employee_no: no, p_full_name: "First" });
    const { error } = await admin.rpc("create_collector", { p_employee_no: no, p_full_name: "Second" });
    expect(error?.message).toMatch(new RegExp(`Employee number ${no} is already in use`));
  });

  it("refuses anyone but an administrator", async () => {
    const { error } = await supervisor.rpc("create_collector", {
      p_employee_no: employeeNo(),
      p_full_name: "X",
    });
    expect(error?.message).toMatch(/Only an administrator/);
  });
});

describe("web roles still need a login", () => {
  it("refuses a supervisor row with no auth.users login", async () => {
    await expect(
      db.query(
        "insert into ceedo_collections.app_users (employee_no, full_name, role) values ($1, 'Nobody', 'supervisor')",
        [employeeNo()],
      ),
    ).rejects.toThrow(/needs a Google sign-in/);
  });

  it("refuses promoting a PIN-only collector to a web role", async () => {
    const { data: id } = await admin.rpc("create_collector", {
      p_employee_no: employeeNo(),
      p_full_name: "Maria",
    });
    await expect(
      db.query("update ceedo_collections.app_users set role = 'accounting' where id = $1", [id]),
    ).rejects.toThrow(/needs a Google sign-in/);
  });
});
