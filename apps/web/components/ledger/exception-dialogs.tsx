"use client";

import { useRef, useState } from "react";
import {
  correctException,
  escalateException,
  spoilException,
} from "@/lib/ledger/exception-actions";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * The three actions §11.3 names for a supervisor resolving a sync exception. Each writes
 * something different against real, already-collected cash (see `lib/ledger/
 * exception-actions.ts`'s own comments): a correction re-posts under the original client
 * UUID, spoiling writes `spoiled_forms` and posts nothing, and escalation only changes a
 * status. A written reason is required on all three -- the database enforces this too, but
 * the field being `required` here means the supervisor sees it as a form rule, not a
 * Postgres error.
 */

function useDialogAction(action: (formData: FormData) => Promise<SaveResult>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await action(formData);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) dialogRef.current?.close();
  }

  return { dialogRef, result, setResult, pending, onSubmit };
}

export function CorrectExceptionDialog({
  exceptionId,
  currentOrNo,
}: {
  exceptionId: string;
  /** Defaults the OR field to what the device actually sent -- most corrections change a
   * claim (lease, period), not the OR number itself. */
  currentOrNo: number | null;
}) {
  const { dialogRef, result, setResult, pending, onSubmit } = useDialogAction(correctException);

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
        Accept with correction
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      >
        <form action={onSubmit} className="w-80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Accept with correction</h2>
          <p className="mb-4 text-xs text-neutral-500">
            Re-posts this receipt under the corrected OR number. Only the claims change --
            the amount is priced by the server, exactly as it is on a device.
          </p>

          <input type="hidden" name="exceptionId" value={exceptionId} />

          <label htmlFor="correct-or-no" className="text-sm font-medium text-neutral-800">
            OR number
          </label>
          <input
            id="correct-or-no"
            name="orNo"
            type="number"
            step="1"
            min="1"
            required
            defaultValue={currentOrNo ?? undefined}
            className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />

          <label htmlFor="correct-reason" className="text-sm font-medium text-neutral-800">
            Reason
          </label>
          <textarea
            id="correct-reason"
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
              {pending ? "Posting…" : "Accept with correction"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function SpoilExceptionDialog({ exceptionId }: { exceptionId: string }) {
  const { dialogRef, result, setResult, pending, onSubmit } = useDialogAction(spoilException);

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
        Mark spoiled
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      >
        <form action={onSubmit} className="w-80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Mark this OR spoiled</h2>
          <p className="mb-4 text-xs text-neutral-500">
            Records the serial as spoiled. No collection is posted -- use this only when the
            paper receipt itself was voided, not merely mis-recorded.
          </p>

          <input type="hidden" name="exceptionId" value={exceptionId} />

          <label htmlFor="spoil-reason" className="text-sm font-medium text-neutral-800">
            Reason
          </label>
          <textarea
            id="spoil-reason"
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
              {pending ? "Recording…" : "Mark spoiled"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function EscalateExceptionDialog({ exceptionId }: { exceptionId: string }) {
  const { dialogRef, result, setResult, pending, onSubmit } = useDialogAction(escalateException);

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
        Escalate
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      >
        <form action={onSubmit} className="w-80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Escalate for investigation</h2>
          <p className="mb-4 text-xs text-neutral-500">
            A status, not a resolution -- this exception stays open and still counts against
            the collector at closeout. Use it when neither correcting nor spoiling is the
            right call yet.
          </p>

          <input type="hidden" name="exceptionId" value={exceptionId} />

          <label htmlFor="escalate-reason" className="text-sm font-medium text-neutral-800">
            Reason
          </label>
          <textarea
            id="escalate-reason"
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
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pending ? "Escalating…" : "Escalate"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
