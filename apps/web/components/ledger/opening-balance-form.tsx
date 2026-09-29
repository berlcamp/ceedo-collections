"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSubmit } from "@/components/ui/use-submit";
import { FieldShell, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { recordOpeningBalance } from "@/lib/ledger/actions";
import type { SaveResult } from "@/lib/admin/save-result";
import type { OpeningBalanceLease } from "@/lib/ledger/queries";

/**
 * One day before the cutover. record_opening_balance() refuses an oldest-unpaid date on
 * or after the cutover itself (migration 20260918000013); the date picker's own `max` is
 * the first place a clerk learns that, before the RPC ever runs.
 */
function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Used once, under time pressure, at go-live -- so the lease picker is the punch list
 * itself (leases with no opening balance yet), not a free-text id a clerk could mistype.
 */
export function OpeningBalanceForm({
  leases,
  cutoverDate,
}: {
  leases: OpeningBalanceLease[];
  cutoverDate: string;
}) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const [leaseId, setLeaseId] = useState("");

  const { pending, onSubmit } = useSubmit(async (formData, form) => {
    const outcome = await recordOpeningBalance(formData);
    setResult(outcome);
    if (outcome.ok) {
      form.reset();
      setLeaseId("");
    }
  });

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};

  if (leases.length === 0) {
    return (
      <Panel title="Record an opening balance" className="max-w-xl">
        <p className="text-sm text-ink-2">Every active lease already has an opening balance recorded.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Record an opening balance"
      note="One per lease, for arrears from before the cutover only. Periods from the cutover onward are billed by the nightly accrual job, not recorded here."
      className="max-w-xl"
    >
      <form onSubmit={onSubmit}>
        <FieldShell id="ob-lease" label="Lease" error={fieldErrors.leaseId}>
          <Select
            id="ob-lease"
            name="leaseId"
            value={leaseId}
            onValueChange={(value) => {
              setLeaseId(value);
              setResult(null);
            }}
            options={leases.map((lease) => ({
              value: lease.leaseId,
              label: `${lease.stallLabel} — ${lease.tenantName}`,
            }))}
          />
        </FieldShell>

        <FieldShell id="ob-amount" label="Reconciled amount" error={fieldErrors.amount}>
          <TextInput
            id="ob-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            invalid={Boolean(fieldErrors.amount)}
          />
        </FieldShell>

        <FieldShell
          id="ob-date"
          label="Oldest unpaid date"
          help={`Must be before the cutover date (${cutoverDate}).`}
          error={fieldErrors.oldestUnpaidDate}
        >
          <TextInput
            id="ob-date"
            name="oldestUnpaidDate"
            type="date"
            max={dayBefore(cutoverDate)}
            required
            invalid={Boolean(fieldErrors.oldestUnpaidDate)}
          />
        </FieldShell>

        <FieldShell
          id="ob-authority"
          label="Reconciled by / authority reference"
          error={fieldErrors.authorityRef}
        >
          <TextInput
            id="ob-authority"
            name="authorityRef"
            type="text"
            required
            placeholder="e.g. Juan dela Cruz, Accounting Section"
            invalid={Boolean(fieldErrors.authorityRef)}
          />
        </FieldShell>

        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3">
            {result.formError}
          </Notice>
        ) : null}
        {result?.ok ? (
          <Notice tone="success" className="mb-3">
            Recorded.
          </Notice>
        ) : null}

        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "Recording…" : "Record opening balance"}
        </Button>
      </form>
    </Panel>
  );
}
