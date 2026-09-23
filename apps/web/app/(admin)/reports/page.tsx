import { ArrowRight } from "lucide-react";
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { NativeSelect, TextInput } from "@/components/ui/field";
import { getCollectors } from "@/lib/ledger/queries";
import { REPORTS } from "@/lib/reports/catalog";
import { getLeaseOptions } from "@/lib/reports/options";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Parent §10's report suite. Each report is a plain GET form, so what it opens is a link
 * that can be bookmarked, shared, or exported again later with the same figures.
 */
export default async function ReportsPage() {
  await requireStaff();
  const needs = new Set(REPORTS.flatMap((r) => r.params));
  const [collectors, leases] = await Promise.all([
    needs.has("collector") ? getCollectors() : Promise.resolve([]),
    needs.has("lease") ? getLeaseOptions() : Promise.resolve([]),
  ]);
  const today = manilaToday();

  return (
    <div>
      <ScreenHeader
        title="Reports"
        note="Every report opens as a printable page. Print it, save it as PDF from the print dialog, or download it as Excel."
      />
      <ul className="grid gap-3 lg:grid-cols-2">
        {REPORTS.map((report) => (
          <li key={report.key} className="rounded-xl border border-rule bg-tape-raised p-4">
            <h2 className="text-sm font-semibold text-ink">{report.title}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{report.purpose}</p>
            <form action={`/reports/${report.key}`} className="mt-3 flex flex-wrap items-end gap-2">
              {report.params.includes("date") ? (
                <label className="text-xs text-ink-2">
                  Date
                  <TextInput type="date" name="date" defaultValue={today} className="mt-1 w-40" required />
                </label>
              ) : null}
              {report.params.includes("month") ? (
                <label className="text-xs text-ink-2">
                  Month
                  <TextInput type="month" name="month" defaultValue={today.slice(0, 7)} className="mt-1 w-40" required />
                </label>
              ) : null}
              {report.params.includes("collector") ? (
                <label className="text-xs text-ink-2">
                  Collector
                  <NativeSelect name="collector" className="mt-1 w-52" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {collectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              {report.params.includes("lease") ? (
                <label className="text-xs text-ink-2">
                  Lease
                  <NativeSelect name="lease" className="mt-1 w-64" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {leases.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              <button type="submit" className={buttonClass("primary", "md", "ml-auto")}>
                Open
                <ArrowRight size={14} strokeWidth={2} />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
