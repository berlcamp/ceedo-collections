import { canResolveExceptions } from "@ceedo/shared";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import {
  CorrectExceptionDialog,
  EscalateExceptionDialog,
  SpoilExceptionDialog,
} from "@/components/ledger/exception-dialogs";
import { getOpenExceptions, type ExceptionRow } from "@/lib/ledger/exceptions";
import { requireStaff } from "@/lib/supabase/session";

/** Whole days since `firstSeenAt`, not merely the calendar-date difference: §11.3's
 * three-day Treasurer escalation is about elapsed time a receipt has sat unresolved, and a
 * supervisor comparing this number against that rule needs it computed the same way. */
function ageInDays(firstSeenAt: string): number {
  const elapsedMs = Date.now() - new Date(firstSeenAt).getTime();
  return Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
}

function columns(canResolve: boolean): LedgerColumn<ExceptionRow>[] {
  return [
    {
      key: "reason",
      label: "Reason",
      render: (row) => (
        <div>
          <p>{row.reasonText}</p>
          {row.status === "escalated" ? (
            <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Escalated
            </span>
          ) : null}
        </div>
      ),
    },
    { key: "collector", label: "Collector", render: (row) => row.collectorName },
    { key: "device", label: "Device", render: (row) => row.deviceLabel },
    {
      key: "or_no",
      label: "OR No.",
      render: (row) => row.summary.orNo ?? "—",
    },
    {
      key: "lease",
      label: "Lease",
      render: (row) => row.summary.leaseId ?? "—",
    },
    {
      key: "attempts",
      label: "Attempts",
      align: "right",
      render: (row) => row.attempts,
    },
    {
      key: "age",
      label: "Age",
      align: "right",
      render: (row) => {
        const days = ageInDays(row.firstSeenAt);
        // §11.3's three-day Treasurer escalation line -- a supervisor deciding what to do
        // about an exception needs to see it's approaching that line, not just a number.
        const overdue = days >= 3;
        return (
          <span className={overdue ? "font-medium text-red-700" : ""}>
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
          return <span className="text-xs text-neutral-500">Awaiting supervisor</span>;
        }
        return (
          <div className="flex flex-wrap gap-3">
            <CorrectExceptionDialog exceptionId={row.id} currentOrNo={row.summary.orNo} />
            <SpoilExceptionDialog exceptionId={row.id} />
            <EscalateExceptionDialog exceptionId={row.id} />
          </div>
        );
      },
    },
  ];
}

export default async function ExceptionsPage() {
  const staff = await requireStaff();
  const rows = await getOpenExceptions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Exceptions</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Rejected pushes, sorted oldest first. By the time one of these exists, the
          collector has already handed a vendor a paper receipt and taken their money --
          every action here decides what to do about cash that has already changed hands,
          not whether to accept it.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          No open exceptions. Every push from a tablet is settling cleanly.
        </p>
      ) : (
        <LedgerTable
          columns={columns(canResolveExceptions(staff.role))}
          rows={rows}
          rowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
