"use client";

import { useMemo } from "react";
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
    return String(nested.name ?? nested.code ?? nested.full_name ?? "—");
  }
  return String(value);
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
  const dataColumns = useMemo<DataColumn<Row>[]>(() => {
    const built: DataColumn<Row>[] = columns.map((column) => ({
      key: column.key,
      label: column.label,
      render: (row) => {
        const text = formatCell(row[column.key]);
        return text === "—" ? <span className="text-ink-3">—</span> : text;
      },
      sortValue: (row) => {
        const value = row[column.key];
        if (typeof value === "number") return value;
        const text = formatCell(value);
        return text === "—" ? null : text;
      },
      searchValue: (row) => formatCell(row[column.key]),
      ...(facetable(rows, column.key) ? { facet: (row: Row) => formatCell(row[column.key]) } : {}),
    }));

    if (spec && editRows) {
      const byId = new Map(editRows.map((row) => [row.id, row]));
      built.push({
        key: "__edit",
        label: "",
        align: "right",
        width: "5rem",
        render: (row) => {
          const target = byId.get(String(row.id));
          return target ? <ResourceFormDialog spec={spec} target={target} /> : null;
        },
      });
    }

    return built;
  }, [columns, rows, spec, editRows]);

  return (
    <DataTable
      columns={dataColumns}
      rows={rows}
      rowKey={(row) => String(row.id ?? JSON.stringify(row))}
      urlKey={urlKey}
      unit={unit}
      empty={empty}
      {...(spec && canCreate ? { emptyAction: <ResourceFormDialog spec={spec} /> } : {})}
      searchPlaceholder={`Filter ${unit}…`}
    />
  );
}
