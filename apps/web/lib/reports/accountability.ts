/**
 * Accountability for accountable forms, for one booklet over one period. The arithmetic
 * behind both the RCD's section C and the RAAF (parent §7.2, §10).
 *
 *   beginning + received - issued = ending
 *
 * "Issued" is every serial consumed in the period, written as a receipt OR spoiled: a
 * spoiled form is still a form out of the collector's hands, and COA counts it. A booklet
 * received (assigned) inside the period starts at zero and arrives as "received".
 */
export interface BookletInput {
  id: string;
  label: string;
  startNo: number;
  endNo: number;
  /** When it reached the collector (assigned_at's date). */
  receivedOn: string;
}

export interface Consumption {
  orNo: number;
  /** Business date the serial was used or spoiled. */
  on: string;
  spoiled: boolean;
}

export interface SerialRange {
  qty: number;
  from: number | null;
  to: number | null;
  /** The runs, e.g. [[1001, 1001], [1008, 1050]]: a skipped form breaks the range. */
  runs: [number, number][];
}

export interface BookletAccountability {
  bookletId: string;
  label: string;
  beginning: SerialRange;
  received: SerialRange;
  issued: SerialRange;
  ending: SerialRange;
  /** Issued in the period, split: written as receipts, and spoiled. */
  issuedUsed: number;
  issuedSpoiled: number;
  used: number;
  spoiled: number;
  /** used + spoiled + unused = total (§7.2), over the booklet's whole life to period end. */
  balances: boolean;
}

function range(serials: number[]): SerialRange {
  const sorted = [...new Set(serials)].sort((a, b) => a - b);
  if (sorted.length === 0) return { qty: 0, from: null, to: null, runs: [] };
  const runs: [number, number][] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return { qty: sorted.length, from: sorted[0]!, to: sorted[sorted.length - 1]!, runs };
}

/** The unconsumed serials of a booklet, given what has been consumed. */
function unused(b: BookletInput, consumed: Set<number>): number[] {
  const out: number[] = [];
  for (let n = b.startNo; n <= b.endNo; n++) if (!consumed.has(n)) out.push(n);
  return out;
}

export function accountFor(
  booklet: BookletInput,
  consumption: Consumption[],
  from: string,
  to: string,
): BookletAccountability {
  const inBooklet = consumption.filter((c) => c.orNo >= booklet.startNo && c.orNo <= booklet.endNo);
  const before = new Set(inBooklet.filter((c) => c.on < from).map((c) => c.orNo));
  const during = inBooklet.filter((c) => c.on >= from && c.on <= to);
  const byEnd = new Set([...before, ...during.map((c) => c.orNo)]);

  const arrivedDuring = booklet.receivedOn >= from && booklet.receivedOn <= to;
  const heldBefore = booklet.receivedOn < from;

  const total = booklet.endNo - booklet.startNo + 1;
  const used = inBooklet.filter((c) => c.on <= to && !c.spoiled).length;
  const spoiled = inBooklet.filter((c) => c.on <= to && c.spoiled).length;
  const endingSerials = booklet.receivedOn <= to ? unused(booklet, byEnd) : [];

  return {
    bookletId: booklet.id,
    label: booklet.label,
    beginning: heldBefore ? range(unused(booklet, before)) : range([]),
    received: arrivedDuring ? range(unused(booklet, before)) : range([]),
    issued: range(during.map((c) => c.orNo)),
    issuedUsed: during.filter((c) => !c.spoiled).length,
    issuedSpoiled: during.filter((c) => c.spoiled).length,
    ending: range(endingSerials),
    used,
    spoiled,
    balances: used + spoiled + endingSerials.length === total || booklet.receivedOn > to,
  };
}

/** `1001, 1008–1050`: every run, so a gap is never hidden inside one range. `—` for none. */
export function showRange(r: SerialRange): string {
  if (r.qty === 0) return "—";
  return r.runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");
}
