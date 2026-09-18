import { notFound } from "next/navigation";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { CondoneDialog } from "@/components/ledger/condone-dialog";
import {
  getLeaseBalance,
  getSubsidiaryLedger,
  type SubsidiaryLedgerEntry,
} from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Takes `leaseId` and `canCondone` rather than being a module-level constant (as it was
 * before Task 18): the condone action needs both to render, and neither is available at
 * module scope in a Server Component.
 */
function columns(leaseId: string, canCondone: boolean): LedgerColumn<SubsidiaryLedgerEntry>[] {
  return [
    { key: "date", label: "Date", render: (row) => row.entryDate },
    {
      key: "detail",
      label: "Entry",
      render: (row) => (
        <span className={row.cancelled ? "line-through text-neutral-500" : ""}>
          {row.detail}
          {row.orNo ? ` (OR ${row.orNo})` : null}
          {row.cancelled && row.cancellationReason ? (
            // The strikethrough shows the receipt was voided; the reason is the point of
            // keeping it on the record at all rather than deleting the row.
            <span className="ml-2 text-xs text-neutral-500">
              — cancelled: {row.cancellationReason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "debit",
      label: "Debit",
      align: "right",
      render: (row) => <Money amount={row.debit} muted={row.cancelled} />,
    },
    {
      key: "credit",
      label: "Credit",
      align: "right",
      render: (row) => <Money amount={row.credit} muted={row.cancelled} />,
    },
    {
      key: "running_balance",
      label: "Balance",
      align: "right",
      render: (row) => <Money amount={row.runningBalance} />,
    },
    {
      key: "action",
      label: "",
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

export default async function SubsidiaryLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leaseId } = await params;

  // Same role set as the other ledger screens -- see aging/page.tsx's comment.
  const staff = await requireStaff();

  const balance = await getLeaseBalance(leaseId);
  if (!balance) notFound();

  const entries = await getSubsidiaryLedger(leaseId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">
          Stall {balance.stallNo} — {balance.tenantName}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Current balance: <Money amount={balance.outstanding} />
          {balance.daysOverdue > 0 ? ` · ${balance.daysOverdue} days overdue` : null}
        </p>
      </div>
      <LedgerTable
        columns={columns(leaseId, staff.role === "admin")}
        rows={entries}
        rowKey={(row) => `${row.entryType}-${row.sourceId}`}
      />
    </div>
  );
}
