import { describe, expect, it } from "vitest";
import { closeSchema, pesosField, receiptSchema } from "./schemas";

const validClose = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  reason: "Tablet wiped before sync",
  declaredTotal: "500",
};

describe("pesosField (used by closeSchema.declaredTotal and receiptSchema.stubTotal)", () => {
  it("refuses a blank value rather than silently reading it as zero", () => {
    const result = pesosField("Enter the cash handed over").safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Enter the cash handed over");
  });

  it("refuses a missing (null/undefined) value with the same message", () => {
    const missingUndefined = pesosField("Enter the cash handed over").safeParse(undefined);
    const missingNull = pesosField("Enter the cash handed over").safeParse(null);
    expect(missingUndefined.success).toBe(false);
    expect(missingNull.success).toBe(false);
    if (!missingUndefined.success) {
      expect(missingUndefined.error.issues[0].message).toBe("Enter the cash handed over");
    }
    if (!missingNull.success) {
      expect(missingNull.error.issues[0].message).toBe("Enter the cash handed over");
    }
  });

  it("accepts a real zero when it is actually typed", () => {
    const result = pesosField("Enter the cash handed over").safeParse("0");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(0);
  });

  it("refuses a negative amount", () => {
    const result = pesosField("Enter the cash handed over").safeParse("-5");
    expect(result.success).toBe(false);
  });
});

describe("closeSchema.declaredTotal", () => {
  it("refuses a blank declaredTotal with a field error, not a silent zero", () => {
    const result = closeSchema.safeParse({ ...validClose, declaredTotal: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "declaredTotal");
      expect(issue?.message).toBe("Enter the cash handed over");
    }
  });

  it("refuses a missing declaredTotal with a field error", () => {
    const withoutTotal = { shiftId: validClose.shiftId, reason: validClose.reason };
    const result = closeSchema.safeParse(withoutTotal);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "declaredTotal");
      expect(issue?.message).toBe("Enter the cash handed over");
    }
  });

  it("accepts a typed zero", () => {
    const result = closeSchema.safeParse({ ...validClose, declaredTotal: "0" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.declaredTotal).toBe(0);
  });

  it("accepts an ordinary amount", () => {
    const result = closeSchema.safeParse(validClose);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.declaredTotal).toBe(500);
  });
});

const validLeaseReceipt = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  reason: "Tablet wiped before sync",
  bookletId: "22222222-2222-4222-8222-222222222222",
  orNo: "1001",
  businessDate: "2026-09-30",
  kind: "lease" as const,
  stubTotal: "1500",
};

describe("receiptSchema.stubTotal", () => {
  it("refuses a blank stubTotal with a field error, not a silent zero", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, stubTotal: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "stubTotal");
      expect(issue?.message).toBe("Enter the total on the stub");
    }
  });

  it("refuses a missing stubTotal with a field error", () => {
    const withoutTotal = {
      shiftId: validLeaseReceipt.shiftId,
      reason: validLeaseReceipt.reason,
      bookletId: validLeaseReceipt.bookletId,
      orNo: validLeaseReceipt.orNo,
      businessDate: validLeaseReceipt.businessDate,
      kind: validLeaseReceipt.kind,
    };
    const result = receiptSchema.safeParse(withoutTotal);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "stubTotal");
      expect(issue?.message).toBe("Enter the total on the stub");
    }
  });

  it("accepts a typed zero", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, stubTotal: "0" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stubTotal).toBe(0);
  });
});

describe("receiptSchema.quantity", () => {
  it("reads a blank quantity as a refusal, not zero, when present at all", () => {
    const result = receiptSchema.safeParse({
      ...validLeaseReceipt,
      kind: "cash",
      feeTypeId: "33333333-3333-4333-8333-333333333333",
      quantity: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "quantity");
      expect(issue?.message).toBe("Enter the quantity");
    }
  });

  it("is not required at all for a lease receipt", () => {
    const result = receiptSchema.safeParse(validLeaseReceipt);
    expect(result.success).toBe(true);
  });
});

describe("receiptSchema.leaseId", () => {
  it("accepts a valid guid", () => {
    const result = receiptSchema.safeParse({
      ...validLeaseReceipt,
      leaseId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leaseId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("reads a blank leaseId as not supplied, not a refusal", () => {
    // The lease <Select> submits "" until a lease is chosen -- actions.ts's own "Choose the
    // lease" field error is what should fire for that, not zod's generic guid message.
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, leaseId: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leaseId).toBeUndefined();
  });

  it("refuses a malformed, non-blank leaseId", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, leaseId: "not-a-guid" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "leaseId");
      expect(issue).toBeDefined();
    }
  });
});

describe("receiptSchema.feeTypeId", () => {
  it("accepts a valid guid", () => {
    const result = receiptSchema.safeParse({
      ...validLeaseReceipt,
      kind: "cash",
      feeTypeId: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.success).toBe(true);
  });

  it("reads a blank feeTypeId as not supplied, not a refusal", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, feeTypeId: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.feeTypeId).toBeUndefined();
  });

  it("refuses a malformed, non-blank feeTypeId", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, feeTypeId: "not-a-guid" });
    expect(result.success).toBe(false);
  });
});

describe("receiptSchema.time", () => {
  it("accepts a valid time", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, time: "23:59" });
    expect(result.success).toBe(true);
  });

  it("accepts a blank time", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, time: "" });
    expect(result.success).toBe(true);
  });

  it("refuses an hour past 23, which the old \\d{2}:\\d{2} shape let through", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, time: "99:99" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "time");
      expect(issue?.message).toBe("Enter a valid time");
    }
  });

  it("refuses a minute past 59", () => {
    const result = receiptSchema.safeParse({ ...validLeaseReceipt, time: "12:60" });
    expect(result.success).toBe(false);
  });
});
