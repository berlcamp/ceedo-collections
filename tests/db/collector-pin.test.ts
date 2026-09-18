import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createSyncFixture,
  serviceClient,
} from "../helpers/supabase";

let db: Client;
let collectorId: string;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  collectorId = (await createSyncFixture(db)).collectorId;
});

afterAll(async () => {
  await db.end();
});

async function setPin(pin: string): Promise<void> {
  await db.query(`select ceedo_collections.set_collector_pin($1::uuid, $2::text)`, [
    collectorId,
    pin,
  ]);
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

    await expect(
      db.query(`select ceedo_collections.set_collector_pin($1::uuid, '123456')`, [
        supervisorId,
      ]),
    ).rejects.toThrow(/collector/i);
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
});
