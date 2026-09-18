import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createCollectionFixture,
  postCollectionAsOwner,
  resetCutover,
} from "../helpers/supabase";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  // Ruling 15: every file that touches `settings` puts it back. This one only reads the
  // seeded cutover, but it calls resetCutover() at both ends so a future edit that starts
  // moving the cutover cannot leave the singleton holding a foreign value for whatever
  // file vitest runs next.
  await resetCutover(db);
  await db.end();
});

/**
 * Serials for this scenario's three receipts.
 *
 * The fixture booklet runs 1000-1999 (FIXTURE_BOOKLET_START_NO/END_NO) and
 * `postCollectionAsOwner` draws its own default serials from a counter based at 1500, so
 * this block sits in the low half where that counter never reaches. Numbers outside the
 * booklet range are not a loud failure -- post_collection returns `or_out_of_range`, a
 * perfectly valid rejection -- so a scenario using out-of-range serials would fail on a
 * rejection that has nothing to do with what it is testing. (`assertOrNoInFixtureRange`
 * inside the helper now turns that into an explanatory throw, but the numbers still have
 * to be right.)
 */
const OR_OPENING_BALANCE = 1100;
const OR_TWO_DAYS = 1101;
const OR_CANCELLED = 1102;

/** Unwraps a supabase-js RPC result, failing here rather than three assertions later. */
async function rpc<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await promise;
  if (error) throw new Error(`RPC failed: ${error.message}`);
  return data;
}

/**
 * A market month, driven end to end through the engine.
 *
 * Phase 2 ships no screen that posts a payment -- collections arrive only from the tablet,
 * which is Phase 3 -- so this test is what demonstrates the ledger is correct. Every
 * assertion at the end cross-checks two surfaces that compute the same figure by different
 * routes: if the aging total and the lease balance ever disagree, one of them is lying and
 * this is where that becomes visible.
 *
 * What it does NOT do is set up a private world. `run_accrual` and `run_surcharge` are
 * nightly jobs with no lease filter, so they walk every active lease in the database,
 * including the ones earlier test files left behind. That is the production behaviour and
 * the test uses it unchanged (Ruling 17); the assertions are all scoped to this
 * scenario's own two leases, and the cost of the system-wide scans is why this test
 * carries an explicit timeout well above vitest's 5s default.
 */
