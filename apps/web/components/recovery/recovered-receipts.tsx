import { fromCentavos } from "@ceedo/shared";
import { Money } from "@/components/ledger/money";
import { Mark } from "@/components/ui/mark";
import { Notice } from "@/components/ui/panel";
import { formatDate } from "@/lib/format/date";
import type { RecoveryShift } from "@/lib/recovery/queries";
import { receiptTotals } from "@/lib/recovery/receipt-totals";
import { heardFromAfterManilaMidnight } from "@/lib/recovery/tablet-activity";

/**
 * The shift's own receipts, first -- from the tablet or already office-encoded in an
 * earlier session on this same shift. No hooks: this is read straight from the page's own
 * fetch and never needs to re-render on its own, so it stays a Server Component rather than
 * paying for a client bundle the way every other table on this app does (`DataTable`'s
 * sort/filter/URL state is for a list big enough to need it; a shift's receipts are not).
 */
export function RecoveredReceipts({ shift }: { shift: RecoveryShift }) {
  // A cancelled receipt stays listed below, marked Cancelled, but counts toward neither
  // figure here -- the same exclusion office_close_shift's own query applies (Task 1).
  const { count, total } = receiptTotals(shift.receipts);

  return (
    <div className="mb-6">
      {shift.lastSeenAt && heardFromAfterManilaMidnight(shift.lastSeenAt, shift.businessDate) ? (
        <Notice tone="warning" className="mb-3">
          This tablet was last heard from {formatDate(shift.lastSeenAt)}. Recover only if its
          data was lost; a tablet still in use would send these receipts again.
        </Notice>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-rule bg-tape-raised">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule bg-tape text-left">
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">OR No.</th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Stall / Payer</th>
              <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-2">Amount</th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {shift.receipts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-sm text-ink-3">
                  No receipt recorded on this shift yet.
                </td>
              </tr>
            ) : (
              shift.receipts.map((r) => (
                <tr key={r.id} className="border-b border-rule-soft last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs text-ink">
                    <span className={r.cancelled ? "text-ink-3 line-through" : undefined}>{r.orNo}</span>
                  </td>
                  <td className="px-4 py-2 text-ink">{r.stallOrPayer}</td>
                  <td className="px-4 py-2 text-right">
                    <Money amount={fromCentavos(r.grossAmount)} muted={r.cancelled} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <Mark tone={r.officeEncoded ? "office" : "neutral"}>
                        {r.officeEncoded ? "Office-encoded" : "From tablet"}
                      </Mark>
                      {/* Task 1: reuses the same cancelled marker style as the collection
                          browser's Status column (components/ledger/collections-table.tsx),
                          and the same exclusion -- see receiptTotals(). */}
                      {r.cancelled ? <Mark tone="alert">Cancelled</Mark> : null}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {shift.receipts.length > 0 ? (
            <tfoot>
              <tr className="border-t border-rule bg-tape">
                <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-ink-2">
                  {count} receipt{count === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-2 text-right font-semibold">
                  <Money amount={total} />
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
