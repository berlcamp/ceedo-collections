// apps/web/lib/accounts/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";
import { ruleSchema, sharesToBps } from "./schemas";

function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

/** replace_account_rule ends the current set the day before and starts this one. */
export async function saveRule(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return failure("Only an administrator may change the account rules.");

  const parsed = ruleSchema.safeParse({
    feeTypeId: formData.get("feeTypeId"),
    facilityId: formData.get("facilityId") ?? "",
    sectionId: formData.get("sectionId") ?? "",
    rateClass: formData.get("rateClass") ?? "",
    portion: formData.get("portion"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  let shares;
  try {
    const ids = formData.getAll("accountId").map(String);
    const percents = formData.getAll("percent").map(String);
    shares = sharesToBps(ids.map((accountId, i) => ({ accountId, percent: percents[i] ?? "" })));
  } catch (e) {
    return { ok: false, fieldErrors: { shares: (e as Error).message } };
  }

  const r = parsed.data;
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("replace_account_rule", {
    p_fee_type_id: r.feeTypeId,
    p_facility_id: r.facilityId as string, // nullable in SQL; the generated type is non-null
    p_section_id: r.sectionId as string,
    p_rate_class: r.rateClass as string,
    p_portion: r.portion,
    p_effective_from: r.effectiveFrom,
    p_shares: shares,
  });
  if (error) return failure(error.message);
  revalidatePath("/accounts/rules");
  revalidatePath("/accounts/unclassified");
  return { ok: true, id: data ?? "" };
}
