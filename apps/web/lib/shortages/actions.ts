"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Record, verify and cancel a shortage repayment. As with remittances, each RPC checks the
 * role itself and raises a sentence written for the operator, shown as-is.
 */
function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

function refresh() {
  revalidatePath("/ledger/shortages");
  revalidatePath("/ledger/shifts");
}

const recordSchema = z.object({
  shiftId: z.guid("Choose the shift"),
  amount: z.coerce.number().positive("The amount must be more than zero"),
  reference: z.string().trim().min(1, "Enter the receipt or deposit slip number"),
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was paid"),
});

export async function recordSettlement(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") {
    return failure("Only a supervisor or administrator may record a shortage payment.");
  }
  const parsed = recordSchema.safeParse({
    shiftId: formData.get("shiftId"),
    amount: formData.get("amount"),
    reference: formData.get("reference"),
    receivedAt: formData.get("receivedAt"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("record_variance_settlement", {
    p_shift_id: parsed.data.shiftId,
    p_amount: parsed.data.amount,
    p_reference: parsed.data.reference,
    p_received_at: parsed.data.receivedAt,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id: data };
}

export async function verifySettlement(id: string): Promise<SaveResult> {
  await requireStaff();
  const supabase = await getServerClient();
  const { error } = await supabase.rpc("verify_variance_settlement", { p_settlement_id: id });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id };
}

export async function cancelSettlement(formData: FormData): Promise<SaveResult> {
  await requireStaff();
  const id = String(formData.get("settlementId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, fieldErrors: { reason: "A written reason is required" } };
  const supabase = await getServerClient();
  const { error } = await supabase.rpc("cancel_variance_settlement", {
    p_settlement_id: id,
    p_reason: reason,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id };
}
