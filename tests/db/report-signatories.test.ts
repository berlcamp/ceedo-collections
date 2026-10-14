import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, type TestClient } from "../helpers/supabase";

let db: Client;
let admin: TestClient;
let accounting: TestClient;
let collector: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin } = await createAppUser({ email: "sig-admin", role: "admin" }));
  ({ client: accounting } = await createAppUser({ email: "sig-accounting", role: "accounting" }));
  ({ client: collector } = await createAppUser({ email: "sig-collector", role: "collector" }));
});
afterAll(async () => db.end());

describe("report_signatories", () => {
  it("seeds the Daily Collection Report's two blocks, without names", async () => {
    const { rows } = await db.query(
      `select label, name, title from ceedo_collections.report_signatories
        where report_key = 'daily-collection' order by sort_order`,
    );
    expect(rows).toEqual([
      { label: "Prepared by", name: null, title: null },
      { label: "Noted by", name: null, title: null },
    ]);
  });

  it("is read by back office, not by collectors", async () => {
    const back = await accounting.from("report_signatories").select("label");
    expect(back.error).toBeNull();
    expect((back.data ?? []).length).toBeGreaterThanOrEqual(2);
    const field = await collector.from("report_signatories").select("label");
    expect(field.data ?? []).toEqual([]);
  });

  it("is written by admins only", async () => {
    const denied = await accounting
      .from("report_signatories")
      .update({ name: "Someone" })
      .eq("report_key", "daily-collection")
      .eq("label", "Prepared by")
      .select("id");
    expect(denied.data ?? []).toEqual([]);

    const ok = await admin
      .from("report_signatories")
      .update({ title: "LRCO-I" })
      .eq("report_key", "daily-collection")
      .eq("label", "Prepared by")
      .select("title");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ title: "LRCO-I" }]);
    await db.query(`update ceedo_collections.report_signatories set title = null where label = 'Prepared by'`);
  });

  it("refuses a second block with the same label on the same report", async () => {
    await expect(
      db.query(
        `insert into ceedo_collections.report_signatories (report_key, label, sort_order)
         values ('daily-collection', 'Noted by', 30)`,
      ),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it("indexes collections by business date", async () => {
    const { rows } = await db.query(
      `select 1 from pg_indexes where schemaname = 'ceedo_collections'
          and indexname = 'collections_business_date_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("is kept by clear_all_data", async () => {
    const { rows } = await db.query(
      `select pg_get_functiondef('ceedo_collections.clear_all_data()'::regprocedure) as def`,
    );
    expect(rows[0].def).toMatch(/'report_signatories'/);
  });
});
