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
import { removeCollectorAreas, setCollectorFacilities } from "@/lib/collection-areas/actions";

export interface AreaOption {
  id: string;
  name: string;
}

export interface AssignFacilitiesData {
  collectors: AreaOption[];
  facilities: AreaOption[];
  /** Each collector's facilities with an active area, keyed by collector id. */
  current: Record<string, string[]>;
}

/**
 * Assigns a collector to one or more facilities, each covering all its sections. The
 * collector's current facilities start ticked, so saving sets their areas to exactly what
 * is ticked (setCollectorFacilities) rather than adding to them.
 *
 * Two uses: with no `target`, a header button that opens it with a collector picker; with
 * a `target` (a row of CollectionAreasTable), an edit for that collector, opened and
 * closed by the table, with Delete to remove them from every facility.
 */
export function AssignFacilitiesDialog({
  collectors,
  facilities,
  current,
  target,
  onClose,
}: AssignFacilitiesData & {
  target?: AreaOption;
  onClose?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(target);
  const [open, setOpen] = useState(editing);
  const [collectorId, setCollectorId] = useState(target?.id ?? "");
  const [ticked, setTicked] = useState<string[]>(target ? (current[target.id] ?? []) : []);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  // Delete asks twice, like the other edit forms: the first click arms it.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function close() {
    setOpen(false);
    setCollectorId("");
    setTicked([]);
    setResult(null);
    setConfirmingDelete(false);
    onClose?.();
  }

  function pickCollector(id: string) {
    setCollectorId(id);
    setTicked(current[id] ?? []);
    setResult(null);
  }

  function toggle(facilityId: string, on: boolean) {
    setTicked((prev) => (on ? [...prev, facilityId] : prev.filter((id) => id !== facilityId)));
    setConfirmingDelete(false);
  }

  async function run(action: () => Promise<SaveResult>) {
    setBusy(true);
    try {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) {
        close();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(() => setCollectorFacilities(collectorId, ticked));
  }

  function onDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    void run(() => removeCollectorAreas(collectorId));
  }

  const errors = result && !result.ok ? result.fieldErrors : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      {editing ? null : (
        <DialogTrigger className={buttonClass("primary", "md")}>
          <Plus size={14} strokeWidth={2} />
          Assign facilities
        </DialogTrigger>
      )}
      <DialogContent
        busy={busy}
        width="sm"
        title={editing ? "Edit collection areas" : "Assign facilities"}
        description={
          editing
            ? target!.name
            : "The collector covers every section of each facility ticked. Unticking a facility withdraws it; the tablet follows on its next sync."
        }
        footer={
          <>
            {editing ? (
              <Button
                variant={confirmingDelete ? "danger" : "ghost"}
                className={
                  confirmingDelete ? "mr-auto" : "mr-auto text-ribbon hover:bg-ribbon-soft hover:text-ribbon"
                }
                onClick={onDelete}
                disabled={busy}
              >
                {confirmingDelete ? "Confirm delete" : "Delete"}
              </Button>
            ) : null}
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
          {editing ? null : (
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
          )}

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

          {confirmingDelete ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs leading-relaxed text-ribbon">
              Remove {target?.name} from every facility? Their tablet round comes up empty until
              they are assigned again. Click Confirm delete to go ahead.
            </p>
          ) : null}
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
