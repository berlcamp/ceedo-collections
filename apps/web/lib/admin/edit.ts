import type { ResourceConfig } from "./resource";

/**
 * The columns an update may write: everything the form parsed, minus the resource's
 * `lockedOnEdit` fields. The form shows locked fields read-only, but a crafted request could
 * still post them, so this is where they are actually dropped.
 */
export function updatePayload(
  config: Pick<ResourceConfig, "lockedOnEdit">,
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const locked = new Set(config.lockedOnEdit ?? []);
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => !locked.has(key)));
}

/**
 * The list query, widened with any form field it does not already select.
 *
 * A list shows labels (`stalls(stall_no)`), but the edit form needs the raw column
 * (`stall_id`) to preselect the right option. Without this, an edit form would open with
 * its selects blank and save them as blank.
 */
export function selectWithFields(select: string, fieldNames: readonly string[]): string {
  const present = new Set<string>();
  let depth = 0;
  let token = "";
  for (const ch of select + ",") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      const name = token.trim();
      if (/^[a-z_][a-z0-9_]*$/i.test(name)) present.add(name);
      token = "";
    } else {
      token += ch;
    }
  }
  const missing = fieldNames.filter((name) => !present.has(name));
  return missing.length ? `${select}, ${missing.join(", ")}` : select;
}
