import ExcelJS from "exceljs";
import { sectionTotals, type Report, type ReportColumn } from "./report";

const MONEY = "#,##0.00;[Red]-#,##0.00";

/**
 * The Excel form of a report. Money goes in as a NUMBER of pesos with a money format, not
 * as text: accounting sums and re-keys these cells, and a figure stored as "1,234.56" text
 * is one they would have to retype. Parent §10.
 */
export async function toXlsx(report: Report): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "CEEDO Collections";
  const sheet = book.addWorksheet(report.title.slice(0, 31));
  const width = Math.max(...report.sections.map((s) => s.columns.length), 1);

  const title = sheet.addRow([report.title]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([report.scope]).font = { italic: true };
  sheet.addRow([]);

  for (const section of report.sections) {
    if (section.title) sheet.addRow([section.title]).font = { bold: true };

    const header = sheet.addRow(section.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.border = { bottom: { style: "thin" } };
    });

    if (section.rows.length === 0) {
      sheet.addRow([section.empty ?? "None."]).font = { italic: true };
    }
    for (const row of section.rows) {
      const added = sheet.addRow(section.columns.map((c) => value(c, row[c.key])));
      format(added, section.columns);
    }

    const totals = sectionTotals(section);
    if (totals) {
      const added = sheet.addRow(
        section.columns.map((c, i) =>
          c.key in totals ? value(c, totals[c.key]!) : i === 0 ? "Total" : null,
        ),
      );
      added.font = { bold: true };
      added.eachCell((cell) => {
        cell.border = { top: { style: "thin" } };
      });
      format(added, section.columns);
    }
    sheet.addRow([]);
  }

  for (const note of report.notes ?? []) sheet.addRow([note]).font = { italic: true, size: 9 };
  if (report.signatures?.length) {
    sheet.addRow([]);
    sheet.addRow(report.signatures.map((s) => `${s.label}: ${s.name ?? "________________"}`));
  }

  const dense = report.sections.some((s) => s.dense);
  for (let i = 1; i <= width; i++) sheet.getColumn(i).width = i === 1 ? 26 : dense ? 10 : 16;
  if (dense) sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 0 }];

  return Buffer.from(await book.xlsx.writeBuffer());
}

function value(column: ReportColumn, raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (column.kind === "money") return Number(raw) / 100;
  if (column.kind === "int") return Number(raw);
  return String(raw);
}

function format(row: ExcelJS.Row, columns: ReportColumn[]) {
  columns.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    if (c.kind === "money") cell.numFmt = MONEY;
    if (c.kind === "money" || c.kind === "int") cell.alignment = { horizontal: "right" };
  });
}
