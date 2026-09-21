"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/select";

/**
 * The collections filter is server-side — it narrows the query, not the rows already in
 * the browser — because `getCollections()` takes these two arguments and a business date
 * bounds what is fetched at all. So it stays in the URL and navigates, where the
 * DataTable's own slip below it works on what came back.
 *
 * The old version was a GET form with a Filter button: choose, click, wait. This applies
 * on change and shows what is currently applied as removable marks, so the state of the
 * screen is legible without re-reading the controls.
 */
export function CollectionsFilter({
  businessDate,
  collectorId,
  collectors,
}: {
  businessDate?: string;
  collectorId?: string;
  collectors: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(next: { businessDate?: string; collectorId?: string }) {
    const params = new URLSearchParams();
    const date = next.businessDate ?? businessDate;
    const collector = next.collectorId ?? collectorId;
    if (date) params.set("businessDate", date);
    if (collector) params.set("collectorId", collector);
    const search = params.toString();
    startTransition(() => {
      router.push(`/ledger/collections${search ? `?${search}` : ""}`);
    });
  }

  const collectorName = collectors.find((collector) => collector.id === collectorId)?.fullName;
  const applied = Boolean(businessDate || collectorId);

  return (
    <div
      className={cn(
        "mb-4 border border-rule bg-tape-raised transition-opacity duration-150",
        pending && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-end gap-3 px-3 py-2.5">
        <div>
          <label htmlFor="businessDate" className="caption mb-1 block text-ink-2">
            Business date
          </label>
          <input
            id="businessDate"
            name="businessDate"
            type="date"
            value={businessDate ?? ""}
            onChange={(event) => apply({ businessDate: event.target.value })}
            className="h-8 rounded-[2px] border border-rule-strong bg-tape-sunk px-2 text-sm text-ink tabular-nums transition-colors duration-150 hover:border-ink-3 focus:border-mark focus:bg-tape-raised"
          />
        </div>

        <div className="min-w-[13rem]">
          <label htmlFor="collectorId" className="caption mb-1 block text-ink-2">
            Collector
          </label>
          <Select
            id="collectorId"
            value={collectorId ?? "__all"}
            onValueChange={(value) => apply({ collectorId: value === "__all" ? "" : value })}
            options={[
              { value: "__all", label: "All collectors" },
              ...collectors.map((collector) => ({ value: collector.id, label: collector.fullName })),
            ]}
            className="h-8"
          />
        </div>

        {applied ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startTransition(() => router.push("/ledger/collections"))}
            className="mb-px"
          >
            <X size={12} strokeWidth={2} />
            Clear
          </Button>
        ) : null}
      </div>

      {applied ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-rule-soft bg-tape px-3 py-1.5">
          <span className="caption text-ink-3">Applied</span>
          {businessDate ? (
            <FilterChip label={`Collected ${businessDate}`} onRemove={() => apply({ businessDate: "" })} />
          ) : null}
          {collectorId ? (
            <FilterChip
              label={collectorName ?? "Selected collector"}
              onRemove={() => apply({ collectorId: "" })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-mark/35 bg-mark-soft py-[3px] pl-2 pr-1 text-xs font-medium text-mark">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="rounded-[2px] p-0.5 transition-colors duration-150 hover:bg-mark/15"
      >
        <X size={11} strokeWidth={2.25} />
      </button>
    </span>
  );
}
