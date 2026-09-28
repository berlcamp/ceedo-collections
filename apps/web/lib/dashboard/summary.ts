import { sum, type Centavos } from "@ceedo/shared";
import type { AgingRow, CollectionRow, DelinquencyRow } from "../ledger/queries";
import type { ExceptionRow } from "../ledger/exceptions";
import type { ShiftRow } from "../ledger/shift-class";
import type { PendingShift } from "../remittances/queries";

/**
 * The dashboard's figures, each derived from the rows the full screen already reads, so a
 * panel and the screen it links to can never disagree about what they count.
 */

export interface TodaySummary {
  receipts: number;
  /** Excludes voided receipts, as the Receipts screen's proof line does. */
  gross: Centavos;
  voided: number;
}

export function summariseToday(rows: CollectionRow[]): TodaySummary {
  const live = rows.filter((row) => !row.cancelled);
  return {
    receipts: live.length,
    gross: sum(live.map((row) => row.grossAmount)),
    voided: rows.length - live.length,
  };
}

export interface ShiftSummary {
  /** Open on today's date: tablets still out in the market. */
  open: number;
  /** Open from an earlier day: a tablet that never closed out. */
  staleOpen: number;
  /** Closed on the device but not yet synced (§6.5 closed_unsynced). */
  unsynced: number;
  /** Closed shifts, not yet remitted, whose declared cash disagrees with the system. */
  varianceCount: number;
}

export function summariseShifts(rows: ShiftRow[]): ShiftSummary {
  return {
    open: rows.filter((row) => row.klass === "open").length,
    staleOpen: rows.filter((row) => row.klass === "stale_open").length,
    unsynced: rows.filter((row) => row.klass === "unsynced").length,
    varianceCount: rows.filter(
      (row) => row.klass === "closed" && row.variance !== null && row.variance !== 0,
    ).length,
  };
}

export interface DepositSummary {
  shifts: number;
  /** Declared cash: what the collectors said they handed over, and what should be banked. */
  declared: Centavos;
  oldestDate: string | null;
}

export function summariseAwaitingDeposit(rows: PendingShift[]): DepositSummary {
  return {
    shifts: rows.length,
    declared: sum(rows.map((row) => row.declared)),
    // getPendingShifts() orders by business_date, oldest first.
    oldestDate: rows[0]?.businessDate ?? null,
  };
}

export interface ExceptionSummary {
  open: number;
  /** Past §11.3's three-day line, where the Treasurer has to be told. */
  overThreeDays: number;
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export function summariseExceptions(rows: ExceptionRow[], now: Date): ExceptionSummary {
  return {
    open: rows.length,
    overThreeDays: rows.filter(
      (row) => now.getTime() - new Date(row.firstSeenAt).getTime() > THREE_DAYS_MS,
    ).length,
  };
}

export interface ReceivableSummary {
  outstanding: Centavos;
  overNinety: Centavos;
  leases: number;
}

export function summariseAging(rows: AgingRow[]): ReceivableSummary {
  return {
    outstanding: sum(rows.map((row) => row.total)),
    overNinety: sum(rows.map((row) => row.bucketOver90)),
    leases: rows.filter((row) => row.total > 0).length,
  };
}

export interface DelinquencySummary {
  leases: number;
  worstDaysOverdue: number;
}

export function summariseDelinquency(rows: DelinquencyRow[]): DelinquencySummary {
  return {
    leases: rows.length,
    worstDaysOverdue: rows.reduce((worst, row) => Math.max(worst, row.daysOverdue), 0),
  };
}
