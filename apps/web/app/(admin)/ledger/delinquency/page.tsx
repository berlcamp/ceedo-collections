import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { DelinquencyTable } from "@/components/ledger/delinquency-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getDelinquency } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

export default async function DelinquencyPage() {
  // Same role set as the aging screen -- see the comment there. This page is the input to
  // demand letters (Task 18), which is why the view (and DelinquencyRow) also carries
  // address, even though the letter itself is out of scope here.
  await requireStaff();
  const rows = await getDelinquency();

  return (
    <div>
      <ScreenHeader
        title="Delinquency list"
        actions={
          <Link href="/reports/delinquency" className={buttonClass("secondary", "md")}>
            <FileSpreadsheet size={14} strokeWidth={2} />
            Print / Excel
          </Link>
        }
        note="Leases more than 30 days overdue. Drives demand letters."
      />
      <DelinquencyTable rows={rows} />
    </div>
  );
}
