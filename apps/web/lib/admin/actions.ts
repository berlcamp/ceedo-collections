"use server";

import "@/lib/admin/registry";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import { RESOURCES, type ResourceConfig } from "./resource";
import { toSaveResult, type SaveResult } from "./save-result";
import { updatePayload } from "./edit";

function coerce(config: ResourceConfig, formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const field of config.fields) {
    const value = formData.get(field.name);
    if (field.type === "boolean") {
      raw[field.name] = value === "on" || value === "true";
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "") {
      raw[field.name] = field.optional ? null : "";
      continue;
    }
    raw[field.name] = field.type === "number" || field.type === "money" ? Number(text) : text;
  }
  return raw;
}

export async function saveResource(
  resourceKey: string,
  formData: FormData,
  id?: string,
): Promise<SaveResult> {
  const config = RESOURCES[resourceKey];
  if (!config) {
    return { ok: false, fieldErrors: {}, formError: "Unknown resource." };
  }

  const staff = await requireStaff();
  if (!config.writeRoles.includes(staff.role)) {
    return { ok: false, fieldErrors: {}, formError: "You do not have permission to change this." };
  }

  // Every writable resource updates when given an id; an edit-only resource (app_users,
  // which only a Google sign-in can create) must be given one. Locked fields are dropped
  // from an update here rather than trusted to the form's read-only controls.
  if (config.writeMode === "edit" && !id) {
    return { ok: false, fieldErrors: {}, formError: `Choose a ${config.singular} to edit.` };
  }
  const targetId = id || undefined;

  const parsed = config.schema.safeParse(coerce(config, formData));
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const query = targetId
    ? supabase
        .from(config.table)
        .update(updatePayload(config, parsed.data) as never)
        .eq("id", targetId)
        .select("id")
        .single()
    : supabase
        .from(config.table)
        .insert(parsed.data as never)
        .select("id")
        .single();

  const { data, error } = await query;
  const result = toSaveResult(
    parsed,
    error ? { code: error.code ?? "", message: error.message } : null,
    (data as { id?: string } | null)?.id ?? targetId ?? "",
  );

  if (result.ok) revalidatePath(`/${config.key}`);
  return result;
}
