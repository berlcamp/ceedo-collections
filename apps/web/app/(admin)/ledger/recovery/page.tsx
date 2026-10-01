import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ScreenHeader } from "@/components/shell/screen-header";
import { CloseForm } from "@/components/recovery/close-form";
import { CloseSummary } from "@/components/recovery/close-summary";
import { ReceiptForm } from "@/components/recovery/receipt-form";
import { RecoveredReceipts } from "@/components/recovery/recovered-receipts";
import { ShiftPicker } from "@/components/recovery/shift-picker";
import {
  getCashFeeTypes,
  getCollectorLeases,
  getHeldBooklets,
  getRecoveryChoices,
  getRecoveryShift,
} from "@/lib/recovery/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Recovery: receipts lost with a wiped tablet, re-entered from the booklet stubs into the
 * collector's open shift, then the shift closed against the cash handed over. Spec
 * 2026-09-30-office-recovery; the one exception to D7's "no web payment path". Admin only.
 */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ shift?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/");
  const { shift: shiftId } = await searchParams;

  if (!shiftId) {
    const choices = await getRecoveryChoices();
    return (
      <div>
        <ScreenHeader
          title="Recovery"
          note="For a tablet whose data was cleared before it synced. Pick the collector, tablet and day; enter each missing receipt from the booklet stubs; then close the shift with the cash that was handed over. Every receipt is checked exactly as a tablet receipt is, and marked Office-encoded."
        />
        <ShiftPicker {...choices} today={manilaToday()} />
      </div>
    );
  }

  // Final-review Task 5: `shiftId` reaches getRecoveryShift()'s `.eq("id", shiftId)`
  // unvalidated. `id` is a uuid column, so a malformed `?shift=` (anything not shaped like
  // one) makes Postgres itself raise "invalid input syntax for type uuid", which this page
  // would otherwise let through as an unhandled 500 instead of the 404 a bad link deserves.
  if (!z.guid().safeParse(shiftId).success) notFound();

  const shift = await getRecoveryShift(shiftId);
  if (!shift) notFound();
  const [booklets, leases, fees] = await Promise.all([
    getHeldBooklets(shift.collectorId, shift.businessDate),
    getCollectorLeases(shift.collectorId),
    getCashFeeTypes(shift.businessDate),
  ]);

  return (
    <div>
      <ScreenHeader
        title="Recovery"
        note={`${shift.collectorName} · ${shift.deviceLabel} · shift of ${shift.businessDate}`}
      />
      <RecoveredReceipts shift={shift} />
      {shift.status === "open" ? (
        <>
          <ReceiptForm shift={shift} booklets={booklets} leases={leases} fees={fees} />
          <CloseForm shift={shift} />
        </>
      ) : shift.variance !== null && shift.declaredTotal !== null ? (
        <CloseSummary declaredTotal={shift.declaredTotal} variance={shift.variance} />
      ) : (
        <p className="mt-6 text-sm text-ink-2">This shift is closed. Its totals are final.</p>
      )}
    </div>
  );
}
