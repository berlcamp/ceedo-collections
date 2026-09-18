import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

let db: Client;
let fx: Awaited<ReturnType<typeof createSyncFixture>>;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  fx = await createSyncFixture(db);
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

function creds() {
  return { credential_id: fx.credentialId, secret: fx.secret };
}

// apikey/Authorization is the gateway credential, not the Function's -- see
// tests/helpers/functions.ts. These two tests bypass callFunction() to send a raw GET and
// a raw malformed body, but Kong still checks the gateway credential first: without it,
// both come back 401 from Kong before sync-pull ever runs, and would pass identically
// whether sync-pull enforces 405/400 or not.
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY ?? "";
const GATEWAY_HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}` };

describe("authentication over HTTP", () => {
  // The layer only these tests can reach: the SQL tests call authenticate_device directly
  // and never exercise the ceedo_app JWT, the transport, or the status codes.

  it("refuses a wrong secret with 401", async () => {
    const res = await callFunction("sync-pull", {
      credential_id: fx.credentialId,
      secret: "wrong",
      cursor: 0,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("refuses an absent credential with 401", async () => {
    const res = await callFunction("sync-pull", { cursor: 0 });
    expect(res.status).toBe(401);
    // The body, not just the status: Kong also answers 401, so a status-only assertion
    // passes even when the Function is broken or absent.
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("refuses a GET with 405", async () => {
    const res = await fetch(
      `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/sync-pull`,
      { headers: GATEWAY_HEADERS },
    );
    expect(res.status).toBe(405);
  });

  it("refuses a malformed body with 400", async () => {
    const res = await fetch(
      `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/sync-pull`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...GATEWAY_HEADERS },
        body: "{not json",
      },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a deactivated device, without the device needing to know", async () => {
    // §4.1: deactivation takes effect on next contact. This is the answer to a stolen
    // tablet, and it can only be verified over the wire.
    const doomed = await createSyncFixture(db);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      doomed.deviceId,
    ]);

    const res = await callFunction("sync-pull", {
      credential_id: doomed.credentialId,
      secret: doomed.secret,
      cursor: 0,
    });
    expect(res.status).toBe(401);
  });

  it("leaks no Postgres detail in an error body", async () => {
    // This endpoint is reached by an unauthenticated client over the public internet. A
    // Postgres error string names tables, columns and constraints.
    const res = await callFunction("sync-push", { ...creds(), entries: "not-an-array" });
    expect(JSON.stringify(res.body)).not.toMatch(/ceedo_collections|relation|column|pg_/i);
  });
});

describe("sync-pull over HTTP", () => {
  it("returns the scoped payload with a cursor and an epoch", async () => {
    const res = await callFunction("sync-pull", { ...creds(), cursor: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cursor");
    expect(res.body).toHaveProperty("epoch");
    expect(res.body.leases.map((l: { id: string }) => l.id)).toContain(fx.leaseId);
  });
});

describe("sync-push over HTTP", () => {
  it("accepts a collection and returns one result per entry", async () => {
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = randomUUID();

    const res = await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "collection",
          payload: {
            id,
            or_no: 1300,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ index: 0, status: "accepted" });
  });

  it("ignores a device_id in the payload and uses the credential's", async () => {
    // Invariant 21, over the wire. The SQL test proves the function does this; this proves
    // the transport does not reintroduce the payload's value on the way through.
    const other = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = randomUUID();

    await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "collection",
          payload: {
            id,
            or_no: 1301,
            booklet_id: fx.bookletId,
            collector_id: fx.collectorId,
            device_id: other.deviceId,
            collected_at: "2026-10-05T02:00:00+00:00",
            fee_type_id: fx.feeTypeId,
            lease_id: fx.leaseId,
            allocations: [{ group_rank: 1 }],
            lines: [],
          },
        },
      ],
    });

    const { rows } = await db.query(
      `select device_id from ceedo_collections.collections where id = $1`,
      [id],
    );
    expect(rows[0]?.device_id).toBe(fx.deviceId);
  });
});

describe("closeout over HTTP", () => {
  it("reports a mismatch without closing", async () => {
    const shiftId = randomUUID();
    await callFunction("sync-push", {
      ...creds(),
      entries: [
        {
          type: "shift_open",
          payload: {
            id: shiftId,
            collector_id: fx.collectorId,
            business_date: "2026-10-05",
            opened_at: "2026-10-05T02:00:00+00:00",
          },
        },
      ],
    });

    const res = await callFunction("closeout", {
      ...creds(),
      shift_id: shiftId,
      declared_total: "0.00",
      device_count: 0,
      device_total: "0.00",
    });

    expect(res.status).toBe(200);
    // Collections already exist for this collector from the push tests above.
    expect(res.body.status).toBe("mismatch");
  });
});
