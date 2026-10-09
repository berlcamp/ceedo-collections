"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { useSubmit } from "@/components/ui/use-submit";
import { openOfficeDay } from "@/lib/office-receipt/actions";
import type { SaveResult } from "@/lib/admin/save-result";

/** Step 1: the officer and the day; `office_shift` opens (or finds) that officer's office shift. */
export function DayPicker({ officers, today }: { officers: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await openOfficeDay(formData);
    setResult(outcome);
    if (outcome.ok) router.push(`/ledger/office-receipt?shift=${outcome.id}`);
  });
  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Panel title="Open the day" className="max-w-xl">
      <form onSubmit={onSubmit}>
        <FieldShell id="od-officer" label="Officer" error={errors.collectorId}>
          <NativeSelect id="od-officer" name="collectorId" defaultValue="">
            <option value="" disabled>Choose the officer…</option>
            {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </NativeSelect>
        </FieldShell>
        <FieldShell id="od-date" label="Business date" error={errors.businessDate}>
          <TextInput id="od-date" name="businessDate" type="date" defaultValue={today} max={today} required />
        </FieldShell>
        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3">{result.formError}</Notice>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>{pending ? "Opening…" : "Continue"}</Button>
      </form>
    </Panel>
  );
}
