"use client";

import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { buttonClass } from "@/components/ui/button";
import {
  AssignFacilitiesDialog,
  type AreaOption,
  type AssignFacilitiesData,
} from "./assign-facilities-dialog";

export interface CollectorAreasRow {
  collectorId: string;
  collectorName: string;
  /** Facility names, in name order. */
  facilities: string[];
}

/**
 * One row per collector with an active collection area, their facilities side by side.
 * Areas are set a collector at a time (AssignFacilitiesDialog), so they are listed that way
 * too. `assign` is present only for a role that may write: a row click then opens the edit.
 */
export function CollectionAreasTable({
  rows,
  empty,
  assign,
}: {
  rows: CollectorAreasRow[];
  empty: string;
  assign: AssignFacilitiesData | null;
}) {
  const [editing, setEditing] = useState<AreaOption | null>(null);

  const columns = useMemo<DataColumn<CollectorAreasRow>[]>(() => {
    const built: DataColumn<CollectorAreasRow>[] = [
      {
        key: "collector",
        label: "Collector",
        sortValue: (row) => row.collectorName,
        render: (row) => row.collectorName,
      },
      {
        key: "facilities",
        label: "Facilities",
        sortValue: (row) => row.facilities.join(", "),
        render: (row) => row.facilities.join(", "),
      },
    ];
    if (assign) {
      built.push({
        key: "__edit",
        label: "",
        align: "right",
        width: "5rem",
        render: (row) => (
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            aria-label={`Edit ${row.collectorName}`}
            onClick={() => setEditing({ id: row.collectorId, name: row.collectorName })}
          >
            <Pencil size={12} strokeWidth={1.75} />
            Edit
          </button>
        ),
      });
    }
    return built;
  }, [assign]);

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.collectorId}
        urlKey="collector-assignments"
        unit="collectors"
        empty={empty}
        searchPlaceholder="Filter by collector or facility…"
        {...(assign
          ? {
              emptyAction: <AssignFacilitiesDialog {...assign} />,
              onRowClick: (row: CollectorAreasRow) =>
                setEditing({ id: row.collectorId, name: row.collectorName }),
              rowLabel: (row: CollectorAreasRow) => `Edit ${row.collectorName}`,
            }
          : {})}
      />
      {assign && editing ? (
        <AssignFacilitiesDialog
          // Keyed by collector: a different row must open a fresh form, not the last one's ticks.
          key={editing.id}
          {...assign}
          target={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
