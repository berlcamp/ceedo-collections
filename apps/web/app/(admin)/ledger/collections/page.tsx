import { canResolveExceptions } from "@ceedo/shared";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { CancelDialog } from "@/components/ledger/cancel-dialog";
import { getCollections, getCollectors, type CollectionRow } from "@/lib/ledger/queries";
import { requireStaff } from "@/lib/supabase/session";

function columns(canCancel: boolean): LedgerColumn<CollectionRow>[] {
  return [
    {
      key: "or_no",
      label: "OR No.",
      render: (row) =>
        row.cancelled ? <span className="line-through text-neutral-500">{row.orNo}</span> : row.orNo,
    },
    { key: "date", label: "Collected", render: (row) => row.businessDate },
    { key: "collector", label: "Collector", render: (row) => row.collectorName },
    { key: "stall_or_payer", label: "Stall / Payer", render: (row) => row.stallOrPayer },
    {
      key: "gross",
      label: "Gross amount",
      align: "right",
      render: (row) => <Money amount={row.grossAmount} muted={row.cancelled} />,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        if (row.cancelled) {
          return (
            <span className="text-xs text-neutral-500">
              Cancelled — {row.cancellationReason}
            </span>
          );
        }
        // The cancel action is presentation-gated the same way the rest of this app gates
        // a write: RLS on collection_cancellations only admits supervisor/accounting/admin
        // to read, and cancel_collection() itself refuses anyone but supervisor or admin
        // (migration 20260918000023) -- this `canCancel` check just keeps the button off
        // an accounting user's screen for a call the database would refuse anyway.
        return canCancel ? (
          <CancelDialog collectionId={row.id} orNo={row.orNo} />
        ) : (
          <span className="text-xs text-neutral-500">Posted</span>
        );
      },
    },
  ];
}

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Collections</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every receipt posted from a tablet, most recent first.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-4"
      >
        <div>
          <label htmlFor="businessDate" className="text-sm font-medium text-neutral-800">
            Business date
          </label>
          <input
            id="businessDate"
            name="businessDate"
            type="date"
            defaultValue={businessDate ?? ""}
            className="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="collectorId" className="text-sm font-medium text-neutral-800">
            Collector
          </label>
          <select
            id="collectorId"
            name="collectorId"
            defaultValue={collectorId ?? ""}
            className="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {collectors.map((collector) => (
              <option key={collector.id} value={collector.id}>
                {collector.fullName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
        >
          Filter
        </button>
        {filtered ? (
          <a href="/ledger/collections" className="text-sm text-neutral-600 underline">
            Clear
          </a>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          {filtered
            ? "No collections match this filter."
            : // This screen is empty until Phase 3, and that is correct: every collection is
              // recorded on a tablet (design D7, no office payment path), so there is
              // nothing here to browse until the first device syncs. It is built now so
              // that morning already has a tested engine behind it, not a screen bolted on
              // mid-Phase-3.
              "No collections yet. Every receipt here comes from a tablet sync, and no device has synced yet — this is expected before Phase 3, not a missing feature."}
        </p>
      ) : (
        <LedgerTable
          columns={columns(canResolveExceptions(staff.role))}
          rows={rows}
          rowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
