import { describe, expect, it } from "vitest";
import { buildOfficePayload, officeReceiptSchema } from "./schemas";

const base = {
  shiftId: "00000000-0000-0000-0000-000000000001",
  bookletId: "00000000-0000-0000-0000-000000000002",
  orNo: "6320800",
  businessDate: "2026-10-05",
  kind: "fees",
  paymentMode: "cash",
};

describe("officeReceiptSchema / buildOfficePayload", () => {
  it("builds fee lines: keyed amounts as one line, rate lines with quantity", () => {
    const r = officeReceiptSchema.parse({
      ...base,
      lines: JSON.stringify([
        { feeTypeId: "00000000-0000-0000-0000-00000000000a", keyed: true, amount: "1722.00" },
        { feeTypeId: "00000000-0000-0000-0000-00000000000b", keyed: false, rateClass: "hog", quantity: "3" },
      ]),
    });
    expect(buildOfficePayload(r, null)).toMatchObject({
      or_no: 6320800,
      collected_at: "2026-10-05T12:00:00+08:00",
      fee_type_id: "00000000-0000-0000-0000-00000000000a",
      payment_mode: "cash",
      allocations: [],
      lines: [
        { fee_type_id: "00000000-0000-0000-0000-00000000000a", rate_class: "", quantity: 1, amount: "1722.00" },
        { fee_type_id: "00000000-0000-0000-0000-00000000000b", rate_class: "hog", quantity: 3 },
      ],
    });
  });

  it("requires check details for a check", () => {
    const r = officeReceiptSchema.safeParse({ ...base, paymentMode: "check", lines: "[]" });
    expect(r.success).toBe(false);
  });

  it("builds a rent receipt from ticked months", () => {
    const r = officeReceiptSchema.parse({
      ...base, kind: "rent", leaseId: "00000000-0000-0000-0000-000000000003", months: "1,2",
      paymentMode: "check", checkNo: "000123", bank: "LBP", checkDate: "2026-10-05",
    });
    expect(buildOfficePayload(r, "00000000-0000-0000-0000-0000000000ff")).toMatchObject({
      fee_type_id: "00000000-0000-0000-0000-0000000000ff",
      lease_id: "00000000-0000-0000-0000-000000000003",
      allocations: [{ group_rank: 1 }, { group_rank: 2 }],
      lines: [],
      payment_mode: "check",
      check_no: "000123",
    });
  });

  it("refuses a fees receipt with no rows, in a sentence", () => {
    const r = officeReceiptSchema.parse({ ...base, lines: "[]" });
    expect(() => buildOfficePayload(r, null)).toThrow("Add at least one fee");
  });
});
