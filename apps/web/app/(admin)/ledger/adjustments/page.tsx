// apps/web/app/(admin)/ledger/adjustments/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { AdjustmentsTable } from "@/components/adjustments/adjustments-table";
import { ControlTotalDialog } from "@/components/adjustments/control-total-dialog";
import { ControlTotalsTable } from "@/components/adjustments/control-totals-table";
import { RecordAdjustmentDialog } from "@/components/adjustments/record-adjustment-dialog";
import { adjustableAccounts, adjustmentsFor, controlTotalsFor } from "@/lib/adjustments/queries";
import { longMonth, readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Monthly adjustments and the cashier's control total (spec "monthly_adjustments",
 * "monthly_control_totals"). Accounting enters them; supervisors and admins read them.
 * Both feed the Monthly summary. Nothing is edited or deleted: an adjustment is cancelled
 * with a reason, and a control total is replaced by a newer entry.
 */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const { month } = readParams(await searchParams);
  const monthStart = `${month}-01`;
  const canWrite = staff.role === "accounting" || staff.role === "admin";
  const [adjustments, controls, accounts] = await Promise.all([
    adjustmentsFor(monthStart),
    controlTotalsFor(monthStart),
    canWrite ? adjustableAccounts() : Promise.resolve([]),
  ]);
  return (
    <div>
      <ScreenHeader
        title="Adjustments"
        note={`Lines no receipt produces, and the cashier's control total, for ${longMonth(month)}. Both appear on the Monthly summary once the month has ended.`}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <ControlTotalDialog month={month} />
              <RecordAdjustmentDialog month={month} accounts={accounts} />
            </div>
          ) : null
        }
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Month
          <TextInput type="month" name="month" defaultValue={month} className="mt-1 w-40" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <h2 className="mb-2 text-sm font-semibold text-ink">Adjustments</h2>
      <AdjustmentsTable rows={adjustments} canCancel={canWrite} />
      <h2 className="mb-2 mt-8 text-sm font-semibold text-ink">Control total</h2>
      <ControlTotalsTable rows={controls} />
    </div>
  );
}
