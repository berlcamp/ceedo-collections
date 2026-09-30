import { ShiftsTable } from "@/components/ledger/shifts-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getShifts } from "@/lib/ledger/shifts";
import { manilaToday } from "@/lib/reports/params";
import { getShortages } from "@/lib/shortages/queries";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Every role that reaches this layout at all already cleared canUseWeb() and is admitted
 * by shifts_read's own policy (migration 20260918000029: admin, supervisor, accounting).
 * The one action here, recording a shortage payment, is the Shortages screen's own and
 * gated the same way: supervisor or admin (record_variance_settlement refuses anyone else).
 */
export default async function ShiftsPage() {
  const staff = await requireStaff();
  const canRecord = staff.role === "supervisor" || staff.role === "admin";
  const [rows, shortages] = await Promise.all([
    getShifts(),
    canRecord ? getShortages().then((s) => s.shortages) : Promise.resolve(null),
  ]);

  return (
    <div>
      <ScreenHeader
        title="Shifts"
        note="Every shift a device has opened, most recent first -- except a shift still open past its own business date or closed offline and not yet synced, which sort to the top regardless of date. A short shift can be settled here; accounting verifies the payment on the Shortages screen."
      />
      <ShiftsTable rows={rows} shortages={shortages} today={manilaToday()} />
    </div>
  );
}
