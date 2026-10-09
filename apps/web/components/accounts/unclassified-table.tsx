// apps/web/components/accounts/unclassified-table.tsx
import Link from "next/link";
import { pesos } from "@/lib/reports/report";
import type { UnclassifiedRow } from "@/lib/accounts/queries";

export function UnclassifiedTable({ rows, canCreate, monthStart }: { rows: UnclassifiedRow[]; canCreate: boolean; monthStart: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-2">Every receipt this month has an account.</p>;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3">
        <tr>
          <th className="py-2">Date</th><th>OR</th><th>Fee</th><th>Facility</th><th>Section</th><th>Class</th>
          <th>Portion</th><th className="text-right">Amount</th><th />
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {rows.map((r) => {
          const q = new URLSearchParams({
            fee: r.feeTypeId, facility: r.facilityId ?? "", section: r.sectionId ?? "",
            rateClass: r.rateClass ?? "", portion: r.portion, from: monthStart,
          });
          return (
            <tr key={r.key}>
              <td className="py-2 tabular-nums">{r.businessDate}</td>
              <td className="tabular-nums">{r.orNo ?? (r.source === "cash_ticket" ? "cash ticket" : "—")}</td>
              <td>{r.feeType}</td>
              <td>{r.facility ?? "—"}</td>
              <td>{r.section ?? "—"}</td>
              <td>{r.rateClass ?? "—"}</td>
              <td>{r.portion}</td>
              <td className="text-right tabular-nums">{pesos(r.amount)}</td>
              <td className="text-right">
                {canCreate ? <Link className="text-xs underline" href={`/accounts/rules?${q}`}>Create rule</Link> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td colSpan={7} className="py-2">Total unclassified</td>
          <td className="text-right tabular-nums">{pesos(total)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
