"use client";

import { Database, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextInput } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { useBusy } from "@/components/ui/use-submit";
import { clearAllData, seedTestData, type ToolResult } from "@/lib/super-admin/actions";
import { CLEAR_CONFIRMATION } from "@/lib/super-admin/confirmation";

function ResultNotice({ result }: { result: ToolResult | null }) {
  if (!result) return null;
  return (
    <Notice tone={result.ok ? "success" : "error"} className="mt-3">
      {result.message}
    </Notice>
  );
}

export function SeedDataPanel() {
  const router = useRouter();
  const { busy, run } = useBusy();
  const [result, setResult] = useState<ToolResult | null>(null);

  return (
    <Panel
      title="Create test data"
      note="Safe to run more than once. It adds only what is missing, and dates are counted back from today."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
        <li>Four facilities: a public market, a terminal, a slaughterhouse and parking.</li>
        <li>Market sections Fish, Meat, Vegetable and Dry Goods, with 10 stalls each.</li>
        <li>26 tenants and 36 leases (daily, weekly and monthly), including reserved, ended, vacant and inactive stalls.</li>
        <li>Arrears from none to about five months, with opening balances and surcharges.</li>
        <li>Fee types, rates and the OR 51 receipt form.</li>
        <li>
          Collectors TEST-C01 (market) and TEST-C02 (terminal), each with PIN 123456 and a
          receipt booklet, plus a test tablet for each site. Issue a tablet&apos;s credential
          on the Devices screen to enrol it.
        </li>
      </ul>
      <div className="mt-4">
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            run(async () => {
              setResult(null);
              const outcome = await seedTestData();
              setResult(outcome);
              if (outcome.ok) router.refresh();
            })
          }
        >
          <Database size={14} strokeWidth={2} />
          {busy ? "Creating…" : "Create test data"}
        </Button>
      </div>
      <ResultNotice result={result} />
    </Panel>
  );
}

export function ClearDataPanel() {
  const router = useRouter();
  const { busy, run } = useBusy();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<ToolResult | null>(null);
  const confirmed = typed === CLEAR_CONFIRMATION;

  return (
    <Panel
      title="Clear all data"
      note="Deletes every record except users and settings: facilities, stalls, tenants, leases, the whole ledger, receipts, shifts, remittances, booklets, tablets, invites and the audit log. It cannot be undone."
    >
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogTrigger className={buttonClass("danger", "md")}>
          <Trash2 size={14} strokeWidth={2} />
          Clear all data
        </DialogTrigger>
        <DialogContent
          busy={busy}
          width="sm"
          tone="danger"
          title="Clear all data?"
          description="Every record except users and settings is deleted permanently, on whichever database this site is connected to. Enrolled tablets will need a new credential."
          footer={
            <>
              <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>
                Cancel
              </DialogClose>
              <Button type="submit" form="clear-data-form" variant="danger" loading={busy} disabled={!confirmed}>
                {busy ? "Clearing…" : "Clear all data"}
              </Button>
            </>
          }
        >
          <form
            id="clear-data-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmed) return;
              void run(async () => {
                const outcome = await clearAllData(typed);
                setResult(outcome);
                setOpen(false);
                setTyped("");
                if (outcome.ok) router.refresh();
              });
            }}
          >
            <FieldShell id="confirmDelete" label={`Type ${CLEAR_CONFIRMATION} to confirm`}>
              <TextInput
                id="confirmDelete"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </FieldShell>
          </form>
        </DialogContent>
      </Dialog>
      <ResultNotice result={result} />
    </Panel>
  );
}
