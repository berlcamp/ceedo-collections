"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextArea } from "@/components/ui/field";
import { cancelCollection, reinstateCollection } from "@/lib/ledger/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * Voids a posted receipt (§11.3). Nothing on the collection itself changes -- there is no
 * UPDATE privilege on it, by design (migration 20260918000023) -- this dialog only ever
 * inserts a cancellation row through cancel_collection(). Rendered only for a supervisor
 * or admin; see the collections page for that gate.
 */
export function CancelDialog({ collectionId, orNo }: { collectionId: string; orNo: number }) {
  return (
    <ReasonDialog
      collectionId={collectionId}
      action={cancelCollection}
      trigger="Cancel"
      triggerClass="text-ribbon hover:bg-ribbon-soft hover:text-ribbon"
      tone="danger"
      title={`Void OR ${orNo}`}
      description="The receipt stays on the record -- this only stops it counting toward what is owed, and needs a written reason."
      submit="Void receipt"
      submitting="Voiding…"
    />
  );
}

/**
 * Undoes a void. Appends a reinstatement through reinstate_collection() (migration
 * 20260928000051); the cancellation stays on the record beside it, and the receipt counts
 * again. Same gate as cancelling.
 */
export function UndoCancelDialog({ collectionId, orNo }: { collectionId: string; orNo: number }) {
  return (
    <ReasonDialog
      collectionId={collectionId}
      action={reinstateCollection}
      trigger="Undo cancel"
      title={`Reinstate OR ${orNo}`}
      description="The receipt counts toward what was collected again. The cancellation and this undo both stay on the record, and it needs a written reason."
      submit="Reinstate receipt"
      submitting="Reinstating…"
    />
  );
}

function ReasonDialog({
  collectionId,
  action,
  trigger,
  triggerClass,
  tone,
  title,
  description,
  submit,
  submitting,
}: {
  collectionId: string;
  action: (formData: FormData) => Promise<SaveResult>;
  trigger: string;
  triggerClass?: string;
  tone?: "danger";
  title: string;
  description: string;
  submit: string;
  submitting: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const formId = `reason-form-${collectionId}`;

  // A dialog reopened after a failed save should not still be wearing that attempt's
  // errors. Cleared as the dialog closes, not in an effect watching the state that just
  // changed — that is a cascading render for something the event already knows.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setResult(null);
  }

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await action(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={buttonClass("ghost", "sm", triggerClass)}>{trigger}</DialogTrigger>
      <DialogContent
        busy={pending}
        {...(tone ? { tone } : {})}
        width="sm"
        title={title}
        description={description}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={pending}>Close</DialogClose>
            <Button type="submit" form={formId} variant={tone ?? "primary"} loading={pending}>
              {pending ? submitting : submit}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit}>
          <input type="hidden" name="collectionId" value={collectionId} />
          <FieldShell id={`${formId}-reason`} label="Reason">
            <TextArea id={`${formId}-reason`} name="reason" required rows={3} />
          </FieldShell>

          {result && !result.ok && result.formError ? (
            <p className="mt-2 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs leading-relaxed text-ribbon">
              {result.formError}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
