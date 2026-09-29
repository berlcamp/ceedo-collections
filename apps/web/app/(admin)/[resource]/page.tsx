import { isAdmin } from "@ceedo/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { AddCollectorDialog } from "@/components/staff/add-collector-dialog";
import { AssignFacilitiesDialog } from "@/components/collection-areas/assign-facilities-dialog";
import { ResourceFormDialog, type ResourceFormSpec } from "@/components/admin/resource-form-dialog";
import { ResourceTable } from "@/components/admin/resource-table";
import { DeviceCredentialPanel } from "@/components/devices/device-credential-panel";
import { ScreenHeader } from "@/components/shell/screen-header";
import { SetPinPanel } from "@/components/staff/set-pin-panel";
import { selectWithFields } from "@/lib/admin/edit";
import { RESOURCES, type SelectOption } from "@/lib/admin/resource";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

function rowLabel(value: unknown): string {
  if (value && typeof value === "object") {
    const first = Object.values(value as Record<string, unknown>)[0];
    return String(first ?? "");
  }
  return String(value ?? "");
}

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

  const { data: fetched, error } = await supabase
    .from(config.table)
    // Widened with the raw form columns so an edit form opens with its values filled in.
    .select(selectWithFields(config.select, config.fields.map((field) => field.name)))
    .order(config.orderBy, { ascending: !config.orderDescending });
  const rows = config.derive
    ? (fetched ?? []).map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return { ...record, ...config.derive!(record) };
      })
    : fetched;

  // Load choices for any select field that draws them from another table. Each
  // source resource names its own label column via `optionLabel` — guessing at
  // "name" or "code" left resources with neither (e.g. stalls, leases) with
  // silently empty dropdowns.
  const dynamicOptions: Record<string, SelectOption[]> = {};
  for (const field of config.fields) {
    if (!field.optionsFrom) continue;
    const source = RESOURCES[field.optionsFrom];
    if (!source) continue;
    // Widened to `string` before the call: `optionLabel` is only known at
    // runtime, so postgrest-js cannot statically parse the rename and its
    // generic-string fallback type does not structurally overlap a plain
    // record — the query itself is still correct, only its static type is not.
    const optionSelect: string = source.optionText
      ? `id, ${source.optionText.select}`
      : `id, label:${source.optionLabel}`;
    let query = supabase.from(source.table).select(optionSelect);
    for (const [column, value] of Object.entries(field.optionsWhere ?? {})) {
      query = query.eq(column, value);
    }
    const { data } = await query;
    // Keyed by field, not source: two fields may draw on one source under different filters.
    dynamicOptions[field.name] = (data ?? [])
      .map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return {
          value: String(record.id),
          label: source.optionText
            ? source.optionText.format(record)
            : String(record.label ?? record.id),
        };
      })
      // Natural order, so "Stall 2" comes before "Stall 10".
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  // Every row of a writable resource can be opened for editing from the table, so the
  // form needs each row's current values. Only built for a role that may write.
  const canWrite = config.writeRoles.includes(staff.role);
  const editRows =
    canWrite
      ? (rows ?? []).map((row) => {
          const record = row as unknown as Record<string, unknown>;
          return {
            id: String(record.id),
            // The row's first column, as the table shows it: a lease reads as its stall,
            // not as its start date (its optionLabel).
            label: rowLabel(record[config.columns[0]?.key ?? config.optionLabel] ?? record.id),
            values: Object.fromEntries(
              config.fields.map((field) => [
                field.name,
                (record[field.name] ?? null) as string | number | boolean | null,
              ]),
            ),
          };
        })
      : undefined;

  // Collection areas are created facility by facility from one dialog (several ticked at
  // once), not the generic one-row form: see AssignFacilitiesDialog.
  const assignFacilities =
    config.key === "collector-assignments" && canWrite
      ? await (async () => {
          const [{ data: collectors }, { data: facilities }] = await Promise.all([
            supabase
              .from("app_users")
              .select("id, full_name")
              .eq("role", "collector")
              .eq("status", "active")
              .order("full_name"),
            supabase.from("facilities").select("id, name").eq("active", true).order("name"),
          ]);
          const current: Record<string, string[]> = {};
          for (const row of (rows ?? []) as unknown as {
            collector_id: string;
            facility_id: string;
            active: boolean;
          }[]) {
            if (!row.active) continue;
            const held = (current[row.collector_id] ??= []);
            if (!held.includes(row.facility_id)) held.push(row.facility_id);
          }
          return {
            collectors: (collectors ?? []).map((c) => ({ id: c.id, name: c.full_name })),
            facilities: (facilities ?? []).map((f) => ({ id: f.id, name: f.name })),
            current,
          };
        })()
      : null;

  const spec: ResourceFormSpec = {
    resourceKey: config.key,
    singular: config.singular,
    fields: config.fields,
    dynamicOptions,
    lockedOnEdit: [...(config.lockedOnEdit ?? [])],
    deletable: Boolean(config.deletable),
  };

  return (
    <div>
      <ScreenHeader
        title={config.title}
        // An edit-mode resource has no create path at all: app_users rows can only come
        // into being through migration 0009's claim trigger on a real Google sign-in, so
        // offering "New staff member" would be offering something the engine cannot do.
        actions={
          canWrite && config.writeMode !== "edit" ? (
            <ResourceFormDialog spec={spec} />
          ) : assignFacilities ? (
            <AssignFacilitiesDialog {...assignFacilities} />
          ) : config.key === "users" && isAdmin(staff.role) ? (
            // Staff has no generic "New" form: a web user only comes into being through a
            // Google sign-in. Collectors are added directly (they use tablets only, with a
            // PIN, migration 0048); web staff are invited.
            <>
              <Link href="/staff-invites" className={buttonClass("secondary", "md")}>
                Invite web staff
              </Link>
              <AddCollectorDialog />
            </>
          ) : null
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
