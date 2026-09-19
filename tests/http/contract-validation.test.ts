import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callFunction } from "../helpers/functions";

/**
 * The server accepted arbitrary JSON until this task. That was survivable -- the SQL
 * enforces both load-bearing refusals independently, post_collection recomputing the amount
 * (invariant 3) and sync_push overriding device_id (invariant 21) -- but a malformed payload
 * reached Postgres and came back as a `server_error` rejection with a raw detail string.
 *
 * These tests use a deliberately invalid CREDENTIAL. Validation must happen BEFORE
 * authentication, so a client learns its payload is malformed without holding a credential;
 * that also means these tests need no fixture and cannot flake on one.
 */
describe("Edge Functions validate their bodies", () => {
  it("refuses a push entry with an unknown type, naming the field", async () => {
    const res = await callFunction("sync-push", {
      credential_id: "nope",
      secret: "nope",
      entries: [{ type: "cancellation", payload: {} }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(JSON.stringify(res.body.detail)).toMatch(/type/);
  });

  it("refuses a collection payload carrying gross_amount", async () => {
    // Invariant 3. The device proposes WHICH periods; the server decides what that costs.
    const res = await callFunction("sync-push", {
      credential_id: "nope",
      secret: "nope",
      entries: [
        {
          type: "collection",
          payload: {
            id: "00000000-0000-0000-0000-000000000001",
            or_no: 1,
            booklet_id: "00000000-0000-0000-0000-000000000002",
            collector_id: "00000000-0000-0000-0000-000000000003",
            collected_at: "2026-10-05T09:00:00+08:00",
            fee_type_id: "00000000-0000-0000-0000-000000000004",
            allocations: [],
            lines: [],
            gross_amount: "999.00",
          },
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.detail)).toMatch(/gross_amount/);
  });

  it("refuses a closeout whose declared_total is not a 2dp decimal string", async () => {
    const res = await callFunction("closeout", {
      credential_id: "nope",
      secret: "nope",
      shift_id: "00000000-0000-0000-0000-000000000005",
      declared_total: 100,
      device_count: 1,
      device_total: "100.00",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.detail)).toMatch(/declared_total/);
  });

  it("still answers 401, not 400, for a WELL-FORMED body with a bad credential", async () => {
    // The ordering matters and is easy to get backwards. A valid body must reach
    // authentication; only a malformed one short-circuits at 400.
    const res = await callFunction("sync-pull", {
      credential_id: "nope",
      secret: "nope",
      cursor: 0,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("leaks no zod internals beyond the field path and a message", async () => {
    const res = await callFunction("sync-pull", { credential_id: "", secret: "" });
    expect(res.status).toBe(400);
    const detail = JSON.stringify(res.body.detail);
    expect(detail).not.toMatch(/ZodError|invalid_type|stack|at Object/);
  });
});

describe("the generated Deno contract copy", () => {
  it("is identical to what the generator would write right now", () => {
    // The whole justification for generating rather than hand-copying is that drift becomes
    // a red test. This is that test. If it fails, run `pnpm edge:contract` and commit the
    // result -- never edit supabase/functions/_shared/contract.ts by hand.
    //
    // The repo root is derived from THIS FILE's location, not from process.cwd(): the
    // suite runs with `tests/` as its working directory under
    // `pnpm --filter @ceedo/tests` and with the repo root under a plain `pnpm test`, and a
    // cwd-relative path is correct in exactly one of those.
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const path = join(root, "supabase/functions/_shared/contract.ts");
    const before = readFileSync(path, "utf8");
    execFileSync("node", [join(root, "scripts/generate-edge-contract.mjs")], { cwd: root });
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });
});
