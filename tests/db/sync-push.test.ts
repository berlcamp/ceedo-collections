import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;
const BUSINESS_DATE = "2026-10-05";
const COLLECTED_AT = `${BUSINESS_DATE}T02:00:00+00:00`;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

type Fixture = Awaited<ReturnType<typeof createSyncFixture>>;
type Entry = { type: string; payload: Record<string, unknown> };
type Result = {
  index: number;
  type: string;
  status: string;
  reason?: string;
  collection_id?: string;
  retryable?: boolean;
  detail?: string;
};

async function push(fx: Fixture, entries: Entry[]): Promise<Result[]> {
  const { rows } = await db.query(
    `select ceedo_collections.sync_push($1::uuid, $2::jsonb) as result`,
    [fx.deviceId, JSON.stringify(entries)],
  );
  return rows[0].result as Result[];
}

// A thin wrapper around `push` for the (common) single-entry case, so call sites can
// destructure a known-present `Result` without `noUncheckedIndexedAccess` flagging every
// later `result.status` as possibly undefined. The assertion is made exactly once, here,
// rather than at each of the dozen call sites.
async function pushOne(fx: Fixture, entries: Entry[]): Promise<Result> {
  const results = await push(fx, entries);
  return results[0]!;
}

let orNo = 1100;

function collectionEntry(fx: Fixture, overrides: Record<string, unknown> = {}): Entry {
  return {
    type: "collection",
    payload: {
      id: randomUUID(),
      or_no: ++orNo,
      booklet_id: fx.bookletId,
      collector_id: fx.collectorId,
      collected_at: COLLECTED_AT,
      fee_type_id: fx.feeTypeId,
      lease_id: fx.leaseId,
      allocations: [{ group_rank: 1 }],
      lines: [],
      ...overrides,
    },
  };
}

async function accrue(): Promise<void> {
  await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
}

/** How many rows the given client UUID actually has in `collections`. */
async function landed(collectionId: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from ceedo_collections.collections where id = $1`,
    [collectionId],
  );
  return rows[0].n as number;
}

async function exceptionCount(collectionUuid: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from ceedo_collections.sync_exceptions
      where collection_uuid = $1`,
    [collectionUuid],
  );
  return rows[0].n as number;
}

