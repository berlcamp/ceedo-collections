"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import type { DelinquencyRow } from "@/lib/ledger/queries";

const columns: DataColumn<DelinquencyRow>[] = [
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
  {
    key: "contact",
    label: "Contact",
    sortValue: (row) => row.contactNo,
    render: (row) =>
      row.contactNo ? (
        <span className="font-mono text-xs">{row.contactNo}</span>
      ) : (
        // A demand letter needs a way to reach the tenant; a missing number is a gap in
        // the work, not a tidy dash.
        <span className="text-xs text-ink-3">No contact on file</span>
      ),
  },
  {
    key: "outstanding",
    label: "Outstanding",
    align: "right",
    nowrap: true,
    sortValue: (row) => row.outstanding,
    total: (row) => row.outstanding,
    render: (row) => <Money amount={row.outstanding} />,
  },
  {
    key: "oldest_due_date",
    label: "Oldest due date",
    nowrap: true,
    sortValue: (row) => row.oldestDueDate,
    render: (row) => row.oldestDueDate ?? <span className="text-ink-3">—</span>,
  },
  {
    key: "days_overdue",
    label: "Days overdue",
    align: "right",
    nowrap: true,
    sortValue: (row) => row.daysOverdue,
    render: (row) => (
      <span className={row.daysOverdue >= 90 ? "font-semibold text-ribbon" : undefined}>
        {row.daysOverdue}
      </span>
    ),
  },
];

export function DelinquencyTable({ rows }: { rows: DelinquencyRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.leaseId}
      urlKey="delinquency"
      unit="leases"
      searchPlaceholder="Filter by stall, tenant or contact…"
      rowMark={(row) => (row.daysOverdue >= 90 ? "alert" : null)}
      empty="Nothing here yet."
    />
  );
}
