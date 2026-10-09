"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const failure = (message: string): SaveResult => ({ ok: false, fieldErrors: {}, formError: message });
const optionalInt = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().positive().optional());

const recordSchema = z.object({
  shiftId: z.guid("Choose the collector's shift"),
  feeTypeId: z.guid("Choose the ticket"),
  amount: z.coerce.number().positive("The amount must be more than zero"),
  ticketFrom: optionalInt,
  ticketTo: optionalInt,
  note: z.string().trim().optional(),
});

async function gate() {
  const staff = await requireStaff();
  return ["supervisor", "accounting", "admin"].includes(staff.role) ? null : failure("Not allowed.");
}

export async function recordCashTickets(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = recordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;
  const supabase = await ledgerClient();
  // The generated types call these parameters non-null (no SQL default), but the function
  // accepts null for the optional serials and note; passing null is the intended value.
  const { data, error } = await supabase.rpc("record_cash_ticket_sale", {
    p_shift_id: r.shiftId, p_fee_type_id: r.feeTypeId, p_amount: r.amount,
    p_ticket_from: (r.ticketFrom ?? null) as number, p_ticket_to: (r.ticketTo ?? null) as number,
    p_note: (r.note ?? null) as string,
  });
  if (error) return failure(error.message);
  revalidatePath("/ledger/cash-tickets");
  revalidatePath("/ledger/shifts");
  return { ok: true, id: data };
}

export async function cancelCashTickets(id: string, reason: string): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("cancel_cash_ticket_sale", { p_sale_id: id, p_reason: reason });
  if (error) return failure(error.message);
  revalidatePath("/ledger/cash-tickets");
  revalidatePath("/ledger/shifts");
  return { ok: true, id };
}
