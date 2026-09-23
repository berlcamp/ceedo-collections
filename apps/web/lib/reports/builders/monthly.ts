import { fromCentavos, fromPesos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import { getPendingShifts, getRemittances } from "@/lib/remittances/queries";
import { accountFor, showRange } from "../accountability";
import { booklets, consumption, deposits, feeTypeNames, manilaDate, receipts, staffNameMap } from "../data";
import { longMonth, monthBounds, type ReportParams } from "../params";
import type { Report } from "../report";

function tally<K>(items: { key: K; amount: number }[]): Map<K, { count: number; amount: number }> {
  const out = new Map<K, { count: number; amount: number }>();
  for (const { key, amount } of items) {
    const t = out.get(key) ?? { count: 0, amount: 0 };
    t.count += 1;
    t.amount += amount;
    out.set(key, t);
  }
  return out;
}

/**
 * Abstract of Collections: a month's receipts totalled by fee type and by accountable
 * form (parent §10), plus by collector. Cancelled receipts are left out of every total and
 * counted in a note, so the abstract agrees with the ledger.
 */
export async function buildAbstract(p: ReportParams): Promise<Report> {
  const { from, to } = monthBounds(p.month);
  const [rows, fees, held] = await Promise.all([receipts(from, to), feeTypeNames(), booklets()]);
  const live = rows.filter((r) => !r.cancelled);
  const who = await staffNameMap(live.map((r) => r.collectorId));
  const form = new Map(held.map((b) => [b.id, { label: b.label, name: b.formName }]));

  const byFee = tally(live.map((r) => ({ key: r.feeTypeId, amount: r.amount })));
  const byBooklet = tally(live.map((r) => ({ key: r.bookletId, amount: r.amount })));
  const byCollector = tally(live.map((r) => ({ key: r.collectorId, amount: r.amount })));
  const cancelled = rows.length - live.length;

  const sortByName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

  return {
    title: "Abstract of Collections",
    scope: longMonth(p.month),
    sections: [
      {
        title: "By fee type",
        columns: [
          { key: "name", label: "Fee type", kind: "text" },
          { key: "count", label: "Receipts", kind: "int", total: true },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [...byFee]
          .map(([id, t]) => ({ name: fees.get(id) ?? id, count: t.count, amount: fromCentavos(t.amount) }))
          .sort(sortByName),
        empty: "No receipts this month.",
      },
      {
        title: "By accountable form",
        columns: [
          { key: "name", label: "Booklet", kind: "text" },
          { key: "form", label: "Form", kind: "text" },
          { key: "count", label: "Receipts", kind: "int", total: true },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [...byBooklet]
          .map(([id, t]) => ({
            name: form.get(id)?.label ?? id,
            form: form.get(id)?.name ?? "",
            count: t.count,
            amount: fromCentavos(t.amount),
          }))
          .sort(sortByName),
        empty: "No receipts this month.",
      },
      {
        title: "By collector",
        columns: [
          { key: "name", label: "Collector", kind: "text" },
          { key: "count", label: "Receipts", kind: "int", total: true },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [...byCollector]
          .map(([id, t]) => ({ name: who.get(id) ?? id, count: t.count, amount: fromCentavos(t.amount) }))
          .sort(sortByName),
        empty: "No receipts this month.",
      },
    ],
    notes: [
      cancelled === 0
        ? "No receipt was cancelled this month."
        : `${cancelled} cancelled receipt${cancelled === 1 ? " is" : "s are"} excluded from every total above.`,
    ],
    signatures: [{ label: "Prepared by" }, { label: "Certified correct" }],
  };
}

/**
 * Report of Accountability for Accountable Forms: every booklet held during the month,
 * carried from beginning to ending balance, with §7.2's check that used + spoiled +
 * unused = total.
 */
export async function buildRaaf(p: ReportParams): Promise<Report> {
  const { from, to } = monthBounds(p.month);
  const held = (await booklets()).filter((b) => b.receivedOn <= to);
  const [used, who] = await Promise.all([
    consumption(held.map((b) => b.id), to),
    staffNameMap(held.map((b) => b.collectorId)),
  ]);

  const rows = held
    .map((b) => ({ b, a: accountFor(b, used.get(b.id) ?? [], from, to) }))
    .filter(({ a }) => a.beginning.qty + a.received.qty + a.issued.qty > 0)
    .map(({ b, a }) => ({
      form: `${b.label} ${b.startNo}–${b.endNo}`,
      collector: who.get(b.collectorId) ?? "—",
      beg: a.beginning.qty,
      rec: a.received.qty,
      used: a.issuedUsed,
      spoiled: a.issuedSpoiled,
      end: a.ending.qty,
      serials: showRange(a.ending),
      check: a.balances ? "Balances" : "DOES NOT BALANCE",
    }));

  return {
    title: "Report of Accountability for Accountable Forms",
    scope: longMonth(p.month),
    sections: [
      {
        columns: [
          { key: "form", label: "Booklet", kind: "text" },
          { key: "collector", label: "Held by", kind: "text" },
          { key: "beg", label: "Beginning", kind: "int", total: true },
          { key: "rec", label: "Received", kind: "int", total: true },
          { key: "used", label: "Used", kind: "int", total: true },
          { key: "spoiled", label: "Spoiled", kind: "int", total: true },
          { key: "end", label: "Ending", kind: "int", total: true },
          { key: "serials", label: "Ending serials", kind: "text" },
          { key: "check", label: "Used + spoiled + unused = total", kind: "text" },
        ],
        rows,
        empty: "No accountable forms were held this month.",
      },
    ],
    notes: ["Beginning + received − used − spoiled = ending, for every booklet."],
    signatures: [{ label: "Prepared by" }, { label: "Certified correct" }],
  };
}

/**
 * Remittance reconciliation: collections against deposit slips (parent §10). Each slip is
 * measured against the declared cash of the shifts it covers; the per-collector section
 * sets the month's receipts against the month's deposits; the last lists closed shifts
 * whose cash no slip covers yet.
 */
export async function buildReconciliation(p: ReportParams): Promise<Report> {
  const { from, to } = monthBounds(p.month);
  const [slips, collected, deposited, pending] = await Promise.all([
    getRemittances(from, to),
    receipts(from, to),
    deposits(from, to),
    getPendingShifts(),
  ]);
  const live = slips.filter((s) => s.state !== "cancelled");
  const who = await staffNameMap([
    ...collected.map((r) => r.collectorId),
    ...deposited.map((d) => d.collectorId),
    ...pending.map((s) => s.collectorId),
  ]);

  const perCollector = new Map<string, { collected: number; deposited: number }>();
  for (const r of collected.filter((r) => !r.cancelled)) {
    const t = perCollector.get(r.collectorId) ?? { collected: 0, deposited: 0 };
    t.collected += r.amount;
    perCollector.set(r.collectorId, t);
  }
  for (const d of deposited) {
    const t = perCollector.get(d.collectorId) ?? { collected: 0, deposited: 0 };
    t.deposited += d.amount;
    perCollector.set(d.collectorId, t);
  }

  return {
    title: "Remittance reconciliation",
    scope: longMonth(p.month),
    sections: [
      {
        title: "Deposit slips against declared cash",
        columns: [
          { key: "date", label: "Deposited", kind: "date" },
          { key: "collector", label: "Collector", kind: "text" },
          { key: "slip", label: "Slip", kind: "text" },
          { key: "covers", label: "Shifts of", kind: "text" },
          { key: "declared", label: "Cash declared", kind: "money", total: true },
          { key: "amount", label: "Deposited", kind: "money", total: true },
          { key: "difference", label: "Difference", kind: "money", total: true },
          { key: "status", label: "Status", kind: "text" },
        ],
        rows: live.map((s) => ({
          date: s.depositedAt,
          collector: s.collectorName,
          slip: `${s.bank} ${s.depositSlipNo}`,
          covers: s.dates.join(", "),
          declared: s.declared,
          amount: s.amount,
          difference: s.difference,
          status: s.state === "verified" ? `Verified by ${s.verifiedByName}` : "Awaiting verification",
        })),
        empty: "No deposit slips this month.",
      },
      {
        title: "By collector: receipts against deposits",
        columns: [
          { key: "collector", label: "Collector", kind: "text" },
          { key: "collected", label: "Collected (per OR)", kind: "money", total: true },
          { key: "deposited", label: "Deposited", kind: "money", total: true },
          { key: "difference", label: "Not yet deposited", kind: "money", total: true },
        ],
        rows: [...perCollector]
          .map(([id, t]) => ({
            collector: who.get(id) ?? id,
            collected: fromCentavos(t.collected),
            deposited: fromCentavos(t.deposited),
            difference: fromCentavos(t.collected - t.deposited),
          }))
          .sort((a, b) => a.collector.localeCompare(b.collector)),
        empty: "No receipts or deposits this month.",
      },
      {
        title: "Closed shifts not yet deposited (as of today)",
        columns: [
          { key: "collector", label: "Collector", kind: "text" },
          { key: "date", label: "Shift date", kind: "date" },
          { key: "count", label: "Receipts", kind: "int", total: true },
          { key: "declared", label: "Cash declared", kind: "money", total: true },
        ],
        rows: pending.map((s) => ({
          collector: who.get(s.collectorId) ?? s.collectorId,
          date: s.businessDate,
          count: s.count,
          declared: s.declared,
        })),
        empty: "Every closed shift is covered by a deposit slip.",
      },
    ],
    notes: [
      "Difference is deposit minus declared cash. A shortage at the stall shows on the shift's closeout variance, not here.",
      "A collector's 'not yet deposited' can include cash deposited early the next month.",
    ],
    signatures: [{ label: "Prepared by" }, { label: "Verified (accounting)" }],
  };
}

/**
 * Exceptions and variances, per month (parent §10). An oversight control as much as a
 * report: a collector generating most of the exceptions, or a supervisor resolving
 * everything the same way, should stand out without anyone going looking.
 */
export async function buildExceptions(p: ReportParams): Promise<Report> {
  const { from, to } = monthBounds(p.month);
  const supabase = await getServerClient();

  // Month bounds in Manila time: an exception raised at 7am on the 1st is that month's.
  const start = `${from}T00:00:00+08:00`;
  const end = `${to}T23:59:59.999+08:00`;
  const [{ data: exceptions, error }, { data: shifts, error: shiftError }] = await Promise.all([
    supabase
      .from("sync_exceptions")
      .select("collector_id, reason_code, first_seen_at, status, resolution, resolved_by, resolved_at")
      .or(
        `and(first_seen_at.gte.${start},first_seen_at.lte.${end}),and(resolved_at.gte.${start},resolved_at.lte.${end})`,
      ),
    supabase
      .from("shifts")
      .select("collector_id, business_date, variance, status")
      .gte("business_date", from)
      .lte("business_date", to)
      .in("status", ["closed", "closed_unsynced", "remitted"]),
  ]);
  if (error) throw new Error(error.message);
  if (shiftError) throw new Error(shiftError.message);

  const raised = (exceptions ?? []).filter((e) => {
    const d = manilaDate(e.first_seen_at);
    return d >= from && d <= to;
  });
  const resolved = (exceptions ?? []).filter((e) => {
    if (!e.resolved_at) return false;
    const d = manilaDate(e.resolved_at);
    return d >= from && d <= to;
  });
  const who = await staffNameMap([
    ...raised.map((e) => e.collector_id),
    ...resolved.flatMap((e) => (e.resolved_by ? [e.resolved_by] : [])),
    ...(shifts ?? []).map((s) => s.collector_id),
  ]);

  const byCollector = new Map<string, { total: number; open: number; escalated: number; resolved: number }>();
  for (const e of raised) {
    const t = byCollector.get(e.collector_id) ?? { total: 0, open: 0, escalated: 0, resolved: 0 };
    t.total += 1;
    t[e.status as "open" | "escalated" | "resolved"] += 1;
    byCollector.set(e.collector_id, t);
  }

  const bySupervisor = new Map<string, { corrected: number; spoiled: number }>();
  for (const e of resolved) {
    const id = e.resolved_by!;
    const t = bySupervisor.get(id) ?? { corrected: 0, spoiled: 0 };
    t[e.resolution as "corrected" | "spoiled"] += 1;
    bySupervisor.set(id, t);
  }

  const variance = new Map<string, { shifts: number; off: number; short: number; over: number }>();
  for (const s of shifts ?? []) {
    const v = fromPesos(Number(s.variance ?? 0));
    const t = variance.get(s.collector_id) ?? { shifts: 0, off: 0, short: 0, over: 0 };
    t.shifts += 1;
    if (v !== 0) t.off += 1;
    if (v < 0) t.short += v;
    if (v > 0) t.over += v;
    variance.set(s.collector_id, t);
  }

  return {
    title: "Exceptions and variances",
    scope: longMonth(p.month),
    sections: [
      {
        title: "Sync exceptions raised, by collector",
        columns: [
          { key: "name", label: "Collector", kind: "text" },
          { key: "total", label: "Raised", kind: "int", total: true },
          { key: "open", label: "Still open", kind: "int", total: true },
          { key: "escalated", label: "Escalated", kind: "int", total: true },
          { key: "resolved", label: "Resolved", kind: "int", total: true },
        ],
        rows: [...byCollector].map(([id, t]) => ({ name: who.get(id) ?? id, ...t })),
        empty: "No sync exceptions were raised this month.",
      },
      {
        title: "Resolutions, by supervisor",
        columns: [
          { key: "name", label: "Resolved by", kind: "text" },
          { key: "corrected", label: "Accepted with correction", kind: "int", total: true },
          { key: "spoiled", label: "Recorded as spoiled", kind: "int", total: true },
        ],
        rows: [...bySupervisor].map(([id, t]) => ({ name: who.get(id) ?? id, ...t })),
        empty: "No exceptions were resolved this month.",
      },
      {
        title: "Closeout variances, by collector",
        columns: [
          { key: "name", label: "Collector", kind: "text" },
          { key: "shifts", label: "Shifts closed", kind: "int", total: true },
          { key: "off", label: "With a variance", kind: "int", total: true },
          { key: "short", label: "Total short", kind: "money", total: true },
          { key: "over", label: "Total over", kind: "money", total: true },
        ],
        rows: [...variance].map(([id, t]) => ({
          name: who.get(id) ?? id,
          shifts: t.shifts,
          off: t.off,
          short: fromCentavos(t.short),
          over: fromCentavos(t.over),
        })),
        empty: "No shifts were closed this month.",
      },
    ],
    notes: ["Exceptions are counted in the month they were first raised; resolutions in the month they were resolved."],
  };
}
