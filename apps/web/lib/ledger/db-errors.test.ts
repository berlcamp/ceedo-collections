import { describe, expect, it } from "vitest";
import { isMissingRelationError } from "./db-errors";

describe("isMissingRelationError", () => {
  it("treats PostgREST's missing-relation code as a missing relation", () => {
    expect(isMissingRelationError({ code: "PGRST205" })).toBe(true);
  });

  it("treats Postgres's own undefined_table code as a missing relation", () => {
    expect(isMissingRelationError({ code: "42P01" })).toBe(true);
  });

  it("does not treat an unrelated error code as a missing relation", () => {
    expect(isMissingRelationError({ code: "42501" })).toBe(false);
  });

  it("does not treat a null error as a missing relation", () => {
    expect(isMissingRelationError(null)).toBe(false);
  });

  it("does not treat an error with no code as a missing relation", () => {
    expect(isMissingRelationError({})).toBe(false);
  });
});
