import { describe, expect, it } from "vitest";
import { decideAccess } from "./gate.js";

describe("decideAccess", () => {
  it("refuses a visitor who is not signed in", () => {
    expect(decideAccess(null, null)).toEqual({ allowed: false, reason: "not_signed_in" });
  });

  it("refuses a valid Google account with no app_users row", () => {
    // auth.users is shared across the Supabase project: someone signed in to an
    // unrelated system on the same instance reaches us as a real session.
    expect(decideAccess({ userId: "u1" }, null)).toEqual({
      allowed: false,
      reason: "not_registered",
    });
  });

  it("refuses a suspended member", () => {
    expect(decideAccess({ userId: "u1" }, { role: "admin", status: "suspended" })).toEqual({
      allowed: false,
      reason: "not_registered",
    });
  });

  it("refuses a collector, who belongs on the tablet", () => {
    expect(decideAccess({ userId: "u1" }, { role: "collector", status: "active" })).toEqual({
      allowed: false,
      reason: "role_not_permitted",
    });
  });

  it("admits an active supervisor", () => {
    expect(decideAccess({ userId: "u1" }, { role: "supervisor", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("admits an active admin", () => {
    expect(decideAccess({ userId: "u1" }, { role: "admin", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("admits an active accounting user", () => {
    expect(decideAccess({ userId: "u1" }, { role: "accounting", status: "active" })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });
});
