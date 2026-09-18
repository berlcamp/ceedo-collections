import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createOutsiderClient,
  createSyncFixture,
  serviceClient,
} from "../helpers/supabase";

let db: Client;
let collectorId: string;
let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  collectorId = (await createSyncFixture(db)).collectorId;
  // set_collector_pin requires a real admin caller (migration 0028's NULL-safety fix means
  // a bare postgres connection with no auth.uid() -- what this file used to call the RPC
  // with -- is now correctly refused, not silently let through). Every call to the RPC
  // below that isn't itself testing the admin guard goes through this client.
  adminClient = (
    await createAppUser({ email: "pin-caller-admin@example.com", role: "admin" })
  ).client;
});

afterAll(async () => {
  await db.end();
});

async function setPin(pin: string): Promise<void> {
  const { error } = await adminClient.rpc("set_collector_pin", {
    p_collector_id: collectorId,
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
}

async function pinHash(): Promise<string | null> {
  const { rows } = await db.query(
    `select pin_hash from ceedo_collections.app_users where id = $1`,
    [collectorId],
  );
  return rows[0].pin_hash as string | null;
}

describe("set_collector_pin", () => {
  it("writes a bcrypt hash the PIN verifies against", async () => {
    await setPin("123456");
    const hash = await pinHash();

    expect(hash).not.toBeNull();
    const { rows } = await db.query(
      `select extensions.crypt('123456', $1::text) = $1::text as ok`,
      [hash],
    );
    expect(rows[0].ok).toBe(true);
  });

  it("uses a cost factor of at least 12", async () => {
    await setPin("123456");
    // A bcrypt hash is $2a$<cost>$<salt+digest>.
    expect(await pinHash()).toMatch(/^\$2[aby]\$(1[2-9]|[2-9]\d)\$/);
  });

  it("never stores the PIN in plaintext", async () => {
    await setPin("987654");
    expect(await pinHash()).not.toContain("987654");
  });

  it("salts, so the same PIN twice gives different hashes", async () => {
    await setPin("123456");
    const first = await pinHash();
    await setPin("123456");
    expect(await pinHash()).not.toBe(first);
  });

  it("refuses a PIN that is not six digits", async () => {
    await expect(setPin("12345")).rejects.toThrow(/six digits/i);
    await expect(setPin("1234567")).rejects.toThrow(/six digits/i);
    await expect(setPin("12345a")).rejects.toThrow(/six digits/i);
  });

  it("refuses a target who is not a collector", async () => {
    // Creates its own non-collector rather than querying for a seeded admin. A fixture that
    // depends on seed contents fails as a TypeError on `rows[0].id` instead of as the
    // assertion it was written to make.
    // createAppUser returns { client, userId } and uniquifies the email itself — do not
    // wrap the address in uniqueEmail() as well.
    const { userId: supervisorId } = await createAppUser({
      email: "pin-target-supervisor@example.com",
      role: "supervisor",
    });

    const { error } = await adminClient.rpc("set_collector_pin", {
      p_collector_id: supervisorId,
      p_pin: "123456",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/collector/i);
  });

  // Every test above calls set_collector_pin as adminClient, a real authenticated admin.
  // These two instead go through non-admin and no-app_users-row callers, to exercise the
  // admin guard itself. supabase-js's .rpc() resolves to { error } rather than rejecting,
  // so the assertion shape differs from setPin()'s.
  it("refuses a caller who is not an admin", async () => {
    const { client } = await createAppUser({
      email: "pin-caller-supervisor@example.com",
      role: "supervisor",
    });
    const { error } = await client.rpc("set_collector_pin", {
      p_collector_id: collectorId,
      p_pin: "123456",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/i);
  });

  // The population migration 0002's "THE GATE" comment says to expect on this shared
  // Supabase project: signed in, but with no app_users row at all. active_role() returns
  // NULL for this caller, and before migration 0028 that NULL propagated through
  // is_admin() uncoalesced -- `if not is_admin() then raise` never fires when is_admin()
  // itself is NULL, so this caller sailed through the guard that should have refused them.
  it("refuses a caller with no app_users row at all", async () => {
    const outsider = await createOutsiderClient();
    const { error } = await outsider.rpc("set_collector_pin", {
      p_collector_id: collectorId,
      p_pin: "123456",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/administrator/i);
  });
});

describe("pin_hash exposure", () => {
  // The point of routing this through an RPC at all. Migration 0002 grants
  // `update (role, status)` and a column-list SELECT that omits pin_hash; these assert the
  // hole stays closed from the strongest client key.
  it("is not readable by service_role through PostgREST", async () => {
    const { error } = await serviceClient().from("app_users").select("pin_hash").limit(1);
    expect(error).not.toBeNull();
  });

  it("is not writable by service_role through PostgREST", async () => {
    const { error } = await serviceClient()
      .from("app_users")
      .update({ pin_hash: "injected" })
      .eq("id", collectorId);
    expect(error).not.toBeNull();
  });

  // SELECT and UPDATE have live callers to probe through PostgREST above; INSERT does not
  // (nothing in this codebase inserts a row naming pin_hash), so there is no request that
  // would exercise a widened grant here. Assert the grant itself instead: checked the
  // actual grantee set for this column first (`information_schema.column_privileges`) --
  // only the table owner (`postgres`) holds any privilege on pin_hash at all, which is
  // exactly the invariant migration 0027's narrowed INSERT grant is supposed to produce.
  it("grants no role INSERT on pin_hash", async () => {
    const { rows } = await db.query(
      `select grantee
         from information_schema.column_privileges
        where table_schema = 'ceedo_collections'
          and table_name = 'app_users'
          and column_name = 'pin_hash'
          and privilege_type = 'INSERT'
          and grantee <> 'postgres'`,
    );
    expect(rows).toEqual([]);
  });
});
