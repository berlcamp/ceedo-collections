import { ArrowRight } from "lucide-react";
import { ScreenHeader } from "@/components/shell/screen-header";
import { buttonClass } from "@/components/ui/button";
import { NativeSelect, TextInput } from "@/components/ui/field";
import { getCollectors } from "@/lib/ledger/queries";
import { REPORTS } from "@/lib/reports/catalog";
import { getAccountOptions, getFacilityOptions, getLeaseOptions, getTenantOptions } from "@/lib/reports/options";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Parent §10's report suite. Each report is a plain GET form, so what it opens is a link
 * that can be bookmarked, shared, or exported again later with the same figures.
 */
export default async function ReportsPage() {
  await requireStaff();
  const needs = new Set(REPORTS.flatMap((r) => r.params));
  const [collectors, leases, facilities, accounts, tenants] = await Promise.all([
    needs.has("collector") ? getCollectors() : Promise.resolve([]),
    needs.has("lease") ? getLeaseOptions() : Promise.resolve([]),
    needs.has("facility") ? getFacilityOptions() : Promise.resolve([]),
    needs.has("account") ? getAccountOptions() : Promise.resolve([]),
    needs.has("tenant") ? getTenantOptions() : Promise.resolve([]),
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
              {report.params.includes("asOf") ? (
                <label className="text-xs text-ink-2">
                  As of
                  <TextInput type="date" name="date" defaultValue={today} className="mt-1 w-40" required />
                </label>
              ) : null}
              {report.params.includes("facility") ? (
                <label className="text-xs text-ink-2">
                  Facility
                  <NativeSelect name="facility" className="mt-1 w-52" defaultValue="">
                    <option value="">All facilities</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              {report.params.includes("month") ? (
                <label className="text-xs text-ink-2">
                  Month
                  <TextInput type="month" name="month" defaultValue={today.slice(0, 7)} className="mt-1 w-40" required />
                </label>
              ) : null}
              {report.params.includes("year") ? (
                <label className="text-xs text-ink-2">
                  Year
                  <TextInput
                    type="number"
                    name="year"
                    min={2026}
                    max={2100}
                    step={1}
                    defaultValue={today.slice(0, 4)}
                    className="mt-1 w-28"
                    required
                  />
                </label>
              ) : null}
              {report.params.includes("collector") ? (
                <label className="text-xs text-ink-2">
                  Collector
                  <NativeSelect
                    name="collector"
                    className="mt-1 w-52"
                    required={!report.optional?.includes("collector")}
                    defaultValue=""
                  >
                    {report.optional?.includes("collector") ? (
                      <option value="">All collectors</option>
                    ) : (
                      <option value="" disabled>
                        Choose…
                      </option>
                    )}
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
                  <NativeSelect
                    name="lease"
                    className="mt-1 w-64"
                    required={!report.optional?.includes("lease")}
                    defaultValue=""
                  >
                    {report.optional?.includes("lease") ? (
                      <option value="">All leases</option>
                    ) : (
                      <option value="" disabled>
                        Choose…
                      </option>
                    )}
                    {leases.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              {report.params.includes("account") ? (
                <label className="text-xs text-ink-2">
                  Account
                  <NativeSelect name="account" className="mt-1 w-64" defaultValue="">
                    <option value="">All accounts</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              {report.params.includes("tenant") ? (
                <label className="text-xs text-ink-2">
                  Tenant
                  <NativeSelect name="tenant" className="mt-1 w-52" defaultValue="">
                    <option value="">All tenants</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              {report.params.includes("customer") ? (
                <label className="text-xs text-ink-2">
                  Customer contains
                  <TextInput type="search" name="q" className="mt-1 w-48" maxLength={100} />
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
