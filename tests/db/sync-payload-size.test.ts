import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createSyncFixture,
  isolateCollectionAreas,
  resetCutover,
} from "../helpers/supabase";

let db: Client;

const BUSINESS_DATE = "2026-10-05";
// ~4 years before BUSINESS_DATE. run_accrual only raises periods from
// greatest(lease_start, cutover) forward (Ruling 11, migration 0014's lease_periods) --
// with the suite's seeded cutover of 2026-10-01 a daily lease going back to 2026-01-01
// would raise only the ~5 days since cutover, nowhere near the ~1,460-charge delinquent
// stall §9 describes. Moving the cutover itself back (and starting the lease no later than
// it) is what actually produces that scale of charge history.
const OLD_CUTOVER = "2022-10-06";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

describe("first-sync payload", () => {
  it("stays under 8 MB for a realistic section", async () => {
    // §6.1 estimates "a few megabytes" but predates collections being in the pull. A
    // delinquent daily stall contributes ~1,460 charge rows AND now its collections too.
    //
    // This is a measurement with an alarm on it, not a behavioural assertion. If it fires,
    // the answer is pagination on the cursor -- which the protocol already permits, because
    // the cursor is resumable -- not trimming what the device needs.
    await db.query(
      `insert into ceedo_collections.settings (cutover_date) values ($1::date)
       on conflict ((true)) do update set cutover_date = excluded.cutover_date`,
      [OLD_CUTOVER],
    );

    // `accrualPeriod: "daily"` matches createLeaseFixture's actual option (verified against
    // tests/helpers/supabase.ts, not assumed). startDate is set at/before OLD_CUTOVER so the
    // cutover, not the lease start, is what bounds how far back charges are raised.
    const fx = await createSyncFixture(db, { accrualPeriod: "daily", startDate: "2022-01-01" });
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);

    const { rows: chargeRows } = await db.query(
      `select count(*)::int as n from ceedo_collections.charges where lease_id = $1`,
      [fx.leaseId],
    );
    const chargeCount = chargeRows[0].n as number;
    // Logged, not just asserted loosely: a future accrual-window regression (e.g. a change
    // to Ruling 11's lease_periods bound) could quietly shrink this fixture to a handful of
    // rows and the byte measurement would still "pass" while no longer measuring anything
    // close to the ~1,460-charge delinquent stall §9 describes. This guard is intentionally
    // loose -- it is not the figure under test -- but it stops that regression from being
    // silent.
    expect(chargeCount).toBeGreaterThan(1000);

    // This fixture's lease only: every tablet pulls every assigned area now.
    const restore = await isolateCollectionAreas(db, fx.collectorId);
    let bytes: number;
    try {
      const { rows } = await db.query(
        `select octet_length(ceedo_collections.sync_pull($1::uuid, 0)::text) as bytes`,
        [fx.deviceId],
      );
      bytes = Number(rows[0].bytes);
    } finally {
      await restore();
    }

    // A fixture with one lease is not a market, and this fixture posts zero collections, so
    // the figure is a LOWER BOUND on a real first-sync payload in two ways at once: one
    // delinquent daily lease rather than a whole section's worth, and none of the
    // collections/allocations a real device's history would also carry. State it as such --
    // see the report for this exact fixture shape alongside the number.
    console.log(
      `first-sync payload (lower bound): ${(bytes / 1024).toFixed(1)} KiB ` +
        `for 1 lease, ${chargeCount} charges, 0 collections`,
    );
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
  });
});
