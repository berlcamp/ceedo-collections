"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import type { AgingRow } from "@/lib/ledger/queries";

const columns: DataColumn<AgingRow>[] = [
  {
    key: "stall",
    label: "Stall",
    sortValue: (row) => row.stallNo,
    render: (row) => (
      <Link
        href={`/ledger/leases/${row.leaseId}`}
        className="font-medium text-mark underline decoration-mark/35 hover:decoration-mark"
      >
        {row.stallNo}
      </Link>
    ),
  },
  { key: "tenant", label: "Tenant", sortValue: (row) => row.tenantName, render: (row) => row.tenantName },
  { key: "b1", label: "1-30 days", align: "right", nowrap: true, sortValue: (row) => row.bucket1to30, total: (row) => row.bucket1to30, render: (row) => <Money amount={row.bucket1to30} /> },
  { key: "b2", label: "31-60 days", align: "right", nowrap: true, sortValue: (row) => row.bucket31to60, total: (row) => row.bucket31to60, render: (row) => <Money amount={row.bucket31to60} /> },
  { key: "b3", label: "61-90 days", align: "right", nowrap: true, sortValue: (row) => row.bucket61to90, total: (row) => row.bucket61to90, render: (row) => <Money amount={row.bucket61to90} /> },
  { key: "b4", label: "Over 90 days", align: "right", nowrap: true, sortValue: (row) => row.bucketOver90, total: (row) => row.bucketOver90, render: (row) => <Money amount={row.bucketOver90} /> },
  { key: "not_yet_due", label: "Not yet due", align: "right", nowrap: true, sortValue: (row) => row.notYetDue, total: (row) => row.notYetDue, render: (row) => <Money amount={row.notYetDue} muted /> },
  { key: "total", label: "Total", align: "right", nowrap: true, sortValue: (row) => row.total, total: (row) => row.total, render: (row) => <Money amount={row.total} /> },
];

export function AgingTable({ rows }: { rows: AgingRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.leaseId}
      urlKey="aging"
      unit="leases"
      searchPlaceholder="Filter by stall or tenant…"
      // The gutter carries the age of the worst money on the row, so the leases that have
      // been owed longest are findable without reading a figure.
      rowMark={(row) => (row.bucketOver90 > 0 ? "alert" : row.bucket61to90 > 0 ? "warn" : null)}
      empty="Nothing here yet."
    />
  );
}
