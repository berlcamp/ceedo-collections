"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextArea } from "@/components/ui/field";
import { cancelCollection } from "@/lib/ledger/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * Voids a posted receipt (§11.3). Nothing on the collection itself changes -- there is no
 * UPDATE privilege on it, by design (migration 20260918000023) -- this dialog only ever
 * inserts a cancellation row through cancel_collection(). Rendered only for a supervisor
 * or admin; see the collections page for that gate.
 */
export function CancelDialog({ collectionId, orNo }: { collectionId: string; orNo: number }) {
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
    const outcome = await cancelCollection(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={buttonClass("ghost", "sm", "text-ribbon hover:bg-ribbon-soft hover:text-ribbon")}>
        Cancel
      </DialogTrigger>
      <DialogContent
        tone="danger"
        width="sm"
        title={`Void OR ${orNo}`}
        description="The receipt stays on the record -- this only stops it counting toward what is owed, and needs a written reason."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Close</DialogClose>
            <Button type="submit" form="cancel-form" variant="danger" disabled={pending}>
              {pending ? "Voiding…" : "Void receipt"}
            </Button>
          </>
        }
      >
        <form id="cancel-form" action={onSubmit}>
          <input type="hidden" name="collectionId" value={collectionId} />
          <FieldShell id="cancel-reason" label="Reason">
            <TextArea id="cancel-reason" name="reason" required rows={3} />
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
