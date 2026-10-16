"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, NativeSelect, TextArea, TextInput } from "@/components/ui/field";
import { recordAdjustment } from "@/lib/adjustments/actions";
import type { AccountOption } from "@/lib/adjustments/queries";
import { longMonth } from "@/lib/reports/params";
import type { SaveResult } from "@/lib/admin/save-result";

/** Adds a month's adjustment to one account. */
export function RecordAdjustmentDialog({ month, accounts }: { month: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await recordAdjustment(formData);
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
        Add adjustment
      </DialogTrigger>
      <DialogContent
        busy={busy}
        title="Add adjustment"
        description={`A line no receipt produces, for ${longMonth(month)}. Use a negative amount to reduce the account.`}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="adjustment-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="adjustment-form" onSubmit={onSubmit}>
          <input type="hidden" name="month" value={month} />
          <FieldShell id="accountId" label="Account" error={errors.accountId}>
            <NativeSelect id="accountId" name="accountId" defaultValue="">
              <option value="" disabled>Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell id="amount" label="Amount" error={errors.amount}>
            <TextInput id="amount" name="amount" type="number" step="0.01" />
          </FieldShell>
          <FieldShell id="note" label="Note" error={errors.note}>
            <TextArea id="note" name="note" rows={3} />
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
