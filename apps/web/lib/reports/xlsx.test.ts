import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fromCentavos } from "@ceedo/shared";
import { cellText, fileName, pesos, sectionTotals, type Report } from "./report";
import { toXlsx } from "./xlsx";

const report: Report = {
  title: "Abstract of Collections",
  scope: "September 2026",
  sections: [
    {
      title: "By fee type",
      columns: [
        { key: "fee", label: "Fee type", kind: "text" },
        { key: "count", label: "Receipts", kind: "int", total: true },
        { key: "amount", label: "Amount", kind: "money", total: true },
      ],
      rows: [
        { fee: "Market stall rental", count: 2, amount: fromCentavos(555_000) },
        { fee: "Terminal fee", count: 1, amount: fromCentavos(4_550) },
      ],
    },
    { title: "Spoiled", columns: [{ key: "or", label: "OR", kind: "int" }], rows: [], empty: "No spoiled forms." },
  ],
  signatures: [{ label: "Certified correct" }],
};

async function readBack(buffer: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = book.worksheets[0]!;
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1)));
  return { sheet, rows };
}

describe("toXlsx", () => {
  it("writes money as numbers of pesos, in a money format, so accounting can sum them", async () => {
    const { sheet, rows } = await readBack(await toXlsx(report));
    const rental = rows.find((r) => r[0] === "Market stall rental")!;
    expect(rental).toEqual(["Market stall rental", 2, 5550]);

    let formatted = false;
    sheet.eachRow((row) => {
      const cell = row.getCell(3);
      if (cell.value === 5550) formatted = cell.numFmt.startsWith("#,##0.00");
    });
    expect(formatted).toBe(true);
  });

  it("adds a totals row computed from the same rows", async () => {
    const { rows } = await readBack(await toXlsx(report));
    expect(rows).toContainEqual(["Total", 3, 5595.5]);
  });

  it("carries the title, the scope, an empty section's message and the signature line", async () => {
    const { rows } = await readBack(await toXlsx(report));
    const text = rows.flat().join(" | ");
    expect(text).toContain("Abstract of Collections");
    expect(text).toContain("September 2026");
    expect(text).toContain("No spoiled forms.");
    expect(text).toContain("Certified correct: ________________");
  });
});

describe("report helpers", () => {
  it("totals only the columns marked for it", () => {
    expect(sectionTotals(report.sections[0]!)).toEqual({ count: 3, amount: 559_550 });
    expect(sectionTotals(report.sections[1]!)).toBeNull();
  });

  it("formats pesos from centavos, negatives included", () => {
    expect(pesos(123_456_78)).toBe("123,456.78");
    expect(pesos(-2_000)).toBe("-20.00");
    expect(pesos(5)).toBe("0.05");
  });

  it("makes a safe download name", () => {
    expect(fileName("RCD", "Maria Santos · 23 Sep 2026", "xlsx")).toBe(
      "rcd-maria-santos-23-sep-2026.xlsx",
    );
  });
});

describe("dense sections", () => {
  it("narrows the columns and freezes the name column", async () => {
    const wide: Report = {
      title: "Monthly tenant payments",
      scope: "October 2026",
      sections: [
        {
          dense: true,
          columns: [
            { key: "tenant", label: "Tenant", kind: "text" },
            { key: "d1", label: "1", kind: "money", total: true },
          ],
          rows: [{ tenant: "A", d1: fromCentavos(20_000) }],
        },
      ],
    };
    const { sheet } = await readBack(await toXlsx(wide));
    expect(sheet.getColumn(1).width).toBe(26);
    expect(sheet.getColumn(2).width).toBe(10);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 1 });
  });
});

describe("cellText", () => {
  const money = { key: "d1", label: "1", kind: "money" as const };
  it("leaves an empty cell blank in a dense grid, so 31 day columns fit an A4 landscape page", () => {
    expect(cellText(money, null, true)).toBe("");
    expect(cellText(money, null, false)).toBe("—");
  });
  it("formats figures the same either way", () => {
    expect(cellText(money, 20_000, true)).toBe("200.00");
    expect(cellText({ key: "n", label: "N", kind: "int" }, 1234, false)).toBe("1,234");
  });
});

describe("styled rows, sheets and layout", () => {
  const styled: Report = {
    title: "Daily Collection Report",
    scope: "30 September 2026",
    layout: "landscape",
    sections: [
      {
        title: "Daily Collection Report",
        sheet: "Treasurer",
        orientation: "portrait",
        columns: [
          { key: "item", label: "Particulars", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [
          { item: "Slaughterhouse fees", amount: 10_000 },
          { item: "Sub-total 1", amount: 10_000, $style: "subtotal" },
          { item: "Electricity", amount: 5_000, $indent: 1 },
          { item: "Grand total", amount: 15_000, $style: "total" },
        ],
      },
      {
        title: "Per collector",
        sheet: "Per collector",
        totalLabel: "Overall total",
        columns: [
          { key: "who", label: "Collector", kind: "text" },
          { key: "amount", label: "Amount", kind: "money", total: true },
        ],
        rows: [{ who: "A", amount: 15_000 }],
      },
    ],
    signatures: [{ label: "Prepared by", name: "Someone", title: "LRCO-I" }],
  };

  it("leaves styled rows out of the section's totals", () => {
    expect(sectionTotals(styled.sections[0]!)).toEqual({ amount: 15_000 });
  });

  it("puts each sheet's sections on their own worksheet", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Treasurer", "Per collector"]);
    expect(book.getWorksheet("Treasurer")!.pageSetup.orientation).toBe("portrait");
    expect(book.getWorksheet("Per collector")!.pageSetup.orientation).toBe("landscape");
    expect(book.getWorksheet("Per collector")!.pageSetup.fitToWidth).toBe(1);
  });

  it("bolds sub-total and total rows, indents, and labels the totals row", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    const treasurer = book.getWorksheet("Treasurer")!;
    let sub: ExcelJS.Row | undefined;
    let indented: ExcelJS.Row | undefined;
    treasurer.eachRow((row) => {
      if (row.getCell(1).value === "Sub-total 1") sub = row;
      if (row.getCell(1).value === "Electricity") indented = row;
    });
    expect(sub!.font?.bold).toBe(true);
    expect(indented!.getCell(1).alignment?.indent).toBe(1);

    const rows: unknown[][] = [];
    book.getWorksheet("Per collector")!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows).toContainEqual(["Overall total", 150]);
  });

  it("prints a signatory's title after the name", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(styled)) as unknown as ArrayBuffer);
    const text: string[] = [];
    book.worksheets.forEach((s) => s.eachRow((row) => text.push((row.values as unknown[]).join(" "))));
    expect(text.join(" | ")).toContain("Prepared by: Someone, LRCO-I");
  });

  it("keeps a report without sheets on one worksheet named after the title", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await toXlsx(report)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Abstract of Collections"]);
  });
});
