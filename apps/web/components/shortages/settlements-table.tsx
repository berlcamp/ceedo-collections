"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import { formatDate } from "@/lib/format/date";
import type { SettlementRow } from "@/lib/shortages/queries";
import { CancelSettlementDialog, VerifySettlementButton } from "./settlement-actions";

const STATE_LABEL = { recorded: "Awaiting verification", verified: "Verified", cancelled: "Cancelled" };

/** Every repayment recorded against a shortage, with accounting's verify and the cancel. */
export function SettlementsTable({
  rows,
  verifiable,
  canCancel,
}: {
  rows: SettlementRow[];
  /** Payments this viewer may verify (accounting or admin, and not the recorder). */
  verifiable: string[];
  canCancel: boolean;
}) {
  const columns: DataColumn<SettlementRow>[] = [
    { key: "paid", label: "Paid", nowrap: true, sortValue: (r) => r.receivedAt, render: (r) => formatDate(r.receivedAt) },
    { key: "collector", label: "Collector", sortValue: (r) => r.collectorName, facet: (r) => r.collectorName, render: (r) => r.collectorName },
    { key: "shift", label: "For shift", nowrap: true, sortValue: (r) => r.businessDate, render: (r) => formatDate(r.businessDate) },
    { key: "reference", label: "Reference", sortValue: (r) => r.reference, render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      nowrap: true,
      sortValue: (r) => r.amount,
      total: (r) => (r.state === "cancelled" ? null : r.amount),
      render: (r) => <Money amount={r.amount} muted={r.state === "cancelled"} />,
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
            {verifiable.includes(r.id) ? <VerifySettlementButton id={r.id} /> : null}
            {canCancel ? <CancelSettlementDialog id={r.id} reference={r.reference} /> : null}
          </span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      urlKey="settlements"
      unit="payments"
      rowMuted={(r) => r.state === "cancelled"}
      rowMark={(r) => (r.state === "recorded" ? "warn" : null)}
      searchPlaceholder="Filter by collector or reference…"
      empty="No shortage payments recorded yet."
    />
  );
}
