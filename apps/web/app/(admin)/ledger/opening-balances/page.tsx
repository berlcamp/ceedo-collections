import { isAdmin } from "@ceedo/shared";
import { OpeningBalanceForm } from "@/components/ledger/opening-balance-form";
import {
  PendingOpeningBalancesTable,
  RecordedOpeningBalancesTable,
} from "@/components/ledger/opening-balance-tables";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getOpeningBalanceLeases } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

export default async function OpeningBalancesPage() {
  const staff = await requireStaff();
  const { cutoverDate, pending, recorded } = await getOpeningBalanceLeases();

  return (
    <div>
      <ScreenHeader
        title="Opening balances"
        note="Reconciled paper arrears carried forward at go-live, recorded once per lease."
        /*
          Shown prominently and deliberately near the top: this screen is used once, under
          time pressure, at go-live, and every rule on it (both here and in
          record_opening_balance() itself) exists to keep an entry from overlapping what
          the cutover date already governs.
        */
        aside={
          <p className="inline-flex items-baseline gap-2 border border-amber/40 bg-amber-soft px-3 py-1.5 text-sm text-amber">
            <span className="caption">Cutover date</span>
            <span className="font-semibold tabular-nums">{cutoverDate}</span>
          </p>
        }
      />

      <div className="space-y-8">
        {/*
          Read is open to the same role set as every other ledger screen (supervisor,
          accounting, admin), so a supervisor can see what is left without being able to act
          on it. record_opening_balance() itself is admin-only (migration 20260918000013),
          which is why the form is hidden rather than merely disabled for anyone else.
        */}
        {isAdmin(staff.role) ? (
          <OpeningBalanceForm leases={pending} cutoverDate={cutoverDate} />
        ) : null}

        <section>
          <h2 className="caption mb-2 text-ink-2">
            Active leases with no opening balance yet ({pending.length})
          </h2>
          <PendingOpeningBalancesTable rows={pending} />
        </section>

        <section>
          <h2 className="caption mb-2 text-ink-2">Already recorded ({recorded.length})</h2>
          <RecordedOpeningBalancesTable rows={recorded} />
        </section>
      </div>
    </div>
  );
}
