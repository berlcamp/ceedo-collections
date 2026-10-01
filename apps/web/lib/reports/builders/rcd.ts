import { fromCentavos } from "@ceedo/shared";
import { accountFor, showRange } from "../accountability";
import { ReportInputError } from "../errors";
import { booklets, consumption, deposits, feeTypeNames, receipts, spoiledForms, staffName } from "../data";
import { longDate, type ReportParams } from "../params";
import type { Report } from "../report";

const EPOCH = "2000-01-01";

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Report of Collections and Deposits: one collector, one day. Parent §10, "the core COA
 * form", laid out in the standard COA sections:
 *
 *   A. Collections      every OR written that day, cancelled ones at zero, spoiled listed
 *   B. Deposits         slips deposited that day
 *   C. Accountability   per booklet: beginning, received, issued, ending
 *   D. Summary          undeposited at start + collections - deposits = undeposited at end
 *
 * Amounts are the receipts' own totals: the RCD reports what the ORs say, and the drawer
 * count (the closeout's declared figure) is the shift's business, not this form's.
 */
export async function buildRcd(p: ReportParams): Promise<Report> {
  if (!p.collectorId) throw new ReportInputError("Choose a collector.");
  const name = await staffName(p.collectorId);
  if (!name) throw new ReportInputError("No such collector.");

  const [today, earlier, depositedToday, depositedEarlier, held, fees] = await Promise.all([
    receipts(p.date, p.date, p.collectorId),
    receipts(EPOCH, dayBefore(p.date), p.collectorId),
    deposits(p.date, p.date, p.collectorId),
    deposits(EPOCH, dayBefore(p.date), p.collectorId),
    booklets(p.collectorId),
    feeTypeNames(),
  ]);

  const bookletIds = held.map((b) => b.id);
  const [used, spoiled] = await Promise.all([
    consumption(bookletIds, p.date),
    spoiledForms(bookletIds),
  ]);
  const prefix = new Map(held.map((b) => [b.id, b.label]));

  const live = (rows: typeof today) => rows.filter((r) => !r.cancelled).reduce((a, r) => a + r.amount, 0);
  const collectedToday = live(today);
  const undepositedBefore = live(earlier) - depositedEarlier.reduce((a, d) => a + d.amount, 0);
  const depositedTotal = depositedToday.reduce((a, d) => a + d.amount, 0);

  const collectionRows = [
    ...today.map((r) => ({
      sort: r.orNo,
      or: `${prefix.get(r.bookletId) ?? ""} ${r.orNo}`.trim(),
      payor: r.payer || "—",
      // Same text-badge convention as cancelled: the Report of Collections and Deposits is
      // the one report builder that lists individual receipts (spec §4.2), and both the
      // printed page and the xlsx export read a Cell as plain text, so the flag rides in
      // this column rather than as a separate styled element neither renderer has.
      nature: [fees.get(r.feeTypeId) ?? "", r.cancelled ? "(CANCELLED)" : "", r.officeEncoded ? "(OFFICE-ENCODED)" : ""]
        .filter(Boolean)
        .join(" "),
      amount: fromCentavos(r.cancelled ? 0 : r.amount),
    })),
    ...spoiled
      .filter((s) => s.on === p.date)
      .map((s) => ({
        sort: s.orNo,
        or: `${prefix.get(s.bookletId) ?? ""} ${s.orNo}`.trim(),
        payor: "—",
        nature: `SPOILED: ${s.reason}`,
        amount: fromCentavos(0),
      })),
  ]
    .sort((a, b) => a.sort - b.sort)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the row
    .map(({ sort: _sort, ...row }) => row);

  const accountability = held
    .filter((b) => b.receivedOn <= p.date)
    .map((b) => accountFor(b, used.get(b.id) ?? [], p.date, p.date))
    .filter((a) => a.beginning.qty + a.received.qty + a.issued.qty > 0);

  return {
    title: "Report of Collections and Deposits",
    scope: `${name} · ${longDate(p.date)}`,
    sections: [
      {
        title: "A. Collections",
        columns: [
          { key: "or", label: "OR no.", kind: "text" },
          { key: "payor", label: "Payor", kind: "text" },
          { key: "nature", label: "Nature of collection", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: collectionRows,
        empty: "No official receipts were issued this day.",
      },
      {
        title: "B. Remittances / deposits",
        columns: [
          { key: "bank", label: "Bank", kind: "text" },
          { key: "slip", label: "Deposit slip no.", kind: "text" },
          { key: "status", label: "Status", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: depositedToday.map((d) => ({
          bank: d.bank,
          slip: d.slip,
          status: d.verified ? "Verified" : "Awaiting verification",
          amount: d.amount,
        })),
        empty: "No deposit recorded for this day.",
      },
      {
        title: "C. Accountability for accountable forms",
        columns: [
          { key: "form", label: "Form", kind: "text" },
          { key: "begQty", label: "Beginning qty", kind: "int" },
          { key: "beg", label: "Beginning serials", kind: "text" },
          { key: "recQty", label: "Received qty", kind: "int" },
          { key: "rec", label: "Received serials", kind: "text" },
          { key: "issQty", label: "Issued qty", kind: "int" },
          { key: "iss", label: "Issued serials", kind: "text" },
          { key: "endQty", label: "Ending qty", kind: "int" },
          { key: "end", label: "Ending serials", kind: "text" },
        ],
        rows: accountability.map((a) => ({
          form: a.label,
          begQty: a.beginning.qty,
          beg: showRange(a.beginning),
          recQty: a.received.qty,
          rec: showRange(a.received),
          issQty: a.issued.qty,
          iss: showRange(a.issued),
          endQty: a.ending.qty,
          end: showRange(a.ending),
        })),
        empty: "No accountable forms were held this day.",
      },
      {
        title: "D. Summary of collections and deposits",
        columns: [
          { key: "item", label: "", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
        ],
        rows: [
          { item: "Undeposited collections, beginning", amount: fromCentavos(undepositedBefore) },
          { item: "Add: collections this day (per OR)", amount: fromCentavos(collectedToday) },
          { item: "Less: deposits this day", amount: fromCentavos(depositedTotal) },
          {
            item: "Undeposited collections, ending",
            amount: fromCentavos(undepositedBefore + collectedToday - depositedTotal),
          },
        ],
      },
    ],
    notes: [
      "Issued forms include spoiled ones, which are listed in section A at zero.",
      "Section C lists every run of serials, so a skipped form shows on its own and stays in the ending balance.",
    ],
    signatures: [
      { label: "Certified correct (collector)", name },
      { label: "Verified (supervisor)" },
      { label: "Received (accounting)" },
    ],
  };
}
