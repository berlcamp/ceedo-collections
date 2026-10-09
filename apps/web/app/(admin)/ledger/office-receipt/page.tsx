import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ScreenHeader } from "@/components/shell/screen-header";
import { CloseSummary } from "@/components/recovery/close-summary";
import { DayPicker } from "@/components/office-receipt/day-picker";
import { OfficeCloseForm } from "@/components/office-receipt/close-form";
import { OfficeReceiptForm } from "@/components/office-receipt/receipt-form";
import { Money } from "@/components/ledger/money";
import { fromCentavos } from "@ceedo/shared";
import { getAllActiveLeases, getOfficeFees, getOfficers, getOfficeShift } from "@/lib/office-receipt/queries";
import { getHeldBooklets } from "@/lib/recovery/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Office receipts: ORs issued at the office counter, cash or check (spec "Screens"). The
 * officer holding the booklet has no web login, so a supervisor posts on their behalf into
 * the officer's office shift for the day, then closes it with the cash and checks handed over.
 */
export default async function OfficeReceiptPage({ searchParams }: { searchParams: Promise<{ shift?: string }> }) {
  const staff = await requireStaff();
  if (staff.role !== "supervisor" && staff.role !== "admin") redirect("/");
  const { shift: shiftId } = await searchParams;

  if (!shiftId) {
    return (
      <div>
        <ScreenHeader
          title="Office receipt"
          note="Choose the officer who issued the receipts and the day. Each receipt is checked exactly as a tablet receipt is — the booklet, the serial, the oldest unpaid months first — and may be paid in cash or by check."
        />
        <DayPicker officers={await getOfficers()} today={manilaToday()} />
      </div>
    );
  }
  if (!z.guid().safeParse(shiftId).success) notFound();
  const shift = await getOfficeShift(shiftId);
  if (!shift) notFound();

  const [booklets, leases, fees] = await Promise.all([
    getHeldBooklets(shift.collectorId, shift.businessDate),
    getAllActiveLeases(),
    getOfficeFees(shift.businessDate),
  ]);
  const total = shift.receipts.reduce((a, r) => a + r.amount, 0);

  return (
    <div>
      <ScreenHeader title="Office receipt" note={`${shift.collectorName} · office · ${shift.businessDate}`} />
      <table className="mb-6 w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr><th className="py-2">OR</th><th>Payer</th><th>Paid by</th><th className="text-right">Amount</th></tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {shift.receipts.map((r) => (
            <tr key={r.id}>
              <td className="py-2 tabular-nums">{r.orNo}</td><td>{r.payer}</td><td>{r.mode}</td>
              <td className="text-right"><Money amount={fromCentavos(r.amount)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-semibold"><td colSpan={3} className="py-2">Total</td>
          <td className="text-right"><Money amount={fromCentavos(total)} /></td></tr></tfoot>
      </table>
      {shift.status === "open" ? (
        <>
          <OfficeReceiptForm shift={shift} booklets={booklets} leases={leases} fees={fees} />
          <OfficeCloseForm shiftId={shift.id} total={total} />
        </>
      ) : shift.variance !== null && shift.declaredTotal !== null ? (
        <CloseSummary declaredTotal={shift.declaredTotal} variance={shift.variance} />
      ) : null}
    </div>
  );
}
