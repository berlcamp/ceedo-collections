// apps/web/app/(admin)/accounts/unclassified/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { UnclassifiedTable } from "@/components/accounts/unclassified-table";
import { getUnclassified } from "@/lib/accounts/queries";
import { longMonth, monthBounds, readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/** Receipt portions no rule places. Every one of them reaches the reports as UNCLASSIFIED until a rule covers it. */
export default async function UnclassifiedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const { month } = readParams(await searchParams);
  const { from, to } = monthBounds(month);
  const rows = await getUnclassified(from, to);
  return (
    <div>
      <ScreenHeader
        title="Unclassified receipts"
        note={`Money received in ${longMonth(month)} that no account rule places. Create a rule starting on or before the receipt's date and it moves to that account in every report.`}
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-xs text-ink-2">
          Month
          <TextInput type="month" name="month" defaultValue={month} className="mt-1 w-40" />
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
      </form>
      <UnclassifiedTable rows={rows} canCreate={staff.role === "admin"} monthStart={from} />
    </div>
  );
}
