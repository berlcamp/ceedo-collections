"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { setCollectorPin } from "@/lib/devices/credential-actions";

export interface CollectorOption {
  id: string;
  fullName: string;
}

/**
 * Collectors only -- a PIN means nothing for any other role (`set_collector_pin()` itself
 * refuses a non-collector, migration 20260918000027). Admin-only visibility mirrors
 * `DeviceCredentialPanel`.
 *
 * The warning below is not a caveat, it is the point of this component: parent spec §14
 * records "a collector who forgets mid-round offline cannot sign in" as a known limitation
 * of a new PIN reaching a tablet only on its next sync. An administrator resetting a PIN
 * believing it takes effect immediately has sent that collector out unable to work. It is
 * rendered as the panel's standing note rather than a line inside the form, so it cannot
 * be scrolled past on the way to the button.
 */
export function SetPinPanel({ collectors }: { collectors: CollectorOption[] }) {
  const [collectorId, setCollectorId] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);

  async function onSubmit() {
    if (!collectorId || !/^\d{6}$/.test(pin)) return;
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("collectorId", collectorId);
    formData.set("pin", pin);
    const result = await setCollectorPin(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.formError ?? "Could not set the PIN.");
      setSavedFor(null);
      return;
    }
    setSavedFor(collectorId);
    setPin("");
  }

  if (collectors.length === 0) return null;

  return (
    <Panel title="Set collector PIN" className="max-w-xl">
      <Notice tone="warning" className="mb-4">
        A new PIN reaches the collector&apos;s tablet only on that tablet&apos;s next sync --
        not immediately. A collector already out on their round with the old PIN will not be
        able to sign in again until they sync, so avoid resetting a PIN mid-round unless the
        collector can reach a connection.
      </Notice>

      <FieldShell id="pin-collector" label="Collector">
        <Select
          id="pin-collector"
          value={collectorId}
          onValueChange={(value) => {
            setCollectorId(value);
            setError(null);
            setSavedFor(null);
          }}
          options={collectors.map((collector) => ({
            value: collector.id,
            label: collector.fullName,
          }))}
        />
      </FieldShell>

      <FieldShell id="pin-value" label="New PIN (6 digits)">
        <TextInput
          id="pin-value"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="max-w-[9rem] font-mono tracking-[0.35em]"
        />
      </FieldShell>

      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {savedFor === collectorId && !error ? (
        <Notice tone="success" className="mb-3">
          PIN set. It will take effect on this tablet&apos;s next sync.
        </Notice>
      ) : null}

      <Button
        variant="primary"
        onClick={onSubmit}
        disabled={pending || !collectorId || !/^\d{6}$/.test(pin)}
      >
        {pending ? "Saving…" : "Set PIN"}
      </Button>
    </Panel>
  );
}
