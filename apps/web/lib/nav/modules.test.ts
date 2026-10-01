import { WEB_ROLES } from "@ceedo/shared";
import { describe, expect, it } from "vitest";
import { RESOURCES } from "../admin/resource";
import { RESOURCE_TABS, activeModule, navFor } from "./modules";

describe("nav modules", () => {
  it("files every registered resource under exactly one module", () => {
    // A resource missing here would have a working URL and no way to reach it.
    expect([...RESOURCE_TABS].sort()).toEqual(Object.keys(RESOURCES).sort());
  });

  it("names only resources that exist", () => {
    for (const key of RESOURCE_TABS) expect(RESOURCES[key]).toBeDefined();
  });

  it("offers staff invitations to an admin and nobody else", () => {
    const hrefs = (role: (typeof WEB_ROLES)[number]) =>
      navFor(role).flatMap((s) => s.modules.flatMap((m) => m.tabs.map((t) => t.href)));
    expect(hrefs("admin")).toContain("/staff-invites");
    expect(hrefs("supervisor")).not.toContain("/staff-invites");
    expect(hrefs("accounting")).not.toContain("/staff-invites");
  });

  it("offers Recovery to an admin and nobody else", () => {
    const hrefs = (role: (typeof WEB_ROLES)[number]) =>
      navFor(role).flatMap((s) => s.modules.flatMap((m) => m.tabs.map((t) => t.href)));
    expect(hrefs("admin")).toContain("/ledger/recovery");
    expect(hrefs("supervisor")).not.toContain("/ledger/recovery");
    expect(hrefs("accounting")).not.toContain("/ledger/recovery");
  });

  it("gives every web role a non-empty rail whose modules all have a tab", () => {
    for (const role of WEB_ROLES) {
      const sections = navFor(role);
      expect(sections.length).toBeGreaterThan(0);
      for (const mod of sections.flatMap((s) => s.modules)) {
        expect(mod.tabs.length).toBeGreaterThan(0);
        expect(mod.href).toBe(mod.tabs[0]!.href);
      }
    }
  });

  it("finds the module for a tab, a screen beneath it, and a drill-in", () => {
    const sections = navFor("admin");
    expect(activeModule("/", sections)?.key).toBe("dashboard");
    expect(activeModule("/stalls", sections)?.key).toBe("market");
    expect(activeModule("/ledger/shifts", sections)?.key).toBe("collections");
    expect(activeModule("/reports/daily-abstract", sections)?.key).toBe("reports");
    expect(activeModule("/ledger/leases/abc", sections)?.key).toBe("receivables");
    // "/" matches only itself, or the dashboard would claim every route.
    expect(activeModule("/nowhere", sections)).toBeUndefined();
  });
});
