import { z } from "zod";
import { dateOnly } from "../recovery/schemas";
import { tickedRanks } from "../recovery/months";

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const dayPickerSchema = z.object({
  collectorId: z.guid("Choose the officer"),
  businessDate: dateOnly,
});

const lineSchema = z.object({
  feeTypeId: z.guid("Choose the fee"),
  keyed: z.boolean(),
  rateClass: z.string().optional(),
  quantity: z.coerce.number().int().positive("Enter the quantity").optional(),
  amount: z.string().optional(),
});

export const officeReceiptSchema = z
  .object({
    shiftId: z.guid(),
    bookletId: z.guid("Choose the booklet"),
    orNo: z.coerce.number().int().positive("Enter the OR number"),
    businessDate: dateOnly,
    kind: z.enum(["rent", "fees"]),
    leaseId: z.preprocess(blankToUndefined, z.guid().optional()),
    months: z.string().optional(),
    // The fee rows, serialised by the form: a variable-length list does not fit FormData's flat keys.
    lines: z.string().optional(),
    payerRef: z.string().trim().optional(),
    paymentMode: z.enum(["cash", "check"]),
    checkNo: z.preprocess(blankToUndefined, z.string().trim().optional()),
    bank: z.preprocess(blankToUndefined, z.string().trim().optional()),
    checkDate: z.preprocess(blankToUndefined, dateOnly.optional()),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMode === "check") {
      for (const key of ["checkNo", "bank", "checkDate"] as const) {
        if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required for a check" });
      }
    }
    if (v.kind === "rent" && !v.leaseId) ctx.addIssue({ code: "custom", path: ["leaseId"], message: "Choose the lease" });
  });

export type OfficeReceipt = z.infer<typeof officeReceiptSchema>;

/** Throws a sentence for the form when the rows are unusable. `rentFeeTypeId` is the lease's rental fee type (rent kind only). */
export function buildOfficePayload(r: OfficeReceipt, rentFeeTypeId: string | null): Record<string, unknown> {
  const check =
    r.paymentMode === "check" ? { check_no: r.checkNo, bank: r.bank, check_date: r.checkDate } : {};
  const common = {
    or_no: r.orNo,
    booklet_id: r.bookletId,
    // Noon Manila keeps the receipt inside its business day.
    collected_at: `${r.businessDate}T12:00:00+08:00`,
    payer_ref: r.payerRef || null,
    payment_mode: r.paymentMode,
    ...check,
  };

  if (r.kind === "rent") {
    const ranks = tickedRanks((r.months ?? "").split(",").filter(Boolean).map(Number));
    return { ...common, fee_type_id: rentFeeTypeId, lease_id: r.leaseId, allocations: ranks.map((group_rank) => ({ group_rank })), lines: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(r.lines || "[]");
  } catch {
    throw new Error("The fee rows could not be read");
  }
  const parsed = z.array(lineSchema).min(1, "Add at least one fee").safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const rows = parsed.data;
  const lines = rows.map((l) =>
    l.keyed
      ? { fee_type_id: l.feeTypeId, rate_class: "", quantity: 1, amount: l.amount ?? "" }
      : { fee_type_id: l.feeTypeId, rate_class: l.rateClass ?? "", quantity: l.quantity ?? 0 },
  );
  // An occupancy fee names the lease that paid it; such a receipt allocates to no charge.
  return { ...common, fee_type_id: rows[0].feeTypeId, lease_id: r.leaseId ?? null, allocations: [], lines };
}
