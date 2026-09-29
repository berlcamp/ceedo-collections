"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

/**
 * The three remittance actions. Each RPC checks the role itself and raises a sentence
 * written for the operator, so its message is shown as-is (see lib/ledger/actions.ts for
 * why that is not run through toSaveResult's constraint translation).
 */
function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

const recordSchema = z.object({
  collectorId: z.string().uuid("Choose the collector"),
  depositSlipNo: z.string().trim().min(1, "Enter the deposit slip number"),
  bank: z.string().trim().min(1, "Enter the bank"),
  amount: z.coerce.number().positive("The amount must be more than zero"),
  depositedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the deposit date"),
  shiftIds: z.array(z.guid()).min(1, "Tick the shifts this deposit covers"),
});

export async function recordRemittance(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") {
    return failure("Only a supervisor or administrator may record a deposit.");
  }
  const parsed = recordSchema.safeParse({
    collectorId: formData.get("collectorId"),
    depositSlipNo: formData.get("depositSlipNo"),
    bank: formData.get("bank"),
    amount: formData.get("amount"),
    depositedAt: formData.get("depositedAt"),
    shiftIds: formData.getAll("shiftIds"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("record_remittance", {
    p_collector_id: parsed.data.collectorId,
    p_deposit_slip_no: parsed.data.depositSlipNo,
    p_bank: parsed.data.bank,
    p_amount: parsed.data.amount,
    p_deposited_at: parsed.data.depositedAt,
    p_shift_ids: parsed.data.shiftIds,
  });
  if (error) return failure(error.message);
  revalidatePath("/ledger/remittances");
  return { ok: true, id: data };
}

export async function verifyRemittance(id: string): Promise<SaveResult> {
  await requireStaff();
  const supabase = await getServerClient();
  const { error } = await supabase.rpc("verify_remittance", { p_remittance_id: id });
  if (error) return failure(error.message);
  revalidatePath("/ledger/remittances");
  return { ok: true, id };
}

export async function cancelRemittance(formData: FormData): Promise<SaveResult> {
  await requireStaff();
  const id = String(formData.get("remittanceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, fieldErrors: { reason: "A written reason is required" } };
  const supabase = await getServerClient();
  const { error } = await supabase.rpc("cancel_remittance", {
    p_remittance_id: id,
    p_reason: reason,
  });
  if (error) return failure(error.message);
  revalidatePath("/ledger/remittances");
  return { ok: true, id };
}
