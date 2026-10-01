import { z } from "zod";

/**
 * Shared validation shapes for the office recovery server actions (`openRecoveryShift`,
 * `recoverReceipt`, `closeRecoveredShift` in `./actions.ts`). Kept in their own module,
 * not defined inline in `actions.ts`, for two reasons: a `"use server"` file may only
 * export async functions (Next.js refuses any other export from one, so a schema could not
 * live there and still be unit-tested), and these ARE unit-tested directly, in
 * `schemas.test.ts`.
 *
 * Every money field on these schemas -- `stubTotal`, `declaredTotal` -- is PESOS, a decimal
 * string off a paper stub, the same unit `recover_collection`/`office_close_shift`
 * themselves compare against. That is NOT the unit `./months.ts` works in: `UnpaidGroup`'s
 * `outstanding` and `tickedTotal()`'s return are CENTAVOS. The two never mix without an
 * explicit `fromPesos`/`fromCentavos` conversion (see `queries.ts`'s own `centavos()`
 * helper, used only for values read back from the database for display).
 */

export const reason = z.string().trim().min(1, "Write why these receipts are being recovered");
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

/**
 * A required money field, entered in pesos as a decimal string off a stub.
 *
 * `z.coerce.number()` alone turns a blank OR MISSING field into `0`, which
 * `.nonnegative()` happily accepts -- so without refusing that before coercing, an empty
 * "cash handed over" field would silently mean "zero pesos" rather than being refused. On
 * `closeSchema.declaredTotal` that is not a cosmetic bug: it permanently closes the shift
 * with `declared_total = 0` and books the whole system total as the collector's shortage
 * (spec 2026-09-30-office-recovery §4.1: the cash handed over is required, and a real ₱0
 * close must still be reachable by actually typing "0", not by leaving the field empty).
 *
 * The `z.preprocess` folds `null`/`undefined` to `""` before the string check runs, so a
 * field that is entirely absent from the submitted data (as `FormData.get()` returns for
 * one the form never rendered) is refused with this same message, not zod's generic
 * "expected string, received null/undefined" -- callers do not have to remember to
 * normalize `formData.get(...)` themselves.
 */
export function pesosField(message: string) {
  return z.preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.string()
      .trim()
      .min(1, message)
      // `.transform(Number)` + `z.number()`, not `z.coerce.number()`: zod v4's `.pipe()`
      // requires the piped schema's input type to match the previous stage's OUTPUT type
      // (`string` here), and `z.coerce.number()`'s input type is `unknown`, which `.pipe()`
      // refuses at the type level even though it would work at runtime.
      .transform((s) => Number(s))
      .pipe(z.number().nonnegative(message)),
  );
}

export const openSchema = z.object({
  collectorId: z.guid("Choose the collector"),
  deviceId: z.guid("Choose the tablet"),
  businessDate: dateOnly,
  reason,
});

/** `stubTotal` is pesos -- see the module comment. */
export const receiptSchema = z.object({
  shiftId: z.guid(),
  reason,
  bookletId: z.guid("Choose the booklet"),
  orNo: z.coerce.number().int().positive("Enter the serial on the stub"),
  businessDate: dateOnly,
  // Stubs rarely carry a time; blank is allowed and defaulted in actions.ts. `23:59` is the
  // latest valid time of day -- the previous `\d{2}:\d{2}` shape also accepted "99:99".
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time")
    .optional()
    .or(z.literal("")),
  kind: z.enum(["lease", "cash"]),
  // z.guid() validates only a present value: the lease <Select> submits "" (not an absent
  // field) until one is chosen, and the cash-kind branch never renders this field at all
  // (formData.get returns null then). Either way this must read as "not supplied", so
  // actions.ts's own `if (!r.leaseId) return { ok: false, fieldErrors: { leaseId: ... } }`
  // keeps showing "Choose the lease" rather than zod's generic "Invalid GUID" on a blank.
  leaseId: z.preprocess((v) => (v === "" ? undefined : v), z.guid("Choose the lease").optional()),
  // Comma-separated group ranks, e.g. "1,2" -- see tickedRanks() in ./months.
  months: z.string().optional(),
  // Same "blank reads as absent" reasoning as leaseId above.
  feeTypeId: z.preprocess((v) => (v === "" ? undefined : v), z.guid("Choose the fee").optional()),
  rateClass: z.string().optional(),
  // A count, not money -- a blank/missing field coerces to 0, which .positive() already
  // refuses; the explicit message is only so that refusal reads like the rest of the form
  // rather than zod's generic "too small" text.
  quantity: z.coerce.number().int().positive("Enter the quantity").optional(),
  payerRef: z.string().trim().optional(),
  stubTotal: pesosField("Enter the total on the stub"),
});

/** `declaredTotal` is pesos -- see the module comment. */
export const closeSchema = z.object({
  shiftId: z.guid(),
  reason,
  declaredTotal: pesosField("Enter the cash handed over"),
});
