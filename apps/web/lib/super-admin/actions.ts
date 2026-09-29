"use server";

import { isAdmin } from "@ceedo/shared";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import { CLEAR_CONFIRMATION } from "./confirmation";

export type ToolResult = { ok: true; message: string } | { ok: false; message: string };

async function superAdminClient() {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) return null;
  const supabase = await getServerClient();
  const { data } = await supabase.rpc("is_super_admin");
  return data ? supabase : null;
}

const REFUSED: ToolResult = { ok: false, message: "Only a super administrator may do this." };

/**
 * Empties every table except users and settings (migration 0052). The database checks the
 * super-admin allowlist again; this check only keeps the refusal readable.
 */
export async function clearAllData(confirmation: string): Promise<ToolResult> {
  if (confirmation !== CLEAR_CONFIRMATION) {
    return { ok: false, message: `Type ${CLEAR_CONFIRMATION} to confirm.` };
  }
  const supabase = await superAdminClient();
  if (!supabase) return REFUSED;

  const { data, error } = await supabase.rpc("clear_all_data");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: `Cleared ${data} tables. Users and settings were kept.` };
}

export async function seedTestData(): Promise<ToolResult> {
  const supabase = await superAdminClient();
  if (!supabase) return REFUSED;

  const { data, error } = await supabase.rpc("seed_test_data");
  if (error) return { ok: false, message: error.message };

  const counts = data as Record<string, number>;
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Test data loaded: ${counts.stalls} stalls, ${counts.tenants} tenants, ${counts.leases} leases and ${counts.charges} charges.`,
  };
}
