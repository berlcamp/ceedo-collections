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

  const { data: rows } = await supabase
    .from(config.table as never)
    .select(config.select)
    .order(config.orderBy);

  // Load choices for any select field that draws them from another table.
  const dynamicOptions: Record<string, SelectOption[]> = {};
  for (const field of config.fields) {
    if (!field.optionsFrom || dynamicOptions[field.optionsFrom]) continue;
    const source = RESOURCES[field.optionsFrom];
    if (!source) continue;
    const { data } = await supabase
      .from(source.table as never)
      .select("id, name:name, code:code");
    dynamicOptions[field.optionsFrom] = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        value: String(record.id),
        label: String(record.name ?? record.code ?? record.id),
      };
    });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{config.title}</h1>
      {config.writeRoles.includes(staff.role) ? (
        <ResourceForm config={config} dynamicOptions={dynamicOptions} />
      ) : null}
      <ResourceTable columns={config.columns} rows={(rows ?? []) as Record<string, unknown>[]} />
    </div>
  );
}
