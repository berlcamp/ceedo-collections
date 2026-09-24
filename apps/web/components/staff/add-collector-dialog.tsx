"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextInput } from "@/components/ui/field";
import { createCollector } from "@/lib/staff/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * A collector is added here directly. They never sign in to the web, only to a tablet with
 * their employee number and PIN, so they need no Google account. Web staff (supervisor,
 * accounting, admin) are invited instead: see the Staff screen's other button.
 */
export function AddCollectorDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(formData: FormData) {
    setBusy(true);
    const outcome = await createCollector(formData);
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.refresh();
    }
  }

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
        width="sm"
        title="Add a collector"
        description="Collectors sign in to tablets with their employee number and a PIN, so they need no Google account. Set the PIN after adding them."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Cancel</DialogClose>
            <Button type="submit" form="add-collector-form" variant="primary" disabled={busy}>
              {busy ? "Adding…" : "Add collector"}
            </Button>
          </>
        }
      >
        <form id="add-collector-form" action={onSubmit}>
          <FieldShell
            id="employeeNo"
            label="Employee number"
            help="Shown on the tablet's sign-in list."
            error={errors.employeeNo}
          >
            <TextInput id="employeeNo" name="employeeNo" autoComplete="off" />
          </FieldShell>
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
