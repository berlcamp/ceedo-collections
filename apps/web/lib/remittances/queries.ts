import { fromPesos, type Centavos } from "@ceedo/shared";
import { getServerClient } from "@/lib/supabase/server";
import { reconcile, remittanceState, type Reconciliation, type RemittanceState } from "./reconcile";

function centavos(value: string | number | null): Centavos {
  return fromPesos(Number(value ?? 0));
}

export interface RemittanceRow extends Reconciliation {
  id: string;
  collectorId: string;
  collectorName: string;
  depositSlipNo: string;
  bank: string;
  amount: Centavos;
  depositedAt: string;
  recordedBy: string;
  recordedByName: string;
  verifiedByName: string | null;
  cancelReason: string | null;
  state: RemittanceState;
  shiftCount: number;
}

export interface PendingShift {
  id: string;
  collectorId: string;
  businessDate: string;
  declared: Centavos;
  system: Centavos;
  count: number;
}

async function names(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, full_name")
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((u) => [u.id, u.full_name]));
}

/** Slips deposited between two dates, newest first, each reconciled against its shifts. */
export async function getRemittances(from: string, to: string): Promise<RemittanceRow[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("remittances")
    .select("*")
    .gte("deposited_at", from)
    .lte("deposited_at", to)
    .order("deposited_at", { ascending: false })
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(error.message);
  const slips = data ?? [];
  if (slips.length === 0) return [];

  const { data: shifts, error: shiftError } = await supabase
    .from("shifts")
    .select("remittance_id, business_date, declared_total, system_total")
    .in("remittance_id", slips.map((s) => s.id));
  if (shiftError) throw new Error(shiftError.message);

  const who = await names(
    slips.flatMap((s) => [s.collector_id, s.recorded_by, s.verified_by ?? s.recorded_by]),
  );

  return slips.map((s) => {
    const covered = (shifts ?? [])
      .filter((sh) => sh.remittance_id === s.id)
      .map((sh) => ({
        businessDate: sh.business_date,
        declared: centavos(sh.declared_total),
        system: centavos(sh.system_total),
      }));
    const amount = centavos(s.amount);
    return {
      id: s.id,
      collectorId: s.collector_id,
      collectorName: who.get(s.collector_id) ?? "—",
      depositSlipNo: s.deposit_slip_no,
      bank: s.bank,
      amount,
      depositedAt: s.deposited_at,
      recordedBy: s.recorded_by,
      recordedByName: who.get(s.recorded_by) ?? "—",
      verifiedByName: s.verified_by ? (who.get(s.verified_by) ?? "—") : null,
      cancelReason: s.cancel_reason,
      state: remittanceState({ verifiedAt: s.verified_at, cancelledAt: s.cancelled_at }),
      shiftCount: covered.length,
      ...reconcile(amount, covered),
    };
  });
}

/** Closed shifts no slip covers yet: collected cash still to reach the bank. */
export async function getPendingShifts(): Promise<PendingShift[]> {
  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("shifts")
    .select("id, collector_id, business_date, declared_total, system_total, system_count")
    .eq("status", "closed")
    .is("remittance_id", null)
    .order("business_date");
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id,
    collectorId: s.collector_id,
    businessDate: s.business_date,
    declared: centavos(s.declared_total),
    system: centavos(s.system_total),
    count: s.system_count ?? 0,
  }));
}

export { names as staffNames };
