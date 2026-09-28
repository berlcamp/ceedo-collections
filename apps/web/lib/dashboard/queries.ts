import { fromPesos, sum, type Centavos } from "@ceedo/shared";
import { getOpenExceptions } from "../ledger/exceptions";
import {
  getAging,
  getCollections,
  getDelinquency,
  getOpeningBalanceLeases,
} from "../ledger/queries";
import { getShifts } from "../ledger/shifts";
import { getPendingShifts } from "../remittances/queries";
import { manilaToday } from "../reports/params";
import { getServerClient } from "../supabase/server";
import {
  summariseAging,
  summariseAwaitingDeposit,
  summariseDelinquency,
  summariseExceptions,
  summariseShifts,
  summariseToday,
} from "./summary";

/**
 * One figure the dashboard could not read is reported as unreadable, never as zero: a
 * refused query and an empty one must not look the same (PRODUCT.md). So each panel gets
 * its own settled result rather than the page failing, or silently showing "—", as a whole.
 */
export type Loaded<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(work: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work };
  } catch {
    return { ok: false };
  }
}

export interface VerificationSummary {
  slips: number;
  amount: Centavos;
}

/** Deposit slips recorded but neither verified by accounting nor cancelled. */
async function getAwaitingVerification(): Promise<VerificationSummary> {
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("remittances")
    .select("amount")
    .is("verified_at", null)
    .is("cancelled_at", null);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { slips: rows.length, amount: sum(rows.map((row) => fromPesos(Number(row.amount)))) };
}

export async function getDashboard() {
  const today = manilaToday();
  const now = new Date();

  const [collected, shifts, deposit, verification, exceptions, aging, delinquency, opening] =
    await Promise.all([
      settle(getCollections({ businessDate: today }).then(summariseToday)),
      settle(getShifts().then(summariseShifts)),
      settle(getPendingShifts().then(summariseAwaitingDeposit)),
      settle(getAwaitingVerification()),
      settle(getOpenExceptions().then((rows) => summariseExceptions(rows, now))),
      settle(getAging().then(summariseAging)),
      settle(getDelinquency().then(summariseDelinquency)),
      settle(getOpeningBalanceLeases().then((leases) => leases.pending.length)),
    ]);

  return { today, collected, shifts, deposit, verification, exceptions, aging, delinquency, opening };
}
