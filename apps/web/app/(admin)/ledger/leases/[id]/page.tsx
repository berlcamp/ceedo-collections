import { isAdmin } from "@ceedo/shared";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Money } from "@/components/ledger/money";
import { SubsidiaryLedgerTable } from "@/components/ledger/subsidiary-ledger-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getLeaseBalance, getSubsidiaryLedger } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

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
    <div>
      {/* This screen is only ever reached by drilling in from Aging or Delinquency, and
          it is the one route with no entry in the rail — so it carries its own way back. */}
      <Link
        href="/ledger/aging"
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
      >
        <ChevronLeft size={13} strokeWidth={2} />
        Aging of receivables
      </Link>

      <ScreenHeader
        title={`Stall ${balance.stallNo} — ${balance.tenantName}`}
        note={
          <>
            Current balance:{" "}
            <span className="font-semibold text-ink">
              <Money amount={balance.outstanding} />
            </span>
            {balance.daysOverdue > 0 ? (
              <span className="text-ribbon"> · {balance.daysOverdue} days overdue</span>
            ) : null}
          </>
        }
      />

      <SubsidiaryLedgerTable
        entries={entries}
        leaseId={leaseId}
        canCondone={isAdmin(staff.role)}
      />
    </div>
  );
}
