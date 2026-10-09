// apps/web/app/(admin)/accounts/rules/page.tsx
import { ScreenHeader } from "@/components/shell/screen-header";
import { RuleDialog } from "@/components/accounts/rule-dialog";
import { RulesTable } from "@/components/accounts/rules-table";
import { getRuleChoices, getRuleSets } from "@/lib/accounts/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Account rules (spec "Screens: /admin/accounts"). A rule places a fee's receipts on one or
 * more accounts from a date. Rules are never edited: a new rule for the same fee, facility,
 * section, class and portion ends the old one the day before. `?fee=&facility=&section=&rateClass=&portion=&from=`
 * prefills the dialog (the Unclassified screen's "Create rule" link).
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requireStaff();
  const prefill = await searchParams;
  const [rows, choices] = await Promise.all([getRuleSets(), getRuleChoices()]);
  return (
    <div>
      <ScreenHeader
        title="Account rules"
        note="Which account each fee's receipts land on. A section rule beats a facility rule, which beats a fee-only rule; a rule naming a rate class beats one that does not. Changing a rule starts a new one from a date; months already reported are never restated."
        actions={staff.role === "admin" ? <RuleDialog choices={choices} today={manilaToday()} prefill={prefill} /> : null}
      />
      <RulesTable rows={rows} />
    </div>
  );
}
