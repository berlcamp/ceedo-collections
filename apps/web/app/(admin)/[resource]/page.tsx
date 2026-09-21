import { isAdmin } from "@ceedo/shared";
import { notFound } from "next/navigation";
import { ResourceFormDialog, type ResourceFormSpec } from "@/components/admin/resource-form-dialog";
import { ResourceTable } from "@/components/admin/resource-table";
import { DeviceCredentialPanel } from "@/components/devices/device-credential-panel";
import { ScreenHeader } from "@/components/shell/screen-header";
import { SetPinPanel } from "@/components/staff/set-pin-panel";
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
  // the form needs the rows to choose between and their current values. The choosing now
  // happens in the table rather than in a dropdown inside the form, but the data the
  // form is handed is unchanged.
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

  const canWrite = config.writeRoles.includes(staff.role);
  const spec: ResourceFormSpec = {
    resourceKey: config.key,
    singular: config.singular,
    fields: config.fields,
    dynamicOptions,
  };

  return (
    <div>
      <ScreenHeader
        title={config.title}
        // An edit-mode resource has no create path at all: app_users rows can only come
        // into being through migration 0009's claim trigger on a real Google sign-in, so
        // offering "New staff member" would be offering something the engine cannot do.
        actions={
          canWrite && config.writeMode !== "edit" ? <ResourceFormDialog spec={spec} /> : null
        }
      />

      <div className="space-y-6">
        {/*
          Task 15: an admin-only action per resource, alongside its create/edit form rather
          than folded into the generic engine -- neither "issue a device credential" nor
          "set a collector PIN" is a create/update of the resource's own row shape (the
          credential and PIN both live behind SECURITY DEFINER RPCs, not a plain table
          write), so the schema-driven form has no way to express either. Gated on isAdmin
          the same way the ledger screens gate an action, not a read -- the RPCs check
          again themselves.
        */}
        {config.key === "devices" && isAdmin(staff.role) && !error ? (
          <DeviceCredentialPanel
            devices={(rows ?? []).map((row) => {
              const record = row as unknown as { id: string; label: string };
              return { id: record.id, label: record.label };
            })}
          />
        ) : null}
        {config.key === "users" && isAdmin(staff.role) && !error ? (
          <SetPinPanel
            collectors={(rows ?? [])
              .map((row) => row as unknown as { id: string; full_name: string; role: string })
              .filter((record) => record.role === "collector")
              .map((record) => ({ id: record.id, fullName: record.full_name }))}
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
          <p className="rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber">
            These records could not be loaded. You may not have access to them.
            {error.code ? ` (${error.code})` : null}
          </p>
        ) : (
          <ResourceTable
            columns={config.columns}
            rows={(rows ?? []) as unknown as Record<string, unknown>[]}
            urlKey={config.key}
            unit="records"
            empty={config.empty}
            canCreate={config.writeMode !== "edit"}
            {...(canWrite ? { spec } : {})}
            {...(canWrite && editRows ? { editRows } : {})}
          />
        )}
      </div>
    </div>
  );
}
