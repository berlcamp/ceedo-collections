"use client";

import { useState } from "react";
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
  const [pending, setPending] = useState(false);
  const [leaseId, setLeaseId] = useState("");

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await recordOpeningBalance(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) setLeaseId("");
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};

  if (leases.length === 0) {
    return (
      <p className="max-w-md rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500">
        Every active lease already has an opening balance recorded.
      </p>
    );
  }

  return (
    <form action={onSubmit} className="max-w-md rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-1 text-sm font-semibold">Record an opening balance</h2>
      <p className="mb-4 text-xs text-neutral-500">
        One per lease, for arrears from before the cutover only. Periods from the cutover
        onward are billed by the nightly accrual job, not recorded here.
      </p>

      <label htmlFor="ob-lease" className="text-sm font-medium text-neutral-800">
        Lease
      </label>
      <select
        id="ob-lease"
        name="leaseId"
        required
        value={leaseId}
        onChange={(event) => {
          setLeaseId(event.target.value);
          setResult(null);
        }}
        className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {leases.map((lease) => (
          <option key={lease.leaseId} value={lease.leaseId}>
            Stall {lease.stallNo} — {lease.tenantName}
          </option>
        ))}
      </select>

      <label htmlFor="ob-amount" className="text-sm font-medium text-neutral-800">
        Reconciled amount
      </label>
      <input
        id="ob-amount"
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        required
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      {fieldErrors.amount ? (
        <p className="mt-1 mb-2 text-xs text-red-600">{fieldErrors.amount}</p>
      ) : (
        <div className="mb-2" />
      )}

      <label htmlFor="ob-date" className="text-sm font-medium text-neutral-800">
        Oldest unpaid date
      </label>
      <input
        id="ob-date"
        name="oldestUnpaidDate"
        type="date"
        max={dayBefore(cutoverDate)}
        required
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <p className="mt-1 mb-2 text-xs text-neutral-500">
        {fieldErrors.oldestUnpaidDate ?? `Must be before the cutover date (${cutoverDate}).`}
      </p>

      <label htmlFor="ob-authority" className="text-sm font-medium text-neutral-800">
        Reconciled by / authority reference
      </label>
      <input
        id="ob-authority"
        name="authorityRef"
        type="text"
        required
        placeholder="e.g. Juan dela Cruz, Accounting Section"
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      {fieldErrors.authorityRef ? (
        <p className="mt-1 mb-2 text-xs text-red-600">{fieldErrors.authorityRef}</p>
      ) : (
        <div className="mb-2" />
      )}

      {result && !result.ok && result.formError ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.formError}
        </p>
      ) : null}
      {result?.ok ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
          Recorded.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record opening balance"}
      </button>
    </form>
  );
}
