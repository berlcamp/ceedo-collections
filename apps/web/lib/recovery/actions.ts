"use server";

import { revalidatePath } from "next/cache";
import { fromPesos, isAdmin, type Centavos, type Database } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { ledgerClient } from "@/lib/ledger/queries";
import { getLeaseFeeType } from "./queries";
import { tickedRanks } from "./months";
import { closeSchema, openSchema, receiptSchema } from "./schemas";

/**
 * `recover_collection`'s own `p_receipt` type is the generated `Json` union, which a plain
 * object literal built up field by field does not structurally satisfy without an explicit
 * index signature. Built as `Record<string, unknown>` below and cast once here, at the one
 * place it crosses into the RPC call -- the payload shape itself is the migration's own
 * (`supabase/migrations/20260930000060_office_recovery.sql`, `post_collection`'s payload
 * comment), not something this cast is asked to enforce.
 */
type RecoveryReceiptPayload = Database["ceedo_collections"]["Functions"]["recover_collection"]["Args"]["p_receipt"];

/**
 * Office recovery (spec 2026-09-30-office-recovery). Every RPC below checks is_admin()
 * itself and raises a sentence written for the operator holding the stub ("That booklet
 * was not held by this collector on that day", "The stub says X; what was ticked comes to
 * Y") -- shown as-is, the same reasoning as `lib/ledger/actions.ts`'s own `rpcFailure`. The
 * `adminOnly()` check here only spares a non-admin the round trip; it is not the real gate.
 */
function rpcFailure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

async function adminOnly(): Promise<SaveResult | null> {
  const staff = await requireStaff();
  return isAdmin(staff.role) ? null : rpcFailure("Only an administrator may recover lost receipts.");
}

function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

function refresh(): void {
  revalidatePath("/ledger/recovery");
  revalidatePath("/ledger/shifts");
  revalidatePath("/ledger/collections");
}

/** Step 1: `recovery_shift` -- finds the collector's open shift for that tablet and day, or
 * opens a new one. Returns its id, which the page then carries into step 2. */
export async function openRecoveryShift(formData: FormData): Promise<SaveResult> {
  const denied = await adminOnly();
  if (denied) return denied;

  const parsed = openSchema.safeParse({
    collectorId: formData.get("collectorId"),
    deviceId: formData.get("deviceId"),
    businessDate: formData.get("businessDate"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("recovery_shift", {
    p_collector_id: parsed.data.collectorId,
    p_device_id: parsed.data.deviceId,
    p_business_date: parsed.data.businessDate,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  refresh();
  return { ok: true, id: data };
}

/**
 * Step 2: re-enters one receipt through `recover_collection`, which itself runs it through
 * `post_collection` -- the booklet, serial, oldest-months-first and rate rules are the
 * tablet's own, not a second copy of them here. This action's own job is only to shape the
 * form's fields into the payload `post_collection` expects (parent migration's own comment
 * on its shape) and to check the stub total client-side before spending a round trip.
 */
export async function recoverReceipt(formData: FormData): Promise<SaveResult> {
  const denied = await adminOnly();
  if (denied) return denied;

  const parsed = receiptSchema.safeParse({
    shiftId: formData.get("shiftId"),
    reason: formData.get("reason"),
    bookletId: formData.get("bookletId"),
    orNo: formData.get("orNo"),
    businessDate: formData.get("businessDate"),
    time: formData.get("time") ?? "",
    kind: formData.get("kind"),
    leaseId: formData.get("leaseId") ?? undefined,
    months: formData.get("months") ?? undefined,
    feeTypeId: formData.get("feeTypeId") ?? undefined,
    rateClass: formData.get("rateClass") ?? undefined,
    quantity: formData.get("quantity") ?? undefined,
    payerRef: formData.get("payerRef") ?? undefined,
    stubTotal: formData.get("stubTotal"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;

  // Noon Manila keeps the receipt inside its business day when the stub carries no time.
  const collectedAt = `${r.businessDate}T${r.time || "12:00"}:00+08:00`;

  let receipt: Record<string, unknown>;
  if (r.kind === "lease") {
    if (!r.leaseId) return { ok: false, fieldErrors: { leaseId: "Choose the lease" } };

    let ranks: number[];
    try {
      ranks = tickedRanks(
        (r.months ?? "")
          .split(",")
          .filter(Boolean)
          .map(Number),
      );
    } catch (e) {
      return { ok: false, fieldErrors: { months: (e as Error).message } };
    }

    let feeTypeId: string | null;
    try {
      feeTypeId = await getLeaseFeeType(r.leaseId);
    } catch (e) {
      return rpcFailure((e as Error).message);
    }
    if (!feeTypeId) return { ok: false, fieldErrors: { leaseId: "No such lease" } };

    receipt = {
      or_no: r.orNo,
      booklet_id: r.bookletId,
      collected_at: collectedAt,
      fee_type_id: feeTypeId,
      lease_id: r.leaseId,
      payer_ref: null,
      allocations: ranks.map((group_rank) => ({ group_rank })),
      lines: [],
    };
  } else {
    if (!r.feeTypeId) return { ok: false, fieldErrors: { feeTypeId: "Choose the fee" } };
    if (!r.quantity) return { ok: false, fieldErrors: { quantity: "Enter the quantity" } };

    receipt = {
      or_no: r.orNo,
      booklet_id: r.bookletId,
      collected_at: collectedAt,
      fee_type_id: r.feeTypeId,
      lease_id: null,
      payer_ref: r.payerRef || null,
      allocations: [],
      lines: [{ fee_type_id: r.feeTypeId, rate_class: r.rateClass || "", quantity: r.quantity }],
    };
  }

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("recover_collection", {
    p_shift_id: r.shiftId,
    p_receipt: receipt as unknown as RecoveryReceiptPayload,
    p_stub_total: r.stubTotal,
    p_reason: r.reason,
  });
  if (error) return rpcFailure(error.message);

  refresh();
  return { ok: true, id: data };
}

/**
 * Step 3: `office_close_shift`. The required "this tablet's data was lost" checkbox is
 * checked here rather than in the zod schema -- it is a confirmation, not a field with a
 * message worth showing next to it, the same distinction the admin-only gate above draws.
 */
export async function closeRecoveredShift(formData: FormData): Promise<SaveResult & { variance?: number }> {
  const denied = await adminOnly();
  if (denied) return denied;

  if (formData.get("confirmLost") !== "on") {
    return { ok: false, fieldErrors: { confirmLost: "Confirm that this tablet's data was lost" } };
  }

  const parsed = closeSchema.safeParse({
    shiftId: formData.get("shiftId"),
    reason: formData.get("reason"),
    declaredTotal: formData.get("declaredTotal"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("office_close_shift", {
    p_shift_id: parsed.data.shiftId,
    p_declared_total: parsed.data.declaredTotal,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcFailure(error.message);

  refresh();
  revalidatePath("/ledger/shortages");

  // The RPC's only return shape (see its own final `return jsonb_build_object(...)`).
  const result = data as { variance: number };
  return { ok: true, id: parsed.data.shiftId, variance: centavos(result.variance) };
}
