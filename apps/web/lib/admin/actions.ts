"use server";

import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import type { ResourceConfig } from "./resource";
import { toSaveResult, type SaveResult } from "./save-result";

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
  config: ResourceConfig,
  formData: FormData,
  id?: string,
): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!config.writeRoles.includes(staff.role)) {
    return { ok: false, fieldErrors: {}, formError: "You do not have permission to change this." };
  }

  const parsed = config.schema.safeParse(coerce(config, formData));
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const query = id
    ? supabase
        .from(config.table as never)
        .update(parsed.data as never)
        .eq("id", id)
        .select("id")
        .single()
    : supabase
        .from(config.table as never)
        .insert(parsed.data as never)
        .select("id")
        .single();

  const { data, error } = await query;
  const result = toSaveResult(
    parsed,
    error ? { code: error.code ?? "", message: error.message } : null,
    (data as { id?: string } | null)?.id ?? id ?? "",
  );

  if (result.ok) revalidatePath(`/${config.key}`);
  return result;
}
