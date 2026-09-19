import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase.js";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/**
 * run_surcharge's month-overdue predicate, with a literal standing in for the function's
 * `v_date`. The date is arbitrary and in the future; what is being asked is whether the
 * planner can turn this shape of expression into a range seek, not how many rows come back.
 *
 * Deliberately NOT the full run_surcharge query. On a freshly reset database `charges` is
 * nearly empty, and on an empty table the planner's choice between the two indexes on
 * `charges` is decided by rounding rather than by anything this test means to assert. A
 * test that flips with the row count is the kind Phase 3a learned to stop writing. Scoped
 * to `charges` alone, exactly one index can produce an Index Cond for this predicate, so
 * the assertion means one thing.
 *
 * The cost measurement -- the full query, at volume, with the planner unforced -- is the
 * harness's job: scripts/surcharge-scan-measure.sql and
 * docs/superpowers/measurements/2026-09-19-surcharge-scan.md.
 */
const SEEK_PROBE = `
  select id from ceedo_collections.charges
  where charge_type <> 'surcharge'
    and '2027-06-01'::date > (due_date + interval '1 month')::date
`;

async function explain(sql: string): Promise<string> {
  await db.query("begin");
  try {
    // SET LOCAL, so this dies with the transaction. Turning the sequential scan off asks a
    // different question from the one the measurement asked: not "does the planner pick
    // this index on a real ledger" -- that was measured once, at volume, and recorded --
    // but "is this predicate still seekable at all". The second question is the one that
    // has an answer on an empty table, and it is the one that catches an expression that
    // has quietly stopped matching.
    await db.query("set local enable_seqscan = off");
    const { rows } = await db.query(`explain (costs off) ${sql}`);
    return rows.map((r) => r["QUERY PLAN"] as string).join("\n");
  } finally {
    await db.query("rollback");
  }
}

describe("charges_surcharge_due_idx", () => {
  it("exists, over the expression run_surcharge actually tests", async () => {
    const { rows } = await db.query(
      "select indexdef from pg_indexes" +
        " where schemaname = 'ceedo_collections' and indexname = 'charges_surcharge_due_idx'",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("((due_date + '1 mon'::interval))::date");
    expect(rows[0].indexdef).toContain("charge_type <> 'surcharge'");
  });

  it("serves the month-overdue predicate as an Index Cond, not a Filter", async () => {
    const plan = await explain(SEEK_PROBE);

    expect(plan).toContain("charges_surcharge_due_idx");

    const indexConds = plan.split("\n").filter((line) => line.includes("Index Cond:"));
    expect(indexConds.join("\n")).toContain("due_date");

    // The failure this whole test exists for: the planner picks the index and then filters
    // on the date anyway, which is what the design probe saw and what §3 gated against.
    const filters = plan.split("\n").filter((line) => line.includes("Filter:"));
    expect(filters.join("\n")).not.toContain("1 mon");
  });
});
