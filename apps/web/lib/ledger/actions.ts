"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canResolveExceptions } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { getCutoverDate, ledgerClient } from "@/lib/ledger/queries";

/**
 * Every RPC here raises with a message written for an operator to read -- "Cannot condone
 * X against a charge with Y outstanding", "Lease X already has an opening balance". That
 * is different from `toSaveResult()`'s job in `lib/admin/save-result.ts`, which exists to
 * translate a raw Postgres constraint name into something a clerk can read. Running an
 * RPC's own exception text back through that switch would do the opposite of its intent:
 * a unique-violation ("Collection X is already cancelled") or an insufficient-privilege
 * error would come out as one of the generic sentences meant for a bare constraint, and
 * the specific rule the database is enforcing would be lost. So a validation failure below
 * still goes through `toSaveResult()` (it already builds the right `fieldErrors` shape for
 * a client-side zod issue), but an RPC failure is surfaced verbatim, wrapped in the same
 * `SaveResult` shape everything else on this form already knows how to render.
 */
function rpcFailure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

const PERMISSION_DENIED = rpcFailure("You do not have permission to change this.");

const cancelSchema = z.object({
  collectionId: z.string().uuid(),
  // The database refuses a blank reason too (§11.3); checking here as well means the
  // cashier sees the rule in the form rather than as a Postgres error.
  reason: z.string().trim().min(1, "A written reason is required"),
});

export async function cancelCollection(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!canResolveExceptions(staff.role)) return PERMISSION_DENIED;

  const parsed = cancelSchema.safeParse({
    collectionId: formData.get("collectionId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("cancel_collection", {
    p_collection_id: parsed.data.collectionId,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/ledger/collections");
  return { ok: true, id: data ?? parsed.data.collectionId };
}

const condoneSchema = z.object({
  chargeId: z.string().uuid(),
  leaseId: z.string().uuid(),
  amount: z.coerce.number().positive("Condoned amount must be a positive amount"),
  authorityRef: z.string().trim().min(1, "The authorising ordinance is required"),
  reason: z.string().trim().min(1, "A reason is required"),
});

export async function condoneCharge(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  // Admin only (§8.4) -- there is no shared helper for exactly this role, unlike
  // cancellation's canResolveExceptions(); a plain equality check is the honest way to
  // write "admin only" rather than reaching for a helper that means something broader.
  if (staff.role !== "admin") return PERMISSION_DENIED;

  const parsed = condoneSchema.safeParse({
    chargeId: formData.get("chargeId"),
    leaseId: formData.get("leaseId"),
    amount: formData.get("amount"),
    authorityRef: formData.get("authorityRef"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("condone_charge", {
    p_charge_id: parsed.data.chargeId,
    p_amount: parsed.data.amount,
    p_authority_ref: parsed.data.authorityRef,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  // Condoning moves a charge's outstanding balance, which aging, delinquency and this
  // lease's own subsidiary ledger all read.
  revalidatePath(`/ledger/leases/${parsed.data.leaseId}`);
  revalidatePath("/ledger/aging");
  revalidatePath("/ledger/delinquency");
  return { ok: true, id: data ?? parsed.data.chargeId };
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export async function recordOpeningBalance(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  // Admin only, same reasoning as condoneCharge above.
  if (staff.role !== "admin") return PERMISSION_DENIED;

  const supabase = await ledgerClient();

  // Fetched before validation, not just before the RPC call: the form must refuse a date
  // on or after the cutover before it ever reaches the database (the brief's "in the form
  // as well as in the database"), and that means checking against the SAME cutover the
  // database will -- not a value baked into the page at an earlier request.
  const cutoverDate = await getCutoverDate();

  const openingBalanceSchema = z.object({
    leaseId: z.string().uuid(),
    amount: z.coerce.number().positive("Opening balance must be a positive amount"),
    oldestUnpaidDate: z
      .string()
      .regex(dateOnly, "Enter a valid date")
      .refine((d) => d < cutoverDate, {
        message: `Must be before the cutover date (${cutoverDate}) -- periods from the cutover onward are raised by the nightly accrual job, not recorded here`,
      }),
    authorityRef: z
      .string()
      .trim()
      .min(1, "Name who reconciled this and the paper record it came from"),
  });

  const parsed = openingBalanceSchema.safeParse({
    leaseId: formData.get("leaseId"),
    amount: formData.get("amount"),
    oldestUnpaidDate: formData.get("oldestUnpaidDate"),
    authorityRef: formData.get("authorityRef"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const { data, error } = await supabase.rpc("record_opening_balance", {
    p_lease_id: parsed.data.leaseId,
    p_amount: parsed.data.amount,
    p_oldest_unpaid_date: parsed.data.oldestUnpaidDate,
    p_authority_ref: parsed.data.authorityRef,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/ledger/opening-balances");
  revalidatePath("/ledger/aging");
  revalidatePath("/ledger/delinquency");
  return { ok: true, id: data ?? parsed.data.leaseId };
}
