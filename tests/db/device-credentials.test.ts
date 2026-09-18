import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  anonClient,
  createAppUser,
  serviceClient,
  uniqueCode,
} from "../helpers/supabase";

let db: Client;
let adminClient: Awaited<ReturnType<typeof createAppUser>>["client"];

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // issue_device_credential/revoke_device_credential require a real admin caller
  // (migration 0028's NULL-safety fix means a bare postgres connection with no
  // auth.uid() -- what issue()/revoke() used to call these through -- is now correctly
  // refused, not silently let through). authenticate_device has no such guard (it's the
  // device's own auth path, granted to ceedo_app, not authenticated) so it keeps using
  // the raw `db` connection below.
  adminClient = (
    await createAppUser({ email: "device-admin@example.com", role: "admin" })
  ).client;
});

afterAll(async () => {
  await db.end();
});

async function newDevice(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.devices (label) values ($1) returning id`,
    [uniqueCode("DEV")],
  );
  return rows[0].id as string;
}

async function issue(deviceId: string): Promise<{ credential_id: string; secret: string }> {
  const { data, error } = await adminClient.rpc("issue_device_credential", {
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
  return data as { credential_id: string; secret: string };
}

async function revoke(deviceId: string): Promise<void> {
  const { error } = await adminClient.rpc("revoke_device_credential", {
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

async function authenticate(credentialId: string, secret: string): Promise<string | null> {
  const { rows } = await db.query(
    `select ceedo_collections.authenticate_device($1::text, $2::text) as device_id`,
    [credentialId, secret],
  );
  return rows[0].device_id as string | null;
}

describe("device credentials", () => {
  it("authenticates the secret it issued", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);

    expect(await authenticate(credential_id, secret)).toBe(deviceId);
  });

  it("issues a secret with at least 256 bits of entropy", async () => {
    const { secret } = await issue(await newDevice());
    // base64url of 32 random bytes is 43 characters.
    expect(secret.length).toBeGreaterThanOrEqual(43);
  });

  it("issues a different secret every time", async () => {
    const a = await issue(await newDevice());
    const b = await issue(await newDevice());
    expect(a.secret).not.toBe(b.secret);
    expect(a.credential_id).not.toBe(b.credential_id);
  });

  it("refuses a wrong secret", async () => {
    const deviceId = await newDevice();
    const { credential_id } = await issue(deviceId);

    expect(await authenticate(credential_id, "not-the-secret")).toBeNull();
  });

  it("refuses an unknown credential id", async () => {
    expect(await authenticate("no-such-credential", "anything")).toBeNull();
  });

  it("refuses a revoked credential", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);
    await revoke(deviceId);

    expect(await authenticate(credential_id, secret)).toBeNull();
  });

  it("refuses an inactive device", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      deviceId,
    ]);

    expect(await authenticate(credential_id, secret)).toBeNull();
  });

  it("re-issuing revokes the previous credential", async () => {
    const deviceId = await newDevice();
    const first = await issue(deviceId);
    const second = await issue(deviceId);

    expect(await authenticate(first.credential_id, first.secret)).toBeNull();
    expect(await authenticate(second.credential_id, second.secret)).toBe(deviceId);
  });

  it("records last_seen_at on a successful authentication", async () => {
    const deviceId = await newDevice();
    const { credential_id, secret } = await issue(deviceId);

    const before = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(before.rows[0].last_seen_at).toBeNull();

    await authenticate(credential_id, secret);

    const after = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(after.rows[0].last_seen_at).not.toBeNull();
  });

  it("does not record last_seen_at on a failed authentication", async () => {
    const deviceId = await newDevice();
    const { credential_id } = await issue(deviceId);

    await authenticate(credential_id, "wrong");

    const { rows } = await db.query(
      `select last_seen_at from ceedo_collections.devices where id = $1`,
      [deviceId],
    );
    expect(rows[0].last_seen_at).toBeNull();
  });

  it("stores no plaintext secret anywhere in the row", async () => {
    const deviceId = await newDevice();
    const { secret } = await issue(deviceId);

    const { rows } = await db.query(
      `select row_to_json(dc)::text as blob
         from ceedo_collections.device_credentials dc
        where dc.device_id = $1`,
      [deviceId],
    );
    expect(rows[0].blob).not.toContain(secret);
  });
});

describe("device_credentials privileges", () => {
  // service_role is the strongest key any client holds. Migration 0001's default
  // privileges grant it SELECT and INSERT on every future table in this schema, so this
  // assertion only means something because the migration actively revokes them. An
  // `anon` assertion here would be vacuous -- anon is denied at schema-usage level and
  // would pass against an empty table.
  it("denies service_role any read", async () => {
    const { error } = await serviceClient().from("device_credentials").select("id").limit(1);
    expect(error).not.toBeNull();
  });

  it("denies service_role any insert", async () => {
    const { error } = await serviceClient()
      .from("device_credentials")
      .insert({ device_id: randomUUID(), secret_hash: "\\x00", issued_by: randomUUID() });
    expect(error).not.toBeNull();
  });

  it("denies anon any read", async () => {
    const { error } = await anonClient().from("device_credentials").select("id").limit(1);
    expect(error).not.toBeNull();
  });
});
