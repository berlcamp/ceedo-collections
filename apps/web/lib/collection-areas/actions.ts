"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@ceedo/shared";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

const schema = z.object({
  collectorId: z.guid("Choose a collector"),
  facilityIds: z.array(z.guid()).min(1, "Tick at least one facility"),
});

/**
 * Makes the collector's active collection areas exactly the ticked facilities, each
 * covering all its sections.
 *
 * Inserts first, then deactivates, so a failure half way leaves the collector with too
 * many areas rather than none. Deactivated along the way: areas at unticked facilities,
 * section-only areas at ticked ones (the new facility-wide area covers them), and
 * duplicate facility-wide areas. Rows are never deleted; the history stays.
 *
 * Admin-only, like the table's own policy (collector_assignments is not in migration
 * 0008's supervisor list), which also refuses the writes on its own.
 */
export async function setCollectorFacilities(
  collectorId: string,
  facilityIds: string[],
): Promise<SaveResult> {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) {
    return { ok: false, fieldErrors: {}, formError: "Only an administrator may assign collection areas." };
  }
  const parsed = schema.safeParse({ collectorId, facilityIds: [...new Set(facilityIds)] });
  if (!parsed.success) return toSaveResult(parsed, null);
  const { collectorId: collector, facilityIds: ticked } = parsed.data;

  const supabase = await getServerClient();
  const { data: current, error: readError } = await supabase
    .from("collector_assignments")
    .select("id, facility_id, section_id")
    .eq("collector_id", collector)
    .eq("active", true)
    .order("created_at");
  if (readError) return toSaveResult(parsed, readError);

  // The facility-wide row kept for each ticked facility: the oldest one already there.
  const kept = new Map<string, string>();
  for (const row of current ?? []) {
    if (row.section_id === null && ticked.includes(row.facility_id) && !kept.has(row.facility_id)) {
      kept.set(row.facility_id, row.id);
    }
  }

  const missing = ticked.filter((facilityId) => !kept.has(facilityId));
  if (missing.length > 0) {
    const { error } = await supabase.from("collector_assignments").insert(
      missing.map((facilityId) => ({
        collector_id: collector,
        facility_id: facilityId,
        section_id: null,
        active: true,
      })),
    );
    if (error) return toSaveResult(parsed, error);
  }

  const keptIds = new Set(kept.values());
  const retire = (current ?? []).filter((row) => !keptIds.has(row.id)).map((row) => row.id);
  if (retire.length > 0) {
    const { error } = await supabase
      .from("collector_assignments")
      .update({ active: false })
      .in("id", retire);
    if (error) return toSaveResult(parsed, error);
  }

  revalidatePath("/collector-assignments");
  return { ok: true, id: collector };
}
