// apps/web/components/accounts/rule-dialog.tsx
"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, NativeSelect, TextInput } from "@/components/ui/field";
import { useSubmit } from "@/components/ui/use-submit";
import { saveRule } from "@/lib/accounts/actions";
import type { RuleChoices } from "@/lib/accounts/queries";
import type { SaveResult } from "@/lib/admin/save-result";

type Share = { accountId: string; percent: string };

export function RuleDialog({
  choices,
  today,
  prefill,
}: {
  choices: RuleChoices;
  today: string;
  prefill: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(prefill.fee));
  const [facilityId, setFacilityId] = useState(prefill.facility ?? "");
  const [shares, setShares] = useState<Share[]>([{ accountId: "", percent: "100" }]);
  const [result, setResult] = useState<SaveResult | null>(null);

  const { pending: busy, onSubmit } = useSubmit(async (formData) => {
    const outcome = await saveRule(formData);
    setResult(outcome);
    if (outcome.ok) {
      setOpen(false);
      router.replace("/accounts/rules");
      router.refresh();
    }
  });
  const errors = result && !result.ok ? result.fieldErrors : {};
  const sections = choices.sections.filter((s) => s.facilityId === facilityId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass("primary", "md")}>
        <Plus size={14} strokeWidth={2} />
        New rule
      </DialogTrigger>
      <DialogContent
        busy={busy}
        title="New account rule"
        description="Starts on the date given; an existing rule for the same fee, facility, section, class and portion ends the day before."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Cancel</DialogClose>
            <Button type="submit" form="rule-form" variant="primary" loading={busy}>
              {busy ? "Saving…" : "Save rule"}
            </Button>
          </>
        }
      >
        <form id="rule-form" onSubmit={onSubmit}>
          <FieldShell id="feeTypeId" label="Fee" error={errors.feeTypeId}>
            <NativeSelect id="feeTypeId" name="feeTypeId" defaultValue={prefill.fee ?? ""}>
              <option value="" disabled>Choose…</option>
              {choices.feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </NativeSelect>
          </FieldShell>
          <div className="grid grid-cols-2 gap-x-3">
            <FieldShell id="facilityId" label="Facility" error={errors.facilityId}>
              <NativeSelect id="facilityId" name="facilityId" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                <option value="">Any</option>
                {choices.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </NativeSelect>
            </FieldShell>
            <FieldShell id="sectionId" label="Section" error={errors.sectionId}>
              <NativeSelect id="sectionId" name="sectionId" defaultValue={prefill.section ?? ""} disabled={!facilityId}>
                <option value="">Any</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </FieldShell>
            <FieldShell id="rateClass" label="Rate class" error={errors.rateClass} help="Blank: any class. e.g. RTMI for a bus company.">
              <TextInput id="rateClass" name="rateClass" defaultValue={prefill.rateClass ?? ""} />
            </FieldShell>
            <FieldShell id="portion" label="Portion" error={errors.portion}>
              <NativeSelect id="portion" name="portion" defaultValue={prefill.portion ?? "base"}>
                <option value="base">Base (rent, fee)</option>
                <option value="surcharge">Surcharge on rent</option>
              </NativeSelect>
            </FieldShell>
            <FieldShell id="effectiveFrom" label="Starts" error={errors.effectiveFrom}>
              <TextInput id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={prefill.from ?? today} />
            </FieldShell>
          </div>

          <FieldShell id="shares" label="Accounts" error={errors.shares} help="Split a fee by adding accounts; the shares must add up to 100%.">
            <div className="space-y-2">
              {shares.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect
                    name="accountId"
                    value={s.accountId}
                    onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}
                  >
                    <option value="" disabled>Choose an account…</option>
                    {choices.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </NativeSelect>
                  <TextInput
                    name="percent"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    className="w-24"
                    value={s.percent}
                    onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => setShares([...shares, { accountId: "", percent: "" }])}
              >
                Add an account
              </button>
            </div>
          </FieldShell>

          {result && !result.ok && result.formError ? (
            <p className="mt-3 rounded-lg border border-ribbon/40 bg-ribbon-soft px-3 py-2 text-xs text-ribbon">{result.formError}</p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
