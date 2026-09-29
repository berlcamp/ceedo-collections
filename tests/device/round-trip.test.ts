import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { betterSqliteDriver } from "@ceedo/sync-engine/testing";
import { enqueue, sync, readSyncState, pushable } from "@ceedo/sync-engine";
import { POSTGRES_URL, createSyncFixture, retireCollectionAreas } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

/**
 * THE ENGINE, OVER REAL HTTP, INTO THE DEPLOYED EDGE FUNCTIONS.
 *
 * This is the layer Phase 3a's postmortem says is worth having: not a mocked transport
 * agreeing with whoever wrote the mock, but the real wire, the real Deno handlers, the real
 * SQL. The only substitution is the SQLite driver, and spec E1 requires Task 10 to close
 * even that with one on-device run.
 */
describe("the device engine, end to end", () => {
  let db: PgClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;
  let sqlite: Database.Database;
  let driver: ReturnType<typeof betterSqliteDriver>;

  const transport = {
    async post(fn: "sync-pull" | "sync-push" | "closeout", body: unknown) {
      return callFunction(fn, body);
    },
  };

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    // Every tablet pulls every active collection area; start this file from its own.
    await retireCollectionAreas(db);
    fx = await createSyncFixture(db);
    // The fixture builds a lease; charges are what `run_accrual` writes from it. Without
    // this the pull is legitimately empty of charges and the assertion below would be
    // measuring an unaccrued ledger rather than a working sync.
    await db.query(`select ceedo_collections.run_accrual($1::date)`, ["2026-10-05"]);

    sqlite = new Database(":memory:");
    // The SAME generated migration the tablet applies, replayed. A hand-written test schema
    // would be a second definition of the device's tables, free to drift from the one that
    // ships. Resolved from this file rather than from cwd, which differs between
    // `pnpm test` at the root and `pnpm --filter @ceedo/tests`.
    const migrations = fileURLToPath(
      new URL("../../packages/db-local/drizzle/", import.meta.url),
    );
    const journal = JSON.parse(
      readFileSync(`${migrations}meta/_journal.json`, "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      sqlite.exec(readFileSync(`${migrations}${entry.tag}.sql`, "utf8"));
    }
    // The device migrations create the sync_state row themselves since 7e4de81.
    driver = betterSqliteDriver(sqlite);
  }, 120_000);

  afterAll(async () => {
    await db.end();
    sqlite.close();
  });

  it("pulls a scoped world, opens a shift, and settles the outbox", async () => {
    const shiftId = randomUUID();
    await enqueue(driver, {
      id: shiftId,
      type: "shift_open",
      payload: {
        id: shiftId,
        collector_id: fx.collectorId,
        business_date: "2026-10-05",
        opened_at: "2026-10-05T08:00:00+08:00",
      },
      collectorId: fx.collectorId,
    });

    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-05",
    });

    expect(outcome.fullResync).toBe(true);
    expect(outcome.pushed).toBe(1);
    expect(outcome.cursor).toBeGreaterThan(0);

    // The world landed.
    const charges = sqlite.prepare("select count(*) as n from charges").get() as { n: number };
    expect(charges.n).toBeGreaterThan(0);

    // The shift settled and is no longer pushable.
    expect(await pushable(driver)).toEqual([]);
    const { rows } = await db.query(
      "select status from ceedo_collections.shifts where id = $1",
      [shiftId],
    );
    expect(rows[0]?.status).toBe("open");
  }, 60_000);

  it("takes a delta on the second sync, not a full re-sync, on the same day", async () => {
    const before = await readSyncState(driver);
    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-05",
    });

    expect(outcome.fullResync).toBe(false);
    expect(outcome.cursor).toBeGreaterThanOrEqual(before.cursor);
  }, 60_000);

  it("takes a full re-sync on a new business date — spec E9", async () => {
    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-06",
    });

    expect(outcome.fullResync).toBe(true);
    expect(outcome.cursor).toBeGreaterThan(0);
  }, 60_000);

  it("discards scoped data but not the outbox when the epoch changes — spec E8", async () => {
    // A queued entry that has NOT yet been pushed, so the assertion below is about survival
    // and not about an empty table trivially staying empty.
    const orphan = randomUUID();
    await enqueue(driver, {
      id: orphan,
      type: "spoiled_form",
      payload: {
        booklet_id: fx.bookletId,
        or_no: 1999,
        collector_id: fx.collectorId,
        reason: "Torn during a rainy round.",
      },
      collectorId: fx.collectorId,
    });

    // Reassign the tablet. The trigger on device_assignments bumps devices.assignment_epoch
    // (migration 20260918000031), which is the entire mechanism behind D7.
    await db.query(
      `update ceedo_collections.device_assignments set active = false where device_id = $1`,
      [fx.deviceId],
    );

    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-06",
    });

    expect(outcome.fullResync).toBe(true);
    const still = sqlite
      .prepare("select count(*) as n from outbox where id = ?")
      .get(orphan) as { n: number };
    expect(still.n).toBe(1);
  }, 60_000);
});
