// apps/web/lib/reports/builders/daily-collection/matrix.ts
import type { ReportColumn, ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyInput } from "./types";

/** The built-in holding column for accounts the office has not placed (migration 066). */
export const OTHER_COLUMN = "RC_OTHER";

/**
 * Part (b), Collections per collector: one row per active collector -- those with nothing
 * that day too, as the office's sheet lists them all -- and per anyone else who collected,
 * so no peso on the Treasurer page is missing here. Then the deposit block.
 */
export function matrixSections(input: DailyInput): [ReportSection, ReportSection] {
  const accounts = byId(input.accounts);
  const columnsById = byId(input.rcdColumns);
  const shifts = byId(input.shifts);

  const byCollector = new Map<string, Map<string, number>>();
  const used = new Set<string>();
  let total = 0;
  let checks = 0;
  let deposited = 0;
  for (const p of input.portions) {
    if (p.cancelled) continue;
    const columnId = accountOf(accounts, p).rcdColumnId;
    used.add(columnId);
    const cells = byCollector.get(p.collectorId) ?? new Map<string, number>();
    cells.set(columnId, (cells.get(columnId) ?? 0) + p.amount);
    byCollector.set(p.collectorId, cells);
    total += p.amount;
    if (p.paymentMode === "check") checks += p.amount;
    if (p.shiftId && shifts.get(p.shiftId)?.deposit) deposited += p.amount;
  }

  const shown = input.rcdColumns
    .filter((c) => (c.active && c.code !== OTHER_COLUMN) || used.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const names = new Map(input.collectors.map((c) => [c.id, c]));
  const rowIds = new Set([
    ...input.collectors.filter((c) => c.active).map((c) => c.id),
    ...byCollector.keys(),
  ]);
  const name = (id: string) => names.get(id)?.name ?? "Unknown collector";

  const rows: ReportRow[] = [...rowIds]
    .sort((a, b) => name(a).localeCompare(name(b)))
    .map((id) => {
      const cells = byCollector.get(id);
      const row: ReportRow = { collector: name(id) };
      let sum = 0;
      for (const c of shown) {
        const v = cells?.get(c.id) ?? 0;
        row[c.code] = v || null;
        sum += v;
      }
      row.total = sum || null;
      return row;
    });

  const columns: ReportColumn[] = [
    { key: "collector", label: "Collector", kind: "text" },
    ...shown.map((c) => ({ key: c.code, label: columnsById.get(c.id)!.name, kind: "money" as const, total: true })),
    { key: "total", label: "Total", kind: "money", total: true },
  ];

  const depositRows: ReportRow[] = [
    { item: "Less: checks", amount: checks },
    { item: "Cash", amount: total - checks },
    { item: "Total deposit", amount: deposited },
    ...(total - deposited !== 0 ? [{ item: "Undeposited", amount: total - deposited }] : []),
    { item: "Total collection", amount: total, $style: "total" as const },
  ];

  return [
    {
      title: "Collections per collector",
      orientation: "landscape",
      sheet: "Per collector",
      breakBefore: true,
      totalLabel: "Over-all total",
      columns,
      rows,
      empty: "No collector is active and no one collected this day.",
    },
    {
      title: "Remittances / deposits",
      orientation: "landscape",
      sheet: "Per collector",
      columns: [
        { key: "item", label: "", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: depositRows,
    },
  ];
}
