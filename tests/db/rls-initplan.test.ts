import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase";

// A role gate in a policy must be evaluated once per statement, not once per row:
// has_role / is_admin / is_super_admin carry SET search_path, so Postgres cannot inline
// them, and a bare call runs for every row scanned (24s to count 197k charges locally).
// Wrapped as (select ...), the call becomes an InitPlan. pg_policies prints that as
// "( SELECT ceedo_collections.has_role(...) AS has_role)".
const CALL = /(ceedo_collections\.(?:has_role|is_admin|is_super_admin)|auth\.uid)\(/g;
const WRAPPED = /SELECT (ceedo_collections\.(?:has_role|is_admin|is_super_admin)|auth\.uid)\(/g;
const count = (s: string | null, re: RegExp) => (s ? (s.match(re) ?? []).length : 0);

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
});
afterAll(async () => db.end());

describe("RLS role gates", () => {
  it("are wrapped in (select ...) in every policy", async () => {
    const { rows } = await db.query(
      `select tablename, policyname, qual, with_check from pg_policies where schemaname = 'ceedo_collections'`,
    );
    expect(rows.length).toBeGreaterThan(60);
    const bare = rows
      .filter((p) => count(p.qual, CALL) !== count(p.qual, WRAPPED) || count(p.with_check, CALL) !== count(p.with_check, WRAPPED))
      .map((p) => `${p.tablename}.${p.policyname}`);
    expect(bare).toEqual([]);
  });

  it("are wrapped in the policies apply_master_data_policies creates", async () => {
    await db.query("begin");
    try {
      await db.query(`create table ceedo_collections._initplan_probe (id uuid primary key, row_version bigint not null default 0)`);
      await db.query(`select ceedo_collections.apply_master_data_policies('_initplan_probe')`);
      const { rows } = await db.query(
        `select qual, with_check from pg_policies where schemaname = 'ceedo_collections' and tablename = '_initplan_probe'`,
      );
      expect(rows).toHaveLength(2);
      for (const p of rows) {
        expect(count(p.qual, CALL)).toBe(count(p.qual, WRAPPED));
        expect(count(p.with_check, CALL)).toBe(count(p.with_check, WRAPPED));
      }
    } finally {
      await db.query("rollback");
    }
  });

  it("are wrapped in the policies apply_ledger_policies creates", async () => {
    await db.query("begin");
    try {
      await db.query(`create table ceedo_collections._initplan_ledger_probe (id uuid primary key, row_version bigint not null default 0)`);
      await db.query(`select ceedo_collections.apply_ledger_policies('_initplan_ledger_probe')`);
      const { rows } = await db.query(
        `select qual, with_check from pg_policies where schemaname = 'ceedo_collections' and tablename = '_initplan_ledger_probe'`,
      );
      expect(rows).toHaveLength(1);
      for (const p of rows) {
        expect(count(p.qual, CALL)).toBeGreaterThan(0);
        expect(count(p.qual, CALL)).toBe(count(p.qual, WRAPPED));
        expect(count(p.with_check, CALL)).toBe(count(p.with_check, WRAPPED));
      }
    } finally {
      await db.query("rollback");
    }
  });
});
