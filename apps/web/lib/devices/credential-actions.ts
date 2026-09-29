"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { requireStaff } from "@/lib/supabase/session";
import { ledgerClient } from "@/lib/ledger/queries";

/**
 * Same reasoning as `lib/ledger/exception-actions.ts`'s own `rpcFailure`: these RPCs raise
 * exceptions already written for an operator to read ("No such device", "Only an
 * administrator may ..."), so the message is surfaced verbatim rather than run through
 * `toSaveResult()`'s Postgres error-code switch, which exists for bare constraint
 * violations.
 */
function rpcFailure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

const CREDENTIAL_DENIED = rpcFailure("Only an administrator may manage device credentials.");
const PIN_DENIED = rpcFailure("Only an administrator may set a collector PIN.");

const deviceIdSchema = z.guid();

export type IssueCredentialResult = SaveResult & {
  credentialId?: string;
  secret?: string;
};

/**
 * Returns the secret ONCE. There is no path that reads it back: migration
 * 20260918000026 stores only a SHA-256 digest (`device_credentials.secret_hash`), and the
 * `issue_device_credential()` RPC itself notes this is "the only moment the secret exists
 * outside the caller's hand". The screen must say so plainly -- a screen that appears to
 * offer recovery invites a support process that cannot exist.
 *
 * Re-issuing revokes the previous live credential in the same transaction (the RPC's own
 * comment), so this doubles as the "replace a lost tablet" action.
 */
export async function issueCredential(formData: FormData): Promise<IssueCredentialResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return CREDENTIAL_DENIED;

  const parsed = deviceIdSchema.safeParse(formData.get("deviceId"));
  if (!parsed.success) {
    return { ok: false, fieldErrors: { deviceId: "Select a device." } };
  }

  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("issue_device_credential", {
    p_device_id: parsed.data,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/devices");

  // The RPC's only return shape (see its own final `return jsonb_build_object(...)`).
  const issued = data as { credential_id: string; secret: string };
  return {
    ok: true,
    id: issued.credential_id,
    credentialId: issued.credential_id,
    secret: issued.secret,
  };
}

/** Revokes a device's live credential without issuing a replacement -- the tablet stops
 * being able to authenticate until a new one is issued. */
export async function revokeCredential(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return CREDENTIAL_DENIED;

  const parsed = deviceIdSchema.safeParse(formData.get("deviceId"));
  if (!parsed.success) {
    return { ok: false, fieldErrors: { deviceId: "Select a device." } };
  }

  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("revoke_device_credential", {
    p_device_id: parsed.data,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/devices");
  return { ok: true, id: parsed.data };
}

const setPinSchema = z.object({
  collectorId: z.guid(),
  // The database validates this again (migration 20260918000027's own regex check) --
  // checking here first means the supervisor sees the rule in the form, not as a Postgres
  // error.
  pin: z.string().regex(/^\d{6}$/, "A PIN must be exactly six digits"),
});

/**
 * A new PIN reaches a collector's tablet only on that tablet's next sync (parent spec §14:
 * "a collector who forgets mid-round offline cannot sign in"). The caller must not present
 * this as taking effect immediately -- see the confirmation copy on the staff screen.
 */
export async function setCollectorPin(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return PIN_DENIED;

  const parsed = setPinSchema.safeParse({
    collectorId: formData.get("collectorId"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await ledgerClient();
  const { error } = await supabase.rpc("set_collector_pin", {
    p_collector_id: parsed.data.collectorId,
    p_pin: parsed.data.pin,
  });
  if (error) return rpcFailure(error.message);

  revalidatePath("/users");
  return { ok: true, id: parsed.data.collectorId };
}
