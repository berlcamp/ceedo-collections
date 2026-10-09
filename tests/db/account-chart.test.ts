import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { POSTGRES_URL, createAppUser, uniqueCode, type TestClient } from "../helpers/supabase";
import { accountId, createAccount, createRule } from "../helpers/accounts";

let db: Client;
let admin: TestClient;
let supervisor: TestClient;

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin } = await createAppUser({ email: "chart-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "chart-supervisor", role: "supervisor" }));
});
afterAll(async () => db.end());

async function feeType(): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.fee_types (code, name, facility_type) values ($1, $1, 'market') returning id`,
    [uniqueCode("FT")],
  );
  return rows[0].id as string;
}

async function facility(): Promise<string> {
  const code = uniqueCode("CHF");
  const { rows } = await db.query(
    `insert into ceedo_collections.facilities (code, name, type) values ($1, $1, 'market') returning id`,
    [code],
  );
  return rows[0].id as string;
}

describe("built-ins", () => {
  it("installs UNCLASSIFIED on the Other collections line and column", async () => {
    const { rows } = await db.query(
      `select t.code as tl, r.code as rc from ceedo_collections.collection_accounts a
         join ceedo_collections.treasurer_lines t on t.id = a.treasurer_line_id
         join ceedo_collections.rcd_columns r on r.id = a.rcd_column_id
        where a.code = 'UNCLASSIFIED'`,
    );
    expect(rows).toEqual([{ tl: "TL_OTHER", rc: "RC_OTHER" }]);
  });

  it("refuses to delete or recode UNCLASSIFIED", async () => {
    await expect(db.query(`delete from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED'`))
      .rejects.toThrow(/built-in/);
    await expect(db.query(`update ceedo_collections.collection_accounts set code = 'X' where code = 'UNCLASSIFIED'`))
      .rejects.toThrow(/built-in/);
  });
});

describe("rule constraints", () => {
  it("refuses shares that do not sum to 10000", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await expect(createRule(db, { feeTypeId: ft, shares: [[a, 9000]] })).rejects.toThrow(/add up to 100%/);
  });

  it("refuses overlapping rule sets for the same key, but allows a later one after an end", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await createRule(db, { feeTypeId: ft, to: "2026-10-31", shares: [[a, 10000]] });
    await expect(createRule(db, { feeTypeId: ft, from: "2026-10-15", shares: [[a, 10000]] }))
      .rejects.toThrow(/account_rules_no_overlap/);
    await expect(createRule(db, { feeTypeId: ft, from: "2026-11-01", shares: [[a, 10000]] })).resolves.toBeTruthy();
  });

  it("treats a different rate class as a different key", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await createRule(db, { feeTypeId: ft, shares: [[a, 10000]] });
    await expect(createRule(db, { feeTypeId: ft, rateClass: "ASMO", shares: [[a, 10000]] })).resolves.toBeTruthy();
  });

  it("treats a different facility as a different key", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await createRule(db, { feeTypeId: ft, shares: [[a, 10000]] });
    await expect(createRule(db, { feeTypeId: ft, facilityId: await facility(), shares: [[a, 10000]] }))
      .resolves.toBeTruthy();
  });

  it("refuses an empty rate class (null means any class)", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await expect(createRule(db, { feeTypeId: ft, rateClass: "", shares: [[a, 10000]] })).rejects.toThrow(/rate_class/);
  });
});

describe("replace_account_rule", () => {
  const call = (client: TestClient, ft: string, from: string, shares: { account_id: string; share_bps: number }[]) =>
    client.rpc("replace_account_rule", {
      p_fee_type_id: ft, p_facility_id: null, p_section_id: null, p_rate_class: null,
      p_portion: "base", p_effective_from: from, p_shares: shares,
    });

  it("refuses anyone but an admin", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const { error } = await call(supervisor, ft, "2026-10-01", [{ account_id: a, share_bps: 10000 }]);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("ends the current set the day before and starts the new one", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const b = await createAccount(db);
    const first = await call(admin, ft, "2026-10-01", [{ account_id: a, share_bps: 10000 }]);
    expect(first.error).toBeNull();
    const second = await call(admin, ft, "2026-11-01", [{ account_id: a, share_bps: 7500 }, { account_id: b, share_bps: 2500 }]);
    expect(second.error).toBeNull();
    const { rows } = await db.query(
      `select effective_from::text f, effective_to::text t from ceedo_collections.account_rules
        where fee_type_id = $1 order by effective_from`,
      [ft],
    );
    expect(rows).toEqual([{ f: "2026-10-01", t: "2026-10-31" }, { f: "2026-11-01", t: null }]);
  });

  it("never rewrites: a start on or before the current set's start is refused", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    await call(admin, ft, "2026-10-10", [{ account_id: a, share_bps: 10000 }]);
    const { error } = await call(admin, ft, "2026-10-10", [{ account_id: a, share_bps: 10000 }]);
    expect(error?.message).toMatch(/already starts on/);
  });

  it("says so in words when the shares do not add up", async () => {
    const ft = await feeType();
    const a = await createAccount(db);
    const { error } = await call(admin, ft, "2026-10-01", [{ account_id: a, share_bps: 5000 }]);
    expect(error?.message).toMatch(/add up to 100%/);
  });

  it("is readable by back office, not writable directly", async () => {
    const { error: readError } = await supervisor.from("account_rules").select("id").limit(1);
    expect(readError).toBeNull();
    const { error } = await admin.from("account_rule_shares").insert({
      rule_id: "00000000-0000-0000-0000-000000000000",
      account_id: await accountId(db, "UNCLASSIFIED"),
      share_bps: 10000,
    });
    expect(error?.message).toMatch(/permission denied/);
  });
});
