"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldShell, TextInput } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

/**
 * One field of a registry-driven form.
 *
 * Select and boolean are Radix primitives rather than native controls, and both still
 * post through `FormData` — Radix renders the hidden native control for exactly this, so
 * `saveResource`'s `coerce()` reads the same names and values it always did.
 */
export function ResourceField({
  config,
  value,
  error,
  options,
}: {
  config: FieldConfig;
  value?: string | number | boolean | null;
  error?: string;
  options?: SelectOption[];
}) {
  const id = `field-${config.name}`;
  const [selectValue, setSelectValue] = useState(value === null || value === undefined ? "" : String(value));
  const [checked, setChecked] = useState(Boolean(value));

  if (config.type === "select") {
    return (
      <FieldShell id={id} label={config.label} optional={config.optional} help={config.help} error={error}>
        <Select
          id={id}
          name={config.name}
          value={selectValue}
          onValueChange={setSelectValue}
          options={options ?? config.options ?? []}
          invalid={Boolean(error)}
        />
      </FieldShell>
    );
  }

  if (config.type === "boolean") {
    return (
      <div className="mb-3.5 last:mb-0">
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 py-1">
          <Checkbox id={id} name={config.name} checked={checked} onCheckedChange={setChecked} />
          <span className="text-sm text-ink">{config.label}</span>
        </label>
        {config.help ? <p className="mt-1 text-xs leading-snug text-ink-3">{config.help}</p> : null}
        {error ? <p className="mt-1 text-xs font-medium text-ribbon">{error}</p> : null}
      </div>
    );
  }

  return (
    <FieldShell id={id} label={config.label} optional={config.optional} help={config.help} error={error}>
      <TextInput
        id={id}
        name={config.name}
        type={config.type === "date" ? "date" : config.type === "text" ? "text" : "number"}
        step={config.type === "money" ? "0.01" : undefined}
        defaultValue={value === null || value === undefined ? "" : String(value)}
        invalid={Boolean(error)}
      />
    </FieldShell>
  );
}
