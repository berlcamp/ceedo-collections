import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "../supabase/server";
import { settlementState, type SettlementState } from "./tally";

// Kept apart from ./queries, and on relative imports only, because lib/ledger/shifts.ts
// loads it and that module is imported by unit tests that have no "@/" alias.

/** Settlements per shift, for the shifts screen and the monthly report. */
export async function settlementsByShift(
  shiftIds: string[],
): Promise<Map<string, { amount: Centavos; state: SettlementState }[]>> {
  const out = new Map<string, { amount: Centavos; state: SettlementState }[]>();
  if (shiftIds.length === 0) return out;
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("variance_settlements")
    .select("shift_id, amount, verified_at, cancelled_at")
    .in("shift_id", shiftIds);
  if (error) throw new Error(error.message);
  for (const s of data ?? []) {
    const list = out.get(s.shift_id) ?? [];
    list.push({
      amount: fromPesos(Number(s.amount)),
      state: settlementState({ verifiedAt: s.verified_at, cancelledAt: s.cancelled_at }),
    });
    out.set(s.shift_id, list);
  }
  return out;
}
