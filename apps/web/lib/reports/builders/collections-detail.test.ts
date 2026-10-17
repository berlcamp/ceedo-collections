// apps/web/lib/reports/builders/collections-detail.test.ts
import { describe, expect, it } from "vitest";
import { fromPesos } from "@ceedo/shared";
import { sectionTotals, type Report } from "../report";
import {
  collectionsDetailReport, detailType, type DetailFilters, type DetailInput, type DetailLine,
} from "./collections-detail";

const ACCOUNTS: DetailInput["accounts"] = [
  { id: "a-rent", code: "CPM-DR-BAKERY", name: "Bakery Section - Daily Rent", facilityId: "f-pm", sortOrder: 20 },
  { id: "a-occ", code: "CPM-OF-BAKERY", name: "Bakery Section - Occupancy Fee", facilityId: "f-pm", sortOrder: 210 },
  { id: "a-del", code: "CPM-DELIVERY", name: "Public Mall Delivery Fee", facilityId: "f-pm", sortOrder: 400 },
  { id: "a-sur", code: "SUR-PM", name: "Public Mall Rental Surcharge", facilityId: null, sortOrder: 760 },
  { id: "a-cit", code: "CITATION", name: "Citation Ticket", facilityId: null, sortOrder: 950 },
  { id: "a-unc", code: "UNCLASSIFIED", name: "Unclassified", facilityId: null, sortOrder: 9999 },
];

const NO_FILTERS: DetailFilters = { facilityId: null, collectorId: null, accountId: null, tenantId: null, customer: "" };

let seq = 0;
function line(over: Partial<DetailLine> = {}): DetailLine {
  seq += 1;
  return {
    source: "receipt",
    collectionId: `c-${seq}`,
    cashTicketId: null,
    lineId: null,
    orNo: 1000 + seq,
    businessDate: "2026-10-05",
    collectorId: "c-ana",
    leaseId: null,
    payerRef: null,
    feeTypeId: "ft-rent",
    facilityId: "f-pm",
    portion: "base",
    accountId: "a-rent",
    paymentMode: "cash",
    amount: fromPesos(100),
    ...over,
  };
}

const ticket = (over: Partial<DetailLine> = {}): DetailLine =>
  line({ source: "cash_ticket", collectionId: null, cashTicketId: `t-${seq}`, orNo: null, feeTypeId: "ft-cr", ...over });

function input(over: Partial<DetailInput> = {}): DetailInput {
  return {
    month: "2026-10",
    lines: [],
    accounts: ACCOUNTS,
    facilities: [{ id: "f-pm", name: "Public Mall" }, { id: "f-ibjt", name: "IBJT" }],
    collectors: [{ id: "c-ana", name: "Ana Reyes" }, { id: "c-ben", name: "Ben Cruz" }],
    leases: [
      { id: "l-1", tenantId: "t-1", tenantName: "Maria Santos", stallNo: "12" },
      { id: "l-2", tenantId: "t-2", tenantName: "Jose Lim", stallNo: "3" },
    ],
    occupancyFeeTypeIds: ["ft-occ"],
    tenantName: null,
    ...over,
  };
}

const build = (over: Partial<DetailInput> = {}, filters: DetailFilters = NO_FILTERS) =>
  collectionsDetailReport(input(over), filters);
const lines = (r: Report) => r.sections[0]!;
const perTenant = (r: Report) => r.sections[1]!;
const byAccount = (r: Report) => r.sections[2]!;
const total = (r: Report, i: number) => sectionTotals(r.sections[i]!)?.["amount"] ?? 0;

// Every type of line, over two leases, three accounts, two collectors and a cash ticket.
const MIX: DetailLine[] = [
  line({ leaseId: "l-1", orNo: 1001, amount: fromPesos(500) }),
  line({ leaseId: "l-1", orNo: 1001, portion: "surcharge", accountId: "a-sur", amount: fromPesos(15) }),
  line({ leaseId: "l-1", orNo: 1002, lineId: "li-1", feeTypeId: "ft-occ", accountId: "a-occ", amount: fromPesos(200) }),
  line({ leaseId: "l-1", orNo: 1002, lineId: "li-2", feeTypeId: "ft-del", accountId: "a-del", amount: fromPesos(30) }),
  line({ leaseId: "l-2", orNo: 2001, collectorId: "c-ben", amount: fromPesos(250) }),
  line({ orNo: 2002, lineId: "li-3", feeTypeId: "ft-del", accountId: "a-del", collectorId: "c-ben", payerRef: "Victory Liner", amount: fromPesos(40) }),
  ticket({ collectorId: "c-ben", feeTypeId: "ft-cr", accountId: "a-del", amount: fromPesos(60) }),
];

