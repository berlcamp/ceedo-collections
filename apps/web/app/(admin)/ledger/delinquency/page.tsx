import Link from "next/link";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { getDelinquency, type DelinquencyRow } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const columns: LedgerColumn<DelinquencyRow>[] = [
  {
    key: "stall",
    label: "Stall",
    render: (row) => (
      <Link href={`/ledger/leases/${row.leaseId}`} className="text-neutral-900 underline">
        {row.stallNo}
      </Link>
    ),
  },
  { key: "tenant", label: "Tenant", render: (row) => row.tenantName },
  { key: "contact", label: "Contact", render: (row) => row.contactNo ?? "—" },
  {
    key: "outstanding",
    label: "Outstanding",
    align: "right",
    render: (row) => <Money amount={row.outstanding} />,
  },
  { key: "oldest_due_date", label: "Oldest due date", render: (row) => row.oldestDueDate ?? "—" },
  { key: "days_overdue", label: "Days overdue", align: "right", render: (row) => row.daysOverdue },
];

export default async function DelinquencyPage() {
  // Same role set as the aging screen -- see the comment there. This page is the input to
  // demand letters (Task 18), which is why the view (and DelinquencyRow) also carries
  // address, even though the letter itself is out of scope here.
  await requireStaff();
  const rows = await getDelinquency();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Delinquency list</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Leases more than 30 days overdue. Drives demand letters.
        </p>
      </div>
      <LedgerTable columns={columns} rows={rows} rowKey={(row) => row.leaseId} />
    </div>
  );
}
