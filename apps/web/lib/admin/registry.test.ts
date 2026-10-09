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

describe("status columns", () => {
  // A value with no entry falls back to plain text, so a new enum value added to a form
  // without a mark here would quietly render unlike its neighbours.
  it("have a mark for every value the form can set", () => {
    const missing: string[] = [];
    for (const config of Object.values(RESOURCES)) {
      for (const column of config.columns) {
        if (!column.status) continue;
        const field = config.fields.find((candidate) => candidate.name === column.key);
        const values =
          field?.type === "boolean" ? ["true", "false"] : (field?.options ?? []).map((o) => o.value);
        for (const value of values) {
          if (!column.status[value]) missing.push(`${config.key}.${column.key}=${value}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

it("lets a non-accruing fee leave 'collected at' blank when it names its facility", () => {
  const schema = RESOURCES["fee-types"].schema;
  const base = { code: "X", name: "X", accrues: false, surcharge_bps: 0, amount_mode: "keyed", active: true };
  expect(schema.safeParse({ ...base, facility_type: null, facility_id: null }).success).toBe(false);
  expect(schema.safeParse({ ...base, facility_type: null, facility_id: "00000000-0000-0000-0000-000000000001" }).success).toBe(true);
});
