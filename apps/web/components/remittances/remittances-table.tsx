"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import type { RemittanceRow } from "@/lib/remittances/queries";
import { CancelRemittanceDialog, VerifyButton } from "./row-actions";
import { formatDate } from "@/lib/format/date";

const STATE_LABEL = { recorded: "Awaiting verification", verified: "Verified", cancelled: "Cancelled" };

export function RemittancesTable({
  rows,
  verifiable,
  canCancel,
}: {
  rows: RemittanceRow[];
  /** Slips this viewer may verify (accounting or admin, and not the recorder). */
  verifiable: string[];
  canCancel: boolean;
}) {
  const columns: DataColumn<RemittanceRow>[] = [
    { key: "date", label: "Deposited", nowrap: true, sortValue: (r) => r.depositedAt, render: (r) => formatDate(r.depositedAt) },
    { key: "collector", label: "Collector", sortValue: (r) => r.collectorName, render: (r) => r.collectorName },
    {
      key: "slip",
      label: "Slip",
      sortValue: (r) => r.depositSlipNo,
      render: (r) => (
        <span>
          <span className="font-mono text-xs">{r.depositSlipNo}</span>
          <span className="block text-xs text-ink-3">{r.bank}</span>
        </span>
      ),
    },
    {
      key: "covers",
      label: "Covers",
      render: (r) => (
        <span className="text-xs">
          {r.shiftCount} shift{r.shiftCount === 1 ? "" : "s"}
          <span className="block text-ink-3">{r.dates.map(formatDate).join(", ")}</span>
        </span>
      ),
    },
    { key: "declared", label: "Cash declared", align: "right", nowrap: true, sortValue: (r) => r.declared, render: (r) => <Money amount={r.declared} /> },
    { key: "amount", label: "Deposited", align: "right", nowrap: true, sortValue: (r) => r.amount, total: (r) => (r.state === "cancelled" ? null : r.amount), render: (r) => <Money amount={r.amount} muted={r.state === "cancelled"} /> },
    {
      key: "difference",
      label: "Difference",
      align: "right",
      nowrap: true,
      sortValue: (r) => r.difference,
      render: (r) =>
        r.state === "cancelled" ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className={r.difference === 0 ? "" : "font-semibold text-ribbon"}>
            <Money amount={r.difference} />
          </span>
        ),
    },
    {
      key: "state",
      label: "Status",
      facet: (r) => STATE_LABEL[r.state],
      sortValue: (r) => r.state,
      render: (r) => (
        <span className="text-xs">
          {STATE_LABEL[r.state]}
          <span className="block text-ink-3">
            {r.state === "verified"
              ? `by ${r.verifiedByName}`
              : r.state === "cancelled"
                ? r.cancelReason
                : `recorded by ${r.recordedByName}`}
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) =>
        r.state !== "recorded" ? null : (
          <span className="inline-flex gap-1">
            {verifiable.includes(r.id) ? <VerifyButton id={r.id} /> : null}
            {canCancel ? <CancelRemittanceDialog id={r.id} slip={r.depositSlipNo} /> : null}
          </span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      urlKey="remittances"
      unit="deposits"
      rowMuted={(r) => r.state === "cancelled"}
      rowMark={(r) => (r.state !== "cancelled" && r.difference !== 0 ? "alert" : r.state === "recorded" ? "warn" : null)}
      searchPlaceholder="Filter by collector, slip or bank…"
      empty="No deposits recorded for this month."
    />
  );
}
