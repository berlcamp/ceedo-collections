#!/usr/bin/env node
/**
 * Emits supabase/functions/_shared/contract.ts from packages/shared/src/sync-contract.ts.
 *
 * WHY GENERATE RATHER THAN IMPORT. Phase 3a's D1 kept @ceedo/shared off the Edge Functions'
 * critical path on purpose: resolving a pnpm workspace package from Deno is real friction,
 * and D1 judged it not worth putting in front of every Function.
 *
 * WHY GENERATE RATHER THAN HAND-COPY. The contract is the one file in this repo whose whole
 * purpose is being identical on both ends. A hand-maintained duplicate would replace a
 * validation gap with a drift hazard, which is the worse trade -- the gap is visible in a
 * grep, the drift is visible only when a device starts rejecting valid responses.
 *
 * So: one source, a generated copy, and a test that fails when the copy is stale. Drift
 * becomes a red build rather than a silent divergence.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "packages/shared/src/sync-contract.ts");
const TARGET = join(root, "supabase/functions/_shared/contract.ts");

const HEADER = `// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`pnpm edge:contract\` to regenerate from packages/shared/src/sync-contract.ts, which
// is the only source of truth for this contract. tests/http/contract-validation.test.ts
// fails if this copy is stale.
`;

let source = readFileSync(SOURCE, "utf8");

// Two rewrites, and only two. Everything else is copied byte for byte, so a change to the
// contract's meaning cannot be introduced here by accident.
//
//   1. zod resolves from npm: under Deno rather than from node_modules.
//   2. reason-codes.ts is a sibling in packages/shared, so its relative import must become
//      an inline copy -- Deno has no node_modules to walk up into.
//
// Each replacement is checked rather than assumed: a silently-unmatched regex would emit a
// file that looks right and cannot run.
function replaceOnce(text, pattern, replacement, what) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags + "g"));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${what} in sync-contract.ts, found ${matches?.length ?? 0}. ` +
        "The generator's assumption about that file's shape is wrong -- fix the generator " +
        "rather than the generated copy.",
    );
  }
  return text.replace(pattern, replacement);
}

source = replaceOnce(
  source,
  /^import \{ z \} from "zod";$/m,
  'import { z } from "npm:zod@4";',
  "zod import",
);

const reasonCodes = readFileSync(
  join(root, "packages/shared/src/reason-codes.ts"),
  "utf8",
);
const REJECT_REASONS = reasonCodes.match(
  /export const REJECT_REASONS = \[[\s\S]*?\] as const;/,
);
if (!REJECT_REASONS) {
  throw new Error(
    "Could not find REJECT_REASONS in reason-codes.ts. The generator's assumption about " +
      "that file's shape is wrong -- fix the generator rather than the source.",
  );
}

source = replaceOnce(
  source,
  /^import \{ REJECT_REASONS, type RejectReason \} from "\.\/reason-codes";$/m,
  `${REJECT_REASONS[0]}\ntype RejectReason = (typeof REJECT_REASONS)[number];`,
  "reason-codes import",
);

// `export type { RejectReason };` at the foot of the source needs NO rewrite: the inlined
// `type RejectReason = ...` above is a local declaration, and re-exporting a local type is
// exactly what that line already does.

writeFileSync(TARGET, HEADER + source);
console.log(`Wrote ${TARGET}`);
