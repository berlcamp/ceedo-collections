"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

const schema = z.object({
  employeeNo: z.string().trim().min(1, "Enter the employee number"),
  fullName: z.string().trim().min(1, "Enter the full name"),
});

/**
 * Adds a collector directly, with no Google sign-in (migration 0048): collectors sign in to
 * tablets with an employee number and PIN, never to the web. The database checks the role
 * again and raises a readable message, shown as-is.
 */
export async function createCollector(formData: FormData): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) {
    return { ok: false, fieldErrors: {}, formError: "Only an administrator may add a collector." };
  }
  const parsed = schema.safeParse({
    employeeNo: formData.get("employeeNo"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) return toSaveResult(parsed, null);

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("create_collector", {
    p_employee_no: parsed.data.employeeNo,
    p_full_name: parsed.data.fullName,
  });
  if (error) return { ok: false, fieldErrors: {}, formError: error.message };

  revalidatePath("/users");
  return { ok: true, id: data };
}
