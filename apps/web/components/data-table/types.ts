import type { ReactNode } from "react";
import type { Centavos } from "@ceedo/shared";
import type { MarkTone } from "@/components/ui/mark";

/**
 * A column of the tape.
 *
 * This replaces neither `ResourceTable`'s generic formatter nor `LedgerTable`'s
 * per-column renderer — it is the one contract both now use, which is why `render`
 * returns a node (so a money cell can go through `<Money>`) while `sortValue`,
 * `searchValue` and `total` are separate, explicit projections. A table cannot sort or
 * sum what it can only render.
 */
export interface DataColumn<Row> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
  /** Sortable when present. Nulls sort last in both directions, always. */
  sortValue?: (row: Row) => string | number | null;
  /** Text the filter slip searches. Defaults to `sortValue`'s string form. */
  searchValue?: (row: Row) => string;
  /** Integer centavos. Present means this column is summed into the running proof. */
  total?: (row: Row) => Centavos | null;
  /** Discrete values become a filter facet in the slip. */
  facet?: (row: Row) => string | null;
  /** A fixed width, e.g. "9rem". Left alone the column sizes to its content. */
  width?: string;
  /** Header label that must not wrap. */
  nowrap?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /**
   * The page's own empty copy, rendered when the source itself is empty. Passed in rather
   * than generated here because several of these sentences explain *why* a screen is
   * legitimately empty, and that is product truth, not table chrome.
   */
  empty: ReactNode;
  /** Namespaces this table's state in the URL, so a filtered view is shareable. */
  urlKey: string;
  searchPlaceholder?: string;
  initialPageSize?: number;
  /** A solid ink bar in the row's gutter — the row needs attention, without colour alone. */
  rowMark?: (row: Row) => MarkTone | null;
  /** Voided, cancelled, settled: the row stays, quietly. */
  rowMuted?: (row: Row) => boolean;
  /** Rendered under the close, below the totals. The shifts screen puts its variance here. */
  proofLine?: (visible: Row[], all: Row[]) => ReactNode;
  /** Noun for the footer count, e.g. "receipts". Defaults to "rows". */
  unit?: string;
}
