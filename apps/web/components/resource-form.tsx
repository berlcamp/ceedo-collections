"use client";

import { useState } from "react";
import { Field } from "@/components/field";
import { saveResource } from "@/lib/admin/actions";
import type { SaveResult } from "@/lib/admin/save-result";
import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

/** One existing row, for a resource the engine updates rather than creates. */
export interface EditRow {
  id: string;
  label: string;
  values: Record<string, string | number | boolean | null>;
}

export function ResourceForm({
  resourceKey,
  singular,
  fields,
  dynamicOptions,
  editRows,
}: {
  /** Looked up server-side by saveResource. Never the resource's own config or
   * schema — a ZodObject cannot cross the RSC boundary in either direction. */
  resourceKey: string;
  singular: string;
  fields: FieldConfig[];
  dynamicOptions: Record<string, SelectOption[]>;
  /**
   * Present only for a `writeMode: "edit"` resource. The form then picks an existing row
   * and updates it; absent, it is the blank insert form every other resource uses.
   */
  editRows?: EditRow[];
}) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const editing = editRows !== undefined;
  const selected = editRows?.find((row) => row.id === selectedId);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setResult(await saveResource(resourceKey, formData, editing ? selectedId : undefined));
    setPending(false);
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};

  return (
    <form action={onSubmit} className="max-w-md rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-4 text-sm font-semibold">
        {editing ? `Edit ${singular}` : `New ${singular}`}
      </h2>

      {editing ? (
        <div className="mb-4">
          <label htmlFor="edit-target" className="text-sm font-medium text-neutral-800">
            {singular.charAt(0).toUpperCase() + singular.slice(1)}
          </label>
          <select
            id="edit-target"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setResult(null);
            }}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {editRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/*
        Keyed by the chosen row so that switching selection remounts the inputs and they
        pick up that row's current values — `defaultValue` is only read on mount.
      */}
      {fields.map((field) => (
        <Field
          key={`${selectedId}-${field.name}`}
          config={field}
          value={selected ? selected.values[field.name] : undefined}
          error={fieldErrors[field.name]}
          options={field.optionsFrom ? dynamicOptions[field.optionsFrom] : undefined}
        />
      ))}

      {result && !result.ok && result.formError ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.formError}
        </p>
      ) : null}
      {result?.ok ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">Saved.</p>
      ) : null}

      <button
        type="submit"
        disabled={pending || (editing && !selectedId)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : `Save ${singular}`}
      </button>
    </form>
  );
}
