import { pesos, sectionTotals, type Cell, type Report, type ReportColumn } from "@/lib/reports/report";

/**
 * The printable form of a report, and what "Save as PDF" in Chrome produces. Parent §10
 * asks for PDF; like the tenant cards (§9.1), that is a print layout rather than a PDF
 * library. Black on white, A4 landscape, figures right-aligned in tabular numerals.
 */
export function ReportDocument({ report, generatedAt }: { report: Report; generatedAt: string }) {
  return (
    <article className="bg-white px-8 py-7 text-black shadow-sm ring-1 ring-rule print:p-0 print:shadow-none print:ring-0">
      <style>{`@page { size: A4 landscape; margin: 12mm; }`}</style>

      <header className="mb-5 border-b-2 border-black pb-3">
        <p className="text-xs uppercase tracking-wider">City Economic Enterprise and Development Office</p>
        <h1 className="text-xl font-bold">{report.title}</h1>
        <p className="text-sm">{report.scope}</p>
      </header>

      {report.sections.map((section, i) => {
        const totals = sectionTotals(section);
        return (
          <section key={i} className="mb-6 break-inside-avoid-page">
            {section.title ? (
              <h2 className="mb-1.5 text-sm font-bold uppercase tracking-wide">{section.title}</h2>
            ) : null}
            {section.rows.length === 0 ? (
              <p className="border-y border-black/40 py-2 text-sm italic">{section.empty ?? "None."}</p>
            ) : (
              <table className="w-full border-collapse text-[12px] leading-snug">
                <thead className="table-header-group">
                  <tr className="border-y border-black">
                    {section.columns.map((c) => (
                      <th
                        key={c.key}
                        className={`px-1.5 py-1 font-semibold ${numeric(c) ? "text-right" : "text-left"}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, r) => (
                    <tr key={r} className="break-inside-avoid border-b border-black/15">
                      {section.columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-1.5 py-0.5 ${numeric(c) ? "text-right tabular-nums" : ""}`}
                        >
                          {show(c, row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totals ? (
                  <tfoot>
                    <tr className="border-y-2 border-black font-bold">
                      {section.columns.map((c, n) => (
                        <td
                          key={c.key}
                          className={`px-1.5 py-1 ${numeric(c) ? "text-right tabular-nums" : ""}`}
                        >
                          {c.key in totals ? show(c, totals[c.key]!) : n === 0 ? "Total" : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            )}
          </section>
        );
      })}

      {report.notes?.length ? (
        <ul className="mb-4 space-y-0.5 text-[11px] italic">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {report.signatures?.length ? (
        <div className="mt-10 grid grid-cols-2 gap-x-16 gap-y-10 break-inside-avoid">
          {report.signatures.map((s) => (
            <div key={s.label}>
              <p className="text-xs">{s.label}</p>
              <p className="mt-8 border-t border-black pt-1 text-center text-sm font-semibold">
                {s.name ?? " "}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-6 text-[10px] text-black/60">Generated {generatedAt} · CEEDO Collections</p>
    </article>
  );
}

function numeric(c: ReportColumn) {
  return c.kind === "money" || c.kind === "int";
}

function show(c: ReportColumn, value: Cell | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (c.kind === "money") return pesos(Number(value));
  if (c.kind === "int") return Number(value).toLocaleString("en-PH");
  return String(value);
}
