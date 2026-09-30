import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { canSignIn, liftPinLocks, recordPinFailure } from "./signin";
import { sync } from "./sync";
import type { SqliteDriver, Transport } from "./driver";

/**
 * Parent §11.5: "five failed attempts lock the device until it next syncs". Production,
 * 2026-09-30: a collector locked out stayed locked through every sync, because only a
 * correct PIN cleared the count -- and a locked collector cannot enter one.
 *
 * BUT ONLY A SYNC SOMEONE ASKED FOR. The tablet now also syncs on its own every two minutes;
 * if that lifted the lock, five wrong PINs would cost a guesser two minutes of waiting. So
 * sync() leaves the lock alone and the collector app lifts it after a "Sync now" succeeds.
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
  create table collectors (id text primary key, pin_hash text);
  insert into collectors (id, pin_hash) values ('alice', '$2b$10$hash');
  create table local_shifts (
    id text primary key, collector_id text not null, status text not null
  );
  create table pin_attempts (
    collector_id text primary key, failures integer not null default 0, locked_at text
  );
`;

function pulling(status: number): Transport {
  return {
    async post() {
      return { status, body: { cursor: 11, epoch: 0 } };
    },
  };
}

describe("the PIN lock", () => {
  let driver: SqliteDriver;

  beforeEach(async () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
    for (let i = 0; i < 5; i++) await recordPinFailure(driver, "alice");
  });

  const run = (transport: Transport) =>
    sync({ driver, transport, credentialId: "c", secret: "s", businessDate: "2026-10-05" });

  it("holds through a sync on its own, even a successful one", async () => {
    await run(pulling(200));

    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });
  });

  it("is lifted by liftPinLocks", async () => {
    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });

    await liftPinLocks(driver);

    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });
});
