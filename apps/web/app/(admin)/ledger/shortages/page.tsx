import { fromCentavos } from "@ceedo/shared";
import { Money } from "@/components/ledger/money";
import { SettlementsTable } from "@/components/shortages/settlements-table";
import { ShortagesTable } from "@/components/shortages/shortages-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { canVerify } from "@/lib/remittances/reconcile";
import { manilaToday } from "@/lib/reports/params";
import { getShortages } from "@/lib/shortages/queries";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Shortages: shifts that closed short, and the money collectors paid back toward them.
 * Migration 20260929000058. A supervisor records each payment; accounting verifies it,
 * and only a verified payment reduces what is owed. The shift's own variance never
 * changes -- this screen sets payments beside it.
 */
export default async function ShortagesPage() {
  const staff = await requireStaff();
  const { shortages, settlements } = await getShortages();
  const canRecord = staff.role === "supervisor" || staff.role === "admin";
  const owed = shortages.reduce((a, s) => a + s.outstanding, 0);
  const owing = shortages.filter((s) => s.outstanding > 0).length;

  return (
    <div>
      <ScreenHeader
        title="Shortages"
        note="Shifts that closed with less cash than their receipts, and what each collector has paid back. A supervisor records a payment with its receipt or slip number; accounting verifies it. The shift's variance itself is never changed."
      />

      <p className="mb-4 text-sm text-ink-2">
        Still owed: {owing} shift{owing === 1 ? "" : "s"},{" "}
        <span className="font-semibold text-ink">
          <Money amount={fromCentavos(owed)} />
        </span>
      </p>

      <ShortagesTable rows={shortages} canRecord={canRecord} today={manilaToday()} />

      <h2 className="caption mb-2 mt-10 text-ink-2">Payments</h2>
      <SettlementsTable
        rows={settlements}
        verifiable={settlements
          .filter((s) => canVerify(staff.role, staff.userId, s.recordedBy))
          .map((s) => s.id)}
        canCancel={canRecord}
      />
    </div>
  );
}
