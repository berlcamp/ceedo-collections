"use client";

import { format, sum, type Centavos } from "@ceedo/shared";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DataColumn, DataTableProps } from "./types";

const PAGE_SIZES = [25, 50, 100, 250];

const MARK_BAR: Record<string, string> = {
  alert: "bg-ribbon",
  warn: "bg-amber",
  proof: "bg-proof",
  office: "bg-mark",
  neutral: "bg-rule-strong",
};

function textOf<Row>(column: DataColumn<Row>, row: Row): string {
  if (column.searchValue) return column.searchValue(row);
  const value = column.sortValue?.(row);
  return value === null || value === undefined ? "" : String(value);
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  urlKey,
  searchPlaceholder = "Filter these rows…",
  initialPageSize = 25,
  rowMark,
  rowMuted,
  proofLine,
  unit = "rows",
  emptyAction,
  onRowClick,
  rowLabel,
}: DataTableProps<Row>) {
  // Read the view's state out of the URL once, during the initial render rather than in
  // an effect: `useSearchParams` gives the same answer on the server and on the client, so
  // a shared link renders already filtered instead of flashing the unfiltered table and
  // then correcting itself. Every route under (admin) reads cookies through requireStaff()
  // and is therefore dynamic, and loading.tsx supplies the Suspense boundary besides.
  const searchParams = useSearchParams();
  const initial = useMemo(() => {
    const read = (name: string) => searchParams.get(`${urlKey}.${name}`);
    const size = Number(read("size"));
    const pageNumber = Number(read("page"));
    const dir = read("dir");
    const restoredFacets: Record<string, string[]> = {};
    const restoredDates: Record<string, string> = {};
    const prefix = `${urlKey}.f.`;
    const datePrefix = `${urlKey}.d.`;
    for (const [name, value] of searchParams.entries()) {
      if (name.startsWith(prefix) && value) restoredFacets[name.slice(prefix.length)] = value.split("~");
      if (name.startsWith(datePrefix) && value) restoredDates[name.slice(datePrefix.length)] = value;
    }
    return {
      query: read("q") ?? "",
      sortKey: read("sort"),
      sortDir: dir === "desc" ? ("desc" as const) : ("asc" as const),
      page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
      pageSize: PAGE_SIZES.includes(size) ? size : initialPageSize,
      facets: restoredFacets,
      dates: restoredDates,
    };
    // Deliberately the mount-time value only: this seeds state the user then owns, and
    // re-seeding it on every search-param change would fight their own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [query, setQuery] = useState(initial.query);
  const [facets, setFacets] = useState<Record<string, string[]>>(initial.facets);
  const [dates, setDates] = useState<Record<string, string>>(initial.dates);
  const [sortKey, setSortKey] = useState<string | null>(initial.sortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortDir);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [tally, setTally] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Write back with history.replaceState, not the router: a filter is a view of rows
  // already in the browser, and a server round-trip per keystroke would be a request the
  // data does not need. The URL stays shareable either way.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const name of [...params.keys()]) {
      if (name === `${urlKey}.q` || name === `${urlKey}.sort` || name === `${urlKey}.dir` ||
          name === `${urlKey}.page` || name === `${urlKey}.size` || name.startsWith(`${urlKey}.f.`) || name.startsWith(`${urlKey}.d.`)) {
        params.delete(name);
      }
    }
    if (query) params.set(`${urlKey}.q`, query);
    if (sortKey) {
      params.set(`${urlKey}.sort`, sortKey);
      params.set(`${urlKey}.dir`, sortDir);
    }
    if (page > 1) params.set(`${urlKey}.page`, String(page));
    if (pageSize !== initialPageSize) params.set(`${urlKey}.size`, String(pageSize));
    for (const [key, values] of Object.entries(facets)) {
      if (values.length > 0) params.set(`${urlKey}.f.${key}`, values.join("~"));
    }
    for (const [key, value] of Object.entries(dates)) {
      if (value) params.set(`${urlKey}.d.${key}`, value);
    }
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [urlKey, query, sortKey, sortDir, page, pageSize, facets, dates, initialPageSize]);

  // "/" puts the cursor in the slip from anywhere on the screen. A clerk reconciling
  // hundreds of rows should not have to reach for the mouse to narrow them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const facetColumns = useMemo(() => columns.filter((column) => column.facet), [columns]);
  const dateColumns = useMemo(() => columns.filter((column) => column.dateBound), [columns]);

  const facetValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const column of facetColumns) {
      const seen = new Set<string>();
      for (const row of rows) {
        const value = column.facet?.(row);
        if (value) seen.add(value);
      }
      map[column.key] = [...seen].sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [facetColumns, rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const active = Object.entries(facets).filter(([, values]) => values.length > 0);
    const bounds = Object.entries(dates).filter(([, value]) => value);
    if (!needle && active.length === 0 && bounds.length === 0) return rows;
    return rows.filter((row) => {
      for (const [key, bound] of bounds) {
        const dateBound = columns.find((candidate) => candidate.key === key)?.dateBound;
        if (!dateBound) continue;
        // ISO dates compare correctly as text.
        const value = dateBound.value(row);
        if (!value) return false;
        if (dateBound.side === "min" ? value < bound : value > bound) return false;
      }
      for (const [key, values] of active) {
        const column = columns.find((candidate) => candidate.key === key);
        const value = column?.facet?.(row) ?? "";
        if (!values.includes(value)) return false;
      }
      if (!needle) return true;
      return columns.some((column) => textOf(column, row).toLowerCase().includes(needle));
    });
  }, [rows, columns, query, facets, dates]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.sortValue) return filtered;
    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      // Nulls sort last whichever way the column is pointing: an empty cell is an
      // absence, and an absence is never the answer to "show me the largest".
      if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [filtered, columns, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  const totalColumns = useMemo(() => columns.filter((column) => column.total), [columns]);
  // Through `sum()` rather than a bare `reduce`: Centavos is a branded type precisely so
  // that a peso total cannot be accumulated as a plain number somewhere along the way.
  const sumOf = useCallback(
    (column: DataColumn<Row>, subject: Row[]): Centavos =>
      sum(
        subject
          .map((row) => column.total?.(row))
          .filter((amount): amount is Centavos => amount !== null && amount !== undefined),
      ),
    [],
  );

  const activeFacetCount = Object.values(facets).reduce((carry, values) => carry + values.length, 0);
  const activeDateCount = Object.values(dates).filter(Boolean).length;
  const narrowed = query.trim().length > 0 || activeFacetCount > 0 || activeDateCount > 0;

  const clearAll = () => {
    setQuery("");
    setFacets({});
    setDates({});
    setPage(1);
    setTally((count) => count + 1);
  };

  const toggleSort = (column: DataColumn<Row>) => {
    if (!column.sortValue) return;
    if (sortKey === column.key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
    setPage(1);
  };

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-tape-raised">
        <div className="mx-auto max-w-prose px-6 py-14 text-center">
          <p className="text-sm leading-relaxed text-ink-2">{empty}</p>
          {emptyAction ? <div className="mt-5 flex justify-center">{emptyAction}</div> : null}
        </div>
      </div>
    );
  }

  const gutter = rowMark ? 1 : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-tape-raised">
      {/* ---- The filter slip: clipped to the top of the tape ------------------------ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-tape px-2.5 py-2">
        <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
          <Search
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
              setTally((count) => count + 1);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className={cn(
              "h-8 w-full rounded-lg border border-rule-strong bg-tape-raised pl-8 pr-7 text-sm",
              "text-ink placeholder:text-ink-3 transition-colors duration-150",
              "hover:border-ink-3 focus:border-mark",
              "[&::-webkit-search-cancel-button]:appearance-none",
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPage(1);
                setTally((count) => count + 1);
                searchRef.current?.focus();
              }}
              aria-label="Clear the filter text"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 transition-colors duration-150 hover:bg-tape-sunk hover:text-ink"
            >
              <X size={13} strokeWidth={2} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded-md border border-rule px-1 text-2xs text-ink-3 sm:block">
              /
            </kbd>
          )}
        </div>

        {facetColumns.map((column) => {
          const chosen = facets[column.key] ?? [];
          const values = facetValues[column.key] ?? [];
          if (values.length < 2) return null;
          return (
            <Popover key={column.key}>
              <PopoverTrigger
                className={buttonClass(
                  chosen.length > 0 ? "primary" : "secondary",
                  "sm",
                  "font-medium",
                )}
              >
                {column.label}
                {chosen.length > 0 ? (
                  <span className="rounded-md bg-tape-raised px-1 text-2xs font-semibold text-chassis-900">
                    {chosen.length}
                  </span>
                ) : (
                  <ChevronsUpDown size={12} strokeWidth={1.75} className="text-ink-3" />
                )}
              </PopoverTrigger>
              <PopoverContent className="max-h-72 w-56 overflow-y-auto p-1">
                {values.map((value) => {
                  const checked = chosen.includes(value);
                  return (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink transition-colors duration-150 hover:bg-tape-sunk"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setFacets((current) => {
                            const existing = current[column.key] ?? [];
                            const updated = next
                              ? [...existing, value]
                              : existing.filter((item) => item !== value);
                            return { ...current, [column.key]: updated };
                          });
                          setPage(1);
                          setTally((count) => count + 1);
                        }}
                      />
                      <span className="min-w-0 truncate">{value}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          );
        })}

        {dateColumns.map((column) => (
          <label key={column.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="font-medium">{column.label}</span>
            <input
              type="date"
              value={dates[column.key] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setDates((current) => ({ ...current, [column.key]: value }));
                setPage(1);
                setTally((count) => count + 1);
              }}
              aria-label={`${column.label} ${column.dateBound?.side === "min" ? "on or after" : "on or before"}`}
              className={cn(
                "h-8 rounded-lg border border-rule-strong bg-tape-raised px-2 text-sm text-ink tabular-nums",
                "transition-colors duration-150 hover:border-ink-3 focus:border-mark",
                dates[column.key] && "border-mark",
              )}
            />
          </label>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {narrowed ? (
            <>
              <span className="text-xs text-ink-2">
                <span className="font-semibold text-ink">{sorted.length}</span> of {rows.length}
              </span>
              <Button size="sm" variant="ghost" onClick={clearAll}>
                <X size={12} strokeWidth={2} />
                Clear
              </Button>
            </>
          ) : (
            <span className="text-xs text-ink-3">
              {rows.length} {unit}
            </span>
          )}
        </div>
      </div>

      {/* ---- The tape ------------------------------------------------------------- */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-strong bg-tape">
              {rowMark ? <th className="w-1 p-0" aria-hidden /> : null}
              {columns.map((column) => {
                const sortable = Boolean(column.sortValue);
                const active = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "caption px-3 py-2 align-bottom text-ink-2",
                      column.align === "right" ? "text-right" : "text-left",
                      column.nowrap && "whitespace-nowrap",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          "caption inline-flex items-center gap-1 rounded-md transition-colors duration-150",
                          "hover:text-ink",
                          active && "text-ink",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.label}
                        {active ? (
                          sortDir === "asc" ? (
                            <ArrowUp size={11} strokeWidth={2.25} />
                          ) : (
                            <ArrowDown size={11} strokeWidth={2.25} />
                          )
                        ) : (
                          <ChevronsUpDown size={11} strokeWidth={1.75} className="text-rule-strong" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + gutter} className="px-3 py-12 text-center">
                  <p className="text-sm text-ink-2">Nothing matches this filter.</p>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="mt-1.5 text-xs font-medium text-mark underline"
                  >
                    Clear it and show all {rows.length} {unit}
                  </button>
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const tone = rowMark?.(row) ?? null;
                const muted = rowMuted?.(row) ?? false;
                return (
                  <tr
                    key={rowKey(row)}
                    className={cn(
                      "border-b border-rule-soft transition-colors duration-100 last:border-b-0",
                      "hover:bg-tape-hover",
                      muted && "text-ink-3",
                      onRowClick &&
                        "cursor-pointer focus-visible:bg-tape-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    )}
                    {...(onRowClick
                      ? {
                          tabIndex: 0,
                          "aria-label": rowLabel?.(row),
                          onClick: (event: ReactMouseEvent) => {
                            // A button or link inside the row does its own thing.
                            if ((event.target as HTMLElement).closest("button, a, input")) return;
                            onRowClick(row);
                          },
                          onKeyDown: (event: ReactKeyboardEvent) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          },
                        }
                      : {})}
                  >
                    {rowMark ? (
                      <td className="w-1 p-0">
                        {/* The gutter bar. A row needing attention is identifiable with
                            colour removed, because it is the only row with ink here. */}
                        <div
                          className={cn("h-full min-h-[1.75rem] w-1", tone ? MARK_BAR[tone] : "bg-transparent")}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 align-middle",
                          column.align === "right" ? "text-right tabular-nums" : "text-left",
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>

          {/* ---- The close: the running proof ------------------------------------- */}
          {totalColumns.length > 0 && visible.length > 0 ? (
            <tfoot className="hidden lg:table-footer-group">
              <tr
                key={tally}
                className={cn("bg-tape", tally > 0 && "animate-[retally_180ms_ease-out]")}
              >
                {rowMark ? <td className="rule-close w-1 p-0" aria-hidden /> : null}
                {columns.map((column, index) => {
                  if (column.total) {
                    const sum = sumOf(column, sorted);
                    return (
                      <td
                        key={column.key}
                        className="rule-close px-3 pb-2.5 pt-2 text-right align-top tabular-nums"
                      >
                        <span className="block text-sm font-semibold text-ink">
                          {sum === 0 ? "—" : format(sum)}
                        </span>
                        {narrowed ? (
                          <span className="mt-0.5 block text-2xs text-ink-3">
                            of {format(sumOf(column, rows))}
                          </span>
                        ) : null}
                      </td>
                    );
                  }
                  const isFirst = index === 0;
                  return (
                    <td key={column.key} className="rule-close px-3 pb-2.5 pt-2 align-top">
                      {isFirst ? (
                        <span className="caption text-ink-2">
                          {narrowed ? "Filtered total" : "Total"}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {totalColumns.length > 0 && visible.length > 0 ? (
        <dl className="rule-close bg-tape px-3 py-2 lg:hidden">
          <p className="caption mb-1 text-ink-2">{narrowed ? "Filtered total" : "Total"}</p>
          {totalColumns.map((column) => {
            const amount = sumOf(column, sorted);
            return (
              <div key={column.key} className="flex items-baseline justify-between gap-4 py-0.5">
                <dt className="text-xs text-ink-2">{column.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink">
                  {amount === 0 ? "—" : format(amount)}
                  {narrowed ? (
                    <span className="ml-1.5 text-2xs font-normal text-ink-3">
                      of {format(sumOf(column, rows))}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {proofLine ? (
        <div className="border-t border-rule bg-tape px-3 py-2">{proofLine(sorted, rows)}</div>
      ) : null}

      {/* ---- The pager ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-tape px-3 py-2">
        <p className="text-xs text-ink-2 tabular-nums">
          {sorted.length === 0 ? (
            <>No {unit} shown</>
          ) : (
            <>
              Showing{" "}
              <span className="font-semibold text-ink">
                {start + 1}&ndash;{Math.min(start + pageSize, sorted.length)}
              </span>{" "}
              of <span className="font-semibold text-ink">{sorted.length}</span> {unit}
            </>
          )}
        </p>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <span>Rows</span>
            <NativeSelect
              compact
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="w-auto"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </label>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous page"
              className="w-7 px-0"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </Button>
            <span className="min-w-[4.5rem] text-center text-xs text-ink-2 tabular-nums">
              Page <span className="font-semibold text-ink">{currentPage}</span> of {pageCount}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next page"
              className="w-7 px-0"
            >
              <ChevronRight size={14} strokeWidth={2} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
