import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createOutsiderClient,
  createSyncFixture,
  resetCutover,
  type TestClient,
} from "../helpers/supabase";

let db: Client;
let supervisor: TestClient;
const BUSINESS_DATE = "2026-10-05";
const COLLECTED_AT = `${BUSINESS_DATE}T02:00:00+00:00`;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  // has_role()/is_admin() resolve through auth.uid(), which is NULL on the raw Postgres
  // owner connection used elsewhere in this file for fixtures and assertions -- confirmed
  // directly (`select auth.uid()` returns a blank row against the local stack over that
  // connection). Every other has_role/is_admin-gated RPC in this codebase (condone_charge,
  // cancel_collection, record_opening_balance) is exercised through an authenticated
  // supabase-js client for exactly this reason, so the three resolution RPCs are called
  // the same way here rather than over `db`.
  ({ client: supervisor } = await createAppUser({
    email: "resolve-exception-supervisor",
    role: "supervisor",
  }));
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;

let orNo = 1200;

/** Pushes a deliberately-bad collection and returns the exception it files. */
async function fileException(fx: Fixture): Promise<{ id: string; collectionUuid: string }> {
  const collectionUuid = randomUUID();
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
  await db.query(`select ceedo_collections.sync_push($1::uuid, $2::jsonb)`, [
    fx.deviceId,
    JSON.stringify([
      {
        type: "collection",
        payload: {
          id: collectionUuid,
          or_no: 999999, // out of range: permanently rejectable
          booklet_id: fx.bookletId,
          collector_id: fx.collectorId,
          collected_at: COLLECTED_AT,
          fee_type_id: fx.feeTypeId,
          lease_id: fx.leaseId,
          allocations: [{ group_rank: 1 }],
          lines: [],
        },
      },
    ]),
  ]);

  const { rows } = await db.query(
    `select id from ceedo_collections.sync_exceptions where collection_uuid = $1`,
    [collectionUuid],
  );
  return { id: rows[0].id as string, collectionUuid };
}

