import { describe, expect, it } from "vitest";
import "./registry.js";
import { RESOURCES } from "./resource.js";

/**
 * The registry is what the generic engine reads to decide whether to render a form and
 * whether to accept a write (apps/web/lib/admin/actions.ts checks `writeRoles` before it
 * touches the database). These assertions are about the two entries where getting it
 * wrong is a security or an operability problem, not a cosmetic one.
 */
describe("admin registry", () => {
  describe("staff (app_users)", () => {
    const users = RESOURCES.users!;

    it("is admin-writable", () => {
      // `writeRoles: []` left an administrator with no way to promote someone, correct a
      // wrong role, or suspend a leaver — the claim trigger only ever fires for someone
      // who signs in again, and a person who has left never will.
      expect(users.writeRoles).toEqual(["admin"]);
    });

    it("updates rather than inserts", () => {
      // The engine was create-only, so admin-writable on its own would have rendered a
      // "New staff member" form that can never succeed — app_users.id references
      // auth.users and has no default. `writeMode: "edit"` picks an existing row instead,
      // and actions.ts refuses the write outright if none was chosen.
      expect(users.writeMode).toBe("edit");
    });

    it("exposes only role and status on the form", () => {
      // `id` references auth.users and the form has no way to supply one; `employee_no`
      // comes from the invite. Neither belongs in an edit form, and the engine coerces
      // exactly the fields listed here — so this list IS the write surface.
      expect(users.fields.map((field) => field.name)).toEqual(["role", "status"]);
      expect(Object.keys(users.schema.shape)).toEqual(["role", "status"]);
    });
  });

  describe("sidebar visibility", () => {
    it("does not offer staff invitations to a supervisor", () => {
      // Migration 0009 makes staff_invites admin-only reading, so the screen can only ever
      // render empty for anyone else — indistinguishable from "there are no invitations".
      expect(RESOURCES["staff-invites"]!.readRoles).toEqual(["admin"]);
    });

    it("gives every resource a readRoles list that excludes collectors", () => {
      // canUseWeb() refuses collectors the web app, and migration 0003's read policy
      // refuses their JWT the rows. A collector in any readRoles list would be a sign the
      // two had drifted apart.
      for (const resource of Object.values(RESOURCES)) {
        expect(resource.readRoles.length, `${resource.key} has no readRoles`).toBeGreaterThan(0);
        expect(resource.readRoles, `${resource.key} offers a collector a screen`).not.toContain(
          "collector",
        );
      }
    });
  });
});
