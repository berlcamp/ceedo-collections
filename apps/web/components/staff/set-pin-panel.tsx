"use client";

import { useState } from "react";
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
 * believing it takes effect immediately has sent that collector out unable to work.
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
    <div className="max-w-md rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-1 text-sm font-semibold">Set collector PIN</h2>
      <p className="mb-4 text-xs font-medium text-amber-800">
        A new PIN reaches the collector&apos;s tablet only on that tablet&apos;s next sync
        -- not immediately. A collector already out on their round with the old PIN will
        not be able to sign in again until they sync, so avoid resetting a PIN mid-round
        unless the collector can reach a connection.
      </p>

      <label htmlFor="pin-collector" className="text-sm font-medium text-neutral-800">
        Collector
      </label>
      <select
        id="pin-collector"
        value={collectorId}
        onChange={(event) => {
          setCollectorId(event.target.value);
          setError(null);
          setSavedFor(null);
        }}
        className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {collectors.map((collector) => (
          <option key={collector.id} value={collector.id}>
            {collector.fullName}
          </option>
        ))}
      </select>

      <label htmlFor="pin-value" className="text-sm font-medium text-neutral-800">
        New PIN (6 digits)
      </label>
      <input
        id="pin-value"
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="mt-1 mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />

      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}
      {savedFor === collectorId && !error ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
          PIN set. It will take effect on this tablet&apos;s next sync.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || !collectorId || !/^\d{6}$/.test(pin)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Set PIN"}
      </button>
    </div>
  );
}
