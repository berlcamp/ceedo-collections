// apps/web/lib/reports/builders/daily-collection/fixture.ts
import { fromPesos } from "@ceedo/shared";
import type { DailyInput, DailyPortion } from "./types";

/**
 * A trimmed, fictitious 30 September 2026 (spec "Testing"): four collectors, every kind of
 * row the report has to handle. Live totals:
 *   A  600 + 18 (lease 1001) + 1,722 + 34.44 (EBP 2001) + 1,000 (office, check, 2002) = 3,374.44
 *      (OR 1002, 200, is cancelled)
 *   B  825 + 275 (ante 3001, split 75/25) + 30 (terminal 3002) + 50 (unclassified 3003) = 1,180.00
 *   C  nothing (active)
 *   D  3,000 cash tickets (inactive collector, shift not deposited)
 *   E  nothing (inactive): appears nowhere
 * Grand total 7,554.44; checks 1,000.00; deposited 4,554.44; undeposited 3,000.00.
 */
export const ID = {
  colA: "col-a", colB: "col-b", colC: "col-c", colD: "col-d", colE: "col-e",
  shA: "sh-a", shAOffice: "sh-a-office", shB: "sh-b", shD: "sh-d",
  bkA1: "bk-a1", bkA2: "bk-a2", bkB1: "bk-b1",
  facPM: "fac-pm", facIBJT: "fac-ibjt", facSLH: "fac-slh",
  secFish: "sec-fish",
  lease1: "lease-1", lease2: "lease-2",
  ftRent: "ft-rent", ftElec: "ft-elec", ftElecSur: "ft-elec-sur", ftAnte: "ft-ante",
  ftTerminal: "ft-terminal", ftMisc: "ft-misc", ftPmCr: "ft-pm-cr",
  accPmRent: "acc-pm-rent", accPmSur: "acc-pm-sur", accPmCr: "acc-pm-cr", accSlhAnte: "acc-slh-ante",
  accNmis: "acc-nmis", accTf: "acc-tf", accElec: "acc-elec", accElecSur: "acc-elec-sur", accUnc: "acc-unc",
} as const;

const P = (pesos: number) => fromPesos(pesos);

function portion(over: Partial<DailyPortion> & Pick<DailyPortion, "collectorId" | "accountId" | "amount">): DailyPortion {
  return {
    source: "receipt", collectionId: null, cashTicketId: null, lineId: null, orNo: null, bookletId: null,
    shiftId: null, leaseId: null, payerRef: null, feeTypeId: ID.ftRent, facilityId: null, sectionId: null,
    rateClass: null, quantity: null, paymentMode: "cash", cancelled: false, ...over,
  };
}

