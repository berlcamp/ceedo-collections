"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextInput } from "@/components/ui/field";
import { createCollector } from "@/lib/staff/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * A collector is added here directly. They never sign in to the web, only to a tablet with
 * their name and a PIN, so they need no Google account. Web staff (supervisor,
 * accounting, admin) are invited instead: see the Staff screen's other button.
 */
export function AddCollectorDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await createCollector(formData);
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
        Add collector
      </DialogTrigger>
      <DialogContent
        busy={busy}
        width="sm"
        title="Add a collector"
        description="Collectors sign in to tablets by picking their name and entering a PIN, so they need no Google account. Set the PIN after adding them."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="add-collector-form" variant="primary" loading={busy}>
              {busy ? "Adding…" : "Add collector"}
            </Button>
          </>
        }
      >
        <form id="add-collector-form" onSubmit={onSubmit}>
          <FieldShell id="fullName" label="Full name" error={errors.fullName}>
            <TextInput id="fullName" name="fullName" autoComplete="off" />
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
