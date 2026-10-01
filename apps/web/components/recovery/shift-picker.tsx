"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, TextArea, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { useSubmit } from "@/components/ui/use-submit";
import { formatDate } from "@/lib/format/date";
import { openRecoveryShift } from "@/lib/recovery/actions";
import type { RecoveryChoices } from "@/lib/recovery/queries";
import type { SaveResult } from "@/lib/admin/save-result";

/**
 * Step 1: picks the collector, tablet and business date `recovery_shift` opens (or finds)
 * a shift for, with the reason this recovery is happening. On success the page navigates to
 * `?shift=<id>` -- step 2 and 3 live there, not in this component.
 */
export function ShiftPicker({
  collectors,
  devices,
  today,
}: RecoveryChoices & { today: string }) {
  const router = useRouter();
  const [collectorId, setCollectorId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending, onSubmit } = useSubmit(async (formData) => {
    const outcome = await openRecoveryShift(formData);
    setResult(outcome);
    if (outcome.ok) router.push(`/ledger/recovery?shift=${outcome.id}`);
  });

  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Panel title="Open or find the shift" className="max-w-xl">
      <form onSubmit={onSubmit}>
        <FieldShell id="rs-collector" label="Collector" error={errors.collectorId}>
          <Select
            id="rs-collector"
            name="collectorId"
            value={collectorId}
            onValueChange={(value) => {
              setCollectorId(value);
              setResult(null);
            }}
            options={collectors.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Choose the collector…"
          />
        </FieldShell>

        <FieldShell id="rs-device" label="Tablet" error={errors.deviceId}>
          <Select
            id="rs-device"
            name="deviceId"
            value={deviceId}
            onValueChange={(value) => {
              setDeviceId(value);
              setResult(null);
            }}
            options={devices.map((d) => ({
              value: d.id,
              label: d.lastSeenAt ? `${d.label} — last heard from ${formatDate(d.lastSeenAt)}` : `${d.label} — never synced`,
            }))}
            placeholder="Choose the tablet…"
          />
        </FieldShell>

        <FieldShell id="rs-date" label="Business date" error={errors.businessDate}>
          <TextInput id="rs-date" name="businessDate" type="date" defaultValue={today} max={today} required />
        </FieldShell>

        <FieldShell
          id="rs-reason"
          label="Reason"
          help="Why these receipts are being recovered -- kept with every receipt this session posts."
          error={errors.reason}
        >
          <TextArea id="rs-reason" name="reason" rows={2} required />
        </FieldShell>

        {result && !result.ok && result.formError ? (
          <Notice tone="error" className="mb-3">
            {result.formError}
          </Notice>
        ) : null}

        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "Opening…" : "Continue"}
        </Button>
      </form>
    </Panel>
  );
}
