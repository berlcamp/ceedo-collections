"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { recordCashTickets } from "@/lib/cash-tickets/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/** Enters ticket money against a collector's shift for the day. */
export function RecordCashTicketsDialog({
  shifts,
  fees,
}: {
  shifts: { id: string; label: string }[];
  fees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await recordCashTickets(formData);
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
        Enter cash tickets
      </DialogTrigger>
      <DialogContent
        busy={busy}
        title="Enter cash tickets"
        description="Ticket money the collector remits that is on no OR."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="cash-ticket-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="cash-ticket-form" onSubmit={onSubmit}>
          <FieldShell id="shiftId" label="Collector's shift" error={errors.shiftId}>
            <NativeSelect id="shiftId" name="shiftId" defaultValue="">
              <option value="" disabled>{shifts.length ? "Choose…" : "No open shift on this day"}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell id="feeTypeId" label="Ticket" error={errors.feeTypeId}>
            <NativeSelect id="feeTypeId" name="feeTypeId" defaultValue="">
              <option value="" disabled>Choose…</option>
              {fees.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </NativeSelect>
          </FieldShell>
          <FieldShell id="amount" label="Amount" error={errors.amount}>
            <TextInput id="amount" name="amount" type="number" step="0.01" min="0.01" />
          </FieldShell>
          <div className="grid grid-cols-2 gap-x-3">
            <FieldShell id="ticketFrom" label="First ticket no. (optional)" error={errors.ticketFrom}>
              <TextInput id="ticketFrom" name="ticketFrom" type="number" min="1" step="1" />
            </FieldShell>
            <FieldShell id="ticketTo" label="Last ticket no. (optional)" error={errors.ticketTo}>
              <TextInput id="ticketTo" name="ticketTo" type="number" min="1" step="1" />
            </FieldShell>
          </div>
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
