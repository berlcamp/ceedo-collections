import { sum, type Centavos } from "@ceedo/shared";

/**
 * What close_office_shift counts as the office day's system total
 * (supabase/migrations/20261008000069_cash_tickets.sql): receipts not under a standing
 * cancellation, plus the live cash tickets entered on the shift. The screen's total and the
 * close form's default "handed over" use this so they match what the close books.
 */
export function officeShiftTotal(
  receipts: readonly { amount: Centavos; cancelled: boolean }[],
  cashTickets: readonly { amount: Centavos }[],
): Centavos {
  return sum([...receipts.filter((r) => !r.cancelled), ...cashTickets].map((x) => x.amount));
}
