// apps/web/lib/adjustments/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const failure = (message: string): SaveResult => ({ ok: false, fieldErrors: {}, formError: message });
const month = z.string().regex(/^\d{4}-\d{2}$/, "Choose the month");
const amount = z.string().trim().min(1, "Enter the amount").pipe(z.coerce.number());

const adjustmentSchema = z.object({
  accountId: z.guid("Choose the account"),
  month,
  amount: amount.refine((v) => v !== 0, "The amount cannot be zero"),
  note: z.string().trim().min(1, "Explain the adjustment"),
});

const controlSchema = z.object({
  month,
  amount: amount.refine((v) => v >= 0, "The control total cannot be negative"),
  note: z.string().trim().optional(),
});

async function gate() {
  const staff = await requireStaff();
  return ["accounting", "admin"].includes(staff.role) ? null : failure("Only accounting or an administrator may do this.");
}

function done(id: string): SaveResult {
  revalidatePath("/ledger/adjustments");
  revalidatePath("/reports/monthly-summary");
  return { ok: true, id };
}

export async function recordAdjustment(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("record_monthly_adjustment", {
    p_account_id: r.accountId, p_month: `${r.month}-01`, p_amount: r.amount, p_note: r.note,
  });
  if (error) return failure(error.message);
  return done(data);
}

export async function cancelAdjustment(id: string, reason: string): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("cancel_monthly_adjustment", { p_adjustment_id: id, p_reason: reason });
  if (error) return failure(error.message);
  return done(id);
}

export async function recordControlTotal(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = controlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  // The generated types call p_note non-null (no SQL default); the function takes null.
  const { data, error } = await supabase.rpc("record_monthly_control_total", {
    p_month: `${r.month}-01`, p_amount: r.amount, p_note: (r.note || null) as string,
  });
  if (error) return failure(error.message);
  return done(data);
}
