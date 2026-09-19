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
 * The exact predicate term in run_surcharge's WHERE clause, as the function body spells it.
 *
 * The first test here is not about surcharges at all. It is a drift guard on this string:
 * it fails the moment someone edits the predicate. That matters because the whole reason the
 * rewrite below was rejected is a property of THIS spelling of it — calendar-month addition,
 * in this direction — and an edit that looks cosmetic can silently make the rejection
 * argument stop applying.
 *
 * `scripts/surcharge-scan-measure.sql` and `scripts/surcharge-scan-alternating.sql` also carry
 * a copy of this predicate, and the measurements they produce are only about run_surcharge
 * insofar as all three agree.
 *
 * An expression index over `(due_date + interval '1 month')::date` was briefly shipped
 * (migration 20260919000043) and reverted: its effect is at most ~4% in both the first-night
 * and steady-state regimes, inside run-to-run variance, and a per-node decomposition of an
 * interleaved run found the two nodes it touches both ran SLOWER with it. It obliged a human
 * to keep this literal and the index expression byte-identical forever for no measured
 * return. With that index went the plan test that guarded it, which is why this file is now
 * the only thing pinning the spelling. See
 * `docs/superpowers/measurements/2026-09-19-surcharge-scan.md`.
 */
const PREDICATE = "v_date > (b.due_date + interval '1 month')::date";

/**
 * Every ordered pair of dates in a 16-month window: 486 days, 486 * 486 = 236,196 pairs.
 * The window runs 2026-01-01 .. 2027-05-01 so that it contains every last-day-of-a-short-
 * month due date the two predicates can disagree on.
 */
const DISAGREEMENT_SQL = `
  with window_days as (
    select ('2026-01-01'::date + n) as d from generate_series(0, 485) as n
  ),
  verdicts as (
    select
      due.d as due_date,
      v.d   as v_date,
      -- run_surcharge's predicate, verbatim apart from the variable names.
      (v.d > (due.d + interval '1 month')::date) as original,
      -- The tempting sargable rewrite. Calendar-month arithmetic is not invertible, so
      -- this is not the same question.
      (due.d < (v.d - interval '1 month')::date)  as rewrite
    from window_days due cross join window_days v
  )
  select due_date::text as due_date, v_date::text as v_date, original, rewrite
  from verdicts
  where original is distinct from rewrite
  order by due_date, v_date
`;

/** Spec §5's table, as (due_date, v_date) pairs. */
const EXPECTED_DISAGREEMENTS = [
  ["2026-02-28", "2026-03-29"],
  ["2026-02-28", "2026-03-30"],
  ["2026-02-28", "2026-03-31"],
  ["2026-04-30", "2026-05-31"],
  ["2026-06-30", "2026-07-31"],
  ["2026-09-30", "2026-10-31"],
  ["2026-11-30", "2026-12-31"],
  ["2027-02-28", "2027-03-29"],
  ["2027-02-28", "2027-03-30"],
  ["2027-02-28", "2027-03-31"],
];

describe("run_surcharge's month-overdue predicate", () => {
  it("still reads exactly as the design assumes", async () => {
    const { rows } = await db.query(
      "select pg_get_functiondef(p.oid) as def" +
        "  from pg_proc p" +
        "  join pg_namespace n on n.oid = p.pronamespace" +
        " where n.nspname = 'ceedo_collections' and p.proname = 'run_surcharge'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain(PREDICATE);
  });

  it("is not equivalent to the sargable rewrite, and disagrees on exactly 10 pairs", async () => {
    const { rows } = await db.query(DISAGREEMENT_SQL);

    expect(rows.map((r) => [r.due_date, r.v_date])).toEqual(EXPECTED_DISAGREEMENTS);
  });

  it("disagrees only by the rewrite failing to charge a penalty the rule charges", async () => {
    const { rows } = await db.query(DISAGREEMENT_SQL);

    // Never the other way round. If a disagreement ever appeared with original=false and
    // rewrite=true, the rewrite would be inventing penalties rather than delaying them,
    // and spec §5's "the penalty is applied up to three days late" reading would be wrong.
    expect(rows.map((r) => ({ original: r.original, rewrite: r.rewrite }))).toEqual(
      rows.map(() => ({ original: true, rewrite: false })),
    );
  });

  it("checks the whole 16-month window, not a sample of it", async () => {
    const { rows } = await db.query(
      "select count(*)::int as pairs" +
        "  from generate_series(0, 485) a, generate_series(0, 485) b",
    );

    expect(rows[0].pairs).toBe(236196);
  });
});
