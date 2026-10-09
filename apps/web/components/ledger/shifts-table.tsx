"use client";

import { format, fromCentavos, sum, type Centavos } from "@ceedo/shared";
import type { ReactNode } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import { Mark, QuietMark } from "@/components/ui/mark";
import Link from "next/link";
import { formatVariance, needsCashTickets, type ShiftClass, type ShiftRow } from "@/lib/ledger/shift-class";
import { formatDate } from "@/lib/format/date";
import type { ShortageRow } from "@/lib/shortages/queries";
import { SettleDialog } from "@/components/shortages/settle-dialog";

function badge(klass: ShiftClass): ReactNode {
  switch (klass) {
    case "stale_open":
      return <Mark tone="alert">Still open</Mark>;
    case "unsynced":
      return <Mark tone="warn">Closed, not yet synced</Mark>;
    case "open":
      return <QuietMark>Open</QuietMark>;
    case "remitted":
      return <QuietMark>Remitted</QuietMark>;
    default:
      return <QuietMark>Closed</QuietMark>;
  }
}

const KLASS_LABEL: Record<ShiftClass, string> = {
  stale_open: "Still open",
  unsynced: "Closed, not yet synced",
  open: "Open",
  remitted: "Remitted",
  closed: "Closed",
};

/**
 * `shortages` is keyed by shift id and passed only to a role that may record a payment
 * (supervisor, admin); for anyone else it is null and the Settle column renders nothing.
 */
function columns(
  shortages: Map<string, ShortageRow> | null,
  today: string,
): DataColumn<ShiftRow>[] {
  return [
    {
      key: "status",
      label: "Status",
      nowrap: true,
      sortValue: (row) => KLASS_LABEL[row.klass],
      searchValue: (row) => KLASS_LABEL[row.klass],
      facet: (row) => KLASS_LABEL[row.klass],
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {badge(row.klass)}
          {/* Task 6: the same `office` tone the collection browser and the Recovery
              screen's own receipt list use -- a shift with any office-encoded receipt
              carries the badge, regardless of how it otherwise classifies. */}
          {row.officeEncodedCount > 0 ? (
            <Mark tone="office">
              {row.officeEncodedCount} office-encoded
            </Mark>
          ) : null}
        </span>
      ),
    },
    { key: "collector", label: "Collector", sortValue: (row) => row.collectorName, facet: (row) => row.collectorName, render: (row) => row.collectorName },
    { key: "device", label: "Device", sortValue: (row) => row.deviceLabel, facet: (row) => row.deviceLabel, render: (row) => row.deviceLabel },
    { key: "business_date", label: "Business date", nowrap: true, sortValue: (row) => row.businessDate, render: (row) => formatDate(row.businessDate) },
    {
      key: "system_count",
      label: "System count",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.systemCount,
      render: (row) => row.systemCount ?? <span className="text-ink-3">—</span>,
    },
    // Deliberately not summed into the close, unlike `variance` below: a shift still open
    // contributes a system total with no declaration to set against it, so a column sum here
    // and a column sum under "Declared total" differ by more than any real discrepancy. A
    // proof that invites a wrong subtraction is worse than no proof.
    {
      key: "system_total",
      label: "System total",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.systemTotal,
      render: (row) => (row.systemTotal === null ? <span className="text-ink-3">—</span> : <Money amount={row.systemTotal} />),
    },
    {
      key: "declared_total",
      label: "Declared total",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.declaredTotal,
      render: (row) => (row.declaredTotal === null ? <span className="text-ink-3">—</span> : <Money amount={row.declaredTotal} />),
    },
    {
      key: "variance",
      label: "Variance",
      align: "right",
      nowrap: true,
      sortValue: (row) => row.variance,
      total: (row) => row.variance,
      render: (row) => {
        const text = formatVariance(row.variance);
        // Signed, so a short drawer reads differently from an over -- a supervisor scanning
        // this column should not have to read every figure to know which is which.
        const className =
          row.variance === null
            ? "text-ink-3"
            : row.variance < 0
              ? "font-semibold text-ribbon"
              : row.variance > 0
                ? "font-semibold text-amber"
                : "text-ink-3";
        // The variance never changes once a shortage is paid back; what is still owed on it
        // sits underneath, so a settled shortage does not read as an open one.
        return (
          <span className={className}>
            {text}
            {needsCashTickets(row) ? (
              <Link href={`/ledger/cash-tickets?date=${row.businessDate}`} className="ml-2 text-xs font-normal text-amber underline">
                Over, no cash tickets
              </Link>
            ) : null}
            {row.stillOwed !== null ? (
              <span className="block text-xs font-normal text-ink-3">
                {row.stillOwed === 0 ? "Paid back" : `${format(row.stillOwed)} still owed`}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "settle",
      label: "",
      align: "right",
      // The same dialog as the Shortages screen: a supervisor records the payment here, and
      // accounting still verifies it there before it reduces what is owed.
      render: (row) => {
        const shortage = shortages?.get(row.id);
        return shortage && shortage.room > 0 ? (
          <SettleDialog row={shortage} today={today} trigger="Settle" />
        ) : null;
      },
    },
  ];
}

export function ShiftsTable({
  rows,
  shortages,
  today,
}: {
  rows: ShiftRow[];
  shortages: ShortageRow[] | null;
  today: string;
}) {
  const byShift = shortages ? new Map(shortages.map((s) => [s.shiftId, s])) : null;
  return (
    <DataTable
      columns={columns(byShift, today)}
      rows={rows}
      rowKey={(row) => row.id}
      urlKey="shifts"
      unit="shifts"
      searchPlaceholder="Filter by collector, device or date…"
      rowMark={(row) =>
        row.klass === "stale_open" ? "alert" : row.klass === "unsynced" ? "warn" : null
      }
      empty="No shifts recorded yet."
      // The net of every closed drawer in view. This is the figure the office is actually
      // answerable for, and nothing else on the screen states it.
      proofLine={(visible) => {
        const closed = visible.filter((row) => row.variance !== null);
        if (closed.length === 0) {
          return <p className="text-xs text-ink-2">No closed shift in this view to prove against.</p>;
        }
        const net = sum(
          closed
            .map((row) => row.variance)
            .filter((variance): variance is Centavos => variance !== null),
        );
        const short = closed.filter((row) => (row.variance ?? 0) < 0).length;
        const over = closed.filter((row) => (row.variance ?? 0) > 0).length;
        return (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-2">
            <span className="caption text-ink-2">Net variance</span>
            <span
              className={`font-semibold tabular-nums ${
                net < 0 ? "text-ribbon" : net > 0 ? "text-amber" : "text-proof"
              }`}
            >
              {net === 0 ? "Balanced" : formatVariance(net)}
            </span>
            <span className="text-ink-3">
              across {closed.length} closed {closed.length === 1 ? "shift" : "shifts"}
              {short > 0 ? ` · ${short} short` : ""}
              {over > 0 ? ` · ${over} over` : ""}
              {net !== 0 ? ` · ${format(fromCentavos(Math.abs(net)))} unaccounted` : ""}
            </span>
          </p>
        );
      }}
    />
  );
}
