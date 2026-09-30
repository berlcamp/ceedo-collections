import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { canSignIn, recordPinFailure, clearPinFailures } from "./signin";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 0, 0);
  create table collectors (
    id text primary key, employee_no text, full_name text, pin_hash text, status text
  );
  create table local_shifts (
    id text primary key, collector_id text, business_date text, opened_at text,
    status text, closed_at text, declared_total text, device_count integer,
    device_total text
  );
  create table pin_attempts (
    collector_id text primary key, failures integer not null default 0, locked_at text
  );
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
`;

describe("canSignIn", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    db.exec(`
      insert into collectors (id, employee_no, full_name, pin_hash, status)
      values ('alice', 'E-1', 'Alice', '$2a$12$abcdefghijklmnopqrstuv', 'active'),
             ('bob',   'E-2', 'Bob',   '$2a$12$abcdefghijklmnopqrstuv', 'active'),
             ('carol', 'E-3', 'Carol', null,                            'active');
    `);
    driver = betterSqliteDriver(db);
  });

  describe("after the server has refused an earlier closeout", () => {
    // Production, 2026-09-29: a shift closed on the tablet but refused by the server stays
    // open THERE, and the next shift on this tablet is refused along with its receipts.
    function closeEntry(state: string, lastResult: unknown): void {
      db.prepare(
        `insert into outbox (id, type, payload, collector_id, created_at, state, last_result, seq)
         values ('s1#close', 'shift_close', '{}', 'bob', '2026-10-05', ?, ?, 1)`,
      ).run(state, JSON.stringify(lastResult));
    }

    it("blocks sign-in on a mismatch", async () => {
      closeEntry("pending", { status: "mismatch" });
      expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "close_refused" });
    });

    it("blocks sign-in on a rejection", async () => {
      closeEntry("rejected", { status: "rejected", reason: "server_error" });
      expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "close_refused" });
    });

    it("does NOT block on a close that simply has not been sent yet", async () => {
      // No signal at closeout is the case closed_unsynced exists for (parent §3).
      db.prepare(
        `insert into outbox (id, type, payload, collector_id, created_at, state, seq)
         values ('s1#close', 'shift_close', '{}', 'bob', '2026-10-05', 'pending', 1)`,
      ).run();
      expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
    });

    it("lets the shift's own collector back in while that shift is still open here", async () => {
      // An ONLINE mismatch or refusal leaves the shift open on the tablet (shift.ts); its
      // collector has to be able to sign back in and retry the closeout.
      db.exec(`insert into local_shifts (id, collector_id, status) values ('s1', 'bob', 'open')`);
      db.prepare(
        `insert into outbox (id, type, payload, collector_id, created_at, state, last_result, seq)
         values ('s1#close', 'shift_close', '{"id":"s1"}', 'bob', '2026-10-05', 'pending', ?, 1)`,
      ).run(JSON.stringify({ status: "mismatch" }));

      expect(await canSignIn(driver, "bob")).toEqual({ ok: true });
      expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "other_shift_open" });
    });

    it("lifts once the close is acked", async () => {
      closeEntry("acked", { status: "closed" });
      expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
    });
  });

  it("permits a synced collector with a PIN and no open shift", async () => {
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });

  it("distinguishes a tablet that HAS synced but is assigned to no facility", async () => {
    /**
     * FOUND ON THE TABLET. An enrolled device that synced cleanly still had an empty
     * `collectors` table, because `sync_pull` scopes collectors by the device's facility
     * assignment and this device had none. Sign-in reported "this tablet has not synced
     * yet" -- a false statement about the one thing the person had just watched succeed,
     * pointing them at the network instead of at the admin screen.
     *
     * An empty collector list has two causes and they need different actions: sync the
     * tablet, or assign it. The device can tell them apart because a sync writes
     * `last_full_sync_date`.
     */
    db.exec("delete from collectors");
    db.exec("update sync_state set last_full_sync_date = '2026-10-05' where id = 1");
    expect(await canSignIn(driver, "alice")).toEqual({
      ok: false,
      reason: "not_assigned",
    });
  });

  it("refuses a device that has never synced, distinguishably", async () => {
    // Collectors reach the device only through the pull. An empty collector list is not
    // "wrong PIN" and must not be reported as one -- at 5am the difference between "your
    // PIN is wrong" and "this tablet was never synced" is the difference between a
    // collector retrying uselessly and one phoning the office.
    db.exec("delete from collectors");
    // last_full_sync_date stays NULL: this device has genuinely never synced.
    expect(await canSignIn(driver, "alice")).toEqual({
      ok: false,
      reason: "never_synced",
    });
  });

  it("refuses a collector with no PIN set, distinguishably", async () => {
    // Phase 3a §6.3 records the real failure this prevents: a supervisor who resets a PIN
    // believing it takes effect immediately has sent a collector out unable to work. A
    // generic "incorrect PIN" makes that undiagnosable in the field.
    expect(await canSignIn(driver, "carol")).toEqual({ ok: false, reason: "no_pin" });
  });

  it("refuses a locked collector", async () => {
    db.exec(
      "insert into pin_attempts (collector_id, failures, locked_at) " +
        "values ('alice', 5, '2026-10-05T09:00:00+08:00')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });
  });

  /**
   * SPEC E10, AND THE DISTINCTION THE WHOLE DECISION RESTS ON.
   *
   * Parent §6.5: "A new collector cannot sign in while the previous collector's shift is
   * still open -- the device requires a closeout first, closed_unsynced if there is no
   * signal."
   *
   * A `closed_unsynced` shift is FINISHED from the collector's point of view and must not
   * block the next person; it is ALSO still pending in the outbox and must still push.
   * Both are true at once only if the gate tests `status = 'open'` specifically. A gate
   * written as `status <> 'closed'` reads as equivalent, is not, and strands the next
   * collector at the sign-in screen with a shift nobody can close because the collector
   * who owned it has gone home.
   */
  it("blocks a different collector while a shift is open", async () => {
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'bob', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({
      ok: false,
      reason: "other_shift_open",
    });
  });

  it("lets the shift's own collector resume it", async () => {
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'alice', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });

  it("does NOT block on a closed_unsynced shift belonging to someone else", async () => {
    // The falsifying case for `status <> 'closed'`. Against that implementation this test
    // fails and every other test in this file still passes.
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'bob', '2026-10-05', '2026-10-05T08:00:00+08:00', 'closed_unsynced')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });
});

describe("the five-attempt lock", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    db.exec(
      "insert into collectors (id, employee_no, full_name, pin_hash, status) " +
        "values ('alice', 'E-1', 'Alice', '$2a$12$abcdefghijklmnopqrstuv', 'active')",
    );
    driver = betterSqliteDriver(db);
  });

  it("locks on the fifth consecutive failure and not the fourth", async () => {
    for (let i = 1; i <= 4; i++) {
      expect(await recordPinFailure(driver, "alice")).toBe(i);
      expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
    }
    expect(await recordPinFailure(driver, "alice")).toBe(5);
    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });
  });

  it("clears the counter on a success", async () => {
    await recordPinFailure(driver, "alice");
    await recordPinFailure(driver, "alice");
    await clearPinFailures(driver, "alice");
    expect(await recordPinFailure(driver, "alice")).toBe(1);
  });

  it("counts per collector, not per device", async () => {
    // A shared tablet: one collector fumbling their PIN must not lock out the next person.
    db.exec(
      "insert into collectors (id, employee_no, full_name, pin_hash, status) " +
        "values ('bob', 'E-2', 'Bob', '$2a$12$abcdefghijklmnopqrstuv', 'active')",
    );
    for (let i = 0; i < 5; i++) await recordPinFailure(driver, "alice");
    expect(await canSignIn(driver, "bob")).toEqual({ ok: true });
  });
});
