import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CashTicketsTable } from "@/components/cash-tickets/cash-tickets-table";
import { RecordCashTicketsDialog } from "@/components/cash-tickets/record-dialog";
import { shiftsOn, ticketFees, ticketsOn } from "@/lib/cash-tickets/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Cash tickets (spec "cash_ticket_sales"): comfort-room and similar tickets, sold for cash
 * the collector remits but on no OR. Entered per collector per day against their shift; the
 * shift's total and variance follow. Cancelling needs a reason; nothing is deleted.
 */
export default async function CashTicketsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireStaff();
  const { date: raw } = await searchParams;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : manilaToday();
  const [shifts, fees, rows] = await Promise.all([shiftsOn(date), ticketFees(), ticketsOn(date)]);
  return (
    <div>
      <ScreenHeader
        title="Cash tickets"
        note="Ticket money the collector hands over with their ORs. Enter it against the collector's shift for the day, before the shift is remitted."
        actions={<RecordCashTicketsDialog shifts={shifts} fees={fees} />}
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Day
          <TextInput type="date" name="date" defaultValue={date} className="mt-1 w-44" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <CashTicketsTable rows={rows} />
    </div>
  );
}
