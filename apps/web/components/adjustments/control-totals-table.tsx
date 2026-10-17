"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import type { ControlRow } from "@/lib/adjustments/queries";

const columns: DataColumn<ControlRow>[] = [
  {
    key: "amount",
    label: "Amount",
    align: "right",
    nowrap: true,
    sortValue: (r) => r.amount,
    render: (r) => <Money amount={r.amount} />,
  },
  { key: "note", label: "Note", render: (r) => r.note ?? <span className="text-ink-3">—</span> },
  { key: "entered", label: "Entered", nowrap: true, render: (r) => `${r.enteredBy} · ${r.enteredOn}` },
  {
    key: "status",
    label: "Status",
    render: (r) => (r.inForce ? "In force" : <span className="text-ink-3">Replaced</span>),
  },
];

export function ControlTotalsTable({ rows }: { rows: ControlRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      urlKey="control-totals"
      unit="entries"
      rowMuted={(r) => !r.inForce}
      empty="No control total entered for this month."
    />
  );
}
