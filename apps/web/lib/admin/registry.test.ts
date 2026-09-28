import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./registry";
import { RESOURCES } from "./resource";

/**
 * An edit-mode resource submits *every* field on every save, prefilled from the row picker,
 * which is populated by the resource's own `select`. So a field absent from `select` arrives
 * blank and silently overwrites whatever was stored — a data-loss bug with no error anywhere.
 *
 * Nothing in the engine can catch this at runtime without risking a crash in production, so
 * it is caught here instead, before anything ships.
 */
describe("resource registry", () => {
  const all = Object.values(RESOURCES);
  const editable = all.filter((config) => config.writeMode === "edit");

  it("registers every resource under its own key", () => {
    for (const [key, config] of Object.entries(RESOURCES)) {
      expect(config.key).toBe(key);
    }
  });

  it("has at least one edit-mode resource, so the rule below is not vacuous", () => {
    expect(editable.length).toBeGreaterThan(0);
  });

  it.each(editable.map((config) => [config.key, config] as const))(
    "%s: every writable field is retrievable from its select",
    (_key, config) => {
      // Tokenised rather than split on commas: a select may carry joins such as
      // `stalls(stall_no)` and aliases such as `label:full_name`.
      const selected = config.select.match(/[a-z_][a-z0-9_]*/gi) ?? [];
      for (const field of config.fields) {
        expect(selected).toContain(field.name);
      }
    },
  );

  it.each(all.map((config) => [config.key, config] as const))(
    "%s: optionLabel is retrievable from its select",
    (_key, config) => {
      const selected = config.select.match(/[a-z_][a-z0-9_]*/gi) ?? [];
      expect(selected).toContain(config.optionLabel);
    },
  );
});

describe("optional fields", () => {
  // The form posts a blank optional field as null (actions.ts coerce). A schema that
  // refuses null makes the field impossible to leave blank: "expected string, received null".
  it("accept a blank (null) value in every resource's schema", () => {
    const refused: string[] = [];
    for (const config of Object.values(RESOURCES)) {
      const shape = config.schema.shape;
      for (const field of config.fields) {
        const schema = shape[field.name];
        if (!field.optional || !schema) continue;
        if (!z.safeParse(schema, null).success) refused.push(`${config.key}.${field.name}`);
      }
    }
    expect(refused).toEqual([]);
  });
});
