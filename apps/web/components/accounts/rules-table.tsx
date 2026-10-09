// apps/web/components/accounts/rules-table.tsx
import type { RuleSetRow } from "@/lib/accounts/queries";

export function RulesTable({ rows }: { rows: RuleSetRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-2">No rules yet. Until a fee has a rule, its receipts show as Unclassified.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3">
        <tr>
          <th className="py-2">Fee</th><th>Facility</th><th>Section</th><th>Class</th><th>Portion</th>
          <th>From</th><th>To</th><th>Accounts</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {rows.map((r) => (
          <tr key={r.id} className={r.effectiveTo ? "text-ink-3" : undefined}>
            <td className="py-2">{r.feeType}</td>
            <td>{r.facility ?? "Any"}</td>
            <td>{r.section ?? "Any"}</td>
            <td>{r.rateClass ?? "Any"}</td>
            <td>{r.portion}</td>
            <td className="tabular-nums">{r.effectiveFrom}</td>
            <td className="tabular-nums">{r.effectiveTo ?? "—"}</td>
            <td>
              {r.shares.map((s) => (
                <div key={s.account}>
                  {s.account}
                  {r.shares.length > 1 ? <span className="text-ink-3"> · {s.percent}%</span> : null}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
