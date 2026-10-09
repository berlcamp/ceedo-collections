"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { useSubmit } from "@/components/ui/use-submit";
import { closeOfficeDay } from "@/lib/office-receipt/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/** Closes the office day against the cash and checks actually handed over (total in centavos). */
export function OfficeCloseForm({ shiftId, total }: { shiftId: string; total: number }) {
  const router = useRouter();
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await closeOfficeDay(formData);
    setResult(outcome);
    if (outcome.ok) router.refresh();
  });
  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Panel
      title="Close the day"
      note="Against the cash and checks the officer actually hands over. Any variance is booked as for an ordinary close."
      className="max-w-xl"
    >
      <form onSubmit={onSubmit}>
        <input type="hidden" name="shiftId" value={shiftId} />
        <FieldShell id="oc-declared" label="Cash and checks handed over" error={errors.declaredTotal}>
          <TextInput
            id="oc-declared" name="declaredTotal" type="number" step="0.01" min="0" required
            defaultValue={(total / 100).toFixed(2)} key={total}
          />
        </FieldShell>
        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3">{result.formError}</Notice>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>{pending ? "Closing…" : "Close the day"}</Button>
      </form>
    </Panel>
  );
}
