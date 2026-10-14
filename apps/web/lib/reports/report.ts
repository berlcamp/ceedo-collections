import type { Centavos } from "@ceedo/shared";

export type Orientation = "portrait" | "landscape";

/**
 * One report, as data. Parent spec §10: every report exports to Excel AND to PDF, so a
 * report is built once, here, and rendered twice: `toXlsx` for the workbook accounting
 * re-keys into eNGAS, `ReportDocument` for the page printed or saved as PDF. Neither
 * renderer computes a figure. That keeps the two exports from disagreeing.
 */
export interface Report {
  title: string;
  /** What the report covers, e.g. "Maria Santos · 23 September 2026". */
  scope: string;
  sections: ReportSection[];
  /** Printed under the last section: basis of figures, caveats. */
  notes?: string[];
  /** Signature blocks, e.g. the COA forms' "Certified correct". */
  signatures?: { label: string; name?: string; title?: string }[];
  /** Default page orientation. Landscape when unset, as every report before phase 4. */
  layout?: Orientation;
  /** Screen-only notices shown above the report (never printed): e.g. unclassified money. */
  warnings?: { text: string; href?: string; linkText?: string }[];
}

export type ColumnKind = "text" | "money" | "int" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Summed into a totals row. Money and int columns only. */
  total?: boolean;
}

/** Money cells are integer centavos; the renderers turn them into pesos. */
export type Cell = string | number | Centavos | null;

/**
 * A row's look. Sub-total and total rows are figures the builder computed; they are
 * printed bold and left out of `sectionTotals`, so a section can carry its own
 * sub-totals and still have an ordinary totals row.
 */
export type RowStyle = "heading" | "subtotal" | "total";

/** Cells by column key, plus two reserved keys the renderers read and no column uses. */
export type ReportRow = Record<string, Cell> & { $style?: RowStyle; $indent?: number };

export function rowStyle(row: ReportRow): RowStyle | null {
  return row.$style ?? null;
}

export function rowIndent(row: ReportRow): number {
  return Math.max(0, Math.floor(Number(row.$indent ?? 0)));
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Shown instead of an empty table. */
  empty?: string;
  /** A wide grid (e.g. one column per day): small print, narrow Excel columns. */
  dense?: boolean;
  /** The totals row's label; "Total" when unset. */
  totalLabel?: string;
  /** This section's page orientation; `Report.layout` when unset. */
  orientation?: Orientation;
  /** The xlsx worksheet this section goes on (≤ 31 chars); the first sheet when unset. */
  sheet?: string;
  /** Start a new printed page before this section. */
  breakBefore?: boolean;
}

/**
 * The totals row of a section: each `total` column summed over its plain rows (styled
 * sub-total/total rows are already sums), as integers (centavos).
 */
export function sectionTotals(section: ReportSection): Record<string, number> | null {
  const totalled = section.columns.filter((c) => c.total);
  const plain = section.rows.filter((r) => rowStyle(r) === null);
  if (totalled.length === 0 || plain.length === 0) return null;
  const out: Record<string, number> = {};
  for (const column of totalled) {
    out[column.key] = plain.reduce((acc, row) => acc + Number(row[column.key] ?? 0), 0);
  }
  return out;
}

/** `123456` centavos → `1,234.56`. Fixed en-PH grouping, never the viewer's locale. */
export function pesos(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centavos));
  const whole = Math.floor(abs / 100).toLocaleString("en-PH");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** A filesystem-safe name for the download, e.g. `rcd-2026-09-23-maria-santos.xlsx`. */
export function fileName(title: string, scope: string, ext: string): string {
  const slug = `${title} ${scope}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return `${slug}.${ext}`;
}

/**
 * A cell as printed. Empty is "—", except in a dense grid, where 31 dashes per row are
 * what push a month's day columns past an A4 landscape page.
 */
export function cellText(c: ReportColumn, value: Cell | undefined, dense = false): string {
  if (value === null || value === undefined || value === "") return dense ? "" : "—";
  if (c.kind === "money") return pesos(Number(value));
  if (c.kind === "int") return Number(value).toLocaleString("en-PH");
  return String(value);
}
