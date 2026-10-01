"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromCentavos } from "@ceedo/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldShell, TextArea, TextInput } from "@/components/ui/field";
import { Money } from "@/components/ledger/money";
import { Notice, Panel } from "@/components/ui/panel";
import { useSubmit } from "@/components/ui/use-submit";
import { closeRecoveredShift } from "@/lib/recovery/actions";
import { closeNotice } from "@/lib/recovery/close-result";
import type { RecoveryShift } from "@/lib/recovery/queries";
import { receiptTotals } from "@/lib/recovery/receipt-totals";
import type { SaveResult } from "@/lib/admin/save-result";

type CloseOutcome = SaveResult & { variance?: number };

/**
 * Step 3: closes the shift against the cash actually handed over, through
 * `office_close_shift`. Until this runs the shift stays open and every receipt entered
 * above is provisional -- the close is the theft check (spec 2026-09-30-office-recovery
 * R5), not a formality after it.
 */
export function CloseForm({ shift }: { shift: RecoveryShift }) {
  const router = useRouter();
  const [result, setResult] = useState<CloseOutcome | null>(null);
  const [confirmLost, setConfirmLost] = useState(false);

  // Excludes cancelled receipts, the same exclusion office_close_shift's own query applies
  // (Task 1) -- this figure must match what the close is actually about to book.
  const { count: receiptCount, total: systemTotal } = receiptTotals(shift.receipts);

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await closeRecoveredShift(formData);
    setResult(outcome);
    if (outcome.ok) router.refresh();
  });

  const errors = result && !result.ok ? result.fieldErrors : {};
  const notice = result?.ok && result.variance !== undefined ? closeNotice(fromCentavos(result.variance)) : null;

  return (
    <Panel
      title="Close the shift"
      note="Against the cash the collector actually hands over. The variance this produces is the same check every ordinary close runs."
      className="max-w-xl"
    >
      <form onSubmit={onSubmit}>
        <input type="hidden" name="shiftId" value={shift.id} />

        <p className="mb-3.5 flex items-baseline justify-between text-sm">
          <span className="text-ink-2">System total ({receiptCount} receipt{receiptCount === 1 ? "" : "s"})</span>
          <span className="font-semibold">
            <Money amount={systemTotal} />
          </span>
        </p>

        <FieldShell id="cf-declared" label="Cash handed over" error={errors.declaredTotal}>
          <TextInput id="cf-declared" name="declaredTotal" type="number" step="0.01" min="0" required />
        </FieldShell>

        <FieldShell id="cf-reason" label="Reason" error={errors.reason}>
          <TextArea id="cf-reason" name="reason" rows={2} required />
        </FieldShell>

        <label htmlFor="cf-confirm-lost" className="mb-3.5 flex cursor-pointer items-start gap-2 text-sm text-ink">
          <Checkbox id="cf-confirm-lost" name="confirmLost" checked={confirmLost} onCheckedChange={setConfirmLost} />
          <span>This tablet&rsquo;s data was lost; it will not send this shift&rsquo;s receipts.</span>
        </label>
        {errors.confirmLost ? (
          <p className="-mt-2.5 mb-3.5 flex gap-1.5 text-xs font-medium text-ribbon">
            <span aria-hidden className="select-none">&#8226;</span>
            <span>{errors.confirmLost}</span>
          </p>
        ) : null}

        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3">
            {result.formError}
          </Notice>
        ) : null}

        {notice ? (
          <Notice tone={notice.tone} className="mb-3">
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
        ) : null}

        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "Closing…" : "Close shift"}
        </Button>
      </form>
    </Panel>
  );
}
