import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { openShift, deviceTotals, closeShift } from "./shift";
import { pushable } from "./outbox";
import type { SqliteDriver, Transport } from "./driver";

const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch, last_full_sync_date)
    values (1, 10, 0, '2026-10-05');
  create table local_shifts (
    id text primary key, collector_id text not null, business_date text not null,
    opened_at text not null, status text not null default 'open', closed_at text,
    declared_total text, device_count integer, device_total text
  );
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
  create table collections (
    id text primary key, shift_id text, gross_amount text, collector_id text
  );
`;

function transportReturning(body: unknown, status = 200): Transport {
  return {
    async post() {
      return { status, body };
    },
  };
}

const OFFLINE: Transport = {
  async post() {
    throw new Error("Network request failed");
  },
};

describe("the shift lifecycle", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  function collect(shiftId: string, id: string, amount: string): void {
    db.prepare(
      "insert into collections (id, shift_id, gross_amount, collector_id) values (?, ?, ?, ?)",
    ).run(id, shiftId, amount, "alice");
  }

  it("queues a shift_open entry when a shift opens", async () => {
    const id = await openShift(driver, {
      collectorId: "alice",
      businessDate: "2026-10-05",
    });
    const rows = await pushable(driver);
    expect(rows.map((r) => r.type)).toEqual(["shift_open"]);
    expect(rows[0]?.id).toBe(id);
  });

  it("sums the device's own collections for that shift", async () => {
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    collect(id, "c1", "150.00");
    collect(id, "c2", "75.50");

    // String arithmetic, not float. 150.00 + 75.50 must be exactly "225.50".
    expect(await deviceTotals(driver, id)).toEqual({ count: 2, total: "225.50" });
  });

  it("counts only this shift's collections, not the whole device's", async () => {
    // The falsifying case for a sum with no WHERE. A second shift's receipts sitting in the
    // same table would otherwise be added to this one's closeout figure, and the collector
    // would be asked to match money that was never in their drawer.
    const mine = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    collect(mine, "c1", "150.00");
    collect("some-other-shift", "c2", "999.00");
    collect(null as unknown as string, "c3", "12.00");

    expect(await deviceTotals(driver, mine)).toEqual({ count: 1, total: "150.00" });
  });

  it("closes with a recorded variance when the cash is short", async () => {
    /**
     * PHASE 3A §5.1, AND CONFLATING THE TWO COMPARISONS WOULD BE A REAL BUG.
     *
     *   device count/sum vs server -> RECORDS missing -> BLOCKS closeout
     *   declared cash vs server    -> the DRAWER short -> RECORDED, never blocks
     *
     * A collector P50 short still closes their shift, with the P50 on the record. Blocking
     * would be worse than useless: it gives a collector who is short a direct incentive to
     * adjust the declaration until it matched.
     */
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    collect(id, "c1", "200.00");

    const outcome = await closeShift(
      driver,
      {
        transport: transportReturning([
          {
            index: 0,
            type: "shift_close",
            status: "closed",
            system_count: 1,
            system_total: 200,
            variance: -50,
          },
        ]),
        credentialId: "c",
        secret: "s",
        businessDate: "2026-10-05",
      },
      { shiftId: id, declaredTotal: "150.00" },
    );

    expect(outcome.status).toBe("closed");
    if (outcome.status === "closed") expect(outcome.variance).toBe("-50.00");
    const row = db
      .prepare("select status, declared_total from local_shifts where id = ?")
      .get(id);
    expect(row).toEqual({ status: "closed", declared_total: "150.00" });
  });

  it("leaves the shift OPEN on a records mismatch", async () => {
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    collect(id, "c1", "200.00");

    const outcome = await closeShift(
      driver,
      {
        transport: transportReturning([
          {
            index: 0,
            type: "shift_close",
            status: "mismatch",
            device_count: 1,
            device_total: 200,
            system_count: 2,
            system_total: 350,
          },
        ]),
        credentialId: "c",
        secret: "s",
        businessDate: "2026-10-05",
      },
      { shiftId: id, declaredTotal: "200.00" },
    );

    expect(outcome.status).toBe("mismatch");
    const row = db.prepare("select status from local_shifts where id = ?").get(id);
    expect(row).toEqual({ status: "open" });
  });

  it("writes closed_unsynced with no signal, and still queues the push", async () => {
    /**
     * Parent §3: "Blocking a collector over bad signal is unworkable." This is the entire
     * reason closed_unsynced exists -- it lets the collector leave and the next one sign in.
     * The shift_close entry stays in the outbox and reconciles whenever the tablet next
     * reaches the network.
     */
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });

    const outcome = await closeShift(
      driver,
      {
        transport: OFFLINE,
        credentialId: "c",
        secret: "s",
        businessDate: "2026-10-05",
      },
      { shiftId: id, declaredTotal: "0.00" },
    );

    expect(outcome.status).toBe("closed_unsynced");
    const row = db.prepare("select status from local_shifts where id = ?").get(id);
    expect(row).toEqual({ status: "closed_unsynced" });

    const queued = await pushable(driver);
    expect(queued.map((r) => r.type)).toContain("shift_close");
  });

  it("queues the shift_close BEFORE the network, so an offline close is already durable", async () => {
    // The ordering is the guarantee. If the entry were queued only after a successful push,
    // the one case it exists for -- no signal -- would be the one case that queues nothing.
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    let queuedAtPostTime: string[] = [];
    const watching: Transport = {
      async post() {
        queuedAtPostTime = (await pushable(driver)).map((r) => r.type);
        throw new Error("Network request failed");
      },
    };

    await closeShift(
      driver,
      { transport: watching, credentialId: "c", secret: "s", businessDate: "2026-10-05" },
      { shiftId: id, declaredTotal: "0.00" },
    );

    expect(queuedAtPostTime).toContain("shift_close");
  });
});
