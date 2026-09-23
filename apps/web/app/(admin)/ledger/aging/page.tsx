import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { AgingTable } from "@/components/ledger/aging-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getAging } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

export default async function AgingPage() {
  // requireStaff() already refuses anyone whose role cannot use the web app at all
  // (canUseWeb() -- collector is the only role excluded), which is the same set the
  // aging_of_receivables view's RLS policy admits. There is no narrower role to gate on
  // here; the check exists so this page redirects instead of rendering an RLS error.
  await requireStaff();
  const rows = await getAging();

  return (
    <div>
      <ScreenHeader
        title="Aging of receivables"
        actions={
          <Link href="/reports/aging" className={buttonClass("secondary", "md")}>
            <FileSpreadsheet size={14} strokeWidth={2} />
            Print / Excel
          </Link>
        }
        note="Outstanding charges by lease, bucketed by how long each charge has been overdue."
      />
      <AgingTable rows={rows} />
    </div>
  );
}
