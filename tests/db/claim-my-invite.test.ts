import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  serviceClient,
  signIn,
  uniqueEmail,
} from "../helpers/supabase";
import { createClient } from "@supabase/supabase-js";

/**
 * An account that ALREADY EXISTS when the invite is made: the shared-project case the
 * auth.users trigger cannot see (migration 0047). The user is created first, through the
 * admin API so it can sign in with a password; the invite comes after; the claim happens
 * when they call claim_my_invite(), as the web app does at sign-in.
 */
let db: Client;
const URL = process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:56321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/** An existing account (email/password), optionally with a linked Google identity. */
async function existingAccount(email: string, google: boolean): Promise<string> {
  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "test-password-not-a-secret",
    email_confirm: true,
  });
  if (error) throw new Error(error.message);
  if (google) {
    await db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       values ($1, $2, jsonb_build_object('sub', $1::text, 'email', $3::text), 'google', now(), now())`,
      [`google-${data.user.id}`, data.user.id, email],
    );
  }
  return data.user.id;
}

async function invite(email: string, role = "supervisor") {
  const { error } = await serviceClient().from("staff_invites").insert({
    email,
    employee_no: `E-${Math.random().toString(36).slice(2, 10)}`,
    full_name: "Invited Person",
    role,
  });
  if (error) throw new Error(error.message);
}

async function member(id: string) {
  const { rows } = await db.query(
    "select role, status from ceedo_collections.app_users where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

describe("claim_my_invite", () => {
  it("claims an invite for an account that existed before the invite (the shared-project case)", async () => {
    const email = uniqueEmail("already-on-asenso@example.com");
    const id = await existingAccount(email, true);
    await invite(email);
    expect(await member(id)).toBeNull(); // the trigger never fired: nothing was inserted

    const client = await signIn(email);
    const { data, error } = await client.rpc("claim_my_invite");
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await member(id)).toEqual({ role: "supervisor", status: "active" });

    const { rows } = await db.query(
      "select count(*)::int as n from ceedo_collections.staff_invites where lower(email) = lower($1)",
      [email],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses an account with a matching email but no Google identity", async () => {
    const email = uniqueEmail("password-only@example.com");
    const id = await existingAccount(email, false);
    await invite(email, "admin");

    const client = await signIn(email);
    const { data } = await client.rpc("claim_my_invite");
    expect(data).toBe(false);
    expect(await member(id)).toBeNull();
  });

  it("does nothing and says so for a signed-in account with no invite", async () => {
    const email = uniqueEmail("uninvited@example.com");
    await existingAccount(email, true);
    const client = await signIn(email);
    const { data } = await client.rpc("claim_my_invite");
    expect(data).toBe(false);
  });

  it("returns true for an existing member without changing their status", async () => {
    const { client, userId } = await createAppUser({ email: "already-member@example.com", role: "accounting" });
    await db.query("update ceedo_collections.app_users set status = 'suspended' where id = $1", [userId]);
    const { data } = await client.rpc("claim_my_invite");
    expect(data).toBe(true);
    expect(await member(userId)).toEqual({ role: "accounting", status: "suspended" });
  });

  it("is not callable anonymously", async () => {
    const anon = createClient(URL, process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "", {
      db: { schema: "ceedo_collections" },
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("claim_my_invite");
    expect(error).not.toBeNull();
  });
});
