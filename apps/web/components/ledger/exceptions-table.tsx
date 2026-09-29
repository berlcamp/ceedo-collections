"use client";

import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import {
  CorrectExceptionDialog,
  EscalateExceptionDialog,
  SpoilExceptionDialog,
} from "@/components/ledger/exception-dialogs";
import { Mark, QuietMark } from "@/components/ui/mark";
import type { ExceptionRow } from "@/lib/ledger/exceptions";

/** Whole days since `firstSeenAt`, not merely the calendar-date difference: §11.3's
 * three-day Treasurer escalation is about elapsed time a receipt has sat unresolved, and a
 * supervisor comparing this number against that rule needs it computed the same way. */
function ageInDays(firstSeenAt: string): number {
  const elapsedMs = Date.now() - new Date(firstSeenAt).getTime();
  return Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
}

function columns(canResolve: boolean): DataColumn<ExceptionRow>[] {
  return [
    {
      key: "reason",
      label: "Reason",
      sortValue: (row) => row.reasonText,
      searchValue: (row) => `${row.reasonText} ${row.reasonCode} ${row.detail ?? ""} ${row.status}`,
      facet: (row) => row.reasonText,
      render: (row) => (
        <div className="min-w-[14rem] max-w-[34rem] whitespace-normal">
          <p className="leading-snug">{row.reasonText}</p>
          {row.detail ? <p className="mt-1 text-xs leading-snug text-ink-3">{row.detail}</p> : null}
          {row.status === "escalated" ? (
            <Mark tone="warn" className="mt-1">
              Escalated
            </Mark>
          ) : null}
        </div>
      ),
    },
    { key: "collector", label: "Collector", sortValue: (row) => row.collectorName, facet: (row) => row.collectorName, render: (row) => row.collectorName },
    { key: "device", label: "Device", sortValue: (row) => row.deviceLabel, facet: (row) => row.deviceLabel, render: (row) => row.deviceLabel },
    {
      key: "or_no",
      label: "OR No.",
      nowrap: true,
      sortValue: (row) => row.summary.orNo,
      render: (row) =>
        row.summary.orNo === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="font-mono text-xs">{row.summary.orNo}</span>
        ),
    },
    {
      key: "lease",
      label: "Lease",
      sortValue: (row) => row.summary.leaseId,
      render: (row) =>
        row.summary.leaseId === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="font-mono text-xs text-ink-2">{row.summary.leaseId}</span>
        ),
    },
    {
      key: "attempts",
      label: "Attempts",
      align: "right",
      sortValue: (row) => row.attempts,
      render: (row) => row.attempts,
    },
    {
      key: "age",
      label: "Age",
      align: "right",
      nowrap: true,
      sortValue: (row) => ageInDays(row.firstSeenAt),
      render: (row) => {
        const days = ageInDays(row.firstSeenAt);
        // §11.3's three-day Treasurer escalation line -- a supervisor deciding what to do
        // about an exception needs to see it's approaching that line, not just a number.
        const overdue = days >= 3;
        return (
          <span className={overdue ? "font-semibold text-ribbon" : undefined}>
            {days} {days === 1 ? "day" : "days"}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        if (!canResolve) {
          return <QuietMark>Awaiting supervisor</QuietMark>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1">
            <CorrectExceptionDialog exceptionId={row.id} currentOrNo={row.summary.orNo} />
            <SpoilExceptionDialog exceptionId={row.id} />
            <EscalateExceptionDialog exceptionId={row.id} />
          </div>
        );
      },
    },
  ];
}

export function ExceptionsTable({
  rows,
  canResolve,
  empty,
}: {
  rows: ExceptionRow[];
  canResolve: boolean;
  empty: string;
}) {
  return (
    <DataTable
      columns={columns(canResolve)}
      rows={rows}
      rowKey={(row) => row.id}
      urlKey="exceptions"
      unit="exceptions"
      searchPlaceholder="Filter by reason, collector, device or OR…"
      rowMark={(row) =>
        ageInDays(row.firstSeenAt) >= 3 ? "alert" : row.status === "escalated" ? "warn" : null
      }
      empty={empty}
      proofLine={(visible) => {
        const past = visible.filter((row) => ageInDays(row.firstSeenAt) >= 3).length;
        if (past === 0) {
          return (
            <p className="text-xs text-ink-2">
              Nothing in this view has passed the three-day line.
            </p>
          );
        }
        return (
          <p className="text-xs text-ink-2">
            <span className="font-semibold text-ribbon">{past}</span>{" "}
            {past === 1 ? "exception has" : "exceptions have"} sat three days or longer — §11.3
            puts these in front of the Treasurer.
          </p>
        );
      }}
    />
  );
}