describe("a market month", () => {
  it(
    "keeps every surface agreeing on the same figures",
    async () => {
      // The seeded cutover is already 2026-10-01 and every date below is chosen against
      // it. Upserting rather than delete-then-insert: `settings_singleton` is a unique
      // index on the constant expression (true), so a plain insert collides whenever a row
      // exists -- which is what made the root `pnpm test` run red before Ruling 23.
      await resetCutover(db);

      // NOTE: the brief for this task also carried
      //   update fee_types set surcharge_bps = 300 where code = 'market_rental'
      // It is deleted, not retargeted (Ruling 14). No fee type has that code -- the seed
      // ships MKT_DAILY / MKT_WEEKLY / MKT_MONTHLY, all with accrues = true and
      // surcharge_bps = 300 -- so the statement matched zero rows and raised nothing. The
      // test would then expect surcharges, get none, and fail for a reason that looks
      // nothing like its cause.
      const daily = await createCollectionFixture(db, {
        accrualPeriod: "daily",
        startDate: "2026-10-01",
        rateAmount: "50.00",
      });
      const monthly = await createCollectionFixture(db, {
        accrualPeriod: "monthly",
        startDate: "2026-10-01",
        dueDay: 5,
        rateAmount: "1500.00",
      });

      // An opening balance on the daily stall: two years of paper arrears.
      const { client: admin } = await createAppUser({
        email: "ledger-scenario-admin@example.com",
        role: "admin",
      });
      await rpc(
        admin.rpc("record_opening_balance", {
          p_lease_id: daily.leaseId,
          p_amount: 9000.0,
          p_oldest_unpaid_date: "2024-09-01",
          p_authority_ref: "Reconciled paper ledger 2026-09-30",
        }),
      );

      // Accrue a month, then let it fall far enough past due to surcharge.
      //   daily:   31 rentals of 50.00, due on their own dates 2026-10-01..10-31
      //   monthly:  1 rental of 1500.00 for October, due on the lease's due_day, 10-05
      // Every one of those due dates is more than a calendar month before 2026-12-15, so
      // run_surcharge raises 3% against each: 1.50 per daily rental, 45.00 on the monthly.
      // The opening balance is charge_type 'opening_balance' and is never surcharged.
      await db.query("select ceedo_collections.run_accrual('2026-10-31')");
      await db.query("select ceedo_collections.run_surcharge('2026-12-15')");

      // FIFO must offer the opening balance first, ahead of every accrued day. Its
      // due_date is the real oldest-unpaid date from the paper record, which is what puts
      // it there -- ordering by created_at would put it last and let a tenant settle this
      // month's rent while two years of arrears sat untouched.
      const { rows: groups } = await db.query(
        `select group_rank, due_date::text as due_date, outstanding
           from ceedo_collections.unpaid_period_groups($1)`,
        [daily.leaseId],
      );
      // ::text in SQL, never Date#toISOString() -- that round-trip was observed shifting a
      // calendar day back on this machine (Ruling 9), silently, in three assertions.
      expect(groups[0].due_date).toBe("2024-09-01");
      expect(Number(groups[0].outstanding)).toBe(9000);
      // Each accrued day groups its rental with its own surcharge: 50.00 + 1.50.
      expect(Number(groups[1].outstanding)).toBe(51.5);

      // Settle the opening balance, then two days. The ranks are re-read by
      // post_collection on every call, so [1] here is the opening balance and [1, 2] on
      // the next call is 2026-10-01 and 2026-10-02.
      await postCollectionAsOwner(db, daily, { groupRanks: [1], orNo: OR_OPENING_BALANCE });
      await postCollectionAsOwner(db, daily, { groupRanks: [1, 2], orNo: OR_TWO_DAYS });

      // One receipt is cancelled.
      const voided = await postCollectionAsOwner(db, daily, {
        groupRanks: [1],
        orNo: OR_CANCELLED,
      });
      await rpc(
        admin.rpc("cancel_collection", {
          p_collection_id: voided,
          p_reason: "Recorded against the wrong stall",
        }),
      );

      // One charge on the monthly lease is condoned under an ordinance.
      const { rows: monthlyCharges } = await db.query(
        `select id, amount::text as amount from ceedo_collections.charges
          where lease_id = $1 and charge_type = 'rental' limit 1`,
        [monthly.leaseId],
      );
      await rpc(
        admin.rpc("condone_charge", {
          p_charge_id: monthlyCharges[0].id,
          p_amount: Number(monthlyCharges[0].amount),
          p_authority_ref: "Ordinance 2026-114",
          p_reason: "Typhoon amnesty",
        }),
      );

      // --- The arithmetic, stated once, before anything cross-checks it. ---
      //
      // daily lease
      //   charged      9000.00 opening + 31 x 50.00 rental + 31 x 1.50 surcharge = 10596.50
      //   collected    9000.00 (OR 1100) + 103.00 (OR 1101, two days at 51.50)   =  9103.00
      //   cancelled      51.50 (OR 1102) -- stops counting entirely
      //   outstanding                                                            =  1493.50
      //
      // monthly lease
      //   charged      1500.00 rental + 45.00 surcharge = 1545.00
      //   condoned     1500.00 (the rental, in full)
      //   outstanding    45.00 -- a penalty survives the amnesty on its parent, because
      //                  the ordinance was applied to the rental charge alone
      const { rows: dailyTotal } = await db.query(
        `select coalesce(sum(outstanding), 0)::text as outstanding
           from ceedo_collections.charge_balances
          where lease_id = $1 and not is_settled`,
        [daily.leaseId],
      );
      expect(Number(dailyTotal[0].outstanding)).toBe(1493.5);

      // --- Now every surface must agree. ---

      for (const leaseId of [daily.leaseId, monthly.leaseId]) {
        const { rows: agreement } = await db.query(
          `select
             (select coalesce(sum(outstanding), 0) from ceedo_collections.charge_balances
               where lease_id = $1 and not is_settled)          as from_charges,
             (select coalesce(outstanding, 0) from ceedo_collections.lease_balances
               where lease_id = $1)                             as from_lease_balances,
             (select coalesce(total, 0) from ceedo_collections.aging_of_receivables
               where lease_id = $1)                             as from_aging,
             (select coalesce(sum(outstanding), 0)
                from ceedo_collections.unpaid_period_groups($1)) as from_fifo`,
          [leaseId],
        );
        const a = agreement[0];
        expect(Number(a.from_lease_balances)).toBe(Number(a.from_charges));
        expect(Number(a.from_aging)).toBe(Number(a.from_charges));
        expect(Number(a.from_fifo)).toBe(Number(a.from_charges));

        // The subsidiary ledger's closing running balance must equal the outstanding
        // figure. It reaches it by a completely different route: a cumulative sum of every
        // debit and credit ever recorded against the lease, rather than a per-charge
        // netting. The two can only agree if cancellation, allocation, condonation and the
        // running-balance window all treat the same rows the same way.
        //
        // This runs for BOTH leases, not just the daily one. Design §8 asked for exactly
        // that -- "condone one charge; then assert that charge_balances, the subsidiary
        // ledger, aging and delinquency all agree" -- and checking only the daily lease
        // left the condoned monthly lease unchecked against this view, which is where the
        // missing condonation branch hid: lease_balances read 45.00 while the ledger closed
        // at 1545.00, and /ledger/leases/[id] prints both.
        const { rows: ledger } = await db.query(
          `select running_balance from ceedo_collections.subsidiary_ledger
            where lease_id = $1 order by entry_date, entry_type, source_id`,
          [leaseId],
        );
        expect(Number(ledger[ledger.length - 1].running_balance)).toBe(
          Number(a.from_lease_balances),
        );
      }

      // Stated as an absolute figure as well as an agreement, so a bug that moved BOTH
      // surfaces the same way could not pass the loop above unnoticed. The monthly lease
      // charged 1500.00 rental + 45.00 surcharge and had the rental condoned in full; the
      // penalty survives the amnesty, because the ordinance was applied to the rental alone.
      const { rows: monthlyLedger } = await db.query(
        `select entry_type, detail, debit, credit, running_balance
           from ceedo_collections.subsidiary_ledger
          where lease_id = $1 order by entry_date, entry_type, source_id`,
        [monthly.leaseId],
      );
      const condonationRow = monthlyLedger.find((r: any) => r.entry_type === "condonation");
      expect(condonationRow).toBeDefined();
      expect(condonationRow.detail).toBe("Ordinance 2026-114");
      expect(Number(condonationRow.debit)).toBe(0);
      expect(Number(condonationRow.credit)).toBe(1500);
      expect(Number(monthlyLedger[monthlyLedger.length - 1].running_balance)).toBe(45);

      // The condoned charge is settled without a single peso having been collected for it.
      const { rows: condoned } = await db.query(
        `select is_settled, allocated, condoned, outstanding
           from ceedo_collections.charge_balances where id = $1`,
        [monthlyCharges[0].id],
      );
      expect(condoned[0].is_settled).toBe(true);
      expect(Number(condoned[0].allocated)).toBe(0);
      expect(Number(condoned[0].condoned)).toBe(1500);
      expect(Number(condoned[0].outstanding)).toBe(0);

      // The cancelled receipt exists, is visibly void, and settled nothing. A voided
      // receipt that simply vanished would be the worse outcome: the paper trail has to
      // show the serial was issued and then cancelled, which is what an auditor looks for.
      const { rows: void_ } = await db.query(
        `select cancelled, credit, or_no from ceedo_collections.subsidiary_ledger
          where source_id = $1`,
        [voided],
      );
      expect(void_[0].cancelled).toBe(true);
      expect(Number(void_[0].credit)).toBe(0);
      expect(void_[0].or_no).toBe(OR_CANCELLED);

      // ...and the day it had settled is unpaid again, back at the head of FIFO.
      const { rows: afterVoid } = await db.query(
        `select group_rank, due_date::text as due_date, outstanding
           from ceedo_collections.unpaid_period_groups($1)`,
        [daily.leaseId],
      );
      expect(afterVoid[0].due_date).toBe("2026-10-03");
      expect(Number(afterVoid[0].outstanding)).toBe(51.5);
    },
    // run_accrual and run_surcharge are unfiltered nightly jobs and this file runs partway
    // through a suite that has already created hundreds of leases, so both scans are far
    // more work than vitest's 5s default allows. Ruling 17 declined to add a lease-scoped
    // test variant of a production function to make a dev-only scenario fit -- that would
    // be changing the system to suit the test -- so the timeout moves instead.
    120_000,
  );
});
