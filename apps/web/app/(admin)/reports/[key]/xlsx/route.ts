import { findReport, ReportInputError } from "@/lib/reports/catalog";
import { readParams } from "@/lib/reports/params";
import { fileName } from "@/lib/reports/report";
import { toXlsx } from "@/lib/reports/xlsx";
import { requireStaff } from "@/lib/supabase/session";

/** The Excel form of `/reports/[key]`, from the same URL parameters. Parent §10. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  await requireStaff();
  const { key } = await params;
  const entry = findReport(key);
  if (!entry) return new Response("No such report.", { status: 404 });

  const search = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const report = await entry.build(readParams(search));
    const body = await toXlsx(report);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName(report.title, report.scope, "xlsx")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (caught) {
    if (caught instanceof ReportInputError) return new Response(caught.message, { status: 400 });
    throw caught;
  }
}
