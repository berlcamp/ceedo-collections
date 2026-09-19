import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `apps/collector/drizzle` is a COPY of `packages/db-local/drizzle`, made by
 * `pnpm --filter @ceedo/collector sync-migrations`.
 *
 * It is a copy because metro bundles the .sql files through babel-plugin-inline-import,
 * which resolves them relative to the app -- and it is committed because a clean checkout
 * must be able to build the app without anyone remembering a generation step first.
 *
 * Both of those make it the same drift hazard the generated Deno contract would have been,
 * so it gets the same answer: a test that fails when the copy is stale. If this fails, run
 * `pnpm --filter @ceedo/collector sync-migrations` and commit the result. Never edit the
 * copy by hand.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = join(root, "packages/db-local/drizzle");
const COPY = join(root, "apps/collector/drizzle");

function tree(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const key = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) Object.assign(out, tree(full, key));
    else out[key] = readFileSync(full, "utf8");
  }
  return out;
}

describe("the collector app's bundled migrations", () => {
  it("are byte-identical to the generated ones in packages/db-local", () => {
    expect(tree(COPY)).toEqual(tree(SOURCE));
  });
});
