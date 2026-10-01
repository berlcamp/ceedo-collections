"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { format, fromCentavos, multiply } from "@ceedo/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { FieldShell, TextArea, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { useSubmit } from "@/components/ui/use-submit";
import { recoverReceipt, unpaidGroupsFor } from "@/lib/recovery/actions";
import { canTick, tickedTotal, type UnpaidGroup } from "@/lib/recovery/months";
import type { CashFeeType, HeldBooklet, RecoveryLeaseOption, RecoveryShift } from "@/lib/recovery/queries";
import type { SaveResult } from "@/lib/admin/save-result";

type Kind = "lease" | "cash";

/**
 * Step 2's entry form. One submission is one receipt, run through `recover_collection` ->
 * `post_collection` -- the booklet, serial, oldest-months-first and rate rules below are
 * only client-side previews of rules the server owns; a refusal from there always wins and
 * is shown verbatim (spec 2026-09-30-office-recovery §4.1).
 *
 * The reason field is deliberately plain component state, not read back from `audit_log`:
 * it is written once per session and carried into every receipt that follows, the same
 * reason typed for the shift itself in `ShiftPicker` but re-entered here because this
 * component never sees that one.
 */
export function ReceiptForm({
  shift,
  booklets,
  leases,
  fees,
}: {
  shift: RecoveryShift;
  booklets: HeldBooklet[];
  leases: RecoveryLeaseOption[];
  fees: CashFeeType[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [bookletId, setBookletId] = useState("");
  const [orNo, setOrNo] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState<Kind>("lease");

  const [leaseId, setLeaseId] = useState("");
  const [unpaidGroups, setUnpaidGroups] = useState<UnpaidGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);

  const [feeTypeId, setFeeTypeId] = useState("");
  const [rateClass, setRateClass] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [payerRef, setPayerRef] = useState("");

  const [stubTotal, setStubTotal] = useState("");
  const [result, setResult] = useState<SaveResult | null>(null);

  async function onLeaseChange(value: string) {
    setLeaseId(value);
    setTicked([]);
    setUnpaidGroups([]);
    setGroupsError(null);
    setResult(null);
    if (!value) return;
    setLoadingGroups(true);
    try {
      setUnpaidGroups(await unpaidGroupsFor(value));
    } catch (e) {
      setGroupsError((e as Error).message);
    } finally {
      setLoadingGroups(false);
    }
  }

  function toggleMonth(rank: number, on: boolean) {
    if (!canTick(unpaidGroups, ticked, rank)) return;
    setTicked(on ? [...ticked, rank].sort((a, b) => a - b) : ticked.filter((r) => r !== rank));
  }

  function onFeeChange(value: string) {
    setFeeTypeId(value);
    const fee = fees.find((f) => f.id === value);
    setRateClass(fee && fee.rateClasses.length === 1 ? fee.rateClasses[0]!.rateClass : "");
    setResult(null);
  }

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await recoverReceipt(formData);
    setResult(outcome);
    if (outcome.ok) {
      // Keep booklet, reason and kind; clear everything a new receipt would need to be
      // re-entered for, per spec 2026-09-30-office-recovery §4.1. The lease's unpaid
      // months are also cleared rather than kept selected: the months just paid are no
      // longer in that list, and refetching is simpler than patching it in place.
      setOrNo("");
      setTime("");
      setLeaseId("");
      setUnpaidGroups([]);
      setTicked([]);
      setFeeTypeId("");
      setRateClass("");
      setQuantity("1");
      setPayerRef("");
      setStubTotal("");
      router.refresh();
    }
  });

  const errors = result && !result.ok ? result.fieldErrors : {};
  const selectedFee = fees.find((f) => f.id === feeTypeId);
  const selectedRate = selectedFee?.rateClasses.find((rc) => rc.rateClass === rateClass) ?? null;
  const qty = Number(quantity);
  const cashPreview =
    selectedRate && Number.isInteger(qty) && qty > 0
      ? format(multiply(fromCentavos(selectedRate.amount), qty))
      : null;
  const leaseTickedTotal = format(fromCentavos(tickedTotal(unpaidGroups, ticked)));

  return (
    <Panel title="Enter a receipt" note="From the booklet stub -- the stub is the only source, and its total is only a cross-check." className="mb-6">
      <form onSubmit={onSubmit}>
        <input type="hidden" name="shiftId" value={shift.id} />
        <input type="hidden" name="businessDate" value={shift.businessDate} />
        <input type="hidden" name="kind" value={kind} />
        {kind === "lease" ? <input type="hidden" name="months" value={ticked.join(",")} /> : null}

        <FieldShell
          id="rf-reason"
          label="Reason"
          help="Entered once, kept for every receipt this session posts."
          error={errors.reason}
        >
          <TextArea
            id="rf-reason"
            name="reason"
            rows={2}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FieldShell>

        <div className="grid grid-cols-2 gap-x-3">
          <FieldShell id="rf-booklet" label="Booklet" error={errors.bookletId}>
            <Select
              id="rf-booklet"
              name="bookletId"
              value={bookletId}
              onValueChange={(v) => {
                setBookletId(v);
                setResult(null);
              }}
              options={booklets.map((b) => ({ value: b.id, label: b.label }))}
              placeholder="Choose the booklet…"
            />
          </FieldShell>
          <FieldShell id="rf-serial" label="Serial" error={errors.orNo}>
            <TextInput
              id="rf-serial"
              name="orNo"
              type="number"
              min="1"
              step="1"
              required
              value={orNo}
              onChange={(e) => setOrNo(e.target.value)}
            />
          </FieldShell>
        </div>

        <FieldShell id="rf-time" label="Time" optional help="Default noon when the stub carries none." error={errors.time}>
          <TextInput id="rf-time" name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </FieldShell>

        <fieldset className="mb-3.5">
          <legend className="caption mb-1 text-ink-2">Kind</legend>
          <div className="flex gap-1.5" role="group" aria-label="Receipt kind">
            <Button
              variant={kind === "lease" ? "primary" : "secondary"}
              size="sm"
              className="flex-1"
              aria-pressed={kind === "lease"}
              onClick={() => setKind("lease")}
            >
              Lease
            </Button>
            <Button
              variant={kind === "cash" ? "primary" : "secondary"}
              size="sm"
              className="flex-1"
              aria-pressed={kind === "cash"}
              onClick={() => setKind("cash")}
            >
              Cash fee
            </Button>
          </div>
        </fieldset>

        {kind === "lease" ? (
          <>
            <FieldShell id="rf-lease" label="Lease" error={errors.leaseId}>
              <Select
                id="rf-lease"
                name="leaseId"
                value={leaseId}
                onValueChange={onLeaseChange}
                options={leases.map((l) => ({ value: l.id, label: l.label }))}
                placeholder="Choose the lease…"
              />
            </FieldShell>

            {loadingGroups ? <p className="mb-3.5 text-xs text-ink-3">Loading unpaid months…</p> : null}
            {groupsError ? (
              <Notice tone="error" className="mb-3.5">
                {groupsError}
              </Notice>
            ) : null}

            {!loadingGroups && leaseId && unpaidGroups.length === 0 && !groupsError ? (
              <Notice tone="warning" className="mb-3.5">
                This lease has no unpaid month.
              </Notice>
            ) : null}

            {unpaidGroups.length > 0 ? (
              <fieldset className="mb-3.5">
                <legend className="caption mb-1 text-ink-2">Months paid</legend>
                <div className="space-y-1.5">
                  {unpaidGroups.map((g) => {
                    const id = `rf-month-${g.groupRank}`;
                    const disabled = !canTick(unpaidGroups, ticked, g.groupRank);
                    return (
                      <label
                        key={g.groupRank}
                        htmlFor={id}
                        className={cn("flex items-center gap-2 text-sm text-ink", disabled && "cursor-not-allowed opacity-55")}
                      >
                        <Checkbox
                          id={id}
                          checked={ticked.includes(g.groupRank)}
                          disabled={disabled}
                          onCheckedChange={(on) => toggleMonth(g.groupRank, on)}
                        />
                        <span>
                          {g.periodStart} – {g.periodEnd}
                        </span>
                        <span className="ml-auto tabular-nums text-ink-2">{format(fromCentavos(g.outstanding))}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.months ? (
                  <p className="mt-1 flex gap-1.5 text-xs font-medium text-ribbon">
                    <span aria-hidden className="select-none">&#8226;</span>
                    <span>{errors.months}</span>
                  </p>
                ) : null}
                {ticked.length > 0 ? (
                  <p className="mt-2 text-xs text-ink-2">
                    Ticked months come to <span className="font-semibold text-ink">{leaseTickedTotal}</span>
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3">
              <FieldShell id="rf-fee" label="Fee" error={errors.feeTypeId}>
                <Select
                  id="rf-fee"
                  name="feeTypeId"
                  value={feeTypeId}
                  onValueChange={onFeeChange}
                  options={fees.map((f) => ({ value: f.id, label: f.name }))}
                  placeholder="Choose the fee…"
                />
              </FieldShell>
              <FieldShell id="rf-quantity" label="Quantity" error={errors.quantity}>
                <TextInput
                  id="rf-quantity"
                  name="quantity"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </FieldShell>
            </div>

            {selectedFee && selectedFee.rateClasses.length === 0 ? (
              <Notice tone="warning" className="mb-3.5">
                No rate for {selectedFee.name} on {shift.businessDate}.
              </Notice>
            ) : null}

            {selectedFee && selectedFee.rateClasses.length > 1 ? (
              <FieldShell id="rf-rate-class" label="Rate class" error={errors.rateClass}>
                <Select
                  id="rf-rate-class"
                  name="rateClass"
                  value={rateClass}
                  onValueChange={(v) => {
                    setRateClass(v);
                    setResult(null);
                  }}
                  options={selectedFee.rateClasses.map((rc) => ({
                    value: rc.rateClass,
                    label: rc.rateClass || "Standard",
                  }))}
                  placeholder="Choose the rate class…"
                />
              </FieldShell>
            ) : selectedFee && selectedFee.rateClasses.length === 1 ? (
              <input type="hidden" name="rateClass" value={selectedFee.rateClasses[0]!.rateClass} />
            ) : null}

            <FieldShell id="rf-payer" label="Payer" optional error={errors.payerRef}>
              <TextInput
                id="rf-payer"
                name="payerRef"
                type="text"
                value={payerRef}
                onChange={(e) => setPayerRef(e.target.value)}
              />
            </FieldShell>

            {cashPreview ? <p className="mb-3.5 text-xs text-ink-2">Comes to <span className="font-semibold text-ink">{cashPreview}</span></p> : null}
          </>
        )}

        <FieldShell id="rf-stub-total" label="Stub total" help="The total written on the booklet stub." error={errors.stubTotal}>
          <TextInput
            id="rf-stub-total"
            name="stubTotal"
            type="number"
            step="0.01"
            min="0"
            required
            value={stubTotal}
            onChange={(e) => setStubTotal(e.target.value)}
          />
        </FieldShell>

        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3.5">
            {result.formError}
          </Notice>
        ) : null}

        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "Recovering…" : "Recover receipt"}
        </Button>
      </form>
    </Panel>
  );
}
