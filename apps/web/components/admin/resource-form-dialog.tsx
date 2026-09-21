"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ResourceField } from "@/components/admin/resource-field";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { saveResource } from "@/lib/admin/actions";
import type { SaveResult } from "@/lib/admin/save-result";
import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

/** Everything the form needs, all of it serializable — a ZodObject cannot cross the RSC
 * boundary, so the schema stays server-side and `saveResource` looks the config up there. */
export interface ResourceFormSpec {
  resourceKey: string;
  singular: string;
  fields: FieldConfig[];
  dynamicOptions: Record<string, SelectOption[]>;
}

/** One existing row, for a resource the engine updates rather than creates. */
export interface EditRow {
  id: string;
  label: string;
  values: Record<string, string | number | boolean | null>;
}

export function ResourceFormDialog({
  spec,
  target,
}: {
  spec: ResourceFormSpec;
  /**
   * Present for an edit. Absent, this is the blank insert form. The old screen asked the
   * operator to pick the row from a dropdown *inside* the form; now the row is picked in
   * the table, which is where they were already looking, and the same id reaches the same
   * server action.
   */
  target?: EditRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  const editing = target !== undefined;

  // A dialog reopened after a failed save should not still be wearing that attempt's
  // errors. Cleared as the dialog closes, not in an effect watching the state that just
  // changed — that is a cascading render for something the event already knows.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setResult(null);
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await saveResource(spec.resourceKey, formData, editing ? target.id : undefined);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      // revalidatePath ran server-side; this is what makes the open screen pick it up.
      router.refresh();
    }
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};
  const title = editing ? `Edit ${spec.singular}` : `New ${spec.singular}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className={
          editing
            ? buttonClass("ghost", "sm")
            : buttonClass("primary", "md")
        }
        aria-label={editing ? `Edit ${target.label}` : undefined}
      >
        {editing ? (
          <>
            <Pencil size={12} strokeWidth={1.75} />
            Edit
          </>
        ) : (
          <>
            <Plus size={14} strokeWidth={2} />
            New {spec.singular}
          </>
        )}
      </DialogTrigger>

      <DialogContent
        title={title}
        // Only an edit needs a subtitle, and the row it is editing is the useful one.
        {...(editing ? { description: target.label } : {})}
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")}>Cancel</DialogClose>
            <Button type="submit" form="resource-form" variant="primary" disabled={pending}>
              {pending ? "Saving…" : `Save ${spec.singular}`}
            </Button>
          </>
        }
      >
        <form id="resource-form" action={onSubmit}>
          {spec.fields.map((field) => (
            <ResourceField
              key={field.name}
              config={field}
              value={target ? target.values[field.name] : undefined}
              error={fieldErrors[field.name]}
              options={field.optionsFrom ? spec.dynamicOptions[field.optionsFrom] : undefined}
            />
          ))}

          {result && !result.ok && result.formError ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs leading-relaxed text-ribbon">
              {result.formError}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
