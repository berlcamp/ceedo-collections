"use client";

import { useState } from "react";
import { Field } from "@/components/field";
import { saveResource } from "@/lib/admin/actions";
import type { SaveResult } from "@/lib/admin/save-result";
import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

export function ResourceForm({
  resourceKey,
  singular,
  fields,
  dynamicOptions,
}: {
  /** Looked up server-side by saveResource. Never the resource's own config or
   * schema — a ZodObject cannot cross the RSC boundary in either direction. */
  resourceKey: string;
  singular: string;
  fields: FieldConfig[];
  dynamicOptions: Record<string, SelectOption[]>;
}) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setResult(await saveResource(resourceKey, formData));
    setPending(false);
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : {};

  return (
    <form action={onSubmit} className="max-w-md rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-4 text-sm font-semibold">New {singular}</h2>

      {fields.map((field) => (
        <Field
          key={field.name}
          config={field}
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
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : `Save ${singular}`}
      </button>
    </form>
  );
}
