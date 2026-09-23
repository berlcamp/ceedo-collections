import Link from "next/link";
import { fromCentavos } from "@ceedo/shared";
import { Money } from "@/components/ledger/money";
import { RecordDialog } from "@/components/remittances/record-dialog";
import { RemittancesTable } from "@/components/remittances/remittances-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { getPendingShifts, getRemittances, staffNames } from "@/lib/remittances/queries";
import { canVerify } from "@/lib/remittances/reconcile";
import { longMonth, manilaToday, monthBounds, readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Deposits: the supervisor records each slip against the closed shifts it covers, and
 * accounting verifies it, which marks those shifts remitted (spec §5.5). The difference
 * column is deposit minus declared cash; the printable reconciliation is under Reports.
 */
export default async function RemittancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  const { month } = readParams(await searchParams);
  const { from, to } = monthBounds(month);

  const [rows, pending] = await Promise.all([getRemittances(from, to), getPendingShifts()]);
  const who = await staffNames(pending.map((s) => s.collectorId));
  const collectors = [...who].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const undeposited = pending.reduce((a, s) => a + s.declared, 0);
  const canRecord = staff.role === "supervisor" || staff.role === "admin";

  return (
    <div>
      <ScreenHeader
        title="Remittances"
        note="Deposit slips against the closed shifts whose cash they carried. A supervisor records each slip; accounting verifies it against the bank, which marks its shifts remitted."
        actions={
          <>
            <Link href={`/reports/remittance-reconciliation?month=${month}`} className={buttonClass("secondary", "md")}>
              Reconciliation report
            </Link>
            {canRecord ? <RecordDialog collectors={collectors} pending={pending} today={manilaToday()} /> : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2">
          <label className="text-xs text-ink-2">
            Month
            <TextInput type="month" name="month" defaultValue={month} className="mt-1 w-40" />
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>
            Show
          </button>
        </form>
        <p className="text-sm text-ink-2">
          Not yet deposited: {pending.length} closed shift{pending.length === 1 ? "" : "s"},{" "}
          <span className="font-semibold text-ink">
            <Money amount={fromCentavos(undeposited)} />
          </span>{" "}
          declared cash
        </p>
      </div>

      <h2 className="sr-only">{longMonth(month)}</h2>
      <RemittancesTable
        rows={rows}
        verifiable={rows.filter((r) => canVerify(staff.role, staff.userId, r.recordedBy)).map((r) => r.id)}
        canCancel={canRecord}
      />
    </div>
  );
}
