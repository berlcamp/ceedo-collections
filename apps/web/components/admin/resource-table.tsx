"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Mark } from "@/components/ui/mark";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import {
  ResourceFormDialog,
  type EditRow,
  type ResourceFormSpec,
} from "@/components/admin/resource-form-dialog";
import type { ColumnConfig } from "@/lib/admin/resource";

type Row = Record<string, unknown>;

/**
 * Formats one cell of a registry-driven resource.
 *
 * Unchanged from the original engine, deliberately: several resources render raw numeric
 * columns (a rate's `amount`, a fee type's `surcharge_bps`) through it, and deciding here
 * that one of those is pesos rather than basis points would be a data change wearing the
 * clothes of a design pass.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>;
    // A join's label column varies by table; `stalls(stall_no)` has none of the usual names,
    // so fall back to whatever single column the join selected.
    return String(
      nested.name ?? nested.code ?? nested.full_name ?? Object.values(nested)[0] ?? "—",
    );
  }
  return String(value);
}

function statusOf(row: Row, column: ColumnConfig) {
  const value = row[column.key];
  return value === null || value === undefined ? undefined : column.status?.[String(value)];
}

function cellText(row: Row, column: ColumnConfig): string {
  const status = statusOf(row, column);
  if (status) return status.label;
  const text = formatCell(row[column.key]);
  return text === "—" && column.emptyText ? column.emptyText : text;
}

/** A column earns a facet chip when its values are few, repeated, and short — a status,
 * a type, a period. A column of distinct names is a search, not a set of checkboxes. */
function facetable(rows: Row[], key: string): boolean {
  if (rows.length < 8) return false;
  const seen = new Set<string>();
  for (const row of rows) {
    const text = formatCell(row[key]);
    if (text.length > 28) return false;
    seen.add(text);
    if (seen.size > 12) return false;
  }
  return seen.size >= 2 && seen.size < rows.length;
}

export function ResourceTable({
  columns,
  rows,
  urlKey,
  unit,
  empty,
  spec,
  editRows,
  canCreate,
}: {
  columns: ColumnConfig[];
  rows: Row[];
  urlKey: string;
  unit: string;
  empty: string;
  /** Present only when this role may write. Absent, the table has no actions column. */
  spec?: ResourceFormSpec;
  /** Present only for a `writeMode: "edit"` resource — the rows the engine can update. */
  editRows?: EditRow[];
  /**
   * False for a `writeMode: "edit"` resource, whose rows can only come into being through
   * the claim trigger on a real Google sign-in — so its empty state must not offer a
   * control the engine has no way to honour.
   */
  canCreate?: boolean;
}) {
  // One shared edit dialog, opened by a row click or the row's Edit button, rather than a
  // dialog mounted per row.
  const [editing, setEditing] = useState<EditRow | null>(null);
  const byId = useMemo(() => new Map((editRows ?? []).map((row) => [row.id, row])), [editRows]);
  const editable = spec && editRows ? (row: Row) => byId.get(String(row.id)) ?? null : null;

  const dataColumns = useMemo<DataColumn<Row>[]>(() => {
    const built: DataColumn<Row>[] = columns.map((column) => ({
      key: column.key,
      label: column.label,
      render: (row) => {
        const status = statusOf(row, column);
        if (status) return <Mark tone={status.tone}>{status.label}</Mark>;
        const text = formatCell(row[column.key]);
        if (text !== "—") return text;
        return <span className="text-ink-3">{column.emptyText ?? "—"}</span>;
      },
      sortValue: (row) => {
        const value = row[column.key];
        if (typeof value === "number") return value;
        const text = statusOf(row, column)?.label ?? formatCell(value);
        return text === "—" ? null : text;
      },
      searchValue: (row) => cellText(row, column),
      ...(column.facet !== false && facetable(rows, column.key) ? { facet: (row: Row) => cellText(row, column) } : {}),
      ...(column.dateBound
        ? {
            dateBound: {
              side: column.dateBound,
              value: (row: Row) => {
                const value = row[column.key];
                return typeof value === "string" && value ? value.slice(0, 10) : null;
              },
            },
          }
        : {}),
    }));

    if (spec && editRows) {
      built.push({
        key: "__edit",
        label: "",
        align: "right",
        width: "5rem",
        render: (row) => {
          const target = byId.get(String(row.id));
          return target ? (
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              aria-label={`Edit ${target.label}`}
              onClick={() => setEditing(target)}
            >
              <Pencil size={12} strokeWidth={1.75} />
              Edit
            </button>
          ) : null;
        },
      });
    }

    return built;
  }, [columns, rows, spec, editRows, byId]);

  return (
    <>
      <DataTable
        columns={dataColumns}
        rows={rows}
        rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        urlKey={urlKey}
        unit={unit}
        empty={empty}
        {...(spec && canCreate ? { emptyAction: <ResourceFormDialog spec={spec} /> } : {})}
        searchPlaceholder={`Filter ${unit}…`}
        {...(editable
          ? {
              onRowClick: (row: Row) => {
                const target = editable(row);
                if (target) setEditing(target);
              },
              rowLabel: (row: Row) => `Edit ${editable(row)?.label ?? ""}`,
            }
          : {})}
      />
      {spec && editing ? (
        <ResourceFormDialog
          // Keyed by row: the form's fields hold their own state, so a different row must
          // mount a fresh form rather than inherit the last one's edits.
          key={editing.id}
          spec={spec}
          target={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
