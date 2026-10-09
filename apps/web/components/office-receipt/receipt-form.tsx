"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { useSubmit } from "@/components/ui/use-submit";
import { officeUnpaidGroups, postOfficeReceipt } from "@/lib/office-receipt/actions";
import type { OfficeFee, OfficeShift } from "@/lib/office-receipt/queries";
import type { UnpaidGroup } from "@/lib/recovery/months";
import type { HeldBooklet } from "@/lib/recovery/queries";
import { pesos } from "@/lib/reports/report";
import type { SaveResult } from "@/lib/admin/save-result";

type Line = { feeTypeId: string; keyed: boolean; rateClass: string; quantity: string; amount: string };
const emptyLine: Line = { feeTypeId: "", keyed: false, rateClass: "", quantity: "1", amount: "" };

export function OfficeReceiptForm({
  shift, booklets, leases, fees,
}: { shift: OfficeShift; booklets: HeldBooklet[]; leases: { id: string; label: string }[]; fees: OfficeFee[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"rent" | "fees">("rent");
  const [leaseId, setLeaseId] = useState("");
  const [groups, setGroups] = useState<UnpaidGroup[]>([]);
  const [ticked, setTicked] = useState(0); // the oldest N groups
  const [lines, setLines] = useState<Line[]>([emptyLine]);
  const [mode, setMode] = useState<"cash" | "check">("cash");
  const [result, setResult] = useState<SaveResult | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form so the uncontrolled fields clear after a post

  async function chooseLease(id: string) {
    setLeaseId(id);
    setTicked(0);
    setGroups(id && kind === "rent" ? await officeUnpaidGroups(id) : []);
  }

  const lineTotal = (l: Line) => {
    if (l.keyed) return Math.round(Number(l.amount || 0) * 100);
    const fee = fees.find((f) => f.id === l.feeTypeId);
    const rate = fee?.rateClasses.find((r) => r.rateClass === l.rateClass);
    return (rate?.amount ?? 0) * Number(l.quantity || 0);
  };
  const total = kind === "rent"
    ? groups.slice(0, ticked).reduce((a, g) => a + g.outstanding, 0)
    : lines.reduce((a, l) => a + lineTotal(l), 0);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    formData.set("kind", kind);
    formData.set("months", Array.from({ length: ticked }, (_, i) => i + 1).join(","));
    formData.set("lines", JSON.stringify(lines.map((l) => ({
      feeTypeId: l.feeTypeId, keyed: l.keyed, rateClass: l.rateClass, quantity: l.quantity, amount: l.amount,
    }))));
    const outcome = await postOfficeReceipt(formData);
    setResult(outcome);
    if (outcome.ok) {
      setLines([emptyLine]); setTicked(0); setGroups([]); setLeaseId(""); setFormKey((k) => k + 1);
      router.refresh();
    }
  });
  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <form key={formKey} onSubmit={onSubmit} className="mb-8 rounded-lg border border-rule p-4">
      <h2 className="mb-3 text-sm font-semibold">Add a receipt</h2>
      <input type="hidden" name="shiftId" value={shift.id} />
      <input type="hidden" name="businessDate" value={shift.businessDate} />
      <div className="grid grid-cols-3 gap-x-3">
        <FieldShell id="bookletId" label="Booklet" error={errors.bookletId}>
          <NativeSelect id="bookletId" name="bookletId" defaultValue="">
            <option value="" disabled>{booklets.length ? "Choose…" : "This officer held no booklet that day"}</option>
            {booklets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </NativeSelect>
        </FieldShell>
        <FieldShell id="orNo" label="OR number" error={errors.orNo}>
          <TextInput id="orNo" name="orNo" inputMode="numeric" autoComplete="off" />
        </FieldShell>
        <FieldShell id="kind" label="For">
          <NativeSelect id="kind" value={kind} onChange={(e) => { setKind(e.target.value as "rent" | "fees"); setGroups([]); setTicked(0); }}>
            <option value="rent">Rent (unpaid months)</option>
            <option value="fees">Fees (electricity, occupancy, certification…)</option>
          </NativeSelect>
        </FieldShell>
      </div>

      <FieldShell id="leaseId" label={kind === "rent" ? "Lease" : "Lease (occupancy fee only)"} error={errors.leaseId}>
        <NativeSelect id="leaseId" name="leaseId" value={leaseId} onChange={(e) => chooseLease(e.target.value)}>
          <option value="">{kind === "rent" ? "Choose…" : "None"}</option>
          {leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </NativeSelect>
      </FieldShell>

      {kind === "rent" ? (
        <FieldShell id="months" label="Months paid" error={errors.months} help="Oldest first; tick through the last month paid.">
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {groups.map((g, i) => (
              <li key={g.groupRank}>
                <label className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <input type="checkbox" checked={i < ticked} onChange={() => setTicked(i < ticked ? i : i + 1)} />
                  <span className="flex-1">{g.periodStart} – {g.periodEnd}</span>
                  <span className="tabular-nums">{pesos(g.outstanding)}</span>
                </label>
              </li>
            ))}
          </ul>
        </FieldShell>
      ) : (
        <FieldShell id="lines" label="Fees" error={errors.lines}>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const fee = fees.find((f) => f.id === l.feeTypeId);
              const set = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="flex gap-2">
                  <NativeSelect value={l.feeTypeId} onChange={(e) => {
                    const f = fees.find((x) => x.id === e.target.value);
                    set({ feeTypeId: e.target.value, keyed: f?.keyed ?? false, rateClass: f?.rateClasses[0]?.rateClass ?? "" });
                  }}>
                    <option value="" disabled>Choose a fee…</option>
                    {fees.map((f) => (
                      <option key={f.id} value={f.id} disabled={!f.keyed && f.rateClasses.length === 0}>
                        {f.name}{!f.keyed && f.rateClasses.length === 0 ? " (no rate in effect)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  {l.keyed ? (
                    <TextInput type="number" step="0.01" min="0.01" placeholder="Amount" className="w-32"
                      value={l.amount} onChange={(e) => set({ amount: e.target.value })} />
                  ) : (
                    <>
                      {fee && fee.rateClasses.length > 1 ? (
                        <NativeSelect value={l.rateClass} onChange={(e) => set({ rateClass: e.target.value })}>
                          {fee.rateClasses.map((r) => <option key={r.rateClass} value={r.rateClass}>{r.rateClass || "standard"}</option>)}
                        </NativeSelect>
                      ) : null}
                      <TextInput type="number" min="1" step="1" className="w-20" value={l.quantity}
                        onChange={(e) => set({ quantity: e.target.value })} />
                    </>
                  )}
                  <span className="w-28 self-center text-right tabular-nums">{pesos(lineTotal(l))}</span>
                </div>
              );
            })}
            <button type="button" className="text-xs underline" onClick={() => setLines([...lines, emptyLine])}>
              Add a fee line
            </button>
          </div>
        </FieldShell>
      )}

      <div className="grid grid-cols-4 gap-x-3">
        <FieldShell id="payerRef" label="Payer (if not a tenant)">
          <TextInput id="payerRef" name="payerRef" autoComplete="off" />
        </FieldShell>
        <FieldShell id="paymentMode" label="Paid by">
          <NativeSelect id="paymentMode" name="paymentMode" value={mode} onChange={(e) => setMode(e.target.value as "cash" | "check")}>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </NativeSelect>
        </FieldShell>
        {mode === "check" ? (
          <>
            <FieldShell id="checkNo" label="Check no." error={errors.checkNo}><TextInput id="checkNo" name="checkNo" /></FieldShell>
            <FieldShell id="bank" label="Bank" error={errors.bank}><TextInput id="bank" name="bank" /></FieldShell>
            <FieldShell id="checkDate" label="Check date" error={errors.checkDate}>
              <TextInput id="checkDate" name="checkDate" type="date" />
            </FieldShell>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm">Receipt total: <strong className="tabular-nums">{pesos(total)}</strong></span>
        <Button type="submit" variant="primary" loading={busy}>{busy ? "Posting…" : "Post receipt"}</Button>
      </div>
      {result && !result.ok && result.formError ? (
        <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">{result.formError}</p>
      ) : null}
    </form>
  );
}