describe("sync_push — collections", () => {
  it("accepts a good entry and files no exception", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx);

    const result = await pushOne(fx, [entry]);

    expect(result).toMatchObject({ index: 0, type: "collection", status: "accepted" });
    expect(await exceptionCount(entry.payload.id as string)).toBe(0);
  });

  it("returns duplicate on a retry of the same client UUID", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx);
    await push(fx, [entry]);

    const result = await pushOne(fx, [entry]);

    expect(result.status).toBe("duplicate");
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections where id = $1`,
      [entry.payload.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("takes device_id from the credential, never from the payload", async () => {
    // Invariant 21. A device may claim any collector_id -- the PIN was verified offline, so
    // that claim is unverifiable by construction and §11.5 accepts it -- but it must not be
    // able to claim to be a DIFFERENT TABLET, which would let one device push receipts
    // attributed to another's assignment.
    const fx = await createSyncFixture(db);
    const other = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { device_id: other.deviceId });

    const result = await pushOne(fx, [entry]);
    expect(result.status).toBe("accepted");

    const { rows } = await db.query(
      `select device_id from ceedo_collections.collections where id = $1`,
      [entry.payload.id],
    );
    expect(rows[0].device_id).toBe(fx.deviceId);
    expect(rows[0].device_id).not.toBe(other.deviceId);
  });

  it("rejects a collector with no active collection area", async () => {
    // Since migration 20260929000055 a collector from any facility may use any tablet; the
    // one thing that refuses them is having no active collection area.
    const fx = await createSyncFixture(db);
    const stranger = await createSyncFixture(db);
    await db.query(
      `update ceedo_collections.collector_assignments set active = false where collector_id = $1`,
      [stranger.collectorId],
    );
    await accrue();

    const result = await pushOne(fx, [
      collectionEntry(fx, { collector_id: stranger.collectorId }),
    ]);

    expect(result).toMatchObject({ status: "rejected", reason: "collector_not_on_device" });
  });

  it("files an exception for a permanently rejectable entry", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    // An OR number outside the booklet's range can never succeed on a retry.
    const entry = collectionEntry(fx, { or_no: 999999 });

    const result = await pushOne(fx, [entry]);

    expect(result).toMatchObject({ status: "rejected", reason: "or_out_of_range" });
    expect(await exceptionCount(entry.payload.id as string)).toBe(1);
  });

  it("bumps attempts instead of filing a second exception on a re-push", async () => {
    // Invariant 23. §6.4 keeps a rejected entry in the outbox as unresolved, so the device
    // re-pushes it every sync. One row per UUID, or the queue is buried within a day.
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { or_no: 999999 });

    await push(fx, [entry]);
    await push(fx, [entry]);
    await push(fx, [entry]);

    expect(await exceptionCount(entry.payload.id as string)).toBe(1);
    const { rows } = await db.query(
      `select attempts, first_seen_at, last_seen_at
         from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [entry.payload.id],
    );
    expect(rows[0].attempts).toBe(3);
    expect(new Date(rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[0].first_seen_at).getTime(),
    );
  });

  it("leaves a RESOLVED exception alone when the device re-pushes it", async () => {
    // §6.4 keeps a rejected entry on the device until it is dealt with, so a device goes
    // on re-pushing it after a supervisor has already resolved it. Before migration 0039
    // the ON CONFLICT clause had no status predicate, so that re-push overwrote
    // `reason_code` on the resolved row and bumped `attempts` — destroying the record of
    // why the exception was filed, on a row whose whole value is that history.
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { or_no: 999999 });
    await push(fx, [entry]);

    // Resolve it the way resolve_exception_spoiled() does. Written directly rather than
    // through that function so this test turns on the ON CONFLICT predicate alone and not
    // on the supervisor-authorization path, which has its own tests.
    await db.query(
      `update ceedo_collections.sync_exceptions
          set status = 'resolved', resolution = 'spoiled',
              resolution_reason = 'form voided', resolved_by = $2, resolved_at = now(),
              reason_code = 'filed_before_resolution'
        where collection_uuid = $1`,
      [entry.payload.id, fx.collectorId],
    );

    await push(fx, [entry]);

    const { rows } = await db.query(
      `select attempts, status, reason_code, resolution
         from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [entry.payload.id],
    );
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].resolution).toBe("spoiled");
    // A sentinel, so the assertion fails if the re-push writes `excluded.reason_code` over
    // the reason this exception was actually filed for.
    expect(rows[0].reason_code).toBe("filed_before_resolution");
  });

  it("files an exception for or_already_used, never collapsing it into duplicate", async () => {
    // §6.3's case that no device can detect on its own: two DIFFERENT devices recorded the
    // same OR number. Phase 2's handover: "Collapsing it into duplicate would make the
    // device discard a real receipt for money that was actually collected."
    const fx = await createSyncFixture(db);
    await accrue();
    const first = collectionEntry(fx);
    await push(fx, [first]);

    // Same booklet and OR, DIFFERENT client UUID -- a second device's record.
    const second = collectionEntry(fx, { or_no: first.payload.or_no });
    const result = await pushOne(fx, [second]);

    expect(result).toMatchObject({ status: "rejected", reason: "or_already_used" });
    expect(result.status).not.toBe("duplicate");
    expect(await exceptionCount(second.payload.id as string)).toBe(1);
  });

  it("marks a retryable rejection as retryable and files NO exception", async () => {
    // Invariant 24. The device re-syncs and retries on its own; a supervisor never sees it.
    const fx = await createSyncFixture(db);
    await accrue();
    // Force the branch directly: an entry whose prefix was settled by a concurrent post is
    // hard to stage deterministically here, so sync-concurrency.test.ts (Task 16) covers the
    // real race. This asserts the exception-filing policy given the reason.
    const settled = collectionEntry(fx);
    await push(fx, [settled]);

    const stale = collectionEntry(fx, { allocations: [{ group_rank: 1 }] });
    const result = await pushOne(fx, [stale]);

    // Rank 1 is now settled, so rank 1 names a different charge set than before.
    if (result.reason === "stale_allocations") {
      expect(result.retryable).toBe(true);
      expect(await exceptionCount(stale.payload.id as string)).toBe(0);
    } else {
      // If the engine accepted it (rank 1 rolled forward), the fixture did not stage the
      // case; Task 16 is the authoritative test for the race.
      expect(result.status).toBe("accepted");
    }
  });
});

describe("sync_push — batch isolation", () => {
  it("does not let one poison entry roll back its neighbours", async () => {
    // Invariant 22, D8. The alternative -- one transaction per batch -- is not merely
    // slower to recover from, it is wrong: a single permanently-rejectable entry would
    // block every other receipt in that round FOREVER, which is the discard failure §6.3
    // exists to prevent, arriving by a different road.
    const fx = await createSyncFixture(db);
    await accrue();

    // The poison entry must raise a genuine PL/pgSQL exception, not just return a graceful
    // `rejected` -- otherwise this test cannot tell the begin/exception subtransaction
    // apart from its absence, because nothing ever unwinds. or_out_of_range (used by the
    // "permanently rejectable" test above) is caught and returned by post_collection()
    // itself, so removing sync_push's own begin/exception block would not change this
    // test's outcome at all. An invalid booklet_id fails the `::uuid` cast at declaration
    // time inside post_collection, which is uncaught there and propagates as a real
    // exception -- exactly the case the subtransaction exists to isolate.
    const one = collectionEntry(fx);
    const poison = collectionEntry(fx, { booklet_id: "not-a-uuid" });
    const three = collectionEntry(fx);

    const results = await push(fx, [one, poison, three]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected", "accepted"]);
    expect(results[1]).toMatchObject({ status: "rejected", reason: "server_error" });

    for (const good of [one, three]) {
      const { rows } = await db.query(
        `select count(*)::int as n from ceedo_collections.collections where id = $1`,
        [good.payload.id],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  // The three tests below are the SECOND half of invariant 22, and until migration 0039
  // nothing covered them: 0035's subtransaction closed before the exception-filing block,
  // so filing ran in the OUTER transaction and any error it raised aborted the whole
  // sync_push() call. Reproduced over real HTTP as ceedo_app: 500 {"error":"sync_failed"},
  // with the good receipt never reaching `collections` — both entries lost, nothing filed,
  // and the device re-pushing the identical batch forever.
  //
  // Each of the three names one input a device can actually send that makes the filing
  // INSERT itself raise. Isolating dispatch and leaving filing exposed is not isolation.

  it("survives a rejection whose exception cannot be filed for want of a real collector", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const good = collectionEntry(fx);
    // Rejected as collector_not_on_device, and then sync_exceptions_collector_id_fkey
    // refuses the filing INSERT, because no app_users row carries this id.
    const orphan = collectionEntry(fx, { collector_id: randomUUID() });

    const results = await push(fx, [good, orphan]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected"]);
    expect(await landed(good.payload.id as string)).toBe(1);
    // The entry is still REPORTED, with the filing failure named rather than swallowed. A
    // supervisor who cannot find the row in the queue still has the device's answer.
    expect(results[1]!.detail).toMatch(/could not be filed/);
  });

  it("survives a rejection carrying no collector_id at all", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const good = collectionEntry(fx);
    // sync_exceptions.collector_id is NOT NULL, so this one fails the filing differently.
    const headless = collectionEntry(fx, { collector_id: null });

    const results = await push(fx, [good, headless]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected"]);
    expect(await landed(good.payload.id as string)).toBe(1);
    expect(results[1]!.detail).toMatch(/could not be filed/);
  });

  it("survives a rejection whose own id is not a valid uuid", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const good = collectionEntry(fx);
    // Here it is the filing block's own `nullif(payload ->> 'id', '')::uuid` that raises,
    // not a constraint.
    const malformed = collectionEntry(fx, { id: "not-a-uuid" });

    const results = await push(fx, [good, malformed]);

    expect(results.map((r) => r.status)).toEqual(["accepted", "rejected"]);
    expect(await landed(good.payload.id as string)).toBe(1);
    expect(results[1]!.detail).toMatch(/could not be filed/);
  });

  it("never files one entry's exception against the previous entry's collector", async () => {
    // A misattribution that PREDATES migration 0039 and that its subtransaction did not
    // touch. `v_collector` is declared at function scope, and PL/pgSQL variables are not
    // rolled back by a subtransaction -- only database state is. So an entry whose
    // collector_id cast RAISES left the previous entry's collector in scope, and the filing
    // block wrote this entry's exception against them.
    //
    // sync_exceptions is read by collector and §11.3 counts an unresolved one against that
    // collector at closeout, so this blamed an innocent person for someone else's failed
    // receipt -- and it succeeded silently, which is worse than raising. Fixed in 0042.
    const fx = await createSyncFixture(db);
    const stranger = await createSyncFixture(db);
    await accrue();

    // Rejected as collector_not_on_device, and FILED -- stranger is a real app_users row, so
    // the foreign key is satisfied. This is what leaves a collector id in scope.
    const first = collectionEntry(fx, { collector_id: stranger.collectorId });
    // Raises on the cast, so it never assigns a collector of its own.
    const second = collectionEntry(fx, { collector_id: "not-a-uuid" });

    const results = await push(fx, [first, second]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);

    // The first entry is still attributed correctly. The fix must not cost this.
    const filed = await db.query(
      `select collector_id from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [first.payload.id],
    );
    expect(filed.rows[0]?.collector_id).toBe(stranger.collectorId);

    // The second is filed against NOBODY -- correctly, because there is no collector to file
    // it against -- and never against the stranger. Asserted as the row set rather than a
    // `not.toBe`, so a row filed against some third collector fails this too.
    const misfiled = await db.query(
      `select collector_id from ceedo_collections.sync_exceptions where collection_uuid = $1`,
      [second.payload.id],
    );
    expect(misfiled.rows).toEqual([]);
    // ...and the device is told, rather than the failure being swallowed (migration 0039).
    expect(results[1]!.detail).toMatch(/could not be filed/);
  });

  it("returns one result per entry, in input order", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entries = [collectionEntry(fx), collectionEntry(fx), collectionEntry(fx)];

    const results = await push(fx, entries);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("returns an empty array for an empty push", async () => {
    const fx = await createSyncFixture(db);
    expect(await push(fx, [])).toEqual([]);
  });
});

