"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextInput } from "@/components/ui/field";
import { formatDate } from "@/lib/format/date";
import { pesos } from "@/lib/reports/report";
import { recordSettlement } from "@/lib/shortages/actions";
import type { ShortageRow } from "@/lib/shortages/queries";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * A supervisor records money the collector paid back toward one short shift. The amount
 * starts at everything still owed and not already awaiting verification; less is a part
 * payment, and more is refused by the database.
 */
export function SettleDialog({
  row,
  today,
  trigger = "Record payment",
}: {
  row: ShortageRow;
  today: string;
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await recordSettlement(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  });

  const errors = result && !result.ok ? result.fieldErrors : {};
  const formId = `settle-${row.shiftId}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger className={buttonClass("secondary", "sm")}>{trigger}</DialogTrigger>
      <DialogContent
        busy={busy}
        width="sm"
        title="Record a shortage payment"
        description={`${row.collectorName}, shift of ${formatDate(row.businessDate)}: short ₱${pesos(
          row.short,
        )}, ₱${pesos(row.room)} still to be recorded. Accounting verifies it afterwards.`}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" form={formId} variant="primary" loading={busy}>
              {busy ? "Saving…" : "Record payment"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit}>
          <input type="hidden" name="shiftId" value={row.shiftId} />
          <div className="grid grid-cols-2 gap-x-3">
            <FieldShell id={`${formId}-amount`} label="Amount paid" error={errors.amount}>
              <TextInput
                id={`${formId}-amount`}
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={(row.room / 100).toFixed(2)}
                defaultValue={(row.room / 100).toFixed(2)}
              />
            </FieldShell>
            <FieldShell id={`${formId}-date`} label="Date paid" error={errors.receivedAt}>
              <TextInput
                id={`${formId}-date`}
                name="receivedAt"
                type="date"
                defaultValue={today}
                min={row.businessDate}
                max={today}
              />
            </FieldShell>
          </div>
          <FieldShell
            id={`${formId}-reference`}
            label="Receipt or deposit slip no."
            help="The office receipt given to the collector, or the slip if they paid at the bank."
            error={errors.reference}
          >
            <TextInput id={`${formId}-reference`} name="reference" autoComplete="off" />
          </FieldShell>
          {result && !result.ok && result.formError ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">
              {result.formError}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
