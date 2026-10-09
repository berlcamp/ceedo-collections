import type { Client as PgClient } from "pg";
import { uniqueCode } from "./supabase";

/** An account on the built-in "Other collections" line and column. */
export async function createAccount(db: PgClient, code = uniqueCode("ACC")): Promise<string> {
  const { rows } = await db.query(
    `insert into ceedo_collections.collection_accounts
       (code, name, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
     select $1, $1, 'Test', 1, 'income', t.id, r.id
       from ceedo_collections.treasurer_lines t, ceedo_collections.rcd_columns r
      where t.code = 'TL_OTHER' and r.code = 'RC_OTHER'
     returning id`,
    [code],
  );
  return rows[0].id as string;
}

export async function accountId(db: PgClient, code: string): Promise<string> {
  const { rows } = await db.query(`select id from ceedo_collections.collection_accounts where code = $1`, [code]);
  if (!rows[0]) throw new Error(`No account ${code}`);
  return rows[0].id as string;
}

/**
 * A rule set inserted as the owner, bypassing replace_account_rule's admin gate. The
 * deferred shares trigger still runs at commit, so the shares must sum to 10000.
 */
export async function createRule(
  db: PgClient,
  r: {
    feeTypeId: string;
    facilityId?: string | null;
    sectionId?: string | null;
    rateClass?: string | null;
    portion?: "base" | "surcharge";
    from?: string;
    to?: string | null;
    shares: [string, number][];
  },
): Promise<string> {
  await db.query("begin");
  try {
    const { rows } = await db.query(
      `insert into ceedo_collections.account_rules
         (fee_type_id, facility_id, section_id, rate_class, portion, effective_from, effective_to)
       values ($1, $2, $3, $4, $5, $6::date, $7::date) returning id`,
      [r.feeTypeId, r.facilityId ?? null, r.sectionId ?? null, r.rateClass ?? null,
       r.portion ?? "base", r.from ?? "2026-10-01", r.to ?? null],
    );
    const id = rows[0].id as string;
    for (const [account, bps] of r.shares) {
      await db.query(
        `insert into ceedo_collections.account_rule_shares (rule_id, account_id, share_bps) values ($1, $2, $3)`,
        [id, account, bps],
      );
    }
    await db.query("commit");
    return id;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