describe("resolve_exception_corrected", () => {
  it("re-posts under the ORIGINAL client UUID", async () => {
    // D9. A rejected entry wrote nothing, so its UUID is still free. Re-using it keeps the
    // device's outbox coherent: the tablet still holds that UUID as unresolved, and when it
    // re-pushes, post_collection returns `duplicate` against the now-posted row and the
    // entry settles. A fresh UUID would leave the device re-pushing a ghost.
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    const { data, error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Collector transposed the OR number",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "accepted" });
    const posted = await db.query(
      `select id, or_no from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(posted.rows).toHaveLength(1);
    expect(posted.rows[0].or_no).toBe(orNo);
  });

  it("re-posts under the exception's own UUID even if the correction payload names a different id", async () => {
    // The migration re-asserts `id` (and `device_id`) AFTER merging the supervisor's
    // payload, precisely so a correction cannot redirect which receipt this is. Without
    // that re-assertion, this is the one case that would slip through: the brief's other
    // "original UUID" test never sends an `id` at all, so removing the re-assertion would
    // not fail it (see Step 5 mutation 1) -- this test exists to close that gap.
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);
    const foreignId = randomUUID();

    const { data, error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo, id: foreignId },
      p_reason: "Collector transposed the OR number",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "accepted" });

    const posted = await db.query(
      `select id, or_no from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(posted.rows).toHaveLength(1);
    expect(posted.rows[0].or_no).toBe(orNo);

    const foreign = await db.query(
      `select id from ceedo_collections.collections where id = $1`,
      [foreignId],
    );
    expect(foreign.rows).toHaveLength(0);
  });

  it("marks the exception resolved/corrected with the reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Transposed digits",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select status, resolution, resolution_reason, resolved_by, resolved_at
         from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: "resolved",
      resolution: "corrected",
      resolution_reason: "Transposed digits",
    });
    expect(rows[0].resolved_at).not.toBeNull();
  });

  it("never accepts an amount from the correction", async () => {
    // Invariant 3 holds for supervisors exactly as for devices. A supervisor override would
    // put a hole in "the device's figure is never authoritative" reachable by anyone with a
    // supervisor account.
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    const { error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo, gross_amount: "1.00" },
      p_reason: "Corrected",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select gross_amount from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(Number(rows[0].gross_amount)).toBeGreaterThan(1);
  });

  it("leaves the exception open when the correction is itself invalid", async () => {
    // Rejected again rather than forced in.
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { data, error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: 888888 },
      p_reason: "Still wrong",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "rejected" });
    const { rows: ex } = await db.query(
      `select status, reason_code from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(ex[0].status).toBe("open");
    expect(ex[0].reason_code).toBe("or_out_of_range");
  });

  it("refuses an empty reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/reason/i);
  });

  it("refuses to resolve an already-resolved exception", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const first = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Fixed",
    });
    expect(first.error).toBeNull();

    const { error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Again",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already resolved/i);
  });

  it("writes an audit row", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Fixed",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'sync_exceptions' and entity_id = $1`,
      [id],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("refuses an outsider with no app_users row", async () => {
    // Migration 0028's null-safety fix is what makes this a refusal rather than a silent
    // no-op: has_role() coalesces active_role() = any(...) to false for a caller with no
    // app_users row, so `if not has_role(...)` actually raises instead of skipping the
    // branch. Asserted against the guard's specific message, not merely "an error came
    // back" -- a skipped guard here would still fail later (no such exception / a foreign
    // key on resolved_by), and that would pass this assertion for the wrong reason.
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const outsider = await createOutsiderClient();

    const { error } = await outsider.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/i);

    const { rows } = await db.query(
      `select status from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0].status).toBe("open");
  });
});

describe("resolve_exception_spoiled", () => {
  it("records the serial as spoiled and posts no collection", async () => {
    const fx = await createSyncFixture(db);
    const { id, collectionUuid } = await fileException(fx);

    const { error } = await supervisor.rpc("resolve_exception_spoiled", {
      p_exception_id: id,
      p_reason: "Receipt voided at the stall",
    });
    expect(error).toBeNull();

    const { rows: ex } = await db.query(
      `select status, resolution from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(ex[0]).toMatchObject({ status: "resolved", resolution: "spoiled" });

    const { rows: posted } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(posted[0].n).toBe(0);

    const { rows: spoiled } = await db.query(
      `select count(*)::int as n from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 999999`,
      [fx.bookletId],
    );
    expect(spoiled[0].n).toBe(1);
  });

  it("refuses an outsider with no app_users row", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const outsider = await createOutsiderClient();

    const { error } = await outsider.rpc("resolve_exception_spoiled", {
      p_exception_id: id,
      p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/i);

    const { rows } = await db.query(
      `select status from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0].status).toBe("open");
  });
});

describe("escalate_exception", () => {
  it("leaves the exception unresolved", async () => {
    // §11.3's third action is not a terminus. An exception must not be closeable by
    // declaring it interesting.
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);

    const { error } = await supervisor.rpc("escalate_exception", {
      p_exception_id: id,
      p_reason: "Two devices claim this OR; referred to the Treasurer",
    });
    expect(error).toBeNull();

    const { rows } = await db.query(
      `select status, resolution, resolved_at, resolution_reason
         from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: "escalated",
      resolution: null,
      resolved_at: null,
    });
    expect(rows[0].resolution_reason).toContain("Treasurer");
  });

  it("still permits a correction afterwards", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const escalated = await supervisor.rpc("escalate_exception", {
      p_exception_id: id,
      p_reason: "Investigating",
    });
    expect(escalated.error).toBeNull();

    const { data, error } = await supervisor.rpc("resolve_exception_corrected", {
      p_exception_id: id,
      p_payload: { or_no: ++orNo },
      p_reason: "Resolved",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "accepted" });
  });

  it("refuses an empty reason", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const { error } = await supervisor.rpc("escalate_exception", {
      p_exception_id: id,
      p_reason: "",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/reason/i);
  });

  it("refuses an outsider with no app_users row", async () => {
    const fx = await createSyncFixture(db);
    const { id } = await fileException(fx);
    const outsider = await createOutsiderClient();

    const { error } = await outsider.rpc("escalate_exception", {
      p_exception_id: id,
      p_reason: "not allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/supervisor or administrator/i);

    const { rows } = await db.query(
      `select status from ceedo_collections.sync_exceptions where id = $1`,
      [id],
    );
    expect(rows[0].status).toBe("open");
  });
});
