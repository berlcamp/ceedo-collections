import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { OpeningBalanceForm } from "@/components/ledger/opening-balance-form";
import {
  getOpeningBalanceLeases,
  type OpeningBalanceLease,
  type RecordedOpeningBalance,
} from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

const pendingColumns: LedgerColumn<OpeningBalanceLease>[] = [
  { key: "stall", label: "Stall", render: (row) => row.stallNo },
  { key: "tenant", label: "Tenant", render: (row) => row.tenantName },
];

const recordedColumns: LedgerColumn<RecordedOpeningBalance>[] = [
  { key: "stall", label: "Stall", render: (row) => row.stallNo },
  { key: "tenant", label: "Tenant", render: (row) => row.tenantName },
  { key: "amount", label: "Amount", align: "right", render: (row) => <Money amount={row.amount} /> },
  { key: "oldest", label: "Oldest unpaid date", render: (row) => row.oldestUnpaidDate },
];

export default async function OpeningBalancesPage() {
  const staff = await requireStaff();
  const { cutoverDate, pending, recorded } = await getOpeningBalanceLeases();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Opening balances</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Reconciled paper arrears carried forward at go-live, recorded once per lease.
        </p>
        {/*
          Shown prominently and deliberately near the top: this screen is used once, under
          time pressure, at go-live, and every rule on it (both here and in
          record_opening_balance() itself) exists to keep an entry from overlapping what
          the cutover date already governs.
        */}
        <p className="mt-3 inline-block rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          Cutover date: {cutoverDate}
        </p>
      </div>

      {/*
        Read is open to the same role set as every other ledger screen (supervisor,
        accounting, admin), so a supervisor can see what is left without being able to act
        on it. record_opening_balance() itself is admin-only (migration 20260918000013),
        which is why the form is hidden rather than merely disabled for anyone else.
      */}
      {staff.role === "admin" ? (
        <OpeningBalanceForm leases={pending} cutoverDate={cutoverDate} />
      ) : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">
          Active leases with no opening balance yet ({pending.length})
        </h2>
        <LedgerTable columns={pendingColumns} rows={pending} rowKey={(row) => row.leaseId} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">
          Already recorded ({recorded.length})
        </h2>
        <LedgerTable columns={recordedColumns} rows={recorded} rowKey={(row) => row.leaseId} />
      </div>
    </div>
  );
}
