"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canResolveExceptions } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { ledgerClient } from "@/lib/ledger/queries";

/**
 * Same reasoning as `lib/ledger/actions.ts`'s own `rpcFailure`: an RPC failure here is
 * surfaced verbatim (it is already written for an operator to read -- "No such exception",
 * "Exception X is already resolved") rather than run through `toSaveResult()`'s Postgres
 * error-code switch, which exists for bare constraint violations, not these RPCs' own
 * exception text.
 */
function rpcFailure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

const PERMISSION_DENIED = rpcFailure("You do not have permission to resolve exceptions.");

// The database refuses a blank reason too (migration 20260918000030's lifecycle constraint
// and assert_can_resolve_exceptions). Checking here as well means the supervisor sees the
// rule in the form rather than as a Postgres error.
const reason = z.string().trim().min(1, "A written reason is required");

const correctSchema = z.object({
  exceptionId: z.string().uuid(),
  orNo: z.coerce.number().int().positive(),
  reason,
});

export async function correctException(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!canResolveExceptions(staff.role)) return PERMISSION_DENIED;

  const parsed = correctSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    orNo: formData.get("orNo"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  // Only CLAIMS. No amount is sent, and post_collection's payload has no amount field to
  // send one in -- invariant 3 holds for supervisors exactly as for devices.
  const { data, error } = await supabase.rpc("resolve_exception_corrected", {
    p_exception_id: parsed.data.exceptionId,
    p_payload: { or_no: parsed.data.orNo },
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  const result = data as { status: string; reason?: string; detail?: string };
  if (result.status === "rejected") {
    // Rejected again rather than forced in. The exception stays open with the new reason.
    return rpcFailure(
      `The correction was rejected: ${result.detail ?? result.reason ?? "unknown reason"}`,
    );
  }

  revalidatePath("/ledger/exceptions");
  return { ok: true, id: parsed.data.exceptionId };
}

const idAndReasonSchema = z.object({
  exceptionId: z.string().uuid(),
  reason,
});

export async function spoilException(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!canResolveExceptions(staff.role)) return PERMISSION_DENIED;

  const parsed = idAndReasonSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("resolve_exception_spoiled", {
    p_exception_id: parsed.data.exceptionId,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/ledger/exceptions");
  return { ok: true, id: parsed.data.exceptionId };
}

export async function escalateException(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!canResolveExceptions(staff.role)) return PERMISSION_DENIED;

  const parsed = idAndReasonSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  // A STATUS, not a resolution (§11.3, migration 20260918000036's own comment): the
  // exception stays open and still counts against the collector at closeout.
  const { error } = await supabase.rpc("escalate_exception", {
    p_exception_id: parsed.data.exceptionId,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/ledger/exceptions");
  return { ok: true, id: parsed.data.exceptionId };
}