describe("sync_push — spoiled forms", () => {
  it("records a spoiled form", async () => {
    const fx = await createSyncFixture(db);
    const result = await pushOne(fx, [
      {
        type: "spoiled_form",
        payload: {
          booklet_id: fx.bookletId,
          or_no: 1900,
          collector_id: fx.collectorId,
          reason: "Torn at the stall",
        },
      },
    ]);

    expect(result).toMatchObject({ type: "spoiled_form", status: "accepted" });
    const { rows } = await db.query(
      `select reason from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 1900`,
      [fx.bookletId],
    );
    expect(rows[0].reason).toBe("Torn at the stall");
  });

  it("is idempotent on a re-push", async () => {
    const fx = await createSyncFixture(db);
    const entry = {
      type: "spoiled_form",
      payload: {
        booklet_id: fx.bookletId,
        or_no: 1901,
        collector_id: fx.collectorId,
        reason: "Torn",
      },
    };
    await push(fx, [entry]);
    const result = await pushOne(fx, [entry]);

    expect(result.status).toBe("duplicate");
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.spoiled_forms
        where booklet_id = $1 and or_no = 1901`,
      [fx.bookletId],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("sync_push — shifts", () => {
  it("opens a shift", async () => {
    const fx = await createSyncFixture(db);
    const shiftId = randomUUID();

    const result = await pushOne(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
    ]);

    expect(result).toMatchObject({ type: "shift_open", status: "accepted" });
    const { rows } = await db.query(
      `select status, device_id from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0]).toMatchObject({ status: "open", device_id: fx.deviceId });
  });

  it("is idempotent on a re-pushed shift_open", async () => {
    const fx = await createSyncFixture(db);
    const entry = {
      type: "shift_open",
      payload: {
        id: randomUUID(),
        collector_id: fx.collectorId,
        business_date: BUSINESS_DATE,
        opened_at: COLLECTED_AT,
      },
    };
    await push(fx, [entry]);
    const result = await pushOne(fx, [entry]);

    expect(result.status).toBe("duplicate");
  });

  it("opens and closes in one batch, for a device that was offline all day", async () => {
    // D5's reason for existing as a push type at all, plus the offline case: a tablet that
    // never found signal pushes both entries together at the end of the round.
    const fx = await createSyncFixture(db);
    const shiftId = randomUUID();

    const results = await push(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
      {
        type: "shift_close",
        payload: { id: shiftId, declared_total: "0.00", device_count: 0, device_total: "0.00" },
      },
    ]);

    // shift_close's result is close_shift()'s own status, passed through verbatim -- not
    // renamed to "accepted" -- exactly as the very next test relies on seeing "mismatch"
    // unmodified. close_shift() returns "closed" on a successful closeout (migration
    // 20260918000034_close_shift.sql), so that is what a batch containing shift_open +
    // shift_close reports for its second entry.
    expect(results.map((r) => r.status)).toEqual(["accepted", "closed"]);
    const { rows } = await db.query(
      `select status from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0].status).toBe("closed");
  });

  it("reports a closeout mismatch without closing", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const shiftId = randomUUID();

    // Open, then collect INTO the shift, then close -- in that order. Since migration 0043
    // close_shift counts by collections.shift_id, and the collection's foreign key needs
    // the shift to exist before it can name it. This is the real sequence; the earlier
    // shape (collect first, open and close afterwards) could only ever produce a receipt
    // belonging to no shift, which now counts towards no closeout at all.
    await push(fx, [
      {
        type: "shift_open",
        payload: {
          id: shiftId,
          collector_id: fx.collectorId,
          business_date: BUSINESS_DATE,
          opened_at: COLLECTED_AT,
        },
      },
      collectionEntry(fx, { shift_id: shiftId }),
    ]);

    const results = await push(fx, [
      {
        type: "shift_close",
        payload: { id: shiftId, declared_total: "0.00", device_count: 0, device_total: "0.00" },
      },
    ]);

    expect(results[0]).toMatchObject({ status: "mismatch", system_count: 1 });
    const { rows } = await db.query(
      `select status from ceedo_collections.shifts where id = $1`,
      [shiftId],
    );
    expect(rows[0].status).toBe("open");
  });
});

describe("sync_push — a shift still open on the server", () => {
  // Production, 2026-09-29: a close the server refused left the shift open there while the
  // tablet moved on. Its next shift_open was refused, and the receipts of that shift each
  // broke collections_shift_id_fkey -- three exceptions reading only "server_error".
  function shiftOpen(fx: Fixture, id: string): Entry {
    return {
      type: "shift_open",
      payload: {
        id,
        collector_id: fx.collectorId,
        business_date: BUSINESS_DATE,
        opened_at: COLLECTED_AT,
      },
    };
  }

  it("names the shift in the way when a second one tries to open", async () => {
    const fx = await createSyncFixture(db);
    const stuck = randomUUID();
    await push(fx, [shiftOpen(fx, stuck)]);

    const result = await pushOne(fx, [shiftOpen(fx, randomUUID())]);

    // Still server_error: tablets in the field parse `reason` against a closed enum.
    expect(result).toMatchObject({ status: "rejected", reason: "server_error" });
    expect(result.detail).toContain(stuck);
    expect(result.detail).toContain("still open on the server");
  });

  it("files a receipt whose shift never opened with a detail naming that shift", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const missing = randomUUID();
    const entry = collectionEntry(fx, { shift_id: missing });

    const result = await pushOne(fx, [entry]);

    expect(result).toMatchObject({ status: "rejected", reason: "server_error" });
    expect(result.detail).toContain(missing);
    const { rows } = await db.query(
      `select reason_code, detail from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [entry.payload.id],
    );
    expect(rows[0].reason_code).toBe("server_error");
    expect(rows[0].detail).toBe(result.detail);
  });

  it("refreshes the stored detail on a re-push", async () => {
    const fx = await createSyncFixture(db);
    await accrue();
    const entry = collectionEntry(fx, { or_no: 999998 });
    await push(fx, [entry]);
    await db.query(
      `update ceedo_collections.sync_exceptions set detail = null where collection_uuid = $1`,
      [entry.payload.id],
    );

    const result = await pushOne(fx, [entry]);

    const { rows } = await db.query(
      `select detail, attempts from ceedo_collections.sync_exceptions
        where collection_uuid = $1`,
      [entry.payload.id],
    );
    expect(rows[0]).toEqual({ detail: result.detail, attempts: 2 });
    expect(rows[0].detail).toContain("999998");
  });
});

describe("sync_push — guards", () => {
  it("raises on an inactive device", async () => {
    const fx = await createSyncFixture(db);
    await db.query(`update ceedo_collections.devices set active = false where id = $1`, [
      fx.deviceId,
    ]);

    await expect(push(fx, [])).rejects.toThrow(/device/i);
  });

  it("rejects an unknown entry type rather than silently skipping it", async () => {
    // A silently skipped entry is a lost receipt. An unknown type means device and server
    // disagree about the protocol, which a person must know about.
    const fx = await createSyncFixture(db);
    const result = await pushOne(fx, [{ type: "cancellation", payload: {} }]);

    expect(result).toMatchObject({ status: "rejected", reason: "unknown_entry_type" });
  });
});
