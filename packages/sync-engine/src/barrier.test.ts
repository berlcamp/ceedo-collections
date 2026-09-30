import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { enqueue } from "./outbox";
import { sync } from "./sync";
import type { SqliteDriver, Transport } from "./driver";

/**
 * A TABLET OFFLINE ACROSS A HANDOVER. Production, 2026-09-29: a shift's close was refused
 * while the tablet had already moved on, the server's shift stayed open, and the next
 * shift_open and its receipts were refused behind it. outbox.test.ts covers `pushable`'s
 * barrier; this file covers what sync() does with it.
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
`;

const ALICE = randomUUID();
const BOB = randomUUID();
const SHIFT_1 = randomUUID();
const SHIFT_2 = randomUUID();

type Sent = { type: string; payload: { id: string } };

describe("sync across a shift boundary", () => {
  let db: Database.Database;
  let driver: SqliteDriver;
  let bodies: Sent[][];

  function transport(closeStatus: string): Transport {
    return {
      async post(fn, body) {
        if (fn === "sync-pull") return { status: 200, body: { cursor: 11, epoch: 0 } };
        const entries = (body as { entries: Sent[] }).entries;
        bodies.push(entries);
        return {
          status: 200,
          body: entries.map((entry, index) => ({
            index,
            type: entry.type,
            status: entry.type === "shift_close" ? closeStatus : "accepted",
            ...(closeStatus === "rejected" && entry.type === "shift_close"
              ? { reason: "server_error" }
              : {}),
          })),
        };
      },
    };
  }

  function run(closeStatus: string) {
    return sync({
      driver,
      transport: transport(closeStatus),
      credentialId: "c",
      secret: "s",
      businessDate: "2026-10-05",
    });
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    bodies = [];

    const open = (id: string, collector: string) =>
      enqueue(driver, {
        id,
        type: "shift_open",
        payload: {
          id,
          collector_id: collector,
          business_date: "2026-10-05",
          opened_at: "2026-10-05T00:00:00.000Z",
        },
        collectorId: collector,
      });
    await open(SHIFT_1, ALICE);
    await enqueue(driver, {
      id: `${SHIFT_1}#close`,
      type: "shift_close",
      payload: { id: SHIFT_1, declared_total: "0.00", device_count: 0, device_total: "0.00" },
      collectorId: ALICE,
    });
    await open(SHIFT_2, BOB);
  });

  it("pushes the whole day in one sync when each close is accepted", async () => {
    const outcome = await run("closed");

    expect(bodies.map((b) => b.map((e) => e.type))).toEqual([
      ["shift_open", "shift_close"],
      ["shift_open"],
    ]);
    expect(outcome.pushed).toBe(3);
  });

  it("holds the next shift on the device while the close is refused", async () => {
    await run("rejected");

    expect(bodies.map((b) => b.map((e) => e.payload.id))).toEqual([[SHIFT_1, SHIFT_1]]);
    const held = db.prepare("select state from outbox where id = ?").get(SHIFT_2);
    expect(held).toEqual({ state: "pending" });
  });

  it("asks again next sync, and releases the next shift once the server accepts", async () => {
    await run("rejected");
    bodies = [];

    // Put right on the server: the close now answers already_closed.
    await run("already_closed");

    expect(bodies.map((b) => b.map((e) => e.type))).toEqual([
      ["shift_close"],
      ["shift_open"],
    ]);
  });
});
