import type { ReactNode } from "react";

/**
 * The ledger screens are read-plus-RPC, not registry CRUD, so they cannot reuse
 * `ResourceTable`'s `Record<string, unknown>` + `formatCell()` shape -- that formatter has
 * no notion of `Centavos` and would print a raw integer of centavos instead of a peso
 * figure. This mirrors `ResourceTable`'s markup and Tailwind classes exactly (see
 * `apps/web/components/resource-table.tsx`) but lets each column render its own cell, so a
 * money column can render through `<Money>`.
 */
export interface LedgerColumn<Row> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
}

export function LedgerTable<Row>({
  columns,
  rows,
  rowKey,
}: {
  columns: LedgerColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-sm text-neutral-500">Nothing here yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left">
          {columns.map((column) => (
            <th
              key={column.key}
              className={`py-2 pr-4 font-medium text-neutral-600 ${
                column.align === "right" ? "text-right" : ""
              }`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="border-b border-neutral-100">
            {columns.map((column) => (
              <td
                key={column.key}
                className={`py-2 pr-4 ${column.align === "right" ? "text-right" : ""}`}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
