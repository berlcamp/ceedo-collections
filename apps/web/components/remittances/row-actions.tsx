"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useBusy, useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextArea } from "@/components/ui/field";
import { cancelRemittance, verifyRemittance } from "@/lib/remittances/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/** Accounting's check against the bank. Shown only to someone who may verify this slip. */
export function VerifyButton({ id }: { id: string }) {
  const router = useRouter();
  const { busy, run } = useBusy();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() =>
          run(async () => {
            const outcome = await verifyRemittance(id);
            if (outcome.ok) router.refresh();
            else setError(outcome.formError ?? "Could not verify.");
          })
        }
      >
        {busy ? "Verifying…" : "Verify"}
      </Button>
      {error ? <span className="text-xs text-ribbon">{error}</span> : null}
    </span>
  );
}

/** Voids a wrong entry before it is verified, releasing its shifts for a corrected slip. */
export function CancelRemittanceDialog({ id, slip }: { id: string; slip: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await cancelRemittance(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger className={buttonClass("ghost", "sm", "text-ribbon hover:bg-ribbon-soft hover:text-ribbon")}>
        Cancel
      </DialogTrigger>
      <DialogContent
        busy={busy}
        tone="danger"
        width="sm"
        title={`Cancel slip ${slip}`}
        description="The entry stays on the record, marked cancelled. Its shifts become free for a corrected slip."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Close</DialogClose>
            <Button type="submit" form={`cancel-${id}`} variant="danger" loading={busy}>
              {busy ? "Cancelling…" : "Cancel slip"}
            </Button>
          </>
        }
      >
        <form id={`cancel-${id}`} onSubmit={onSubmit}>
          <input type="hidden" name="remittanceId" value={id} />
          <FieldShell
            id={`reason-${id}`}
            label="Reason"
            error={result && !result.ok ? result.fieldErrors.reason : undefined}
          >
            <TextArea id={`reason-${id}`} name="reason" rows={3} />
          </FieldShell>
          {result && !result.ok && result.formError ? (
            <p className="mt-3 text-xs text-ribbon">{result.formError}</p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
