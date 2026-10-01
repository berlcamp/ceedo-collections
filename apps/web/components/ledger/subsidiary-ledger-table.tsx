"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { CondoneDialog } from "@/components/ledger/condone-dialog";
import { Money } from "@/components/ledger/money";
import { Mark } from "@/components/ui/mark";
import type { SubsidiaryLedgerEntry } from "@/lib/ledger/queries";
import { formatDate } from "@/lib/format/date";

/**
 * Takes `leaseId` and `canCondone` rather than being a module-level constant: the condone
 * action needs both to render.
 */
function columns(leaseId: string, canCondone: boolean): DataColumn<SubsidiaryLedgerEntry>[] {
  return [
    { key: "date", label: "Date", nowrap: true, sortValue: (row) => row.entryDate, render: (row) => formatDate(row.entryDate) },
    {
      key: "detail",
      label: "Entry",
      sortValue: (row) => row.detail,
      searchValue: (row) => `${row.detail} ${row.orNo ?? ""} ${row.cancellationReason ?? ""}`,
      facet: (row) => (row.entryType === "collection" ? "Payment" : "Charge"),
      render: (row) => (
        <span className={row.cancelled ? "text-ink-3 line-through" : undefined}>
          {row.detail}
          {row.orNo ? <span className="ml-1 font-mono text-xs text-ink-2">OR {row.orNo}</span> : null}
          {/* Task 6: same `office` tone as the collection browser and the shifts list, next
              to the OR the same way "Cancelled" sits below -- consistent across every
              screen that shows a receipt's OR number. */}
          {row.officeEncoded ? (
            <span className="ml-2 inline-flex align-middle no-underline">
              <Mark tone="office">Office-encoded</Mark>
            </span>
          ) : null}
          {row.cancelled && row.cancellationReason ? (
            // The strikethrough shows the receipt was voided; the reason is the point of
            // keeping it on the record at all rather than deleting the row.
            <span className="ml-2 inline-flex items-center gap-1.5 align-middle no-underline">
              <Mark tone="alert">Cancelled</Mark>
              <span className="text-xs text-ink-3 no-underline">{row.cancellationReason}</span>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "debit",
      label: "Debit",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.debit,
      total: (row) => row.debit,
      render: (row) => <Money amount={row.debit} muted={row.cancelled} />,
    },
    {
      key: "credit",
      label: "Credit",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.credit,
      total: (row) => row.credit,
      render: (row) => <Money amount={row.credit} muted={row.cancelled} />,
    },
    {
      key: "running_balance",
      label: "Balance",
      align: "right",
      nowrap: true,
      // Deliberately not summed into the close: a running balance is already a total, and
      // adding a column of them together would produce a number that means nothing.
      sortValue: (row) => row.runningBalance,
      render: (row) => <Money amount={row.runningBalance} />,
    },
    {
      key: "action",
      label: "",
      align: "right",
      width: "6rem",
      // Condoning only ever makes sense against a live charge with something still
      // outstanding -- a payment row (entryType "collection") and an already-settled
      // charge both fall through to nothing rendered.
      render: (row) =>
        canCondone && row.entryType === "charge" && row.isSettled === false && row.outstanding !== null ? (
          <CondoneDialog
            chargeId={row.sourceId}
            leaseId={leaseId}
            outstanding={row.outstanding}
            detail={row.detail}
          />
        ) : null,
    },
  ];
}

export function SubsidiaryLedgerTable({
  entries,
  leaseId,
  canCondone,
}: {
  entries: SubsidiaryLedgerEntry[];
  leaseId: string;
  canCondone: boolean;
}) {
  return (
    <DataTable
      columns={columns(leaseId, canCondone)}
      rows={entries}
      rowKey={(row) => `${row.entryType}-${row.sourceId}`}
      urlKey="ledger"
      unit="entries"
      searchPlaceholder="Filter by entry, OR number or reason…"
      rowMuted={(row) => row.cancelled}
      empty="No entries on this lease yet. Charges land here as the nightly accrual bills each period, and payments as the collector's tablet syncs."
    />
  );
}
