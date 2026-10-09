// apps/web/lib/accounts/schemas.ts
import { z } from "zod";

/** Kept apart from the "use server" actions so they can be unit-tested (same reason as lib/recovery/schemas.ts). */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const ruleSchema = z.object({
  feeTypeId: z.guid("Choose the fee"),
  facilityId: z.preprocess(blankToNull, z.guid().nullable()),
  sectionId: z.preprocess(blankToNull, z.guid().nullable()),
  rateClass: z.preprocess(blankToNull, z.string().trim().nullable()),
  portion: z.enum(["base", "surcharge"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date"),
});

/** Percent strings (two decimals) to basis points. Throws a sentence when they are not whole. */
export function sharesToBps(rows: { accountId: string; percent: string }[]): { account_id: string; share_bps: number }[] {
  const shares = rows
    .filter((r) => r.accountId)
    .map((r) => ({ account_id: r.accountId, share_bps: Math.round(Number(r.percent) * 100) }));
  if (shares.length === 0) throw new Error("Add at least one account");
  if (shares.some((s) => !Number.isFinite(s.share_bps) || s.share_bps < 1)) throw new Error("Every share must be more than 0%");
  if (new Set(shares.map((s) => s.account_id)).size !== shares.length) throw new Error("Name each account once");
  const total = shares.reduce((a, s) => a + s.share_bps, 0);
  if (total !== 10000) throw new Error(`The shares must add up to 100% (they add up to ${(total / 100).toFixed(2)}%)`);
  return shares;
}
