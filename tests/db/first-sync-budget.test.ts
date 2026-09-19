import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { authenticatorClient } from "../helpers/authenticator";
import { POSTGRES_URL, createSyncFixture } from "../helpers/supabase";

/**
 * FIRST SYNC IS THE LONGEST QUERY IN THIS SYSTEM, AND IT RUNS UNDER AN 8 SECOND CEILING
 * THAT NO TEST HAS EVER APPLIED.
 *
 * Phase 3a measured the first-sync PAYLOAD at ~634 KiB and said plainly that the case which
 * would stress it -- a long-delinquent stall with full collection and allocation history --
 * was not exercised. It never measured elapsed time at all, because every test connects as
 * `postgres`, where statement_timeout is 0.
 *
 * A first sync that crosses 8s fails on every tablet and passes the entire suite. That is
 * the exact shape of the two bugs that reached the end of Phase 3a.
 *
 * The budget below is HALF the production ceiling, deliberately. A test that only fails at
 * 8s tells you after the tablets are already failing.
 */
const BUDGET_MS = 4000;

describe("sync_pull first-sync budget", () => {
  let app: PgClient;
  let fixtures: PgClient;
  let deviceId: string;

  beforeAll(async () => {
    fixtures = new PgClient({ connectionString: POSTGRES_URL });
    await fixtures.connect();

    // A long-delinquent daily stall: the case Phase 3a named as unmeasured.
    const fx = await createSyncFixture(fixtures, {
      accrualPeriod: "daily",
      startDate: "2024-09-19",
    });
    deviceId = fx.deviceId;

    // The backlog is inserted directly rather than accrued.
    //
    // run_accrual(p_business_date) raises charges for ONE date per call and refuses any
    // date before settings.cutover_date (seeded 2026-10-01), so building four years of
    // daily charges through it would be ~1,460 calls against a guard that rejects most of
    // them. This insert produces the same rows the accrual would have produced, in one
    // statement, which is what a duration measurement needs.
    await fixtures.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, source)
       select $1, $2, 'rental', d::date, d::date, d::date, 100.00, 'accrual'
         from generate_series('2022-09-19'::date, '2026-09-18'::date, '1 day') as d`,
      [fx.leaseId, fx.feeTypeId],
    );

    // AND A LONG PAYMENT HISTORY, which is the half Phase 3a explicitly did NOT measure.
    //
    // §6.1 scopes the charges array to "unpaid, plus paid within 90 days", so settling a
    // charge moves it OUT of `charges` and into `collections` + `collection_allocations`.
    // Measuring only unpaid charges therefore understates the realistic worst case in the
    // exact direction that matters: design §9 flags that collections are now part of the
    // pull, and those rows are wider than charge rows.
    //
    // Settling the oldest 730 of 1,461 charges produces a payload carrying BOTH a
    // two-year unpaid backlog and a two-year payment history -- the shape Phase 3a
    // described and estimated at 1.5-3 MB without ever building it.
    //
    // 730 is also the ceiling the fixture booklet allows: collections_serial_spent_once is
    // UNIQUE (booklet_id, or_no) and createCollectionFixture's booklet runs 1000-1999.
    await fixtures.query(
      `with paid as (
         select id, period_start,
                row_number() over (order by period_start) as n
           from ceedo_collections.charges
          where lease_id = $1
          order by period_start
          limit 730
       ), made as (
         -- collections.id has NO default: it is the device's client-generated UUID, which
         -- is what makes a re-push idempotent. A fixture must supply it.
         insert into ceedo_collections.collections
           (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
            fee_type_id, lease_id, gross_amount)
         select gen_random_uuid(), 999 + paid.n, $2, $3, $4, paid.period_start::timestamptz,
                paid.period_start, $5, $1, 100.00
           from paid
         returning id, or_no
       )
       insert into ceedo_collections.collection_allocations
         (id, collection_id, charge_id, amount)
       select gen_random_uuid(), made.id, paid.id, 100.00
         from made
         join paid on paid.n = made.or_no - 999`,
      [fx.leaseId, fx.bookletId, fx.collectorId, fx.deviceId, fx.feeTypeId],
    );

    app = await authenticatorClient();
  }, 120_000);

  afterAll(async () => {
    // Guarded, because beforeAll builds a substantial fixture and a failure there leaves
    // these undefined. An unguarded teardown then throws its own TypeError and REPLACES
    // the Postgres error that actually explains the failure -- which cost a debugging
    // round trip the first time this fixture was wrong.
    await app?.end();
    await fixtures?.end();
  });

  it("completes a cursor-0 pull inside half the production statement_timeout", async () => {
    const started = Date.now();
    const { rows } = await app.query("select ceedo_collections.sync_pull($1, 0) as payload", [
      deviceId,
    ]);
    const elapsed = Date.now() - started;

    // Prove the pull actually returned a world, so a fast empty answer cannot pass.
    //
    // Both halves are asserted. A fixture that lost its collection history -- or a
    // sync_pull that stopped sending one -- would otherwise leave this measuring the same
    // unpaid-only shape Phase 3a already measured, while claiming to have closed the gap.
    const payload = rows[0].payload as Record<string, unknown[]>;
    expect(Array.isArray(payload.charges)).toBe(true);
    expect(payload.charges.length).toBeGreaterThan(300);
    expect(payload.collections.length).toBeGreaterThan(300);
    expect(payload.collection_allocations.length).toBeGreaterThan(300);

    console.log(
      `first-sync: ${elapsed}ms | ${payload.charges.length} charges, ` +
        `${payload.collections.length} collections, ` +
        `${payload.collection_allocations.length} allocations | ` +
        `${JSON.stringify(payload).length} bytes`,
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 30_000);

  it("is not silently exempt from the ceiling it is being measured against", async () => {
    // If this connection ever stops carrying the timeout, the budget test above becomes
    // decorative. Pin it in the same file that depends on it.
    const { rows } = await app.query("show statement_timeout");
    expect(rows[0].statement_timeout).toBe("8s");
  });
});
