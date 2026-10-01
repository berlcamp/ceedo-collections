import { fromCentavos, sum, type Centavos } from "@ceedo/shared";

export interface ReceiptTotals {
  count: number;
  total: Centavos;
}

export interface ReceiptLike {
  grossAmount: number;
  cancelled: boolean;
}

/**
 * The receipt count and gross total the Recovery screen shows, in both the receipts table
 * and the close form's "System total" -- excluding cancelled receipts, the same exclusion
 * `office_close_shift`'s own query applies (`supabase/migrations/20260930000060_office_
 * recovery.sql`: `not exists (select 1 from standing_cancellations ...)`). A cancelled
 * receipt stays listed, marked Cancelled, but counts toward neither figure, so what this
 * screen shows before closing matches what the close will actually book.
 */
export function receiptTotals(receipts: ReceiptLike[]): ReceiptTotals {
  const live = receipts.filter((r) => !r.cancelled);
  return { count: live.length, total: sum(live.map((r) => fromCentavos(r.grossAmount))) };
}
