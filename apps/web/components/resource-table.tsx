import type { ColumnConfig } from "@/lib/admin/resource";

export function ResourceTable({
  columns,
  rows,
}: {
  columns: ColumnConfig[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-sm text-neutral-500">Nothing here yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left">
          {columns.map((column) => (
            <th key={column.key} className="py-2 pr-4 font-medium text-neutral-600">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={String(row.id ?? index)} className="border-b border-neutral-100">
            {columns.map((column) => (
              <td key={column.key} className="py-2 pr-4">
                {formatCell(row[column.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>;
    return String(nested.name ?? nested.code ?? nested.full_name ?? "—");
  }
  return String(value);
}
