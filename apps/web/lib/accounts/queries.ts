// apps/web/lib/accounts/queries.ts
import { fromPesos, type Centavos } from "@ceedo/shared";
import { ledgerClient } from "@/lib/ledger/queries";
import { allPages } from "@/lib/reports/data";

export interface RuleSetRow {
  id: string;
  feeType: string;
  facility: string | null;
  section: string | null;
  rateClass: string | null;
  portion: "base" | "surcharge";
  effectiveFrom: string;
  effectiveTo: string | null;
  shares: { account: string; percent: number }[];
}

export async function getRuleSets(): Promise<RuleSetRow[]> {
  const supabase = await ledgerClient();
  const rows = await allPages((from, to) =>
    supabase
      .from("account_rules")
      .select(
        "id, rate_class, portion, effective_from, effective_to, fee_types(name), facilities(name), sections!account_rules_section_in_facility(name), account_rule_shares(share_bps, collection_accounts(code, name))",
      )
      .order("effective_from", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows
    .map((r) => ({
      id: r.id,
      feeType: r.fee_types?.name ?? "—",
      facility: r.facilities?.name ?? null,
      section: r.sections?.name ?? null,
      rateClass: r.rate_class,
      portion: r.portion as "base" | "surcharge",
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      shares: (r.account_rule_shares ?? []).map((s) => ({
        account: `${s.collection_accounts?.code ?? ""} · ${s.collection_accounts?.name ?? ""}`,
        percent: s.share_bps / 100,
      })),
    }))
    .sort((a, b) => a.feeType.localeCompare(b.feeType) || (a.facility ?? "").localeCompare(b.facility ?? ""));
}

export interface RuleChoices {
  feeTypes: { id: string; name: string }[];
  facilities: { id: string; name: string }[];
  sections: { id: string; name: string; facilityId: string }[];
  accounts: { id: string; label: string }[];
}

export async function getRuleChoices(): Promise<RuleChoices> {
  const supabase = await ledgerClient();
  const [fees, facilities, sections, accounts] = await Promise.all([
    supabase.from("fee_types").select("id, name").eq("active", true).order("name"),
    supabase.from("facilities").select("id, name").eq("active", true).order("name"),
    supabase.from("sections").select("id, name, facility_id").eq("active", true).order("name"),
    supabase.from("collection_accounts").select("id, code, name").eq("active", true).order("sort_order"),
  ]);
  for (const r of [fees, facilities, sections, accounts]) if (r.error) throw r.error;
  return {
    feeTypes: fees.data ?? [],
    facilities: facilities.data ?? [],
    sections: (sections.data ?? []).map((s) => ({ id: s.id, name: s.name, facilityId: s.facility_id })),
    accounts: (accounts.data ?? []).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
  };
}

export interface UnclassifiedRow {
  key: string;
  businessDate: string;
  orNo: number | null;
  source: string;
  feeTypeId: string;
  feeType: string;
  facilityId: string | null;
  facility: string | null;
  sectionId: string | null;
  section: string | null;
  rateClass: string | null;
  portion: "base" | "surcharge";
  amount: Centavos;
}

/** Every portion of the period that no rule places, excluding cancelled receipts. */
export async function getUnclassified(from: string, to: string): Promise<UnclassifiedRow[]> {
  const supabase = await ledgerClient();
  const { data: unc, error } = await supabase.from("collection_accounts").select("id").eq("code", "UNCLASSIFIED").single();
  if (error) throw error;
  const rows = await allPages((a, b) =>
    supabase.rpc("receipt_account_lines", { p_from: from, p_to: to })
      .eq("account_id", unc.id).eq("cancelled", false)
      .order("business_date").order("or_no")
      .order("collection_id").order("cash_ticket_id").order("line_id").order("portion")
      .range(a, b),
  );
  const [fees, facilities, sections] = await Promise.all([
    supabase.from("fee_types").select("id, name"),
    supabase.from("facilities").select("id, name"),
    supabase.from("sections").select("id, name"),
  ]);
  for (const r of [fees, facilities, sections]) if (r.error) throw r.error;
  const name = (list: { id: string; name: string }[] | null, id: string | null) =>
    id ? (list ?? []).find((x) => x.id === id)?.name ?? null : null;
  return rows.map((r, i) => ({
    key: `${r.collection_id ?? r.cash_ticket_id}-${r.line_id ?? r.portion}-${i}`,
    businessDate: r.business_date,
    orNo: r.or_no,
    source: r.source,
    feeTypeId: r.fee_type_id,
    feeType: name(fees.data, r.fee_type_id) ?? "—",
    facilityId: r.facility_id,
    facility: name(facilities.data, r.facility_id),
    sectionId: r.section_id,
    section: name(sections.data, r.section_id),
    rateClass: r.rate_class || null,
    portion: r.portion as "base" | "surcharge",
    amount: fromPesos(Number(r.amount)),
  }));
}
