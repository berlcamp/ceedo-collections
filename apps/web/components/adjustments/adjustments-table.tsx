"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextArea } from "@/components/ui/field";
import { cancelAdjustment } from "@/lib/adjustments/actions";
import type { AdjustmentRow } from "@/lib/adjustments/queries";

function CancelAdjustmentDialog({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Give a reason");
      return;
    }
    setBusy(true);
    try {
      const outcome = await cancelAdjustment(id, reason);
      if (outcome.ok) {
        setOpen(false);
        router.refresh();
      } else setError(outcome.formError ?? "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setReason("");
        }
      }}
    >
      <DialogTrigger className={buttonClass("ghost", "sm", "text-ribbon hover:bg-ribbon-soft hover:text-ribbon")}>
        Cancel
      </DialogTrigger>
      <DialogContent
        busy={busy}
        tone="danger"
        width="sm"
        title="Cancel adjustment"
        description="The adjustment stays on the record, marked cancelled. The monthly summary drops it."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Close</DialogClose>
            <Button type="submit" form={`cancel-adjustment-${id}`} variant="danger" loading={busy}>
              {busy ? "Cancelling…" : "Cancel adjustment"}
            </Button>
          </>
        }
      >
        <form id={`cancel-adjustment-${id}`} onSubmit={submit}>
          <FieldShell id={`reason-${id}`} label="Reason" error={error ?? undefined}>
            <TextArea id={`reason-${id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldShell>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustmentsTable({ rows, canCancel }: { rows: AdjustmentRow[]; canCancel: boolean }) {
  const columns: DataColumn<AdjustmentRow>[] = [
    { key: "account", label: "Account", sortValue: (r) => r.account, facet: (r) => r.account, render: (r) => r.account },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      nowrap: true,
      sortValue: (r) => r.amount,
      render: (r) => <Money amount={r.amount} />,
    },
    {
      key: "note",
      label: "Note",
      render: (r) => (r.cancelled ? <span className="text-ribbon">Cancelled — {r.cancelReason}</span> : r.note),
    },
    { key: "entered", label: "Entered", nowrap: true, render: (r) => `${r.enteredBy} · ${r.enteredOn}` },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (canCancel && !r.cancelled ? <CancelAdjustmentDialog id={r.id} /> : null),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      urlKey="adjustments"
      unit="adjustments"
      rowMuted={(r) => r.cancelled}
      searchPlaceholder="Filter by account or note…"
      empty="No adjustments for this month."
    />
  );
}
