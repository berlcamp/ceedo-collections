"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { SaveResult } from "@/lib/admin/save-result";
import { setCollectorFacilities } from "@/lib/collection-areas/actions";

interface Option {
  id: string;
  name: string;
}

/**
 * Assigns a collector to one or more facilities, each covering all its sections. Picking a
 * collector ticks the facilities they already hold, so saving sets their areas to exactly
 * what is ticked (setCollectorFacilities) rather than adding to them.
 */
export function AssignFacilitiesDialog({
  collectors,
  facilities,
  current,
}: {
  collectors: Option[];
  facilities: Option[];
  /** Each collector's facilities with an active area, keyed by collector id. */
  current: Record<string, string[]>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collectorId, setCollectorId] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  function pickCollector(id: string) {
    setCollectorId(id);
    setTicked(current[id] ?? []);
    setResult(null);
  }

  function toggle(facilityId: string, on: boolean) {
    setTicked((prev) => (on ? [...prev, facilityId] : prev.filter((id) => id !== facilityId)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const outcome = await setCollectorFacilities(collectorId, ticked);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCollectorId("");
          setTicked([]);
          setResult(null);
        }
      }}
    >
      <DialogTrigger className={buttonClass("primary", "md")}>
        <Plus size={14} strokeWidth={2} />
        Assign facilities
      </DialogTrigger>
      <DialogContent
        busy={busy}
        width="sm"
        title="Assign facilities"
        description="The collector covers every section of each facility ticked. Unticking a facility withdraws it; the tablet follows on its next sync."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" form="assign-facilities-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="assign-facilities-form" onSubmit={onSubmit}>
          <FieldShell id="collectorId" label="Collector" error={errors.collectorId}>
            <Select
              id="collectorId"
              value={collectorId}
              onValueChange={pickCollector}
              placeholder="Choose a collector"
              options={collectors.map((c) => ({ value: c.id, label: c.name }))}
              invalid={Boolean(errors.collectorId)}
            />
          </FieldShell>

          <fieldset disabled={!collectorId || busy}>
            <legend className="caption mb-1 text-ink-2">Facilities</legend>
            <div className="space-y-2">
              {facilities.map((facility) => (
                <label
                  key={facility.id}
                  htmlFor={`facility-${facility.id}`}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Checkbox
                    id={`facility-${facility.id}`}
                    checked={ticked.includes(facility.id)}
                    onCheckedChange={(on) => toggle(facility.id, on)}
                    disabled={!collectorId || busy}
                  />
                  <span className="text-sm text-ink">{facility.name}</span>
                </label>
              ))}
            </div>
            {errors.facilityIds ? (
              <p className="mt-1 text-xs font-medium text-ribbon">{errors.facilityIds}</p>
            ) : null}
          </fieldset>

          {result && !result.ok && result.formError ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">
              {result.formError}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
