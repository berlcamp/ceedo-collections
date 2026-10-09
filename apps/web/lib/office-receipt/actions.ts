"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Database } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { ledgerClient } from "@/lib/ledger/queries";
import { getLeaseFeeType, getUnpaidGroups } from "@/lib/recovery/queries";
import type { UnpaidGroup } from "@/lib/recovery/months";
import { pesosField } from "@/lib/recovery/schemas";
import { requireStaff } from "@/lib/supabase/session";
import { buildOfficePayload, dayPickerSchema, officeReceiptSchema } from "./schemas";

type Payload = Database["ceedo_collections"]["Functions"]["post_office_receipt"]["Args"]["p_receipt"];

function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}
async function gate(): Promise<SaveResult | null> {
  const staff = await requireStaff();
  return staff.role === "supervisor" || staff.role === "admin"
    ? null
    : failure("Only a supervisor or administrator may post office receipts.");
}
function refresh() {
  revalidatePath("/ledger/office-receipt");
  revalidatePath("/ledger/shifts");
  revalidatePath("/ledger/collections");
}

export async function openOfficeDay(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = dayPickerSchema.safeParse({ collectorId: formData.get("collectorId"), businessDate: formData.get("businessDate") });
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("office_shift", {
    p_collector_id: parsed.data.collectorId, p_business_date: parsed.data.businessDate,
  });
  if (error) return failure(error.message);
  return { ok: true, id: data };
}

export async function postOfficeReceipt(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = officeReceiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;

  let payload: Record<string, unknown>;
  try {
    const rentFee = r.kind === "rent" && r.leaseId ? await getLeaseFeeType(r.leaseId) : null;
    payload = buildOfficePayload(r, rentFee);
  } catch (e) {
    return { ok: false, fieldErrors: { [r.kind === "rent" ? "months" : "lines"]: (e as Error).message } };
  }

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("post_office_receipt", {
    p_shift_id: r.shiftId, p_receipt: payload as unknown as Payload,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id: data };
}

export async function closeOfficeDay(formData: FormData): Promise<SaveResult> {
  const denied = await gate();
  if (denied) return denied;
  const parsed = z.object({ shiftId: z.guid(), declaredTotal: pesosField("Enter the cash and checks handed over") })
    .safeParse({ shiftId: formData.get("shiftId"), declaredTotal: formData.get("declaredTotal") });
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("close_office_shift", {
    p_shift_id: parsed.data.shiftId, p_declared_total: parsed.data.declaredTotal,
  });
  if (error) return failure(error.message);
  refresh();
  revalidatePath("/ledger/remittances");
  return { ok: true, id: parsed.data.shiftId };
}

export async function officeUnpaidGroups(leaseId: string): Promise<UnpaidGroup[]> {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") throw new Error("Not allowed");
  return getUnpaidGroups(leaseId);
}
