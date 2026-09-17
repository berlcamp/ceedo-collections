import { describe, expect, it } from "vitest";
import {
  canManageMasterData,
  canResolveExceptions,
  canUseWeb,
  canVerifyRemittance,
  canViewReports,
  ROLES,
} from "./roles.js";

describe("role predicates", () => {
  it("keeps collectors out of the web application", () => {
    expect(canUseWeb("collector")).toBe(false);
  });

  it("admits supervisors, accounting and admins to the web application", () => {
    expect(canUseWeb("supervisor")).toBe(true);
    expect(canUseWeb("accounting")).toBe(true);
    expect(canUseWeb("admin")).toBe(true);
  });

  it("restricts master data to admins", () => {
    expect(ROLES.filter(canManageMasterData)).toEqual(["admin"]);
  });

  it("allows supervisors and admins to resolve exceptions", () => {
    expect(ROLES.filter(canResolveExceptions)).toEqual(["supervisor", "admin"]);
  });

  it("hides reports from collectors only", () => {
    expect(ROLES.filter((role) => !canViewReports(role))).toEqual(["collector"]);
  });

  it("allows accounting and admins to verify remittance", () => {
    expect(ROLES.filter(canVerifyRemittance)).toEqual(["accounting", "admin"]);
  });
});