describe("detailType", () => {
  it("tells rental, occupancy, walk-in and cash-ticket lines apart", () => {
    expect(detailType(line({ leaseId: "l-1" }), ["ft-occ"])).toBe("Rental");
    expect(detailType(line({ leaseId: "l-1", portion: "surcharge" }), ["ft-occ"])).toBe("Rental");
    expect(detailType(line({ leaseId: "l-1", lineId: "x", feeTypeId: "ft-occ" }), ["ft-occ"])).toBe("Occupancy");
    expect(detailType(line({ leaseId: "l-1", lineId: "x", feeTypeId: "ft-del" }), ["ft-occ"])).toBe("Walk-in");
    expect(detailType(line({ lineId: "x", feeTypeId: "ft-del" }), ["ft-occ"])).toBe("Walk-in");
    expect(detailType(ticket(), ["ft-occ"])).toBe("Cash ticket");
  });
});

describe("collectionsDetailReport", () => {
  it("is landscape, titled, and scoped to the month", () => {
    const r = build();
    expect(r.title).toBe("Collections detail");
    expect(r.scope).toBe("October 2026");
    expect(r.layout).toBe("landscape");
    expect(r.sections.map((s) => s.sheet)).toEqual(["Lines", "Per tenant", "By account"]);
  });

  it("types and names each line", () => {
    const r = build({
      lines: [
        line({ leaseId: "l-1", orNo: 1 }),
        line({ leaseId: "l-1", orNo: 2, lineId: "li", feeTypeId: "ft-occ", accountId: "a-occ" }),
        line({ orNo: 3, lineId: "li", feeTypeId: "ft-del", accountId: "a-del", payerRef: "  Victory Liner " }),
        line({ orNo: 4, lineId: "li", feeTypeId: "ft-del", accountId: "a-del", payerRef: "   " }),
        ticket(),
      ],
    });
    expect(lines(r).rows.map((row) => [row["type"], row["customer"]])).toEqual([
      ["Rental", "Maria Santos"],
      ["Occupancy", "Maria Santos"],
      ["Walk-in", "Victory Liner"],
      ["Walk-in", "Walk-in"],
      ["Cash ticket", "Walk-in"],
    ]);
    expect(lines(r).rows[0]).toMatchObject({
      date: "2026-10-05", or: "1", facility: "Public Mall", collector: "Ana Reyes",
      account: "Bakery Section - Daily Rent", mode: "Cash", amount: 10000,
    });
  });

  it("orders by date, then OR, with the day's cash tickets after its ORs", () => {
    const r = build({
      lines: [
        line({ orNo: 1002 }),
        line({ orNo: 1001 }),
        ticket({ collectorId: "c-ben" }),
        ticket({ collectorId: "c-ana" }),
        line({ orNo: 900, businessDate: "2026-10-06" }),
      ],
    });
    expect(lines(r).rows.map((row) => [row["or"], row["collector"]])).toEqual([
      ["1001", "Ana Reyes"],
      ["1002", "Ana Reyes"],
      [null, "Ana Reyes"],
      [null, "Ben Cruz"],
      ["900", "Ana Reyes"],
    ]);
  });

  it("shows a split portion as one line per account, summing to the portion", () => {
    const r = build({
      lines: [
        line({ collectionId: "c-split", orNo: 1001, accountId: "a-rent", amount: fromPesos(66.67) }),
        line({ collectionId: "c-split", orNo: 1001, accountId: "a-del", amount: fromPesos(33.33) }),
      ],
    });
    expect(lines(r).rows.map((row) => [row["or"], row["amount"]])).toEqual([["1001", 6667], ["1001", 3333]]);
    expect(byAccount(r).rows.map((row) => [row["account"], row["amount"]])).toEqual([
      ["Bakery Section - Daily Rent", 6667],
      ["Public Mall Delivery Fee", 3333],
    ]);
    expect(total(r, 0)).toBe(10000);
  });

  it("totals Section 1 and Section 3 to the same centavo", () => {
    const r = build({ lines: MIX });
    expect(total(r, 0)).toBe(fromPesos(1095));
    expect(total(r, 2)).toBe(total(r, 0));
  });

  it("splits each lease's month into rent, surcharge, occupancy and other", () => {
    const r = build({ lines: MIX });
    expect(perTenant(r).totalLabel).toBe("Grand total");
    expect(perTenant(r).rows).toEqual([
      { customer: "Jose Lim", facility: "Public Mall", stall: "3", rent: 25000, surcharge: 0, occupancy: 0, other: 0, total: 25000 },
      { customer: "Maria Santos", facility: "Public Mall", stall: "12", rent: 50000, surcharge: 1500, occupancy: 20000, other: 3000, total: 74500 },
    ]);
  });

  it("places a facility-less fee by its account's facility for the facility filter", () => {
    const onDelivery = line({ facilityId: null, lineId: "li", feeTypeId: "ft-del", accountId: "a-del" });
    const onCitation = line({ facilityId: null, lineId: "li", feeTypeId: "ft-cit", accountId: "a-cit" });
    const all = build({ lines: [onDelivery, onCitation] });
    expect(lines(all).rows.map((row) => row["facility"])).toEqual(["Public Mall", null]);

    const pm = build({ lines: [onDelivery, onCitation] }, { ...NO_FILTERS, facilityId: "f-pm" });
    expect(lines(pm).rows.map((row) => row["account"])).toEqual(["Public Mall Delivery Fee"]);
  });

  it("narrows every section by collector, account, tenant and customer", () => {
    const by = (f: Partial<DetailFilters>) => build({ lines: MIX }, { ...NO_FILTERS, ...f });

    const ben = by({ collectorId: "c-ben" });
    expect(lines(ben).rows.every((row) => row["collector"] === "Ben Cruz")).toBe(true);
    expect(lines(ben).rows).toHaveLength(3);

    const occ = by({ accountId: "a-occ" });
    expect(lines(occ).rows.map((row) => row["type"])).toEqual(["Occupancy"]);
    expect(byAccount(occ).rows).toHaveLength(1);

    const lim = by({ tenantId: "t-2" });
    expect(lines(lim).rows.map((row) => row["customer"])).toEqual(["Jose Lim"]);
    expect(perTenant(lim).rows.map((row) => row["customer"])).toEqual(["Jose Lim"]);

    const santos = by({ customer: "SANTOS" });
    expect(new Set(lines(santos).rows.map((row) => row["customer"]))).toEqual(new Set(["Maria Santos"]));
    expect(lines(santos).rows).toHaveLength(4);

    for (const r of [ben, occ, lim, santos]) expect(total(r, 2)).toBe(total(r, 0));
  });

  it("names the filters in the scope", () => {
    const r = collectionsDetailReport(
      input({ tenantName: "Jose Lim" }),
      { facilityId: "f-pm", collectorId: "c-ben", accountId: "a-occ", tenantId: "t-2", customer: "lim" },
    );
    expect(r.scope).toBe(
      "October 2026 · Public Mall · Ben Cruz · Bakery Section - Occupancy Fee · Jose Lim · customer “lim”",
    );
  });

  it("warns when the month holds unclassified money, and not otherwise", () => {
    const r = build({ lines: [line({ accountId: "a-unc", amount: fromPesos(40) })] });
    expect(r.warnings).toEqual([{
      text: "40.00 of this month's collections is on no account (Unclassified).",
      href: "/accounts/unclassified?month=2026-10",
      linkText: "Classify it",
    }]);
    expect(build().warnings ?? []).toEqual([]);
  });

  it("keeps the month's unclassified warning when a filter hides those lines", () => {
    const month = [line({ amount: fromPesos(100) }), line({ facilityId: null, accountId: "a-unc", amount: fromPesos(40) })];
    for (const f of [{ accountId: "a-rent" }, { facilityId: "f-pm" }, { customer: "santos" }]) {
      const r = build({ lines: month }, { ...NO_FILTERS, ...f });
      expect(r.warnings?.map((w) => w.text)).toEqual(["40.00 of this month's collections is on no account (Unclassified)."]);
    }
  });

  it("says what is left out and what reconciles", () => {
    expect(build().notes).toEqual([
      "Cancelled receipts are left out.",
      "With no filters, the total equals the month's column in the Monthly summary before adjustments.",
    ]);
  });

  it("shows an empty state for a month with nothing", () => {
    const r = build();
    expect(r.sections.map((s) => [s.rows.length, s.empty])).toEqual([
      [0, "No collections match."],
      [0, "No tenant paid."],
      [0, "No collections match."],
    ]);
  });
});
