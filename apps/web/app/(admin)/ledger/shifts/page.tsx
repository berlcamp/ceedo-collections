import type { ReactNode } from "react";
import { Money } from "@/components/ledger/money";
import { LedgerTable, type LedgerColumn } from "@/components/ledger/ledger-table";
import { formatVariance, getShifts, type ShiftClass, type ShiftRow } from "@/lib/ledger/shifts";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Read-only. Verification and remittance are Phase 6 -- there is no action on this page,
 * so unlike collections/page.tsx or exceptions/page.tsx there is nothing here to gate on
 * role. Every role that reaches this layout at all already cleared canUseWeb() and is
 * admitted by shifts_read's own policy (migration 20260918000029: admin, supervisor,
 * accounting).
 */
function badge(klass: ShiftClass): ReactNode {
  switch (klass) {
    case "stale_open":
      return (
        <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
          Still open
        </span>
      );
    case "unsynced":
      return (
        <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
          Closed, not yet synced
        </span>
      );
    case "open":
      return <span className="text-xs text-neutral-500">Open</span>;
    case "remitted":
      return <span className="text-xs text-neutral-500">Remitted</span>;
    default:
      return <span className="text-xs text-neutral-500">Closed</span>;
  }
}

const columns: LedgerColumn<ShiftRow>[] = [
  {
    key: "status",
    label: "Status",
    render: (row) => badge(row.klass),
  },
  { key: "collector", label: "Collector", render: (row) => row.collectorName },
  { key: "device", label: "Device", render: (row) => row.deviceLabel },
  { key: "business_date", label: "Business date", render: (row) => row.businessDate },
  {
    key: "system_count",
    label: "System count",
    align: "right",
    render: (row) => row.systemCount ?? "—",
  },
  {
    key: "system_total",
    label: "System total",
    align: "right",
    render: (row) => (row.systemTotal === null ? "—" : <Money amount={row.systemTotal} />),
  },
  {
    key: "declared_total",
    label: "Declared total",
    align: "right",
    render: (row) => (row.declaredTotal === null ? "—" : <Money amount={row.declaredTotal} />),
  },
  {
    key: "variance",
    label: "Variance",
    align: "right",
    render: (row) => {
      const text = formatVariance(row.variance);
      // Signed, so a short drawer reads differently from an over -- a supervisor scanning
      // this column should not have to read every figure to know which is which.
      const className =
        row.variance === null
          ? "text-neutral-500"
          : row.variance < 0
            ? "font-medium text-red-700"
            : row.variance > 0
              ? "font-medium text-amber-700"
              : "text-neutral-500";
      return <span className={className}>{text}</span>;
    },
  },
];

export default async function ShiftsPage() {
  await requireStaff();
  const rows = await getShifts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shifts</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every shift a device has opened, most recent first -- except a shift still open
          past its own business date or closed offline and not yet synced, which sort to
          the top regardless of date. Verification and remittance are handled elsewhere; this
          screen is for seeing the problem, not acting on it.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          No shifts recorded yet.
        </p>
      ) : (
        <LedgerTable columns={columns} rows={rows} rowKey={(row) => row.id} />
      )}
    </div>
  );
}
