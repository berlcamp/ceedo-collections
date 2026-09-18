"use client";

import { useRef, useState } from "react";
import { cancelCollection } from "@/lib/ledger/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * Voids a posted receipt (§11.3). Nothing on the collection itself changes -- there is no
 * UPDATE privilege on it, by design (migration 20260918000023) -- this dialog only ever
 * inserts a cancellation row through cancel_collection(). Rendered only for a supervisor
 * or admin; see the collections page for that gate.
 */
export function CancelDialog({ collectionId, orNo }: { collectionId: string; orNo: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await cancelCollection(formData);
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
        className="text-xs text-red-700 underline"
      >
        Cancel
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      >
        <form action={onSubmit} className="w-80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Void OR {orNo}</h2>
          <p className="mb-4 text-xs text-neutral-500">
            The receipt stays on the record -- this only stops it counting toward what is
            owed, and needs a written reason.
          </p>

          <input type="hidden" name="collectionId" value={collectionId} />

          <label htmlFor="cancel-reason" className="text-sm font-medium text-neutral-800">
            Reason
          </label>
          <textarea
            id="cancel-reason"
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
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pending ? "Voiding…" : "Void receipt"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
