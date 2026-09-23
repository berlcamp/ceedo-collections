"use client";

import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { FacilityOption } from "@/lib/cards/queries";

// Radix Select cannot hold an empty string as an item value.
const ALL = "all";

/** Chooses which cards to print. Never printed itself: the whole bar is `print:hidden`. */
export function CardToolbar({
  facilities,
  facilityId,
  sectionId,
  count,
}: {
  facilities: FacilityOption[];
  facilityId: string | null;
  sectionId: string | null;
  count: number;
}) {
  const router = useRouter();
  const sections = facilities.find((f) => f.id === facilityId)?.sections ?? [];

  function go(next: { facility?: string | null; section?: string | null }) {
    const params = new URLSearchParams();
    if (next.facility) params.set("facility", next.facility);
    if (next.section) params.set("section", next.section);
    const query = params.toString();
    router.push(query ? `/cards?${query}` : "/cards");
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
      <div className="w-56">
        <Select
          value={facilityId ?? ALL}
          onValueChange={(value) => go({ facility: value === ALL ? null : value })}
          options={[
            { value: ALL, label: "All markets" },
            ...facilities.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </div>
      <div className="w-56">
        <Select
          value={sectionId ?? ALL}
          disabled={!facilityId}
          onValueChange={(value) =>
            go({ facility: facilityId, section: value === ALL ? null : value })
          }
          options={[
            { value: ALL, label: "All sections" },
            ...sections.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
      <Button variant="primary" disabled={count === 0} onClick={() => window.print()}>
        <Printer size={14} strokeWidth={2} />
        Print {count} card{count === 1 ? "" : "s"}
      </Button>
    </div>
  );
}
