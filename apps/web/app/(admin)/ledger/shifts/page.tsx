import { ShiftsTable } from "@/components/ledger/shifts-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getShifts } from "@/lib/ledger/shifts";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Read-only. Verification and remittance are Phase 6 -- there is no action on this page,
 * so unlike collections/page.tsx or exceptions/page.tsx there is nothing here to gate on
 * role. Every role that reaches this layout at all already cleared canUseWeb() and is
 * admitted by shifts_read's own policy (migration 20260918000029: admin, supervisor,
 * accounting).
 */
export default async function ShiftsPage() {
  await requireStaff();
  const rows = await getShifts();

  return (
    <div>
      <ScreenHeader
        title="Shifts"
        note="Every shift a device has opened, most recent first -- except a shift still open past its own business date or closed offline and not yet synced, which sort to the top regardless of date. Verification and remittance are handled elsewhere; this screen is for seeing the problem, not acting on it."
      />
      <ShiftsTable rows={rows} />
    </div>
  );
}
