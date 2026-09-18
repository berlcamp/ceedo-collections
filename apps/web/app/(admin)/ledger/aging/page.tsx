import Link from "next/link";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { getAging, type AgingRow } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const columns: LedgerColumn<AgingRow>[] = [
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
  { key: "b1", label: "1-30 days", align: "right", render: (row) => <Money amount={row.bucket1to30} /> },
  { key: "b2", label: "31-60 days", align: "right", render: (row) => <Money amount={row.bucket31to60} /> },
  { key: "b3", label: "61-90 days", align: "right", render: (row) => <Money amount={row.bucket61to90} /> },
  { key: "b4", label: "Over 90 days", align: "right", render: (row) => <Money amount={row.bucketOver90} /> },
  { key: "not_yet_due", label: "Not yet due", align: "right", render: (row) => <Money amount={row.notYetDue} /> },
  { key: "total", label: "Total", align: "right", render: (row) => <Money amount={row.total} /> },
];

export default async function AgingPage() {
  // requireStaff() already refuses anyone whose role cannot use the web app at all
  // (canUseWeb() -- collector is the only role excluded), which is the same set the
  // aging_of_receivables view's RLS policy admits. There is no narrower role to gate on
  // here; the check exists so this page redirects instead of rendering an RLS error.
  await requireStaff();
  const rows = await getAging();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Aging of receivables</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Outstanding charges by lease, bucketed by how long each charge has been overdue.
        </p>
      </div>
      <LedgerTable columns={columns} rows={rows} rowKey={(row) => row.leaseId} />
    </div>
  );
}