export function sept30(): DailyInput {
  const a = { collectorId: ID.colA, shiftId: ID.shA };
  const b = { collectorId: ID.colB, shiftId: ID.shB, bookletId: ID.bkB1 };
  return {
    date: "2026-09-30",
    portions: [
      // A, booklet A1: a lease receipt (base + surcharge), then a cancelled one.
      portion({ ...a, collectionId: "c1", orNo: 1001, bookletId: ID.bkA1, leaseId: ID.lease1,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent, amount: P(600) }),
      portion({ ...a, collectionId: "c1", orNo: 1001, bookletId: ID.bkA1, leaseId: ID.lease1,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmSur, amount: P(18) }),
      portion({ ...a, collectionId: "c2", orNo: 1002, bookletId: ID.bkA1, leaseId: ID.lease2,
        facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent, amount: P(200), cancelled: true }),
      // A, booklet A2: electricity bill + its surcharge on one OR, then an office receipt by check.
      portion({ ...a, collectionId: "c3", lineId: "l3a", orNo: 2001, bookletId: ID.bkA2, payerRef: "Stall F-9",
        feeTypeId: ID.ftElec, facilityId: ID.facPM, accountId: ID.accElec, amount: P(1722) }),
      portion({ ...a, collectionId: "c3", lineId: "l3b", orNo: 2001, bookletId: ID.bkA2, payerRef: "Stall F-9",
        feeTypeId: ID.ftElecSur, facilityId: ID.facPM, accountId: ID.accElecSur, amount: P(34.44) }),
      portion({ collectorId: ID.colA, shiftId: ID.shAOffice, collectionId: "c4", orNo: 2002, bookletId: ID.bkA2,
        leaseId: ID.lease1, facilityId: ID.facPM, sectionId: ID.secFish, accountId: ID.accPmRent,
        paymentMode: "check", amount: P(1000) }),
      // B, booklet B1: ante-mortem split 75/25, a terminal fee, an unclassified fee.
      portion({ ...b, collectionId: "c5", lineId: "l5", orNo: 3001, payerRef: "Owner One", feeTypeId: ID.ftAnte,
        facilityId: ID.facSLH, rateClass: "Hog", quantity: 2, accountId: ID.accSlhAnte, amount: P(825) }),
      portion({ ...b, collectionId: "c5", lineId: "l5", orNo: 3001, payerRef: "Owner One", feeTypeId: ID.ftAnte,
        facilityId: ID.facSLH, rateClass: "Hog", quantity: 2, accountId: ID.accNmis, amount: P(275) }),
      portion({ ...b, collectionId: "c6", lineId: "l6", orNo: 3002, payerRef: "KVX 123", feeTypeId: ID.ftTerminal,
        facilityId: ID.facIBJT, rateClass: "RTMI", quantity: 1, accountId: ID.accTf, amount: P(30) }),
      portion({ ...b, collectionId: "c7", lineId: "l7", orNo: 3003, feeTypeId: ID.ftMisc,
        facilityId: ID.facPM, accountId: ID.accUnc, amount: P(50) }),
      // D: cash tickets on a shift not yet deposited.
      portion({ source: "cash_ticket", cashTicketId: "ct1", collectorId: ID.colD, shiftId: ID.shD,
        feeTypeId: ID.ftPmCr, facilityId: ID.facPM, accountId: ID.accPmCr, amount: P(3000) }),
    ],
    accounts: [
      { id: ID.accPmRent, code: "CPM-DR-FRESHFISH", name: "Fresh Fish Section - Daily Rent", sortOrder: 80, treasurerLineId: "tl-pm", rcdColumnId: "rc-pm" },
      { id: ID.accPmCr, code: "CPM-CR", name: "City Public Mall CR", sortOrder: 380, treasurerLineId: "tl-pm-cr", rcdColumnId: "rc-pm" },
      { id: ID.accTf, code: "IBJT-TF-RTMI", name: "Terminal Fee - RTMI", sortOrder: 600, treasurerLineId: "tl-ibjt", rcdColumnId: "rc-ibjt" },
      { id: ID.accSlhAnte, code: "SLH-ANTE", name: "Ante Mortem", sortOrder: 660, treasurerLineId: "tl-slh", rcdColumnId: "rc-slh" },
      { id: ID.accPmSur, code: "SUR-RENT-CPM", name: "Public Mall Rental Surcharge", sortOrder: 760, treasurerLineId: "tl-other", rcdColumnId: "rc-sur" },
      { id: ID.accElecSur, code: "SUR-ELEC-CPM", name: "Public Mall Electricity Surcharge", sortOrder: 790, treasurerLineId: "tl-elec-sur", rcdColumnId: "rc-elec-sur" },
      { id: ID.accNmis, code: "NI-NMIS", name: "Ante Mortem/Post-Mortem NMIS", sortOrder: 930, treasurerLineId: "tl-nmis", rcdColumnId: "rc-nmis" },
      { id: ID.accElec, code: "NI-ELEC-CPM", name: "Public Mall Electricity", sortOrder: 960, treasurerLineId: "tl-elec", rcdColumnId: "rc-elec" },
      { id: ID.accUnc, code: "UNCLASSIFIED", name: "Unclassified", sortOrder: 99999, treasurerLineId: "tl-other", rcdColumnId: "rc-other" },
    ],
    treasurerLines: [
      { id: "tl-slh", code: "TL_SLH", name: "Slaughterhouse fees", sortOrder: 10, subtotalGroup: 1, active: true },
      { id: "tl-pm", code: "TL_PM", name: "Public Mall stall rentals/misc", sortOrder: 20, subtotalGroup: 1, active: true },
      { id: "tl-pm-cr", code: "TL_PM_CR", name: "Public Mall CR", sortOrder: 30, subtotalGroup: 1, active: true },
      { id: "tl-ibjt", code: "TL_IBJT", name: "IBJT stall rentals/parking/misc", sortOrder: 40, subtotalGroup: 1, active: true },
      { id: "tl-cem", code: "TL_CEM", name: "Public cemetery", sortOrder: 70, subtotalGroup: 1, active: true },
      { id: "tl-other", code: "TL_OTHER", name: "Other collections", sortOrder: 110, subtotalGroup: 1, active: true },
      { id: "tl-nmis", code: "TL_NMIS", name: "Ante/post-mortem fees", sortOrder: 200, subtotalGroup: 2, active: true },
      { id: "tl-elec", code: "TL_ELEC", name: "Electricity bill payments", sortOrder: 210, subtotalGroup: 2, active: true },
      { id: "tl-elec-sur", code: "TL_ELEC_SUR", name: "Surcharges on electricity bill payments", sortOrder: 220, subtotalGroup: 2, active: true },
    ],
    rcdColumns: [
      { id: "rc-pm", code: "RC_PM", name: "Public Mall", sortOrder: 10, active: true },
      { id: "rc-sur", code: "RC_SUR", name: "Surcharges – stall rentals", sortOrder: 20, active: true },
      { id: "rc-slh", code: "RC_SLH", name: "Slaughterhouse", sortOrder: 30, active: true },
      { id: "rc-nmis", code: "RC_NMIS", name: "Ante/post-mortems", sortOrder: 40, active: true },
      { id: "rc-ibjt", code: "RC_IBJT", name: "IBJT", sortOrder: 50, active: true },
      { id: "rc-cem", code: "RC_CEM", name: "Public cemetery", sortOrder: 70, active: true },
      { id: "rc-elec", code: "RC_ELEC", name: "Electricity bill payments", sortOrder: 100, active: true },
      { id: "rc-elec-sur", code: "RC_ELEC_SUR", name: "Surcharges – electricity", sortOrder: 110, active: true },
      { id: "rc-other", code: "RC_OTHER", name: "Other collections", sortOrder: 120, active: true },
    ],
    shifts: [
      { id: ID.shA, deposit: { on: "2026-10-01", verified: true } },
      { id: ID.shAOffice, deposit: { on: "2026-10-02", verified: true } },
      { id: ID.shB, deposit: { on: "2026-10-01", verified: false } },
      { id: ID.shD, deposit: null },
    ],
    collectors: [
      { id: ID.colA, name: "Collector A", active: true },
      { id: ID.colB, name: "Collector B", active: true },
      { id: ID.colC, name: "Collector C", active: true },
      { id: ID.colD, name: "Collector D", active: false },
      { id: ID.colE, name: "Collector E", active: false },
    ],
    facilities: [
      { id: ID.facPM, name: "Public Mall", type: "market" },
      { id: ID.facIBJT, name: "IBJT", type: "terminal" },
      { id: ID.facSLH, name: "Slaughterhouse", type: "slaughterhouse" },
    ],
    sections: [{ id: ID.secFish, name: "Fresh Fish" }],
    feeTypes: [
      { id: ID.ftRent, name: "Market stall rental (daily)" },
      { id: ID.ftElec, name: "Electricity bill payment (Public Mall)" },
      { id: ID.ftElecSur, name: "Electricity surcharge (Public Mall)" },
      { id: ID.ftAnte, name: "Ante-mortem fee" },
      { id: ID.ftTerminal, name: "Terminal fee" },
      { id: ID.ftMisc, name: "Miscellaneous fee" },
      { id: ID.ftPmCr, name: "PM CR cash ticket" },
    ],
    booklets: [
      { id: ID.bkA1, label: "A1" },
      { id: ID.bkA2, label: "A2" },
      { id: ID.bkB1, label: "B1" },
    ],
    leases: [
      { id: ID.lease1, tenantName: "Tenant One", stallNo: "F-1" },
      { id: ID.lease2, tenantName: "Tenant Two", stallNo: "F-2" },
    ],
    rentCover: [
      { collectionId: "c1", allocated: P(618), periods: [
        { start: "2026-09-27", end: "2026-09-27" }, { start: "2026-09-28", end: "2026-09-28" },
        { start: "2026-09-29", end: "2026-09-29" }, { start: "2026-09-30", end: "2026-09-30" },
      ] },
      { collectionId: "c2", allocated: P(200), periods: [{ start: "2026-09-30", end: "2026-09-30" }] },
      { collectionId: "c4", allocated: P(800), periods: [{ start: "2026-10-01", end: "2026-10-05" }] },
    ],
    cashTickets: [{ id: "ct1", ticketFrom: 1, ticketTo: 600, note: null }],
    signatories: [
      { label: "Prepared by", name: "Signer One", title: "LRCO-I" },
      { label: "Noted by", name: null, title: null },
    ],
    unclassifiedAccountId: ID.accUnc,
  };
}
