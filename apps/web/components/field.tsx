import type { FieldConfig, SelectOption } from "@/lib/admin/resource";

export function Field({
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
  const base =
    "mt-1 w-full rounded-md border px-3 py-2 text-sm " +
    (error ? "border-red-500" : "border-neutral-300");

  return (
    <div className="mb-4">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {config.label}
        {config.optional ? <span className="text-neutral-400"> (optional)</span> : null}
      </label>

      {config.type === "select" ? (
        <select id={id} name={config.name} defaultValue={String(value ?? "")} className={base}>
          <option value="">Select…</option>
          {(options ?? config.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : config.type === "boolean" ? (
        <input
          id={id}
          name={config.name}
          type="checkbox"
          defaultChecked={Boolean(value)}
          className="mt-2 block h-4 w-4"
        />
      ) : (
        <input
          id={id}
          name={config.name}
          type={config.type === "date" ? "date" : config.type === "text" ? "text" : "number"}
          step={config.type === "money" ? "0.01" : undefined}
          defaultValue={value === null || value === undefined ? "" : String(value)}
          className={base}
        />
      )}

      {config.help ? <p className="mt-1 text-xs text-neutral-500">{config.help}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
