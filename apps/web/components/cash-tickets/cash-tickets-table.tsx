"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { DataColumn } from "@/components/data-table/types";
import { Money } from "@/components/ledger/money";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldShell, TextArea } from "@/components/ui/field";
import { cancelCashTickets } from "@/lib/cash-tickets/actions";
import type { TicketRow } from "@/lib/cash-tickets/queries";

function CancelTicketDialog({ id }: { id: string }) {
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
      const outcome = await cancelCashTickets(id, reason);
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
        title="Cancel cash tickets"
        description="The entry stays on the record, marked cancelled. The shift's total follows."
        footer={
          <>
            <DialogClose className={buttonClass("ghost", "md")} disabled={busy}>Close</DialogClose>
            <Button type="submit" form={`cancel-ticket-${id}`} variant="danger" loading={busy}>
              {busy ? "Cancelling…" : "Cancel entry"}
            </Button>
          </>
        }
      >
        <form id={`cancel-ticket-${id}`} onSubmit={submit}>
          <FieldShell id={`reason-${id}`} label="Reason" error={error ?? undefined}>
            <TextArea id={`reason-${id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldShell>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const columns: DataColumn<TicketRow>[] = [
  { key: "collector", label: "Collector", sortValue: (r) => r.collector, facet: (r) => r.collector, render: (r) => r.collector },
  { key: "fee", label: "Ticket", sortValue: (r) => r.fee, facet: (r) => r.fee, render: (r) => r.fee },
  { key: "serials", label: "Serials", nowrap: true, render: (r) => r.serials ?? <span className="text-ink-3">—</span> },
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
    render: (r) =>
      r.cancelled ? (
        <span className="text-ribbon">Cancelled — {r.cancelReason}</span>
      ) : (
        (r.note ?? <span className="text-ink-3">—</span>)
      ),
  },
  {
    key: "actions",
    label: "",
    align: "right",
    render: (r) => (!r.cancelled && r.shiftStatus !== "remitted" ? <CancelTicketDialog id={r.id} /> : null),
  },
];

export function CashTicketsTable({ rows }: { rows: TicketRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      urlKey="cash-tickets"
      unit="entries"
      rowMuted={(r) => r.cancelled}
      searchPlaceholder="Filter by collector or ticket…"
      empty="No cash tickets entered for this day."
    />
  );
}
