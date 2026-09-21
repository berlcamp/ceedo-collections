import { canResolveExceptions } from "@ceedo/shared";
import { ExceptionsTable } from "@/components/ledger/exceptions-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getOpenExceptions } from "@/lib/ledger/exceptions";
import { requireStaff } from "@/lib/supabase/session";

export default async function ExceptionsPage() {
  const staff = await requireStaff();
  const rows = await getOpenExceptions();

  return (
    <div>
      <ScreenHeader
        title="Exceptions"
        note="Rejected pushes, sorted oldest first. By the time one of these exists, the collector has already handed a vendor a paper receipt and taken their money -- every action here decides what to do about cash that has already changed hands, not whether to accept it."
      />
      <ExceptionsTable
        rows={rows}
        canResolve={canResolveExceptions(staff.role)}
        empty="No open exceptions. Every push from a tablet is settling cleanly."
      />
    </div>
  );
}
