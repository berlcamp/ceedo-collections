"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import { Mark, QuietMark } from "@/components/ui/mark";
import { formatDate } from "@/lib/format/date";
import type { ShortageRow } from "@/lib/shortages/queries";
import { SHORTAGE_LABEL } from "@/lib/shortages/tally";
import { SettleDialog } from "./settle-dialog";

/** One row per short shift: what was short, what has been paid back, what is still owed. */
export function ShortagesTable({
  rows,
  canRecord,
  today,
}: {
  rows: ShortageRow[];
  canRecord: boolean;
  today: string;
}) {
  const columns: DataColumn<ShortageRow>[] = [
    {
      key: "state",
      label: "Status",
      nowrap: true,
      sortValue: (r) => SHORTAGE_LABEL[r.state],
      facet: (r) => SHORTAGE_LABEL[r.state],
      render: (r) =>
        r.state === "settled" ? (
          <QuietMark>Settled</QuietMark>
        ) : (
          <Mark tone={r.state === "outstanding" ? "alert" : "warn"}>{SHORTAGE_LABEL[r.state]}</Mark>
        ),
    },
    { key: "date", label: "Shift", nowrap: true, sortValue: (r) => r.businessDate, render: (r) => formatDate(r.businessDate) },
    { key: "collector", label: "Collector", sortValue: (r) => r.collectorName, facet: (r) => r.collectorName, render: (r) => r.collectorName },
    { key: "short", label: "Short", align: "right", nowrap: true, sortValue: (r) => r.short, total: (r) => r.short, render: (r) => <Money amount={r.short} /> },
    { key: "settled", label: "Paid, verified", align: "right", nowrap: true, sortValue: (r) => r.settled, total: (r) => r.settled, render: (r) => <Money amount={r.settled} /> },
    { key: "pending", label: "Awaiting verification", align: "right", nowrap: true, sortValue: (r) => r.pending, total: (r) => r.pending, render: (r) => <Money amount={r.pending} /> },
    {
      key: "outstanding",
      label: "Still owed",
      align: "right",
      nowrap: true,
      sortValue: (r) => r.outstanding,
      total: (r) => r.outstanding,
      render: (r) => (
        <span className={r.outstanding > 0 ? "font-semibold text-ribbon" : ""}>
          <Money amount={r.outstanding} />
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (canRecord && r.room > 0 ? <SettleDialog row={r} today={today} /> : null),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.shiftId}
      urlKey="shortages"
      unit="short shifts"
      rowMuted={(r) => r.state === "settled"}
      rowMark={(r) => (r.state === "outstanding" ? "alert" : r.state === "partly_settled" ? "warn" : null)}
      searchPlaceholder="Filter by collector or date…"
      empty="No shift has closed short."
    />
  );
}
