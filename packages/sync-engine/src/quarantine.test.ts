import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { enqueue, pushable } from "./outbox";
import { sync } from "./sync";
import type { SqliteDriver, Transport } from "./driver";

/**
 * ONE MALFORMED ENTRY MUST NOT KILL THE ROUND. Found on the tablet, not in a test.
 *
 * Task 10's engine probe left `{ id: "probe-entry", type: "spoiled_form",
 * payload: { reason: "probe" } }` in the real outbox. Task 5 then put contract validation
 * in front of the Edge Functions, and `SpoiledFormPayload` requires booklet_id, or_no and
 * collector_id. So the first enrollment sync pushed that entry, the Function answered
 * `400 invalid_body` for the WHOLE body, and the sync threw.
 *
 * The consequence is not one lost entry, it is a permanent deadlock. The entries stay
 * `in_flight`; spec E11 correctly re-pushes them on the next sync; the server correctly
 * refuses the same body again. The device never syncs again, and every receipt taken after
 * that point is stranded behind an entry that can never succeed.
 *
 * This is migration 0039's lesson arriving by a different road. That migration gave each
 * entry its own subtransaction so one permanently-rejectable entry could not cost the
 * round. But the Edge Function's body validation runs BEFORE Postgres, so `sync_push`'s
 * per-entry isolation never gets the chance -- the batch is refused at the door.
 *
 * The fix is on the device, where it belongs: an entry that cannot satisfy the shared
 * contract can never be accepted by a server that validates against that same contract, so
 * it is quarantined locally rather than retried forever. It is marked `rejected` and KEPT
 * (parent §6.3 -- a rejection never means discard the record), and the rest of the round
 * goes.
 */
const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch, last_full_sync_date)
    values (1, 10, 0, '2026-10-05');
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
  create table pin_attempts (
    collector_id text primary key, failures integer not null default 0, locked_at text
  );
`;

// Real UUIDs, minted rather than typed. `uuid` in the wire contract is zod's, which checks
// the version and variant nibbles -- a hand-written "1111...-4444-..." looks like a UUID and
// is not one, and a fixture that fails validation for that reason would make this whole file
// pass for the wrong cause.
const COLLECTOR = randomUUID();
const BOOKLET = randomUUID();

/** A `spoiled_form` payload that satisfies SpoiledFormPayload. */
function goodSpoiledForm(orNo: number) {
  return {
    booklet_id: BOOKLET,
    or_no: orNo,
    collector_id: COLLECTOR,
    reason: "Torn during a rainy round.",
  };
}

describe("an entry that can never satisfy the contract", () => {
  let db: Database.Database;
  let driver: SqliteDriver;
  /** Every body the transport was asked to send, so the test can see what was pushed. */
  let pushedBodies: { entries: { type: string; payload: unknown }[] }[];

  const transport: Transport = {
    async post(fn, body) {
      if (fn === "sync-pull") return { status: 200, body: { cursor: 11, epoch: 0 } };
      const typed = body as { entries: { type: string; payload: unknown }[] };
      pushedBodies.push(typed);
      return {
        status: 200,
        body: typed.entries.map((entry, index) => ({
          index,
          type: entry.type,
          status: "accepted",
        })),
      };
    },
  };

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    pushedBodies = [];
  });

  it("is never sent, so the good entries in the same round still go", async () => {
    // The exact entry Task 10's probe wrote onto the real tablet.
    await enqueue(driver, {
      id: "probe-entry",
      type: "spoiled_form",
      payload: { reason: "probe" },
      collectorId: "probe-collector",
    });
    await enqueue(driver, {
      id: "good-1",
      type: "spoiled_form",
      payload: goodSpoiledForm(1500),
      collectorId: COLLECTOR,
    });

    const outcome = await sync({
      driver,
      transport,
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });

    // One entry pushed, and it is the good one. The poison never reached the wire.
    expect(pushedBodies).toHaveLength(1);
    expect(pushedBodies[0]?.entries).toHaveLength(1);
    expect(pushedBodies[0]?.entries[0]?.payload).toMatchObject({ or_no: 1500 });
    expect(outcome.pushed).toBe(1);
  });

  it("is quarantined rather than retried, so the queue drains", async () => {
    await enqueue(driver, {
      id: "probe-entry",
      type: "spoiled_form",
      payload: { reason: "probe" },
      collectorId: "probe-collector",
    });

    await sync({
      driver,
      transport,
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });

    // The whole point: it stops blocking. A second sync has nothing to push.
    expect(await pushable(driver)).toEqual([]);

    const row = db
      .prepare("select state, reason_code, retryable from outbox where id = 'probe-entry'")
      .get();
    expect(row).toEqual({ state: "rejected", reason_code: "invalid_payload", retryable: 0 });
  });

  it("keeps the row, because a rejection never means discard the record", async () => {
    // Parent §6.3. A quarantined entry may be a receipt a vendor is holding. It stops being
    // pushed; it does not stop existing.
    await enqueue(driver, {
      id: "probe-entry",
      type: "spoiled_form",
      payload: { reason: "probe" },
      collectorId: "probe-collector",
    });

    await sync({
      driver,
      transport,
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });

    const row = db
      .prepare("select id, payload, last_result from outbox where id = 'probe-entry'")
      .get() as { id: string; payload: string; last_result: string };
    expect(row.id).toBe("probe-entry");
    // The original payload is untouched, so a person can still see what was queued.
    expect(JSON.parse(row.payload)).toEqual({ reason: "probe" });
    // And the reason names the fields, so "why" does not require a debugger.
    expect(row.last_result).toMatch(/booklet_id/);
  });

  it("does not quarantine a valid entry", async () => {
    // The falsifying case for a quarantine that is too eager. A bug here would silently
    // stop sending real receipts, which is far worse than the deadlock it replaced.
    await enqueue(driver, {
      id: "good-1",
      type: "spoiled_form",
      payload: goodSpoiledForm(1501),
      collectorId: COLLECTOR,
    });

    await sync({
      driver,
      transport,
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });

    const row = db.prepare("select state from outbox where id = 'good-1'").get();
    expect(row).toEqual({ state: "acked" });
  });

  it("still pushes nothing, and does not throw, when EVERY entry is poison", async () => {
    await enqueue(driver, {
      id: "probe-entry",
      type: "spoiled_form",
      payload: { reason: "probe" },
      collectorId: "probe-collector",
    });

    const outcome = await sync({
      driver,
      transport,
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });

    // No push at all, rather than an empty one: a round with nothing valid to say has
    // nothing to say.
    expect(pushedBodies).toHaveLength(0);
    expect(outcome.pushed).toBe(0);
    // And the pull still counted. The device is not held back by its own bad entry.
    expect(outcome.cursor).toBe(11);
  });
});
