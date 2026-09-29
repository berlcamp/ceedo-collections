"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import type { OpeningBalanceLease, RecordedOpeningBalance } from "@/lib/ledger/queries";
import { formatDate } from "@/lib/format/date";

const pendingColumns: DataColumn<OpeningBalanceLease>[] = [
  { key: "stall", label: "Stall", sortValue: (row) => row.stallNo, render: (row) => row.stallNo },
  { key: "tenant", label: "Tenant", sortValue: (row) => row.tenantName, render: (row) => row.tenantName },
];

const recordedColumns: DataColumn<RecordedOpeningBalance>[] = [
  { key: "stall", label: "Stall", sortValue: (row) => row.stallNo, render: (row) => row.stallNo },
  { key: "tenant", label: "Tenant", sortValue: (row) => row.tenantName, render: (row) => row.tenantName },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    nowrap: true,
    sortValue: (row) => row.amount,
    total: (row) => row.amount,
    render: (row) => <Money amount={row.amount} />,
  },
  {
    key: "oldest",
    label: "Oldest unpaid date",
    nowrap: true,
    sortValue: (row) => row.oldestUnpaidDate,
    render: (row) => formatDate(row.oldestUnpaidDate),
  },
];

export function PendingOpeningBalancesTable({ rows }: { rows: OpeningBalanceLease[] }) {
  return (
    <DataTable
      columns={pendingColumns}
      rows={rows}
      rowKey={(row) => row.leaseId}
      urlKey="ob-pending"
      unit="leases"
      searchPlaceholder="Filter by stall or tenant…"
      empty="Every active lease has an opening balance recorded. Nothing is left on the punch list."
    />
  );
}

export function RecordedOpeningBalancesTable({ rows }: { rows: RecordedOpeningBalance[] }) {
  return (
    <DataTable
      columns={recordedColumns}
      rows={rows}
      rowKey={(row) => row.leaseId}
      urlKey="ob-recorded"
      unit="leases"
      searchPlaceholder="Filter by stall or tenant…"
      empty="No opening balance has been recorded yet. Each one entered above appears here, and this is the list the Treasurer is shown at go-live."
    />
  );
}
