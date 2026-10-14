// apps/web/lib/reports/builders/daily-collection/types.ts
import type { Centavos } from "@ceedo/shared";

/**
 * One row of receipt_account_lines (migration 070): a receipt PORTION placed on one
 * account. Every figure in the Daily Collection Report is a sum of these, which is what
 * makes the Treasurer page, the matrix and the abstracts agree by construction.
 */
export interface DailyPortion {
  source: "receipt" | "cash_ticket";
  collectionId: string | null;
  cashTicketId: string | null;
  lineId: string | null;
  orNo: number | null;
  bookletId: string | null;
  shiftId: string | null;
  collectorId: string;
  leaseId: string | null;
  payerRef: string | null;
  feeTypeId: string;
  facilityId: string | null;
  sectionId: string | null;
  rateClass: string | null;
  quantity: number | null;
  accountId: string;
  paymentMode: "cash" | "check";
  amount: Centavos;
  /** Status as of now; every total excludes these, the abstracts list them at zero. */
  cancelled: boolean;
}

export interface DailyAccount {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  treasurerLineId: string;
  rcdColumnId: string;
}

export interface DailyTreasurerLine {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  subtotalGroup: 1 | 2;
  active: boolean;
}

export interface DailyRcdColumn {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** A shift and the live remittance covering it, if any. */
export interface DailyShift {
  id: string;
  deposit: { on: string; verified: boolean } | null;
}

/** Every collector-role user, plus anyone else who collected that day. */
export interface DailyCollector {
  id: string;
  name: string;
  active: boolean;
}

export interface DailyFacility {
  id: string;
  name: string;
  type: "market" | "terminal" | "parking" | "slaughterhouse" | "other";
}

export interface Named {
  id: string;
  name: string;
}

export interface DailyBooklet {
  id: string;
  label: string;
}

export interface DailyLease {
  id: string;
  tenantName: string;
  stallNo: string;
}

/** What a lease receipt settled: all its allocations, and the rental periods among them. */
export interface RentCover {
  collectionId: string;
  allocated: Centavos;
  periods: { start: string; end: string }[];
}

export interface DailyCashTicket {
  id: string;
  ticketFrom: number | null;
  ticketTo: number | null;
  note: string | null;
}

export interface DailySignatory {
  label: string;
  name: string | null;
  title: string | null;
}

export interface DailyInput {
  /** The business date, YYYY-MM-DD. */
  date: string;
  portions: DailyPortion[];
  accounts: DailyAccount[];
  treasurerLines: DailyTreasurerLine[];
  rcdColumns: DailyRcdColumn[];
  shifts: DailyShift[];
  collectors: DailyCollector[];
  facilities: DailyFacility[];
  sections: Named[];
  feeTypes: Named[];
  booklets: DailyBooklet[];
  leases: DailyLease[];
  rentCover: RentCover[];
  cashTickets: DailyCashTicket[];
  signatories: DailySignatory[];
  /** The built-in UNCLASSIFIED account's id; null only if the chart is missing it. */
  unclassifiedAccountId: string | null;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** The account a portion sits on; a portion on an account missing from the chart is a bug. */
export function accountOf(accounts: Map<string, DailyAccount>, p: DailyPortion): DailyAccount {
  const a = accounts.get(p.accountId);
  if (!a) throw new Error(`Account ${p.accountId} is not in the chart`);
  return a;
}
