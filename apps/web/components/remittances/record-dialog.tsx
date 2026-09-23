"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { recordRemittance } from "@/lib/remittances/actions";
import { pesos } from "@/lib/reports/report";
import type { PendingShift } from "@/lib/remittances/queries";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * A supervisor records the slip a collector brings back from the bank, and ticks the
 * closed shifts whose cash it carried. The amount starts at their declared total, the
 * figure the deposit should match; a different figure is allowed and shows up on the
 * reconciliation as a difference.
 */
export function RecordDialog({
  collectors,
  pending,
  today,
}: {
  collectors: { id: string; name: string }[];
  pending: PendingShift[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collectorId, setCollectorId] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);

  const theirs = pending.filter((s) => s.collectorId === collectorId);
  const declared = theirs.filter((s) => ticked.has(s.id)).reduce((a, s) => a + s.declared, 0);

  function choose(id: string) {
    setCollectorId(id);
    const all = pending.filter((s) => s.collectorId === id);
    setTicked(new Set(all.map((s) => s.id)));
    setAmount((all.reduce((a, s) => a + s.declared, 0) / 100).toFixed(2));
  }

  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    const sum = theirs.filter((s) => next.has(s.id)).reduce((a, s) => a + s.declared, 0);
    setAmount((sum / 100).toFixed(2));
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(null);
      setCollectorId("");
      setTicked(new Set());
      setAmount("");
    }
  }

  async function onSubmit(formData: FormData) {
    setBusy(true);
    const outcome = await recordRemittance(formData);
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }

  const errors = result && !result.ok ? result.fieldErrors : {};
  const withShifts = collectors.filter((c) => pending.some((s) => s.collectorId === c.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={buttonClass("primary", "md")}>
        <Plus size={14} strokeWidth={2} />
        Record deposit
      </DialogTrigger>
      <DialogContent
        title="Record a deposit"
        description="From the collector's deposit slip. Accounting verifies it afterwards."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Cancel</DialogClose>
            <Button type="submit" form="remittance-form" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Record deposit"}
            </Button>
          </>
        }
      >
        <form id="remittance-form" action={onSubmit}>
          <FieldShell id="collectorId" label="Collector" error={errors.collectorId}>
            <NativeSelect
              id="collectorId"
              name="collectorId"
              value={collectorId}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="" disabled>
                {withShifts.length ? "Choose…" : "No collector has an undeposited shift"}
              </option>
              {withShifts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>

          {collectorId ? (
            <FieldShell
              id="shiftIds"
              label="Shifts this deposit covers"
              error={errors.shiftIds}
              help={`Declared cash in the ticked shifts: ${pesos(declared)}`}
            >
              <ul className="divide-y divide-rule rounded-lg border border-rule">
                {theirs.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        name="shiftIds"
                        value={s.id}
                        checked={ticked.has(s.id)}
                        onChange={() => toggle(s.id)}
                      />
                      <span className="flex-1">{s.businessDate}</span>
                      <span className="text-xs text-ink-3">{s.count} receipts</span>
                      <span className="w-24 text-right tabular-nums">{pesos(s.declared)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </FieldShell>
          ) : null}

          <div className="grid grid-cols-2 gap-x-3">
            <FieldShell id="depositSlipNo" label="Deposit slip no." error={errors.depositSlipNo}>
              <TextInput id="depositSlipNo" name="depositSlipNo" autoComplete="off" />
            </FieldShell>
            <FieldShell id="bank" label="Bank" error={errors.bank}>
              <TextInput id="bank" name="bank" defaultValue="Land Bank of the Philippines" />
            </FieldShell>
            <FieldShell id="amount" label="Amount deposited" error={errors.amount}>
              <TextInput
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FieldShell>
            <FieldShell id="depositedAt" label="Date deposited" error={errors.depositedAt}>
              <TextInput id="depositedAt" name="depositedAt" type="date" defaultValue={today} max={today} />
            </FieldShell>
          </div>

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
