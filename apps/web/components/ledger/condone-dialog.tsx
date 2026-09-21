"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Centavos } from "@ceedo/shared";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextArea, TextInput } from "@/components/ui/field";
import { condoneCharge } from "@/lib/ledger/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * Writes off part or all of a charge under a council amnesty ordinance (§8.4). Admin only
 * -- rendered from a charge row in the subsidiary ledger, never on its own screen, because
 * an ordinance references a specific tenant's specific debt, not "condone something".
 */
export function CondoneDialog({
  chargeId,
  leaseId,
  outstanding,
  detail,
}: {
  chargeId: string;
  leaseId: string;
  /** Defaults the amount field -- condoning more than this is refused by the database. */
  outstanding: Centavos;
  detail: string;
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
    const outcome = await condoneCharge(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={buttonClass("ghost", "sm")}>Condone</DialogTrigger>
      <DialogContent
        title={`Condone ${detail}`}
        description="Writes off this charge against an authorising ordinance. Cannot exceed the amount still outstanding."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Close</DialogClose>
            <Button type="submit" form="condone-form" variant="primary" disabled={pending}>
              {pending ? "Condoning…" : "Condone"}
            </Button>
          </>
        }
      >
        <form id="condone-form" action={onSubmit}>
          <input type="hidden" name="chargeId" value={chargeId} />
          <input type="hidden" name="leaseId" value={leaseId} />

          <FieldShell id="condone-amount" label="Amount">
            <TextInput
              id="condone-amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              defaultValue={(outstanding / 100).toFixed(2)}
            />
          </FieldShell>

          <FieldShell id="condone-authority" label="Ordinance reference">
            <TextInput
              id="condone-authority"
              name="authorityRef"
              type="text"
              required
              placeholder="e.g. City Ordinance 2026-14"
            />
          </FieldShell>

          <FieldShell id="condone-reason" label="Reason">
            <TextArea id="condone-reason" name="reason" required rows={3} />
          </FieldShell>

          {result && !result.ok && result.formError ? (
            <p className="mt-2 border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs leading-relaxed text-ribbon">
              {result.formError}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
