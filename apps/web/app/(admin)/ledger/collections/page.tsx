import { canResolveExceptions } from "@ceedo/shared";
import { CollectionsFilter } from "@/components/ledger/collections-filter";
import { CollectionsTable } from "@/components/ledger/collections-table";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getCollections, getCollectors } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessDate?: string; collectorId?: string }>;
}) {
  const staff = await requireStaff();
  const { businessDate, collectorId } = await searchParams;
  const filtered = Boolean(businessDate || collectorId);

  const [rows, collectors] = await Promise.all([
    getCollections({ businessDate, collectorId }),
    getCollectors(),
  ]);

  return (
    <div>
      <ScreenHeader
        title="Receipts"
        note="Every receipt posted from a tablet, most recent first."
      />

      <CollectionsFilter
        {...(businessDate ? { businessDate } : {})}
        {...(collectorId ? { collectorId } : {})}
        collectors={collectors}
      />

      <CollectionsTable
        rows={rows}
        canCancel={canResolveExceptions(staff.role)}
        empty={
          filtered
            ? "No collections match this filter."
            : // This screen is empty until Phase 3, and that is correct: every collection is
              // recorded on a tablet (design D7, no office payment path), so there is
              // nothing here to browse until the first device syncs. It is built now so
              // that morning already has a tested engine behind it, not a screen bolted on
              // mid-Phase-3.
              "No collections yet. Every receipt here comes from a tablet sync, and no device has synced yet — this is expected before Phase 3, not a missing feature."
        }
      />
    </div>
  );
}
