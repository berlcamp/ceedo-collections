import Link from "next/link";
import { fromCentavos } from "@ceedo/shared";
import { Money } from "@/components/ledger/money";
import { Notice } from "@/components/ui/panel";
import { closeNotice } from "@/lib/recovery/close-result";

/**
 * The closed shift's own variance, read back from the shift row rather than kept in
 * `CloseForm`'s component state -- that state is gone the moment `router.refresh()` lands
 * and the page stops rendering `<CloseForm>` (shift.status is no longer "open"), so without
 * this the "Short ₱X -- record repayments under Shortages" notice spec 2026-09-30-office-
 * recovery §4.1(3) requires would flash once and then be unreachable on every reload. No
 * hooks, same reasoning as `RecoveredReceipts`.
 */
export function CloseSummary({ declaredTotal, variance }: { declaredTotal: number; variance: number }) {
  const notice = closeNotice(fromCentavos(variance));
  return (
    <div className="mt-6 max-w-xl">
      <p className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-ink-2">Cash handed over</span>
        <span className="font-semibold">
          <Money amount={fromCentavos(declaredTotal)} />
        </span>
      </p>
      <Notice tone={notice.tone}>
        {notice.message}
        {notice.shortageLink ? (
          <>
            {" "}
            <Link href="/ledger/shortages" className="font-semibold underline">
              Go to Shortages
            </Link>
          </>
        ) : null}
      </Notice>
    </div>
  );
}
