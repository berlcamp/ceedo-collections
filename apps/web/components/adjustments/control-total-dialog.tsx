"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextInput } from "@/components/ui/field";
import { recordControlTotal } from "@/lib/adjustments/actions";
import { longMonth } from "@/lib/reports/params";
import type { SaveResult } from "@/lib/admin/save-result";

/** Records the cashier's control total for a month. */
export function ControlTotalDialog({ month }: { month: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await recordControlTotal(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  });

  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger className={buttonClass("primary", "md")}>
        <Plus size={14} strokeWidth={2} />
        Enter control total
      </DialogTrigger>
      <DialogContent
        busy={busy}
        title="Cashier's control total"
        description={`The cashier's figure for ${longMonth(month)}. A new entry replaces the one in force; earlier entries stay on record.`}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="control-total-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="control-total-form" onSubmit={onSubmit}>
          <input type="hidden" name="month" value={month} />
          <FieldShell id="amount" label="Amount" error={errors.amount}>
            <TextInput id="amount" name="amount" type="number" step="0.01" min="0" />
          </FieldShell>
          <FieldShell id="note" label="Note" error={errors.note}>
            <TextInput id="note" name="note" autoComplete="off" />
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
