import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toSaveResult } from "./save-result.js";

const schema = z.object({ code: z.string().min(1), name: z.string().min(1) });

describe("toSaveResult", () => {
  it("returns field errors from a failed parse", () => {
    const parsed = schema.safeParse({ code: "", name: "Market" });
    expect(toSaveResult(parsed, null)).toEqual({
      ok: false,
      fieldErrors: { code: expect.any(String) },
    });
  });

  it("maps a unique-violation to a readable form error", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "23505", message: "duplicate key" });
    expect(result).toMatchObject({ ok: false });
    expect((result as { formError: string }).formError).toMatch(/already exists/i);
  });

  it("maps a check-constraint violation to its database message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, {
      code: "23514",
      message: "Sections may only belong to a market facility, not terminal",
    });
    expect((result as { formError: string }).formError).toMatch(/market facility/);
  });

  it("maps an exclusion-constraint violation to an overlap message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "23P01", message: "conflicting key value" });
    expect((result as { formError: string }).formError).toMatch(/overlaps/i);
  });

  it("maps a permission denial to an access message", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    const result = toSaveResult(parsed, { code: "42501", message: "permission denied" });
    expect((result as { formError: string }).formError).toMatch(/permission/i);
  });

  it("returns ok when the parse succeeds and there is no database error", () => {
    const parsed = schema.safeParse({ code: "CPM", name: "Market" });
    expect(toSaveResult(parsed, null, "new-id")).toEqual({ ok: true, id: "new-id" });
  });
});
