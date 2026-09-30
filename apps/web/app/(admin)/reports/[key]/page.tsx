import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportDocument } from "@/components/reports/report-document";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import { findReport, ReportInputError } from "@/lib/reports/catalog";
import { openExceptions } from "@/lib/reports/data";
import { exceptionsInScope } from "@/lib/reports/open-exceptions";
import { readParams } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * One report, on screen exactly as it prints. The page IS the PDF (parent §10, the same
 * approach as the tenant cards): the toolbar and the rail are `print:hidden`.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const { key } = await params;
  const entry = findReport(key);
  if (!entry) notFound();

  const search = await searchParams;
  const query = new URLSearchParams(
    Object.entries(search).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  ).toString();

  // Only the build is guarded: JSX in a try block reads as if it caught render errors,
  // which it cannot (react-hooks/error-boundaries).
  const reportParams = readParams(search);
  // The Exceptions report lists them itself; a warning above it would say the same thing twice.
  const open =
    entry.key === "exceptions"
      ? []
      : exceptionsInScope(await openExceptions(), entry.params, reportParams);

  let report: Awaited<ReturnType<typeof entry.build>>;
  try {
    report = await entry.build(reportParams);
  } catch (caught) {
    if (!(caught instanceof ReportInputError)) throw caught;
    return (
      <div className="mx-auto max-w-[80rem]">
        <ReportToolbar xlsxHref={null} />
        <p className="rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber">
          {caught.message}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[80rem]">
      <ReportToolbar xlsxHref={`/reports/${key}/xlsx${query ? `?${query}` : ""}`} />
      {/* Screen only: the printed page is the official form. See lib/reports/open-exceptions.ts. */}
      {open.length > 0 ? (
        <p className="mb-4 rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber print:hidden">
          {open.length} unresolved {open.length === 1 ? "exception" : "exceptions"} affecting this
          report — figures may be incomplete. A rejected receipt is not in these totals until
          it is corrected or spoiled, and a correction posts under its original date.{" "}
          <Link href="/ledger/exceptions" className="font-semibold underline">
            Review exceptions
          </Link>
        </p>
      ) : null}
      <ReportDocument
        report={report}
        generatedAt={new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
      />
    </div>
  );
}
