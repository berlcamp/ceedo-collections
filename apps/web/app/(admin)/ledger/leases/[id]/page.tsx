import { notFound } from "next/navigation";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import {
  getLeaseBalance,
  getSubsidiaryLedger,
  type SubsidiaryLedgerEntry,
} from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const columns: LedgerColumn<SubsidiaryLedgerEntry>[] = [
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
          <span className="ml-2 text-xs text-neutral-500">— cancelled: {row.cancellationReason}</span>
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
];

export default async function SubsidiaryLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leaseId } = await params;

  // Same role set as the other ledger screens -- see aging/page.tsx's comment.
  await requireStaff();

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
      <LedgerTable columns={columns} rows={entries} rowKey={(row) => `${row.entryType}-${row.sourceId}`} />
    </div>
  );
}
