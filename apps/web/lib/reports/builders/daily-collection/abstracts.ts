// apps/web/lib/reports/builders/daily-collection/abstracts.ts
import type { ReportColumn, ReportRow, ReportSection } from "../../report";
import { accountOf, byId, type DailyFacility, type DailyInput, type DailyPortion } from "./types";

/** The office's month abbreviations, as on its abstracts ("Sept 1–30"). */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function show(date: string, withYear: boolean): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${MON[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/**
 * Rental periods as the office writes them in Remarks: consecutive and overlapping
 * periods merged, "Sept 27–30", "Sept 29–Oct 2", "Dec 30, 2026–Jan 2, 2027"; separate runs
 * joined by ", ". Null when there are none.
 */
export function formatPeriods(periods: { start: string; end: string }[]): string | null {
  if (periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  const runs: { start: string; end: string }[] = [];
  for (const p of sorted) {
    const last = runs.at(-1);
    if (last && p.start <= dayAfter(last.end)) {
      if (p.end > last.end) last.end = p.end;
    } else {
      runs.push({ ...p });
    }
  }
  return runs
    .map(({ start, end }) => {
      if (start === end) return show(start, false);
      const crossYear = start.slice(0, 4) !== end.slice(0, 4);
      if (crossYear) return `${show(start, true)}–${show(end, true)}`;
      if (start.slice(0, 7) === end.slice(0, 7)) return `${show(start, false)}–${Number(end.slice(8))}`;
      return `${show(start, false)}–${show(end, false)}`;
    })
    .join(", ");
}

/** One abstract row: a receipt line, or a lease receipt (which has no lines), summed over its portions. */
interface Item {
  first: DailyPortion;
  amount: number;
}

const SHEET = "Abstracts";

/**
 * Part (c), one abstract per collector in OR order, broken into one section per booklet
 * ("Total 1/n … n/n", as the office's pages are), then their cash tickets, then a summary
 * by section and account. Cancelled ORs are listed at zero.
 */
export function abstractSections(input: DailyInput): ReportSection[] {
  const accounts = byId(input.accounts);
  const facilities = byId(input.facilities);
  const sections = byId(input.sections);
  const fees = byId(input.feeTypes);
  const leases = byId(input.leases);
  const booklets = byId(input.booklets);
  const tickets = byId(input.cashTickets);
  const cover = new Map(input.rentCover.map((c) => [c.collectionId, c]));
  const names = byId(input.collectors);
  const name = (id: string) => names.get(id)?.name ?? "Unknown collector";

  const facilityOf = (p: DailyPortion): DailyFacility | undefined => (p.facilityId ? facilities.get(p.facilityId) : undefined);
  const place = (p: DailyPortion) => {
    const f = facilityOf(p)?.name;
    const s = p.sectionId ? sections.get(p.sectionId)?.name : undefined;
    return f ? (s ? `${f} · ${s}` : f) : "—";
  };
  const feeName = (id: string) => fees.get(id)?.name ?? "—";

  const collectorIds = [...new Set(input.portions.map((p) => p.collectorId))].sort((a, b) =>
    name(a).localeCompare(name(b)),
  );
  if (collectorIds.length === 0) {
    return [{
      title: "Abstracts",
      orientation: "landscape",
      sheet: SHEET,
      breakBefore: true,
      columns: [{ key: "or", label: "OR #", kind: "text" }],
      rows: [],
      empty: "No receipts or cash tickets were recorded this day.",
    }];
  }

  const out: ReportSection[] = [];
  for (const collectorId of collectorIds) {
    const mine = input.portions.filter((p) => p.collectorId === collectorId);
    const who = name(collectorId);
    let firstOfCollector = true;
    const pageBreak = () => {
      const b = firstOfCollector;
      firstOfCollector = false;
      return b;
    };

    // Receipts: items keyed by receipt + line; receipt totals; booklets in OR order.
    const items = new Map<string, Item>();
    const receiptTotal = new Map<string, number>();
    // The lease's own portions (no line): what `remarks` compares with the rent it settled.
    const leaseTotal = new Map<string, number>();
    for (const p of mine) {
      if (p.source !== "receipt" || !p.collectionId) continue;
      const key = `${p.collectionId}\u0000${p.lineId ?? ""}`;
      const item = items.get(key) ?? { first: p, amount: 0 };
      item.amount += p.amount;
      items.set(key, item);
      receiptTotal.set(p.collectionId, (receiptTotal.get(p.collectionId) ?? 0) + p.amount);
      if (!p.lineId) leaseTotal.set(p.collectionId, (leaseTotal.get(p.collectionId) ?? 0) + p.amount);
    }
    const byBooklet = new Map<string, Item[]>();
    for (const item of items.values()) {
      const id = item.first.bookletId ?? "";
      byBooklet.set(id, [...(byBooklet.get(id) ?? []), item]);
    }
    const bookletOrder = [...byBooklet.entries()]
      .map(([id, list]) => ({ id, list: list.sort((a, b) => (a.first.orNo ?? 0) - (b.first.orNo ?? 0)) }))
      .sort((a, b) => (a.list[0]!.first.orNo ?? 0) - (b.list[0]!.first.orNo ?? 0));

    const remarks = (p: DailyPortion): string | null => {
      if (p.cancelled) return "(cancelled)";
      if (p.lineId) return feeName(p.feeTypeId);
      if (!p.leaseId || !p.collectionId) return null;
      const c = cover.get(p.collectionId);
      const gross = leaseTotal.get(p.collectionId) ?? 0;
      const parts = [formatPeriods(c?.periods ?? []), gross > (c?.allocated ?? 0) ? "advance" : null];
      return parts.filter(Boolean).join("; ") || null;
    };

    bookletOrder.forEach(({ id, list }, index) => {
      const k = index + 1;
      const n = bookletOrder.length;
      const types = new Set(list.map((i) => facilityOf(i.first)?.type));
      const terminal = types.has("terminal");
      const slaughter = types.has("slaughterhouse");
      const columns: ReportColumn[] = [
        { key: "no", label: "No.", kind: "int" },
        { key: "or", label: "OR #", kind: "text" },
        { key: "name", label: "Name", kind: "text" },
        { key: "section", label: "Section", kind: "text" },
        { key: "stall", label: "Stall", kind: "text" },
        ...(terminal ? [{ key: "plate", label: "Plate/Body #", kind: "text" as const }] : []),
        ...(slaughter
          ? [
              { key: "variety", label: "Variety", kind: "text" as const },
              { key: "heads", label: "Heads", kind: "int" as const },
            ]
          : []),
        { key: "amount", label: "Amount", kind: "money", total: true },
        { key: "total", label: "Total", kind: "money", total: true },
        { key: "remarks", label: "Remarks", kind: "text" },
      ];

      let no = 0;
      let lastReceipt: string | null = null;
      const rows: ReportRow[] = list.map(({ first: p, amount }) => {
        const firstOfReceipt = p.collectionId !== lastReceipt;
        lastReceipt = p.collectionId;
        if (firstOfReceipt) no += 1;
        const type = facilityOf(p)?.type;
        const lease = p.leaseId ? leases.get(p.leaseId) : undefined;
        const fee = feeName(p.feeTypeId);
        const row: ReportRow = {
          no: firstOfReceipt ? no : null,
          or: firstOfReceipt ? String(p.orNo) : null,
          name: lease?.tenantName ?? (type === "terminal" ? (p.rateClass ?? p.payerRef ?? fee) : (p.payerRef ?? fee)),
          section: place(p),
          stall: lease?.stallNo ?? null,
          amount: p.cancelled ? 0 : amount,
          total: firstOfReceipt ? (p.cancelled ? 0 : receiptTotal.get(p.collectionId!)!) : null,
          remarks: remarks(p),
        };
        if (terminal) row.plate = type === "terminal" ? p.payerRef : null;
        if (slaughter) {
          row.variety = type === "slaughterhouse" ? (p.rateClass || null) : null;
          row.heads = type === "slaughterhouse" ? p.quantity : null;
        }
        return row;
      });

      out.push({
        title: `${who} · Booklet ${booklets.get(id)?.label ?? "—"} (${k}/${n})`,
        orientation: "landscape",
        sheet: SHEET,
        breakBefore: pageBreak(),
        totalLabel: `Total ${k}/${n}`,
        columns,
        rows,
      });
    });

    // Cash tickets, one row per sale (a split sale is still one sale).
    const sales = new Map<string, { p: DailyPortion; amount: number }>();
    for (const p of mine) {
      if (p.source !== "cash_ticket" || !p.cashTicketId) continue;
      const s = sales.get(p.cashTicketId) ?? { p, amount: 0 };
      s.amount += p.amount;
      sales.set(p.cashTicketId, s);
    }
    if (sales.size > 0) {
      out.push({
        title: `${who} · Cash tickets`,
        orientation: "landscape",
        sheet: SHEET,
        breakBefore: pageBreak(),
        columns: [
          { key: "fee", label: "Ticket", kind: "text" },
          { key: "tickets", label: "Serials", kind: "text" },
          { key: "note", label: "Note", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [...sales.values()].map(({ p, amount }) => {
          const t = tickets.get(p.cashTicketId!);
          return {
            fee: feeName(p.feeTypeId),
            tickets: t?.ticketFrom != null && t?.ticketTo != null ? `${t.ticketFrom}–${t.ticketTo}` : null,
            note: t?.note ?? null,
            amount,
          };
        }),
      });
    }

    // Summary by section and account: the office's "Row Labels / Sum" table.
    const sums = new Map<string, { place: string; account: string; sort: number; amount: number }>();
    for (const p of mine) {
      if (p.cancelled) continue;
      const a = accountOf(accounts, p);
      const key = `${place(p)}\u0000${a.id}`;
      const s = sums.get(key) ?? { place: place(p), account: a.name, sort: a.sortOrder, amount: 0 };
      s.amount += p.amount;
      sums.set(key, s);
    }
    out.push({
      title: `${who} · Summary by section`,
      orientation: "landscape",
      sheet: SHEET,
      breakBefore: pageBreak(),
      columns: [
        { key: "place", label: "Section", kind: "text" },
        { key: "account", label: "Account", kind: "text" },
        { key: "amount", label: "Amount", kind: "money", total: true },
      ],
      rows: [...sums.values()]
        .sort((a, b) => a.place.localeCompare(b.place) || a.sort - b.sort)
        .map(({ place: pl, account, amount }) => ({ place: pl, account, amount })),
      empty: "Nothing live: every receipt was cancelled.",
    });
  }
  return out;
}
