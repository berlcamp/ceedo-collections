"use client";

import { format, sum } from "@ceedo/shared";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { CancelDialog, UndoCancelDialog } from "@/components/ledger/cancel-dialog";
import { Money } from "@/components/ledger/money";
import { Mark, QuietMark } from "@/components/ui/mark";
import type { CollectionRow } from "@/lib/ledger/queries";

function columns(canCancel: boolean): DataColumn<CollectionRow>[] {
  return [
    {
      key: "or_no",
      label: "OR No.",
      nowrap: true,
      sortValue: (row) => row.orNo,
      render: (row) => (
        <span className={`font-mono text-xs ${row.cancelled ? "text-ink-3 line-through" : "text-ink"}`}>
          {row.orNo}
        </span>
      ),
    },
    { key: "date", label: "Collected", nowrap: true, sortValue: (row) => row.businessDate, render: (row) => row.businessDate },
    { key: "collector", label: "Collector", sortValue: (row) => row.collectorName, render: (row) => row.collectorName },
    { key: "stall_or_payer", label: "Stall / Payer", sortValue: (row) => row.stallOrPayer, render: (row) => row.stallOrPayer },
    {
      key: "gross",
      label: "Gross amount",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.grossAmount,
      // A voided receipt is excluded from the running proof. It stays on the record and
      // stays on the screen — it just stops counting toward what was collected, which is
      // exactly what cancel_collection() does to the ledger.
      total: (row) => (row.cancelled ? null : row.grossAmount),
      render: (row) => <Money amount={row.grossAmount} muted={row.cancelled} />,
    },
    {
      key: "status",
      label: "Status",
      searchValue: (row) => (row.cancelled ? `cancelled ${row.cancellationReason ?? ""}` : "posted"),
      facet: (row) => (row.cancelled ? "Cancelled" : "Posted"),
      render: (row) =>
        row.cancelled ? (
          <span className="flex items-center gap-1.5">
            <Mark tone="alert">Cancelled</Mark>
            <span className="text-xs text-ink-3">{row.cancellationReason}</span>
          </span>
        ) : (
          <QuietMark>Posted</QuietMark>
        ),
    },
    {
      key: "action",
      label: "",
      align: "right",
      width: "7rem",
      // The cancel action is presentation-gated the same way the rest of this app gates
      // a write: RLS on collection_cancellations only admits supervisor/accounting/admin
      // to read, and cancel_collection() itself refuses anyone but supervisor or admin
      // (migration 20260918000023) -- this `canCancel` check just keeps the button off
      // an accounting user's screen for a call the database would refuse anyway.
      render: (row) =>
        !canCancel ? null : row.cancelled ? (
          <UndoCancelDialog collectionId={row.id} orNo={row.orNo} />
        ) : (
          <CancelDialog collectionId={row.id} orNo={row.orNo} />
        ),
    },
  ];
}

export function CollectionsTable({
  rows,
  canCancel,
  empty,
}: {
  rows: CollectionRow[];
  canCancel: boolean;
  empty: string;
}) {
  return (
    <DataTable
      columns={columns(canCancel)}
      rows={rows}
      rowKey={(row) => row.id}
      urlKey="collections"
      unit="receipts"
      searchPlaceholder="Filter by OR, collector, stall or payer…"
      rowMark={(row) => (row.cancelled ? "alert" : null)}
      rowMuted={(row) => row.cancelled}
      empty={empty}
      // The line the whole screen exists for: what the total would have been, and what
      // the voids took out of it.
      proofLine={(visible) => {
        const cancelled = visible.filter((row) => row.cancelled);
        if (cancelled.length === 0) {
          return (
            <p className="text-xs text-ink-2">
              No cancellations in this view — every receipt shown counts toward the total.
            </p>
          );
        }
        const voided = sum(cancelled.map((row) => row.grossAmount));
        return (
          <p className="text-xs text-ink-2">
            <span className="font-semibold text-ribbon">{cancelled.length}</span>{" "}
            {cancelled.length === 1 ? "receipt" : "receipts"} cancelled, holding{" "}
            <span className="font-semibold tabular-nums text-ribbon">{format(voided)}</span> —
            excluded from the total above.
          </p>
        );
      }}
    />
  );
}
