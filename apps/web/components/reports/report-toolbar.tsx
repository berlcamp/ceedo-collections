"use client";

import Link from "next/link";
import { ChevronLeft, FileSpreadsheet, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

/** Never printed. "Print or save as PDF" is Chrome's own dialog: choose Save as PDF there. */
export function ReportToolbar({ xlsxHref }: { xlsxHref: string | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <Link
        href="/reports"
        className="mr-auto inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <ChevronLeft size={13} strokeWidth={2} />
        All reports
      </Link>
      {xlsxHref ? (
        // A plain link, not fetch(): the browser handles the download and its file name.
        <a href={xlsxHref} className={buttonClass("secondary", "md")}>
          <FileSpreadsheet size={14} strokeWidth={2} />
          Download Excel
        </a>
      ) : null}
      <Button variant="primary" onClick={() => window.print()}>
        <Printer size={14} strokeWidth={2} />
        Print or save as PDF
      </Button>
    </div>
  );
}
