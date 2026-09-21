import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PushResult } from "@ceedo/shared";
import { POSTGRES_URL, createSyncFixture, resetCutover } from "../helpers/supabase";
import { GATEWAY_URL, callFunction } from "../helpers/functions";

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

  it("refuses an absent credential with 400, naming the missing field", async () => {
    // This asserted 401 until Task 5 put contract validation BEFORE authentication. A body
    // with no credential_id is malformed, not unauthenticated, and saying so is what lets a
    // device developer tell a typo from a revoked credential. The 401-comes-from-us-and-not
    // -from-Kong point this test used to carry is pinned by the wrong-secret test above,
    // which sends a well-formed body and asserts the body of the 401.
    const res = await callFunction("sync-pull", { cursor: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(JSON.stringify(res.body.detail)).toMatch(/credential_id/);
  });

  it("refuses a GET with 405", async () => {
    const res = await fetch(`${GATEWAY_URL}/functions/v1/sync-pull`, {
      headers: GATEWAY_HEADERS,
    });
    expect(res.status).toBe(405);
  });

  it("refuses a malformed body with 400", async () => {
    const res = await fetch(`${GATEWAY_URL}/functions/v1/sync-pull`, {
      method: "POST",
      headers: { "content-type": "application/json", ...GATEWAY_HEADERS },
      body: "{not json",
    });
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
    //
    // This test used to send `entries: "not-an-array"`, which sync-push refused at its own
    // `Array.isArray` check — Postgres never ran, no error string ever existed, and the
    // assertion below was true of a body that could not have leaked anything. It was then
    // changed to send `shift_id: "not-a-uuid"`, which drove a real PostgREST uuid-syntax
    // error; Task 5's contract validation now refuses THAT at the door, which would have
    // put this test back in the same vacuous shape.
    //
    // So the error is driven one layer deeper: a well-formed uuid naming no shift passes
    // validation, reaches close_shift, and raises `No such shift` — a genuine Postgres
    // error string, redacted by the handler into the code below.
    const res = await callFunction("closeout", {
      ...creds(),
      shift_id: randomUUID(),
      declared_total: "0.00",
      device_count: 0,
      device_total: "0.00",
    });

    expect(res.status).toBe(500);
    // Deep equality, not a substring: the body must be the redacted code and NOTHING else,
    // or a future handler can append a `detail` and still pass a negative match.
    expect(res.body).toEqual({ error: "closeout_failed" });
    expect(JSON.stringify(res.body)).not.toMatch(/ceedo_collections|relation|column|pg_/i);
    expect(JSON.stringify(res.body)).not.toMatch(/uuid|syntax|shift/i);
  });

  it("still refuses a non-array entries field with 400, and now says which field", async () => {
    // Kept from the old redaction test above, which is the only thing it ever proved. The
    // bare `Array.isArray` check that answered this is gone; the schema answers it instead,
    // and the difference is that the caller is told the field's name.
    const res = await callFunction("sync-push", { ...creds(), entries: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(JSON.stringify(res.body.detail)).toMatch(/entries/);
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

/** The collection payload these tests push, with only the fields a case actually varies. */
function collectionEntry(overrides: Record<string, unknown> = {}) {
  return {
    type: "collection",
    payload: {
      id: randomUUID(),
      booklet_id: fx.bookletId,
      collector_id: fx.collectorId,
      collected_at: "2026-10-05T02:00:00+00:00",
      fee_type_id: fx.feeTypeId,
      lease_id: fx.leaseId,
      allocations: [{ group_rank: 1 }],
      lines: [],
      ...overrides,
    },
  };
}

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

  it("refuses a payload carrying device_id rather than quietly overriding it", async () => {
    // Invariant 21, over the wire -- and the answer CHANGED in Task 5. sync_push still
    // overrides device_id from the authenticated credential, and tests/db/sync-push.test.ts
    // ("takes device_id from the credential, never from the payload") still pins that; it is
    // the guarantee, and it is untouched.
    //
    // What changed is what a client carrying one is told. CollectionPayload declares
    // device_id `z.never()` -- "REFUSED rather than merely ignored", as the contract's own
    // comment puts it -- so the request no longer reaches Postgres at all. Silently
    // accepting a field the server intends to discard is how a confused client stays
    // confused, and how a hostile one learns nothing.
    const other = await createSyncFixture(db);
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const id = randomUUID();

    const res = await callFunction("sync-push", {
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

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(JSON.stringify(res.body.detail)).toMatch(/device_id/);

    // And nothing was written: a refused body must not have reached the engine.
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
  });

  it("does not lose the whole round to one entry whose exception cannot be filed", async () => {
    // The Critical this phase's final review found, reproduced over the wire it was found
    // on. Before migration 0039 this exact request answered 500 {"error":"sync_failed"} and
    // the GOOD receipt never reached `collections`: the exception-filing INSERT ran in the
    // OUTER transaction, its foreign key raised, and the whole call aborted. Cash was
    // already taken, nothing was filed, and §6.4 has the device re-pushing the identical
    // batch forever — a permanent sync deadlock.
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);
    const goodId = randomUUID();

    const res = await callFunction("sync-push", {
      ...creds(),
      entries: [
        collectionEntry({ id: goodId, or_no: 1310 }),
        // A collector_id naming no app_users row: rejected by the device check, and then
        // unfilable, because sync_exceptions.collector_id is a foreign key.
        collectionEntry({ or_no: 1311, collector_id: randomUUID() }),
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.map((r: { status: string }) => r.status)).toEqual([
      "accepted",
      "rejected",
    ]);
    // The status line alone is not the point. The receipt has to be IN the ledger.
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [goodId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("returns collection results that validate against the shipped PushResult contract", async () => {
    // Shipping a wire contract is only worth anything if a Phase 3b device can validate what
    // it actually receives against it. PushResult is `.strict()`, and it rejected EVERY
    // accepted collection this server has ever returned, because `gross_amount` — present on
    // every one of them — was not in the schema. A device validating its responses would
    // have treated a settled receipt as a protocol error and gone on re-pushing it: the
    // "device silently discards a receipt" failure, arriving through the contract itself.
    //
    // `sync-contract.test.ts` could not catch this. It parses hand-written literals, which
    // only ever prove the schema agrees with whoever wrote them. This parses the server's
    // own bytes.
    await db.query(`select ceedo_collections.run_accrual('2026-10-05'::date)`);

    const res = await callFunction("sync-push", {
      ...creds(),
      entries: [
        collectionEntry({ or_no: 1320 }),
        // Permanently rejectable: carries reason, retryable and detail.
        collectionEntry({ or_no: 999999 }),
      ],
    });

    expect(res.status).toBe(200);
    // Throws, loudly and by field name, on any drift between server and contract.
    const results = PushResult.array().parse(res.body);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected"]);
    expect(results[0]!.gross_amount).toBeDefined();
    expect(results[1]!.retryable).toBe(false);
  });

  it("returns shift results that validate too, mismatch through already_closed", async () => {
    // The other three PushResult shapes, and the only ones carrying money BACK: `mismatch`
    // (device vs server), `closed` (which the status enum did not even list) and
    // `already_closed` (the only place `shift_status` appears). A fresh fixture, so this
    // collector has no collections today and 0/0.00 genuinely reconciles.
    const clean = await createSyncFixture(db);
    const cleanCreds = { credential_id: clean.credentialId, secret: clean.secret };
    const shiftId = randomUUID();
    const closeEntry = (declared: string, count: number, total: string) => ({
      type: "shift_close",
      payload: { id: shiftId, declared_total: declared, device_count: count, device_total: total },
    });

    const opening = await callFunction("sync-push", {
      ...cleanCreds,
      entries: [
        {
          type: "shift_open",
          payload: {
            id: shiftId,
            collector_id: clean.collectorId,
            business_date: "2026-10-05",
            opened_at: "2026-10-05T02:00:00+00:00",
          },
        },
        // A device claiming one receipt the server never saw: records are missing, so this
        // must not close.
        closeEntry("5.00", 1, "5.00"),
      ],
    });
    const closing = await callFunction("sync-push", {
      ...cleanCreds,
      entries: [closeEntry("0.00", 0, "0.00")],
    });
    const again = await callFunction("sync-push", {
      ...cleanCreds,
      entries: [closeEntry("0.00", 0, "0.00")],
    });

    const opened = PushResult.array().parse(opening.body);
    const closed = PushResult.array().parse(closing.body);
    const reclosed = PushResult.array().parse(again.body);

    expect(opened.map((r) => r.status)).toEqual(["accepted", "mismatch"]);
    // numeric(14,2) assembled by jsonb_build_object arrives as a JSON NUMBER, not the
    // quoted string PostgREST produces for numeric COLUMNS. The schema said string, so
    // `.strict()` rejected all three of these fields on every real response.
    expect(typeof opened[1]!.system_total).toBe("number");
    expect(closed[0]!.status).toBe("closed");
    expect(typeof closed[0]!.variance).toBe("number");
    expect(reclosed[0]!.status).toBe("already_closed");
    expect(reclosed[0]!.shift_status).toBe("closed");
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
        // A receipt collected INTO this shift. Since migration 0043 close_shift counts by
        // collections.shift_id, so the mismatch has to be staged with a collection that
        // names this shift -- leaning on receipts left behind by the push tests above no
        // longer works, because those belong to no shift and count towards no closeout.
        //
        // Cash-only, not a lease allocation: the tests above have already settled this
        // lease's unpaid periods, so a group_rank 1 allocation here would be rejected as
        // not-a-prefix and the shift would end up empty again.
        collectionEntry({
          or_no: 1330,
          shift_id: shiftId,
          lease_id: null,
          fee_type_id: fx.perHeadFeeTypeId,
          allocations: [],
          lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
        }),
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
    // The device declares nothing; the server holds one receipt for this shift.
    expect(res.body.status).toBe("mismatch");
    expect(Number(res.body.system_count)).toBe(1);
  });
});
