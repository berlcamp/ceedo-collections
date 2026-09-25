import { notFound } from "next/navigation";
import { ReportDocument } from "@/components/reports/report-document";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import { findReport, ReportInputError } from "@/lib/reports/catalog";
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
  let report: Awaited<ReturnType<typeof entry.build>>;
  try {
    report = await entry.build(readParams(search));
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
      <ReportDocument
        report={report}
        generatedAt={new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
      />
    </div>
  );
}
