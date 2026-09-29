import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "../supabase/server";
import { staffNames } from "../remittances/queries";
import { settlementState, tally, type SettlementState, type Tally } from "./tally";

function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

export interface ShortageRow extends Tally {
  shiftId: string;
  collectorName: string;
  businessDate: string;
  shiftStatus: string;
}

export interface SettlementRow {
  id: string;
  shiftId: string;
  collectorName: string;
  businessDate: string;
  amount: Centavos;
  reference: string;
  receivedAt: string;
  recordedBy: string;
  recordedByName: string;
  verifiedByName: string | null;
  cancelReason: string | null;
  state: SettlementState;
}

/**
 * Every closed or remitted shift that was short, oldest first, with what has been paid
 * toward it, and every repayment recorded against them, newest first.
 */
export async function getShortages(): Promise<{
  shortages: ShortageRow[];
  settlements: SettlementRow[];
}> {
  const supabase = await getServerClient();
  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("id, collector_id, business_date, status, variance")
    .in("status", ["closed", "remitted"])
    .lt("variance", 0)
    .order("business_date")
    .limit(1000);
  if (error) throw new Error(error.message);
  const list = shifts ?? [];
  if (list.length === 0) return { shortages: [], settlements: [] };

  const { data: raw, error: settleError } = await supabase
    .from("variance_settlements")
    .select("*")
    .in("shift_id", list.map((s) => s.id))
    .order("recorded_at", { ascending: false });
  if (settleError) throw new Error(settleError.message);
  const settlementsRaw = raw ?? [];

  const who = await staffNames([
    ...list.map((s) => s.collector_id),
    ...settlementsRaw.flatMap((s) => [s.recorded_by, ...(s.verified_by ? [s.verified_by] : [])]),
  ]);
  const shiftById = new Map(list.map((s) => [s.id, s]));

  const settlements: SettlementRow[] = settlementsRaw.map((s) => {
    const shift = shiftById.get(s.shift_id)!;
    return {
      id: s.id,
      shiftId: s.shift_id,
      collectorName: who.get(shift.collector_id) ?? "—",
      businessDate: shift.business_date,
      amount: centavos(s.amount),
      reference: s.reference,
      receivedAt: s.received_at,
      recordedBy: s.recorded_by,
      recordedByName: who.get(s.recorded_by) ?? "—",
      verifiedByName: s.verified_by ? (who.get(s.verified_by) ?? "—") : null,
      cancelReason: s.cancel_reason,
      state: settlementState({ verifiedAt: s.verified_at, cancelledAt: s.cancelled_at }),
    };
  });

  const shortages: ShortageRow[] = list.map((s) => ({
    shiftId: s.id,
    collectorName: who.get(s.collector_id) ?? "—",
    businessDate: s.business_date,
    shiftStatus: s.status,
    ...tally(
      centavos(s.variance),
      settlements.filter((x) => x.shiftId === s.id),
    ),
  }));

  return { shortages, settlements };
}
