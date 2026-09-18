"use client";

import { useRef, useState } from "react";
import type { Centavos } from "@ceedo/shared";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await condoneCharge(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          dialogRef.current?.showModal();
        }}
        className="text-xs text-neutral-700 underline"
      >
        Condone
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      >
        <form action={onSubmit} className="w-80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Condone {detail}</h2>
          <p className="mb-4 text-xs text-neutral-500">
            Writes off this charge against an authorising ordinance. Cannot exceed the
            amount still outstanding.
          </p>

          <input type="hidden" name="chargeId" value={chargeId} />
          <input type="hidden" name="leaseId" value={leaseId} />

          <label htmlFor="condone-amount" className="text-sm font-medium text-neutral-800">
            Amount
          </label>
          <input
            id="condone-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={(outstanding / 100).toFixed(2)}
            className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />

          <label htmlFor="condone-authority" className="text-sm font-medium text-neutral-800">
            Ordinance reference
          </label>
          <input
            id="condone-authority"
            name="authorityRef"
            type="text"
            required
            placeholder="e.g. City Ordinance 2026-14"
            className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />

          <label htmlFor="condone-reason" className="text-sm font-medium text-neutral-800">
            Reason
          </label>
          <textarea
            id="condone-reason"
            name="reason"
            required
            rows={3}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />

          {result && !result.ok && result.formError ? (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {result.formError}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pending ? "Condoning…" : "Condone"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
