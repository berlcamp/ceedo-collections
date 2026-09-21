"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button, buttonClass, type ButtonVariant } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextArea, TextInput } from "@/components/ui/field";
import {
  correctException,
  escalateException,
  spoilException,
} from "@/lib/ledger/exception-actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * The three actions §11.3 names for a supervisor resolving a sync exception. Each writes
 * something different against real, already-collected cash (see `lib/ledger/
 * exception-actions.ts`'s own comments): a correction re-posts under the original client
 * UUID, spoiling writes `spoiled_forms` and posts nothing, and escalation only changes a
 * status. A written reason is required on all three -- the database enforces this too, but
 * the field being `required` here means the supervisor sees it as a form rule, not a
 * Postgres error.
 *
 * All three share one shell so they cannot drift apart in chrome, spacing or button
 * vocabulary; only the trigger, the copy and the submit verb differ.
 */
function ExceptionDialog({
  action,
  formId,
  trigger,
  triggerTone,
  title,
  description,
  tone,
  submit,
  submitting,
  submitVariant,
  children,
}: {
  action: (formData: FormData) => Promise<SaveResult>;
  formId: string;
  trigger: string;
  triggerTone?: string;
  title: string;
  description: string;
  tone?: "neutral" | "danger";
  submit: string;
  submitting: string;
  submitVariant: ButtonVariant;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  // A dialog reopened after a failed save should not still be wearing that attempt's
  // errors. Cleared as the dialog closes, not in an effect watching the state that just
  // changed — that is a cascading render for something the event already knows.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setResult(null);
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await action(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={buttonClass("ghost", "sm", triggerTone)}>{trigger}</DialogTrigger>
      <DialogContent
        width="sm"
        {...(tone ? { tone } : {})}
        title={title}
        description={description}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Close</DialogClose>
            <Button type="submit" form={formId} variant={submitVariant} disabled={pending}>
              {pending ? submitting : submit}
            </Button>
          </>
        }
      >
        <form id={formId} action={onSubmit}>
          {children}
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

export function CorrectExceptionDialog({
  exceptionId,
  currentOrNo,
}: {
  exceptionId: string;
  /** Defaults the OR field to what the device actually sent -- most corrections change a
   * claim (lease, period), not the OR number itself. */
  currentOrNo: number | null;
}) {
  return (
    <ExceptionDialog
      action={correctException}
      formId={`correct-${exceptionId}`}
      trigger="Accept with correction"
      title="Accept with correction"
      description="Re-posts this receipt under the corrected OR number. Only the claims change -- the amount is priced by the server, exactly as it is on a device."
      submit="Accept with correction"
      submitting="Posting…"
      submitVariant="primary"
    >
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <FieldShell id={`correct-or-no-${exceptionId}`} label="OR number">
        <TextInput
          id={`correct-or-no-${exceptionId}`}
          name="orNo"
          type="number"
          step="1"
          min="1"
          required
          defaultValue={currentOrNo ?? undefined}
        />
      </FieldShell>
      <FieldShell id={`correct-reason-${exceptionId}`} label="Reason">
        <TextArea id={`correct-reason-${exceptionId}`} name="reason" required rows={3} />
      </FieldShell>
    </ExceptionDialog>
  );
}

export function SpoilExceptionDialog({ exceptionId }: { exceptionId: string }) {
  return (
    <ExceptionDialog
      action={spoilException}
      formId={`spoil-${exceptionId}`}
      trigger="Mark spoiled"
      triggerTone="text-ribbon hover:bg-ribbon-soft hover:text-ribbon"
      tone="danger"
      title="Mark this OR spoiled"
      description="Records the serial as spoiled. No collection is posted -- use this only when the paper receipt itself was voided, not merely mis-recorded."
      submit="Mark spoiled"
      submitting="Recording…"
      submitVariant="danger"
    >
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <FieldShell id={`spoil-reason-${exceptionId}`} label="Reason">
        <TextArea id={`spoil-reason-${exceptionId}`} name="reason" required rows={3} />
      </FieldShell>
    </ExceptionDialog>
  );
}

export function EscalateExceptionDialog({ exceptionId }: { exceptionId: string }) {
  return (
    <ExceptionDialog
      action={escalateException}
      formId={`escalate-${exceptionId}`}
      trigger="Escalate"
      title="Escalate for investigation"
      description="A status, not a resolution -- this exception stays open and still counts against the collector at closeout. Use it when neither correcting nor spoiling is the right call yet."
      submit="Escalate"
      submitting="Escalating…"
      submitVariant="primary"
    >
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <FieldShell id={`escalate-reason-${exceptionId}`} label="Reason">
        <TextArea id={`escalate-reason-${exceptionId}`} name="reason" required rows={3} />
      </FieldShell>
    </ExceptionDialog>
  );
}
