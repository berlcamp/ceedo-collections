import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/resource-form";
import { ResourceTable } from "@/components/resource-table";
import { RESOURCES, type SelectOption } from "@/lib/admin/resource";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function ResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource: key } = await params;
  const config = RESOURCES[key];
  if (!config) notFound();

  const staff = await requireStaff();
  const supabase = await getServerClient();

  const { data: rows, error } = await supabase
    .from(config.table)
    .select(config.select)
    .order(config.orderBy);

  // Load choices for any select field that draws them from another table. Each
  // source resource names its own label column via `optionLabel` — guessing at
  // "name" or "code" left resources with neither (e.g. stalls, leases) with
  // silently empty dropdowns.
  const dynamicOptions: Record<string, SelectOption[]> = {};
  for (const field of config.fields) {
    if (!field.optionsFrom || dynamicOptions[field.optionsFrom]) continue;
    const source = RESOURCES[field.optionsFrom];
    if (!source) continue;
    // Widened to `string` before the call: `optionLabel` is only known at
    // runtime, so postgrest-js cannot statically parse the rename and its
    // generic-string fallback type does not structurally overlap a plain
    // record — the query itself is still correct, only its static type is not.
    const optionSelect: string = `id, label:${source.optionLabel}`;
    const { data } = await supabase.from(source.table).select(optionSelect);
    dynamicOptions[field.optionsFrom] = (data ?? []).map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return {
        value: String(record.id),
        label: String(record.label ?? record.id),
      };
    });
  }

  // A `writeMode: "edit"` resource updates an existing row instead of inserting one, so
  // the form needs the rows to choose between and their current values.
  const editRows =
    config.writeMode === "edit"
      ? (rows ?? []).map((row) => {
          const record = row as unknown as Record<string, unknown>;
          return {
            id: String(record.id),
            label: String(record[config.optionLabel] ?? record.id),
            values: Object.fromEntries(
              config.fields.map((field) => [
                field.name,
                (record[field.name] ?? null) as string | number | boolean | null,
              ]),
            ),
          };
        })
      : undefined;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{config.title}</h1>
      {config.writeRoles.includes(staff.role) ? (
        <ResourceForm
          resourceKey={config.key}
          singular={config.singular}
          fields={config.fields}
          dynamicOptions={dynamicOptions}
          {...(editRows ? { editRows } : {})}
        />
      ) : null}
      {/*
        A denied read and an empty table look identical once the error is discarded, and
        "Nothing here yet." is the worst possible thing to tell someone who is in fact
        being refused — it reads as a fact about the data. Say which it is. The message is
        kept generic; the code is shown because it is what makes a support conversation
        short (42501 is a privilege denial, PGRST116 a shape mismatch, and so on).
      */}
      {error ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          These records could not be loaded. You may not have access to them.
          {error.code ? ` (${error.code})` : null}
        </p>
      ) : (
        <ResourceTable
          columns={config.columns}
          rows={(rows ?? []) as unknown as Record<string, unknown>[]}
        />
      )}
    </div>
  );
}
