"use client";

import { useRef, useState, type FormEvent } from "react";

/**
 * Runs one async job at a time. A call made while one is in flight is dropped.
 *
 * The ref, not the `busy` state, is what stops a double save: two clicks in the same frame
 * both land before the re-render that disables the button.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run(job: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await job();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, run };
}

/**
 * Submits a form through `onSubmit`, never `<form action>`.
 *
 * React 19 resets a form after its `action` runs, whatever the outcome, so a save refused
 * for a blank required field used to hand the clerk an emptied form. Here nothing resets
 * unless the handler does it (`form.reset()` after a success, where that is wanted).
 */
export function useSubmit(
  handler: (formData: FormData, form: HTMLFormElement) => Promise<void>,
) {
  const { busy, run } = useBusy();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => handler(new FormData(form), form));
  }

  return { pending: busy, onSubmit };
}
