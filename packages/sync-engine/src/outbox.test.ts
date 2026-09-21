import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { enqueue, pushable, applyResults, markInFlight, purgeAcked } from "./outbox";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
`;

describe("the outbox", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("preserves insertion order, so a shift_open precedes its collections", async () => {
    /**
     * Migration 20260919000043 made collections.shift_id a foreign key to shifts. A
     * collection pushed before the shift_open that creates its shift fails that key, and
     * the entry is rejected with server_error for a reason that has nothing to do with the
     * receipt.
     */
    await enqueue(driver, { id: "s1", type: "shift_open", payload: {}, collectorId: "c" });
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await enqueue(driver, { id: "r2", type: "collection", payload: {}, collectorId: "c" });

    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["s1", "r1", "r2"]);
  });

  /**
   * SPEC E11. `in_flight` MEANS "SENT, OUTCOME UNKNOWN" -- NOT "SOMEONE ELSE'S PROBLEM".
   *
   * A push whose response is lost leaves entries in this state with a genuinely unknown
   * server outcome: the push may have committed and the ack been dropped. Client-generated
   * UUIDs make a re-push safe by construction -- post_collection answers `duplicate` and
   * the entry settles.
   *
   * An implementation that skips in_flight silently drops exactly the receipts a dropped
   * connection created, which is the one condition guaranteed to occur on a market round.
   */
  it("re-pushes in_flight entries rather than skipping them", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await markInFlight(driver, ["r1"]);

    // Simulates the next sync after a lost response: nothing acked it, so it must come back.
    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
    expect(rows[0]?.state).toBe("in_flight");
  });

  it("does not re-push an acked entry", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      { index: 0, type: "collection", status: "accepted" },
    ]);

    expect(await pushable(driver)).toEqual([]);
  });

  it("settles a duplicate as acked, because the server already has it", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      { index: 0, type: "collection", status: "duplicate" },
    ]);

    const row = db.prepare("select state from outbox where id = 'r1'").get();
    expect(row).toEqual({ state: "acked" });
  });

  it("keeps a retryable rejection pushable and counts the attempt", async () => {
    // stale_allocations is the ONLY retryable reason (invariant 24). The device re-pulls
    // and re-pushes on its own; no supervisor is involved and no exception is filed.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      {
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "stale_allocations",
        retryable: true,
      },
    ]);

    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
    expect(rows[0]?.attempts).toBe(1);
  });

  it("stops re-pushing a retryable rejection after the attempt cap", async () => {
    // An unbounded retry on a reason that keeps recurring is a tablet stuck in a loop with
    // a collector watching it. On exhaustion the entry surfaces like any other unresolved
    // one.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    for (let i = 0; i < 5; i++) {
      await applyResults(driver, await pushable(driver), [
        {
          index: 0,
          type: "collection",
          status: "rejected",
          reason: "stale_allocations",
          retryable: true,
        },
      ]);
    }
    expect(await pushable(driver)).toEqual([]);
    const row = db.prepare("select state, attempts from outbox where id = 'r1'").get();
    expect(row).toEqual({ state: "rejected", attempts: 5 });
  });

  it("keeps a permanent rejection out of the push queue but on the device", async () => {
    // Parent §6.3: "A server rejection must never mean discard the record." The collector
    // has handed a vendor a paper receipt and taken their money; that serial is spent.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      {
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "or_already_used",
        retryable: false,
      },
    ]);

    expect(await pushable(driver)).toEqual([]);
    const row = db
      .prepare("select state, reason_code from outbox where id = 'r1'")
      .get();
    expect(row).toEqual({ state: "rejected", reason_code: "or_already_used" });
  });

  it("carries collector_id on every row and never derives it from a session", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "alice" });
    await enqueue(driver, { id: "r2", type: "collection", payload: {}, collectorId: "bob" });

    const rows = await pushable(driver);
    expect(rows.map((r) => r.collectorId)).toEqual(["alice", "bob"]);
  });
});

describe("retention", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);

    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    const insert = db.prepare(
      `insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
       values (?, 'collection', '{}', 'c', ?, ?, 0, ?)`,
    );
    insert.run("old-acked", old, "acked", 1);
    insert.run("old-rejected", old, "rejected", 2);
    insert.run("old-pending", old, "pending", 3);
    insert.run("new-acked", recent, "acked", 4);
  });

  it("purges only acked entries past the window", async () => {
    expect(await purgeAcked(driver)).toBe(1);
    const left = db
      .prepare("select id from outbox order by seq")
      .all()
      .map((r) => (r as { id: string }).id);
    expect(left).toEqual(["old-rejected", "old-pending", "new-acked"]);
  });

  it("never purges a rejected entry, however old", async () => {
    // It is a paper receipt a vendor is holding and money a collector has taken, waiting on
    // a supervisor. Age is not evidence it stopped mattering.
    await purgeAcked(driver, 1);
    const row = db.prepare("select id from outbox where id = 'old-rejected'").get();
    expect(row).toEqual({ id: "old-rejected" });
  });

  it("never purges a pending entry, however old", async () => {
    await purgeAcked(driver, 1);
    const row = db.prepare("select id from outbox where id = 'old-pending'").get();
    expect(row).toEqual({ id: "old-pending" });
  });
});
