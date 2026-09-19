# Phase 3b-i (Device Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the collector app up to and including a complete shift that contains zero
receipts — enrollment, offline PIN sign-in, on-device SQLite, sync engine, outbox and
closeout — plus the three server carryovers Phase 3a deferred.

**Architecture:** The sync engine is pure TypeScript in `packages/sync-engine`, behind
async-shaped SQLite-driver and HTTP-transport interfaces. Under Vitest the driver is
`better-sqlite3` and the transport is real HTTP into the deployed Edge Functions; on the
tablet the driver is `expo-sqlite` and the transport is `fetch`. `apps/collector` is
screens and glue. Server carryovers land first because three of the four change the wire
the app is written against.

**Tech Stack:** TypeScript 5.7, Node 22, pnpm 10, Vitest 3, Expo (React Native, Hermes),
`drizzle-orm` + `drizzle-kit`, `better-sqlite3`, `expo-sqlite`, `expo-secure-store`,
`expo-camera`, `bcryptjs`, `zod` 4, Supabase (Postgres + Deno Edge Functions).

**Spec:** `docs/superpowers/specs/2026-09-19-phase-3b-device-spine-design.md`

## Execution status — read this first

**Branch:** `phase-3b-i-device-spine` (branched from `main`). Suite green at **694 tests /
61 files**; `pnpm typecheck` clean. Working tree clean as of the last commit below.

| Task | State |
| --- | --- |
| 1 — `authenticator` harness | **done** — 6 tests, all five exemptions pinned |
| 2 — Expo shell + Hermes bcrypt measurement | **done** — measured, and it invalidated a design assumption |
| 2a — native bcrypt module | **done** — added mid-phase because of Task 2's result |
| 3 — first-sync duration | **done** — measured, spec E9 confirmed |
| 4 — `shift_id` on `collections` | **done** — migrations 0043 and 0044; four existing closeout fixtures rewritten |
| 5 — Edge Function payload validation | **done** — 702 tests green; two wire answers changed, see below |
| 6 — `packages/db-local` | **done** — 21 tables generated; `better-sqlite3` needed a pnpm build-script allowance |
| 7 — `packages/sync-engine` (pull and apply) | **done** — 5 tests; E7 atomicity confirmed falsifiable |
| **8 — reset, epoch, daily full re-sync** | **NEXT.** |
| 9–14 | not started |

**What Task 2 changed, and why it matters to everything after it.** `bcryptjs` under Hermes
verifies a cost-12 hash in **22,265 ms** (release build) against a 2,000 ms threshold. The
remedy is `apps/collector/modules/ceedo-bcrypt`, a local Expo module wrapping
`at.favre.lib:bcrypt`, measured at **~482 ms — 47× faster**. Task 12 calls `verify()` from
that module; an `import bcrypt from "bcryptjs"` on the sign-in path is a 22-second sign-in.
Spec D3 is untouched: same cost-12 hash, same mitigation, nothing renegotiated.

**What Task 4 changed in the tests it did not own.** `close_shift` counts by
`collections.shift_id` now, so four existing tests that posted receipts BEFORE opening their
shift were staging shifts that contain nothing: `db/close-shift.test.ts`,
`db/sync-push.test.ts`, `http/functions.test.ts` and `http/round-trip.test.ts`. Each was
fixed as a fixture — open the shift, then collect into it, which is the real sequence — and
no assertion was weakened. `postCollectionAsOwner` gained a `shiftId` option; omitted still
means `null`, so fixtures that do not care about shifts are unchanged.

Three deviations from this plan's Task 4 text, all in the test file rather than the
migrations:
- Step 1's setup reopened shift A while shift B was still open, which
  `shifts_one_open_per_device` refuses. B is closed first, then A reopened; the end state is
  the one the plan describes.
- Step 1 inserted `collections` rows directly. The `collections_balance` trigger refuses a
  row with no parts, and a direct insert would have left the `post_collection` half of the
  migration untested, so the test posts through `post_collection` and asserts against the
  fixture's per-head rate rather than a written-in 100.00.
- Step 5's E3 test called `resolve_exception_corrected` over the owner connection, where
  `auth.uid()` is null and `has_role` refuses. It goes through an authenticated supervisor
  client, as `db/resolve-exception.test.ts` already does, and files its exception through
  `sync_push` rather than inserting the `sync_exceptions` row by hand.

**What Task 5 changed on the wire.** Validation runs before authentication, which moves two
answers a client may already depend on:
- A body with no `credential_id`/`secret` is now `400 invalid_body`, not `401 unauthorized`.
  A well-formed body with a wrong credential is still `401` — `http/functions.test.ts` pins
  both.
- A collection payload carrying `device_id` is now refused with `400`, where it used to be
  accepted and silently overridden. `sync_push` still overrides it from the credential and
  `db/sync-push.test.ts` still pins that; what changed is only what a client carrying one is
  told. The same applies to `gross_amount`.
- `closeout` request money must be a 2dp decimal **string**. `round-trip.test.ts` was feeding
  the server's own `system_total` — a JSON number — straight back, which the server used to
  tolerate.

The generated Deno copy is `supabase/functions/_shared/contract.ts`. Never hand-edit it; run
`pnpm edge:contract`. `http/contract-validation.test.ts` fails when it is stale, and that
failure was confirmed by hand rather than assumed.

**Measurements taken so far**, each with what it invalidated:
- `docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md`
- `docs/superpowers/measurements/phase-3b-i-first-sync.md`

**Known follow-ups not yet done:**
- The Android package identifier is still Expo's placeholder `com.anonymous.collector`. Must
  not ship. Changing it forces a rebuild, so it was deferred rather than done mid-measurement.
- The exact `native:` sample line from the Task 2a probe run was reported as "3 digits" with
  a 47× speedup; ~482 ms is derived from that ratio, not transcribed. Replace with the real
  figure when convenient.

---

## Global Constraints

- **Run `supabase db reset` before the suite, every time.** Phase 3a measured 178,167
  `charges` rows and 558 `app_users` rows accumulating over two unreset runs; a fourth run
  crosses PostgREST's 1000-row default page size and breaks `membership-gate.test.ts`.
- **Environment must be passed inline, in one command.** This harness resets shell state
  between tool calls, and `eval $(supabase status -o env)` is refused in worktree-isolated
  sessions. Every test command in this plan uses the inline form. These are the standard
  local Supabase demo keys, not secrets.
- **`packages/shared`, `packages/db-local` and `packages/sync-engine` must not import React
  Native** (parent spec §4). They are pure TypeScript, testable in Node.
- **Edge Functions must never use `service_role`** (parent spec §12.5). They mint a
  short-lived `ceedo_app`-role JWT per invocation via `_shared/auth.ts`.
- **Every SQL function carries `set search_path = ceedo_collections, pg_temp`** (parent
  spec §12.4).
- **Money on the wire is asymmetric** (`packages/shared/src/sync-contract.ts`): outbound
  device→server is a decimal **string** matching `/^-?\d+\.\d{2}$/`; inbound server→device
  is a bare JSON **number**. Do not unify them.
- **Target device:** Android 13+, 4 GB RAM (parent spec §3).
- **Migrations are plain SQL** under `supabase/migrations/`, named
  `YYYYMMDDHHMMSS_snake_case.sql`. The last existing migration is
  `20260918000042_sync_push_collector_scope.sql`; this phase continues at `20260919000043`.
- **`statement_timeout = 8s` and `lock_timeout = 8s` apply to every real device call**
  (role `authenticator`). The `postgres` test connection has `statement_timeout = 0`.

**The standard test command** (substitute the path):

```bash
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run <path>
```

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `tests/helpers/authenticator.ts` | A Postgres connection made AS `authenticator`, which then assumes `ceedo_app` — the sequence PostgREST performs |
| `tests/db/role-exemptions.test.ts` | Pins all five exemptions the `postgres` connection enjoys and a real caller does not |
| `tests/db/first-sync-budget.test.ts` | `sync_pull` first-sync duration under the real 8s ceiling |
| `supabase/migrations/20260919000043_collections_shift_id.sql` | `shift_id` column, `post_collection` insert, `close_shift` scoping |
| `supabase/migrations/20260919000044_correction_preserves_shift.sql` | E3 — a correction re-posts the original `shift_id` |
| `scripts/generate-edge-contract.mjs` | Emits the Deno contract copy from `packages/shared` |
| `supabase/functions/_shared/contract.ts` | Generated. Never hand-edited |
| `supabase/functions/_shared/validate.ts` | Turns a zod failure into a 400 naming the field |
| `packages/db-local/` | Drizzle schema for device SQLite + generated migrations |
| `packages/sync-engine/` | Pull, apply, cursor, epoch, outbox, push — pure TypeScript |
| `apps/collector/` | Expo app: screens and glue only |
| `docs/superpowers/measurements/phase-3b-i-device-smoke.md` | The on-device checklist, executed by hand |

**Deliberately NOT in this plan, though the spec mentions it:**

Spec §5.2's fourth rule — *"Outstanding is computed, never stored"* — has no task here.
Nothing in a shift containing zero receipts displays an outstanding balance, so there is no
screen to compute it for and no assertion that would not be inventing its own subject. It
belongs to 3b-ii, alongside the lease browse and the FIFO prefix picker that are its only
consumers. The rule itself is not in doubt: `parity.test.ts` already pins
`packages/shared`'s `fifo.ts` and `charges.ts` against the SQL, and the device recomputes
from the `collections` rows the pull delivers. This is a note rather than a gap, and it is
written down so the next reader does not have to re-derive that it was a choice.

**Modified:**

| Path | Change |
| --- | --- |
| `packages/shared/src/sync-contract.ts` | `CollectionPayload` gains `shift_id` |
| `supabase/functions/*/index.ts` | Validate the body before calling Postgres |
| `apps/web/components/devices/device-credential-panel.tsx` | Render the issued credential as a QR code |
| `tests/helpers/supabase.ts` | Re-export the `authenticator` helper |

---

## Task 1: The `authenticator` test harness

The Phase 3a handover calls this *"the single most actionable sentence in this document"*.
Everything server-side in this phase is tested on it, so it comes first.

**Files:**
- Create: `tests/helpers/authenticator.ts`
- Create: `tests/db/role-exemptions.test.ts`
- Modify: `tests/helpers/supabase.ts` (append one re-export)

**Interfaces:**
- Consumes: nothing.
- Produces: `authenticatorClient(): Promise<PgClient>` — a connected `pg.Client` whose
  session is `authenticator` and whose current role is `ceedo_app`. Caller must `end()` it.

- [x] **Step 1: Write the failing test**

Create `tests/db/role-exemptions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client as PgClient } from "pg";
import { authenticatorClient } from "../helpers/authenticator";
import { Client } from "pg";
import { POSTGRES_URL } from "../helpers/supabase";

/**
 * The Phase 3a handover names THREE things that exempt the `postgres` test connection from
 * what a real caller faces: object ownership, rolbypassrls, and the pg_safeupdate guard.
 * There are FIVE. `authenticator` also carries statement_timeout=8s and lock_timeout=8s.
 *
 * This file pins all five, so that a future change to the Supabase image that drops one is
 * a red test rather than a silent widening of what tests are blind to.
 */
describe("the exemptions a postgres test connection enjoys", () => {
  let app: PgClient;
  let su: PgClient;

  beforeAll(async () => {
    app = await authenticatorClient();
    su = new Client({ connectionString: POSTGRES_URL });
    await su.connect();
  });

  afterAll(async () => {
    await app.end();
    await su.end();
  });

  it("connects as authenticator and runs as ceedo_app", async () => {
    const { rows } = await app.query(
      "select session_user as session, current_user as current",
    );
    expect(rows[0].session).toBe("authenticator");
    expect(rows[0].current).toBe("ceedo_app");
  });

  it("applies an 8s statement_timeout that the postgres connection does not", async () => {
    const mine = await app.query("show statement_timeout");
    expect(mine.rows[0].statement_timeout).toBe("8s");

    const theirs = await su.query("show statement_timeout");
    expect(theirs.rows[0].statement_timeout).toBe("0");
  });

  it("applies an 8s lock_timeout that the postgres connection does not", async () => {
    const mine = await app.query("show lock_timeout");
    expect(mine.rows[0].lock_timeout).toBe("8s");

    const theirs = await su.query("show lock_timeout");
    expect(theirs.rows[0].lock_timeout).toBe("0");
  });

  it("cancels a 9 second query that the postgres connection completes", async () => {
    await expect(app.query("select pg_sleep(9)")).rejects.toThrow(/statement timeout/i);
    await expect(su.query("select pg_sleep(9)")).resolves.toBeDefined();
  }, 30_000);

  it("loads pg_safeupdate, which the postgres connection never loads", async () => {
    // A table ceedo_app owns, so the refusal below is the guard and not a privilege error.
    await app.query("create temp table guard_probe (id int)");
    await app.query("insert into guard_probe values (1)");
    await expect(app.query("delete from guard_probe")).rejects.toThrow(
      /requires a WHERE clause/i,
    );
  });

  it("does NOT bypass RLS the way the postgres connection does", async () => {
    const mine = await app.query(
      "select rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(mine.rows[0].rolbypassrls).toBe(false);

    const theirs = await su.query(
      "select rolbypassrls from pg_roles where rolname = 'postgres'",
    );
    expect(theirs.rows[0].rolbypassrls).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run db/role-exemptions.test.ts
```

Expected: FAIL — `Cannot find module '../helpers/authenticator'`.

- [x] **Step 3: Write the helper**

Create `tests/helpers/authenticator.ts`:

```ts
import { Client as PgClient } from "pg";

/**
 * A connection made AS `authenticator`, which then assumes `ceedo_app` -- the exact
 * sequence PostgREST performs on every request.
 *
 * WHY NOT `set role ceedo_app` ON THE EXISTING `postgres` CONNECTION:
 *
 * Phase 3a found two production-blocking bugs that a 641-test green suite could not see,
 * because every SQL test connects as `postgres` and every real caller arrives as
 * `ceedo_app` via `authenticator`. FIVE things exempt that connection, and `set role`
 * reproduces only two of them:
 *
 *   1. object ownership   -- reproduced by `set role`
 *   2. rolbypassrls       -- reproduced by `set role`
 *   3. pg_safeupdate      -- NOT reproduced. `session_preload_libraries` is loaded per
 *                            SESSION for `authenticator` alone (pg_db_role_setting), so a
 *                            `postgres` session never loads the library at all.
 *   4. statement_timeout  -- NOT reproduced. 8s for authenticator, 0 for postgres.
 *   5. lock_timeout       -- NOT reproduced. 8s for authenticator, 0 for postgres.
 *
 * Items 4 and 5 were measured during Phase 3b-i design and are NOT in the Phase 3a
 * handover's list of three. They matter: every real device query runs under an 8-second
 * ceiling that no test in this repo had ever applied.
 *
 * A harness built on `set role` would look like it closed this bug class while leaving
 * three of the five mechanisms unreproduced.
 */
const AUTHENTICATOR_URL =
  process.env.SUPABASE_AUTHENTICATOR_URL ??
  "postgresql://authenticator:postgres@127.0.0.1:54322/postgres";

export async function authenticatorClient(): Promise<PgClient> {
  const client = new PgClient({ connectionString: AUTHENTICATOR_URL });
  await client.connect();
  // PostgREST issues this per request after authenticating the JWT's `role` claim.
  await client.query("set role ceedo_app");
  return client;
}
```

- [x] **Step 4: Re-export from the main helper**

Append to `tests/helpers/supabase.ts`:

```ts
/**
 * Re-exported so a test file needs one import for connections. The implementation lives in
 * its own file because its doc comment is the explanation of an entire bug class.
 */
export { authenticatorClient } from "./authenticator";
```

- [x] **Step 5: Run the test to verify it passes**

```bash
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run db/role-exemptions.test.ts
```

Expected: PASS, 6 tests.

- [x] **Step 6: Verify the test is falsifiable**

Temporarily change `authenticatorClient` to connect on `POSTGRES_URL` instead and re-run.
Expected: the `session_user`, both timeout tests, the `pg_sleep(9)` test and the
`pg_safeupdate` test all FAIL. **Revert the change.** A harness that passes on the wrong
connection proves nothing, and this is the one check that tells the two apart.

- [x] **Step 7: Commit**

```bash
git add tests/helpers/authenticator.ts tests/db/role-exemptions.test.ts tests/helpers/supabase.ts
git commit -m "test: connect as authenticator, and pin all five role exemptions

The Phase 3a handover names three things that exempt the postgres test
connection from what a real caller faces. There are five: authenticator
also carries statement_timeout=8s and lock_timeout=8s, while postgres
carries 0. Verified by pg_sleep(9) succeeding on one and being cancelled
on the other.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Expo shell, and measure bcrypt under Hermes on the tablet

Spec §4.4 records a measurement gap this task closes before any sign-in code is written:
native C bcrypt at cost 12 is ~184ms and `bcryptjs` on V8 is ~233ms — only ~1.27x — so the
common claim that JS bcrypt needs a native module is unsupported. **Hermes has no JIT, and
nobody has measured it.** If verification lands beyond ~2s the sign-in design changes, so
this happens now rather than after the screens exist.

**Files:**
- Create: `apps/collector/` (Expo scaffold)
- Create: `apps/collector/app/bcrypt-probe.tsx`
- Create: `docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable Expo app at `apps/collector`, and a recorded number that Task 12
  depends on.

- [x] **Step 1: Scaffold the Expo app**

```bash
cd apps
pnpm create expo-app@latest collector --template blank-typescript
cd collector
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

Then set the package name so the workspace picks it up. Edit `apps/collector/package.json`
so `"name"` is `"@ceedo/collector"` and add `"private": true`.

- [x] **Step 2: Write the probe screen**

Create `apps/collector/app/bcrypt-probe.tsx`:

```tsx
import { useState } from "react";
import { Button, Text, View } from "react-native";
import bcrypt from "bcryptjs";

/**
 * A THROWAWAY screen. Its only job is to produce one number: how long bcrypt cost-12
 * verification takes under Hermes on the real tablet.
 *
 * The hash below is a real `crypt('123456', gen_salt('bf', 12))` output from this
 * project's Postgres, so this measures exactly what set_collector_pin() produces.
 *
 * Delete this file in Task 12 once the number is recorded.
 */
const HASH = "$2a$12$uDaaR3AzzqrwJB1WnEJwY.u2dqVzFqIkM/4M23P.f2g05aNMcMuau";

export default function BcryptProbe() {
  const [result, setResult] = useState<string>("not run");

  function run() {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      // The RIGHT pin, so the full key schedule runs. A wrong PIN costs the same in
      // bcrypt, but measuring the success path removes any doubt.
      const ok = bcrypt.compareSync("123456", HASH);
      samples.push(Date.now() - t);
      if (!ok) {
        setResult("HASH MISMATCH — the probe is wrong, not the timing");
        return;
      }
    }
    const median = [...samples].sort((a, b) => a - b)[2];
    setResult(`samples: ${samples.join(", ")} ms | median: ${median} ms`);
  }

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Text>bcrypt cost 12 verify, under Hermes</Text>
      <Button title="Run 5 verifications" onPress={run} />
      <Text selectable>{result}</Text>
    </View>
  );
}
```

- [x] **Step 3: Confirm Hermes is the engine**

A measurement taken on JSC would be meaningless. Add to the probe screen, above the button:

```tsx
<Text>
  engine: {(global as { HermesInternal?: unknown }).HermesInternal ? "Hermes" : "NOT Hermes"}
</Text>
```

Run the app on the tablet and confirm it reads `Hermes`. If it does not, stop and fix the
Expo configuration before taking any timing.

- [x] **Step 4: Run it on the physical tablet and record the number**

```bash
cd apps/collector && pnpm expo run:android --device
```

Create `docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md` with: the device model,
Android version, the five samples, the median, and the engine confirmation from Step 3.

- [x] **Step 5: Decide, and record the decision in the same file**

| Median | Decision |
| --- | --- |
| under ~800ms | Proceed as specified. `bcryptjs` on the sign-in path, no spinner needed. |
| ~800ms–2s | Proceed, but Task 12's sign-in shows a progress indicator during verification. |
| over ~2s | **Stop and escalate.** The options are a native bcrypt binding or a cost-factor conversation with the ordinance in hand, and both are decisions for a human, not this plan. |

Write which branch was taken and why. Task 12 reads this file.

- [x] **Step 6: Commit**

```bash
git add apps/collector docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md
git commit -m "feat(collector): Expo shell, and bcrypt cost-12 measured under Hermes

Measured before any sign-in code exists, because a result over ~2s changes
the design. JS bcrypt is not meaningfully slower than C on V8 (233ms vs
184ms at cost 12), so the assumption that a native module is required was
not supported; Hermes, which has no JIT, was the real unknown.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2a: Native bcrypt, because Hermes cannot do it

**Added mid-phase, after Task 2's measurement.** Not in the original plan — it exists because
Task 2 returned a number that invalidated an assumption the plan rested on.

`bcryptjs` under Hermes measured **22,265 ms** median in a release build (5 samples, 0.2%
spread) against a 2,000 ms threshold and an 800 ms goal. Hermes has no JIT; bcrypt at cost 12
is ~4,096 Blowfish key expansions of pure 32-bit integer arithmetic. There is no JavaScript
fix — that figure is already the minified, ahead-of-time-compiled release result, and Hermes
has no WebAssembly.

**Files:**
- Create: `apps/collector/modules/ceedo-bcrypt/` (local Expo module, Android only)
- Modify: `apps/collector/src/app/bcrypt-probe.tsx` (measure native against JS)
- Modify: `docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `verify(pin: string, hash: string): boolean`, `costOf(hash: string): number`,
  `meetsExpectedCost(hash: string): boolean`, `EXPECTED_COST = 12` — from
  `apps/collector/modules/ceedo-bcrypt`. Task 12's sign-in uses `verify` in place of
  `bcrypt.compareSync`.

**Why a local module and not a package.** Every published native bcrypt for React Native was
checked against live npm and GitHub. The best candidate has 0 stars, ~2 downloads/week and a
Nitro version skew; the next is two years dead with an unanswered "does not register on
Android" bug at RN 0.80; another still declares `jcenter()`. Depending on any of them for the
code path that authenticates every collector on every shift is a worse risk than fifty lines
of Kotlin. `expo-crypto` has no KDF at all, and `react-native-quick-crypto` — the one healthy
package in the space — has no bcrypt.

**Why `at.favre.lib:bcrypt` and not vendored jBCrypt.** jBCrypt has not been released since
2010; vendoring means owning 800 lines of crypto and its known quirks. `at.favre.lib:bcrypt`
is Apache 2.0, maintained, tested, parses Modular Crypt Format itself, and handles the
`2x`/null-byte edge cases. Pinned exactly — a version range in this dependency would let a
build change the authenticator without anyone deciding to.

**This task keeps spec D3 intact.** The server still produces
`crypt(pin, gen_salt('bf', 12))`; the device verifies that same hash; cost stays 12. No
security posture is renegotiated, nothing is needed from CEEDO, and no invariant moves. That
is the entire reason this option was chosen over lowering the cost factor.

- [x] **Step 1: Scaffold the local module**

```bash
cd apps/collector
npx create-expo-module@latest ceedo-bcrypt --local --name CeedoBcrypt \
  --description "Native bcrypt verification for offline collector PIN sign-in" \
  --package ph.ceedo.collector.bcrypt --license Apache-2.0 \
  --platform android --features Function
```

- [x] **Step 2: Add the bcrypt dependency**

In `modules/ceedo-bcrypt/android/build.gradle`, after the `android { }` block:

```gradle
dependencies {
  implementation 'at.favre.lib:bcrypt:0.10.2'
}
```

- [x] **Step 3: Implement `verify` and `costOf` in Kotlin**

`verify` returns false rather than throwing for empty or malformed input, so a collector with
a null `pin_hash` reaches sign-in's own "PIN not set" message instead of a crash — §6.3
records why that distinction matters in the field. `costOf` exists so the device can assert
what the server gave it rather than trust it, because spec D3 makes cost the PIN's only
mitigation and a server that silently started issuing cost 6 would be invisible everywhere
else.

- [x] **Step 4: TypeScript surface, and a web stub that throws**

The web stub throws rather than returning false. A false is indistinguishable from a wrong
PIN and would let a web build present a working-looking sign-in that refuses every correct
PIN — a silent wrong answer, which this project treats as worse than a loud failure.

- [x] **Step 5: Measure native against JS in the same probe run**

Both paths stay in `bcrypt-probe.tsx`. The native number alone is a claim; the two side by
side on one device in one run are a comparison. The probe reports `NATIVE UNAVAILABLE`
rather than falling through to JS, so an unlinked module can never be mistaken for a fast
one.

- [x] **Step 6: Rebuild and measure on the device** — DONE: ~482 ms native vs 22,666 ms bcryptjs, 47x.

```bash
cd apps/collector
npx expo run:android --device --variant release
```

**A native module needs a full rebuild — Fast Refresh does not reload Kotlin.**

Record both medians and the speedup in
`docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md`.

**The expectation is low hundreds of milliseconds. It is an expectation, not a measurement** —
the same class of claim as this phase's 1.5–5 s estimate (wrong by 10–30×) and its 2–7 s
release-build prediction (wrong again). If native comes back over 2 s, stop: every remaining
option changes the security posture and belongs to a human.

- [x] **Step 7: Commit**

---

## Task 3: Measure `sync_pull` first-sync duration under the real 8s ceiling

Phase 3a's Task 16 measured the first-sync **payload** (~634 KiB against an 8 MiB alarm) and
stated that the case which would stress it was not exercised. **Nothing has ever measured
how long it takes**, and in production it runs under `statement_timeout = 8s`. This also
gates spec E9: a daily full re-sync is only affordable while a full sync is cheap.

**Files:**
- Create: `tests/db/first-sync-budget.test.ts`
- Create: `docs/superpowers/measurements/phase-3b-i-first-sync.md`

**Interfaces:**
- Consumes: `authenticatorClient()` from Task 1; `createSyncFixture(db, opts)` and
  `createCollectionFixture` from `tests/helpers/supabase.ts`.
- Produces: a recorded duration, and a regression test that fails if first sync ever
  crosses half the production ceiling.

- [x] **Step 1: Write the failing test**

Create `tests/db/first-sync-budget.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { authenticatorClient } from "../helpers/authenticator";
import { POSTGRES_URL, createSyncFixture } from "../helpers/supabase";

/**
 * FIRST SYNC IS THE LONGEST QUERY IN THIS SYSTEM, AND IT RUNS UNDER AN 8 SECOND CEILING
 * THAT NO TEST HAS EVER APPLIED.
 *
 * Phase 3a measured the first-sync PAYLOAD at ~634 KiB and said plainly that the case which
 * would stress it -- a long-delinquent stall with full collection and allocation history --
 * was not exercised. It never measured elapsed time at all, because every test connects as
 * `postgres`, where statement_timeout is 0.
 *
 * A first sync that crosses 8s fails on every tablet and passes the entire suite. That is
 * the exact shape of the two bugs that reached the end of Phase 3a.
 *
 * The budget below is HALF the production ceiling, deliberately. A test that only fails at
 * 8s tells you after the tablets are already failing.
 */
const BUDGET_MS = 4000;

describe("sync_pull first-sync budget", () => {
  let app: PgClient;
  let fixtures: PgClient;
  let deviceId: string;

  beforeAll(async () => {
    fixtures = new PgClient({ connectionString: POSTGRES_URL });
    await fixtures.connect();

    // A long-delinquent daily stall: the case Phase 3a named as unmeasured.
    const fx = await createSyncFixture(fixtures, {
      accrualPeriod: "daily",
      startDate: "2024-09-19",
    });
    deviceId = fx.deviceId;

    // The backlog is inserted directly rather than accrued.
    //
    // run_accrual(p_business_date) raises charges for ONE date per call and refuses any
    // date before settings.cutover_date (seeded 2026-10-01), so building two years of
    // daily charges through it would be ~730 calls against a guard that rejects most of
    // them. This insert produces the same rows the accrual would have produced, in one
    // statement, which is what a duration measurement needs.
    await fixtures.query(
      `insert into ceedo_collections.charges
         (lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, source)
       select $1, $2, 'rental', d::date, d::date, d::date, 100.00, 'accrual'
         from generate_series('2024-09-19'::date, '2026-09-18'::date, '1 day') as d`,
      [fx.leaseId, fx.feeTypeId],
    );

    app = await authenticatorClient();
  }, 120_000);

  afterAll(async () => {
    await app.end();
    await fixtures.end();
  });

  it("completes a cursor-0 pull inside half the production statement_timeout", async () => {
    const started = Date.now();
    const { rows } = await app.query("select ceedo_collections.sync_pull($1, 0) as payload", [
      deviceId,
    ]);
    const elapsed = Date.now() - started;

    // Prove the pull actually returned a world, so a fast empty answer cannot pass.
    const payload = rows[0].payload as Record<string, unknown[]>;
    expect(Array.isArray(payload.charges)).toBe(true);
    expect(payload.charges.length).toBeGreaterThan(300);

    console.log(
      `first-sync: ${elapsed}ms, ${payload.charges.length} charges, ` +
        `${JSON.stringify(payload).length} bytes`,
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 30_000);

  it("is not silently exempt from the ceiling it is being measured against", async () => {
    // If this connection ever stops carrying the timeout, the budget test above becomes
    // decorative. Pin it in the same file that depends on it.
    const { rows } = await app.query("show statement_timeout");
    expect(rows[0].statement_timeout).toBe("8s");
  });
});
```

- [x] **Step 2: Run it**

```bash
supabase db reset && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run db/first-sync-budget.test.ts
```

**This test may legitimately pass on the first run.** That is a result, not a failure of the
method — the point is the number it prints, which nothing has ever produced.

`createSyncFixture` forwards its options to `createCollectionFixture`, which forwards them
to `createLeaseFixture` (`tests/helpers/supabase.ts:285`) — `accrualPeriod` and `startDate`
are real option names there.

**The fixture posts no collections, so this is a lower bound**, exactly as Phase 3a's own
payload measurement was. Spec §3.4 requires collection and allocation history to be present;
if Step 3's recorded number is close to the budget, extend the fixture with
`postCollectionAsOwner` (`tests/helpers/supabase.ts:615`) before ruling on E9 in Step 4.

- [x] **Step 3: Record the measurement**

Create `docs/superpowers/measurements/phase-3b-i-first-sync.md` with the elapsed time, the
charge count, the payload size, and — stated explicitly — whether collection and allocation
history was present in the fixture. Phase 3a's measurement was honest about this gap and
this one must be too.

- [x] **Step 4: Rule on spec E9 in the same file**

E9 makes a full re-sync run on the first sync of each business date. Write down whether the
measured duration supports that:

- **Under ~2s:** E9 stands as specified.
- **2s–4s:** E9 stands, but Task 9 must run the daily full re-sync in the background with
  the existing cached data still readable, never as a blocking splash.
- **Over 4s:** E9 must be revisited. Escalate — tombstone rows become the better trade and
  that is a spec change, not an implementation choice.

- [x] **Step 5: Commit**

```bash
git add tests/db/first-sync-budget.test.ts docs/superpowers/measurements/phase-3b-i-first-sync.md
git commit -m "test: measure first-sync duration under the real 8s ceiling

Phase 3a measured first-sync payload size and never measured its duration,
because every test connects as postgres where statement_timeout is 0. In
production sync_pull runs as authenticator under an 8s ceiling. Budget is
set at half that, so the test fails before the tablets do.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `shift_id` on `collections`

Retires the deferral the Phase 3a handover records: `close_shift` currently reconciles by
`(collector_id, business_date)`, which fails safe but refuses an honest closeout when a
collector works two tablets in a day or opens a second shift on one device. Includes spec
E3 — a supervisor's correction must re-post the original `shift_id`.

**Files:**
- Create: `supabase/migrations/20260919000043_collections_shift_id.sql`
- Create: `supabase/migrations/20260919000044_correction_preserves_shift.sql`
- Modify: `packages/shared/src/sync-contract.ts`
- Create: `tests/db/shift-scoped-closeout.test.ts`

**Interfaces:**
- Consumes: `authenticatorClient()` (Task 1).
- Produces: `collections.shift_id uuid null`; `CollectionPayload` gains
  `shift_id: z.string().uuid().nullable().optional()`.

- [x] **Step 1: Write the failing test**

Create `tests/db/shift-scoped-closeout.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";
import { POSTGRES_URL, createSyncFixture } from "../helpers/supabase";

/**
 * Two shifts, one collector, one business date -- the case the Phase 3a handover records as
 * deferred. Before shift_id, close_shift summed EVERY collection for (collector, date), so
 * closing the first shift saw the second shift's receipts too, fell short on count, and
 * refused an honest closeout.
 *
 * Fails safe, never silent -- but it refuses a collector who has done nothing wrong, and
 * the fix needs a schema change, which is why it waited for this phase.
 */
describe("closeout scoped by shift_id", () => {
  let db: PgClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    fx = await createSyncFixture(db);
  }, 60_000);

  afterAll(async () => {
    await db.end();
  });

  it("closes the first of two shifts on the same collector and date", async () => {
    const businessDate = "2026-10-05";
    const shiftA = randomUUID();
    const shiftB = randomUUID();

    for (const id of [shiftA, shiftB]) {
      await db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, status)
         values ($1, $2, $3, $4::date, now(), 'open')`,
        [id, fx.collectorId, fx.deviceId, businessDate],
      );
      // shifts_one_open_per_device forbids two SIMULTANEOUSLY open shifts on one device,
      // so the first is closed out of the way before the second opens -- which is exactly
      // the real sequence (a morning shift, then an afternoon one).
      if (id === shiftA) {
        await db.query(
          `update ceedo_collections.shifts set status = 'closed' where id = $1`,
          [id],
        );
      }
    }
    // Reopen A so both exist, one open, matching the state at the moment A closes out.
    await db.query(`update ceedo_collections.shifts set status = 'open' where id = $1`, [
      shiftA,
    ]);
    await db.query(`update ceedo_collections.shifts set status = 'closed' where id = $1`, [
      shiftB,
    ]);

    // One collection in each shift.
    for (const [shiftId, orNo] of [
      [shiftA, 1101],
      [shiftB, 1102],
    ] as const) {
      await db.query(
        `insert into ceedo_collections.collections
           (id, or_no, booklet_id, collector_id, device_id, collected_at, business_date,
            fee_type_id, gross_amount, shift_id)
         values (gen_random_uuid(), $1, $2, $3, $4, $5::date, $5::date, $6, 100.00, $7)`,
        [
          orNo,
          fx.bookletId,
          fx.collectorId,
          fx.deviceId,
          businessDate,
          fx.perHeadFeeTypeId,
          shiftId,
        ],
      );
    }

    // Shift A holds exactly ONE collection totalling 100.00. Before shift_id, close_shift
    // would have counted both and answered `mismatch`.
    const { rows } = await db.query(
      `select ceedo_collections.close_shift($1, $2, 100.00, 1, 100.00) as result`,
      [shiftA, fx.deviceId],
    );
    expect(rows[0].result.status).toBe("closed");
    expect(Number(rows[0].result.system_count)).toBe(1);
    expect(Number(rows[0].result.system_total)).toBe(100);
    expect(Number(rows[0].result.variance)).toBe(0);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run db/shift-scoped-closeout.test.ts
```

Expected: FAIL — `column "shift_id" of relation "collections" does not exist`.

- [x] **Step 3: Write the migration**

Create `supabase/migrations/20260919000043_collections_shift_id.sql`:

```sql
-- shift_id on collections, so closeout scopes to the shift being closed instead of
-- inferring it from (collector_id, business_date).
--
-- WHY THIS WAS DEFERRED, AND WHAT IT FIXES. close_shift (migration 0034) sums every
-- collection for the closing shift's collector and business date. That is spec §6.5 step 3
-- taken literally, and it assumes one collector, one device, one shift per date. Two real
-- cases break it: a collector working two tablets the same day, and a second shift opened
-- on the same device later the same day (shifts_one_open_per_device forbids only
-- SIMULTANEOUSLY open shifts, and deliberately permits the sequence).
--
-- Both failed SAFE -- the server's figures are a superset of what the closing device knows,
-- so its count falls short and the mismatch branch returns before any write. Never a
-- correctness bug; always an honest closeout refused, needing a supervisor.
--
-- NULLABLE, AND THAT IS CORRECT RATHER THAN CONVENIENT. Every collection posted before this
-- migration, and every collection a supervisor posts from the web, belongs to no device
-- shift. There is nothing to backfill: a null shift_id is a true statement about those rows.

alter table ceedo_collections.collections
  add column shift_id uuid references ceedo_collections.shifts(id);

comment on column ceedo_collections.collections.shift_id is
  'The device shift this receipt was collected during. Null for collections posted before '
  'Phase 3b-i and for any posted from the web, which belong to no device shift.';

-- Closeout reads this, and reads it filtered by shift. Without the index that scan is
-- seq-scan-per-closeout on the largest table in the schema.
create index collections_shift_id_idx
  on ceedo_collections.collections (shift_id)
  where shift_id is not null;

-- post_collection: carry shift_id from the payload onto the row.
--
-- Only the declaration and the INSERT change. The function is otherwise migration 0032's
-- verbatim, and is reproduced in full because `create or replace` replaces the whole body --
-- there is no partial form, and an abbreviated copy here would silently drop every branch
-- it omitted.
--
-- IMPLEMENTOR: copy the body of supabase/migrations/20260918000032_stale_allocations.sql
-- (the current definition) and make exactly these three edits:
--
--   1. In the declare block, after v_lease_id, add:
--        v_shift_id uuid := nullif(p_payload ->> 'shift_id', '')::uuid;
--
--   2. In the INSERT column list, after `notes`, add `shift_id`.
--
--   3. In the VALUES list, in the matching position, add `v_shift_id`.
--
-- Change nothing else. Re-read the resulting function against 0032 before committing: the
-- stale_allocations branch, the two unique-violation discriminations and the FIFO prefix
-- validation must all survive intact.
```

**Do not paraphrase `post_collection`.** Read `20260918000032_stale_allocations.sql`, copy
its `create or replace function` block into this migration below the comment above, and make
only the three edits listed. Then continue the same file:

```sql
-- close_shift: scope by shift_id.
--
-- IMPLEMENTOR: copy the body of supabase/migrations/20260918000034_close_shift.sql, keeping
-- migration 0040's NULL check on p_declared_total (read 20260918000040 and confirm it is
-- present in what you copy -- it refuses a close with no cash declaration at all, and
-- dropping it would silently reopen that hole). Replace ONLY the system count/sum query:
--
--   select count(*), coalesce(sum(c.gross_amount), 0)
--     into v_system_count, v_system_total
--     from ceedo_collections.collections c
--    where c.shift_id = p_shift_id
--      and not exists (
--        select 1 from ceedo_collections.collection_cancellations cc
--         where cc.collection_id = c.id);
--
-- The collector_id and business_date predicates are REMOVED, not added to. A shift's
-- collections are now identified by the shift itself; re-checking the collector would be a
-- second, weaker statement of the same fact, and would resurrect the two-shift bug for any
-- row whose collector was corrected.
--
-- The cancellation exclusion STAYS. charge_balances already excludes cancelled collections
-- from the ledger; without the same exclusion here a cancelled receipt inflates the figure
-- the collector is asked to match and an honest closeout is refused.
```

Again: copy the real function, make only that edit, and keep the `revoke`/`grant` pair at
the end of the file for both functions.

- [x] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run db/shift-scoped-closeout.test.ts
```

Expected: PASS.

- [x] **Step 5: Write the failing test for E3 (a correction keeps its shift)**

Append to `tests/db/shift-scoped-closeout.test.ts`:

```ts
describe("a correction preserves the original shift_id", () => {
  let db: PgClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    fx = await createSyncFixture(db);
  }, 60_000);

  afterAll(async () => {
    await db.end();
  });

  it("re-posts into the shift the receipt was collected in, not the supervisor's claim", async () => {
    const businessDate = "2026-10-05";
    const shiftId = randomUUID();
    const collectionUuid = randomUUID();
    const otherShiftId = randomUUID();

    for (const id of [shiftId, otherShiftId]) {
      await db.query(
        `insert into ceedo_collections.shifts
           (id, collector_id, device_id, business_date, opened_at, status)
         values ($1, $2, $3, $4::date, now(), 'closed')`,
        [id, fx.collectorId, fx.deviceId, businessDate],
      );
    }

    // A rejected entry: it wrote nothing, so its UUID is still free (spec D9). Its stored
    // payload carries the shift it was collected in.
    const payload = {
      id: collectionUuid,
      or_no: 1201,
      booklet_id: fx.bookletId,
      collector_id: fx.collectorId,
      collected_at: `${businessDate}T09:00:00+08:00`,
      business_date: businessDate,
      fee_type_id: fx.perHeadFeeTypeId,
      shift_id: shiftId,
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 1 }],
      allocations: [],
    };
    const { rows: exRows } = await db.query(
      `insert into ceedo_collections.sync_exceptions
         (collection_uuid, device_id, collector_id, reason_code, payload)
       values ($1, $2, $3, 'or_already_used', $4::jsonb)
       returning id`,
      [collectionUuid, fx.deviceId, fx.collectorId, JSON.stringify(payload)],
    );
    const exceptionId = exRows[0].id as string;

    // The supervisor corrects the OR number AND -- whether by a buggy client or a hostile
    // one -- sends a different shift_id. The correction must ignore it.
    await db.query(
      `select ceedo_collections.resolve_exception_corrected($1, $2::jsonb, $3)`,
      [
        exceptionId,
        JSON.stringify({ or_no: 1202, shift_id: otherShiftId }),
        "Collector wrote the wrong serial; corrected against the paper receipt.",
      ],
    );

    const { rows } = await db.query(
      `select shift_id from ceedo_collections.collections where id = $1`,
      [collectionUuid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_id).toBe(shiftId);
  });
});
```

- [x] **Step 6: Run it to verify it fails**

Same command as Step 4. Expected: FAIL — `shift_id` is `otherShiftId`, because
`resolve_exception_corrected` merges the supervisor's payload over the device's and
re-asserts only `id` and `device_id`.

- [x] **Step 7: Write the E3 migration**

Create `supabase/migrations/20260919000044_correction_preserves_shift.sql`:

```sql
-- Spec E3: a correction re-posts the original shift_id, not just the original UUID.
--
-- Phase 3a's D9 rules that "accept with correction" re-runs post_collection with the
-- rejected entry's original UUID, so the device's outbox stays coherent and settles on
-- `duplicate`. resolve_exception_corrected (migration 0036) implements that by merging the
-- supervisor's edits over the device's stored payload and then RE-ASSERTING `id` and
-- `device_id` on top -- "facts about the push, not claims open to correction", as its own
-- comment puts it.
--
-- Once collections carry shift_id, it is a third fact of exactly that kind, and it was not
-- in that list. A corrected receipt is cash that was physically in that collector's drawer
-- during that shift. A correction that dropped the shift_id, or took the supervisor's
-- current context instead, would silently move that money out of the shift it belonged to --
-- and a closeout that had already balanced would stop balancing, with nothing pointing at
-- why.
--
-- IMPLEMENTOR: copy the body of supabase/migrations/20260918000036_resolve_exception.sql
-- and change exactly one expression. The merge currently reads:
--
--   v_merged := v_ex.payload || coalesce(p_payload, '{}'::jsonb)
--               || jsonb_build_object('id', v_ex.collection_uuid,
--                                     'device_id', v_ex.device_id);
--
-- It becomes:
--
--   v_merged := v_ex.payload || coalesce(p_payload, '{}'::jsonb)
--               || jsonb_build_object('id', v_ex.collection_uuid,
--                                     'device_id', v_ex.device_id,
--                                     'shift_id', v_ex.payload ->> 'shift_id');
--
-- Read from v_ex.payload, NOT from p_payload: the device's original claim is the one that
-- is true. An exception whose payload has no shift_id yields a JSON null here, which
-- nullif()::uuid in post_collection turns into a SQL NULL -- correct for a pre-3b-i entry
-- that genuinely belonged to no shift.
--
-- Copy every other line of 0036 unchanged, including resolve_exception_spoiled and
-- escalate_exception if they share the file, and the revoke/grant pairs at the end.
```

- [x] **Step 8: Run the tests to verify they pass**

Same command as Step 4. Expected: PASS, both `describe` blocks.

- [x] **Step 9: Add `shift_id` to the wire contract**

In `packages/shared/src/sync-contract.ts`, inside `CollectionPayload`'s object literal, after
the `lease_id` line, add:

```ts
    /**
     * The device shift this receipt was collected in. Nullable and optional: a collection
     * posted from the web belongs to no device shift, and pre-3b-i devices sent none.
     *
     * Unlike `gross_amount` and `device_id`, this is NOT a forbidden field. The device is
     * the only party that knows which shift a receipt was taken during -- the server cannot
     * derive it, because a shift's time window deliberately does not bound its collections
     * (a receipt queued before the shift_open push is acked can carry
     * collected_at < opened_at). So it is a claim the server accepts, and the constraint
     * that keeps it honest is the foreign key plus close_shift's own arithmetic.
     */
    shift_id: uuid.nullable().optional(),
```

Then in `ShiftClosePayload`, no change — it already keys on the shift's own `id`.

- [x] **Step 10: Run the shared package's tests**

```bash
pnpm --filter @ceedo/shared exec vitest run
```

Expected: PASS. If `sync-contract.test.ts` has a `.strict()` assertion listing
`CollectionPayload`'s keys, add `shift_id` to it.

- [x] **Step 11: Regenerate database types**

```bash
pnpm db:types
```

Expected: `packages/shared/src/db.types.ts` gains `shift_id` on `collections`.

- [x] **Step 12: Run the whole suite**

```bash
supabase db reset && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm test
```

Expected: PASS. `close_shift`'s scoping changed, so `tests/db/close-shift.test.ts` and
`tests/http/round-trip.test.ts` are the two most likely to need their fixtures to set
`shift_id` on the collections they post. **If one fails, fix the fixture, not the
assertion** — a closeout test that stops checking the total is the vacuous shape this
project has shipped before.

- [x] **Step 13: Commit**

```bash
git add supabase/migrations/20260919000043_collections_shift_id.sql \
        supabase/migrations/20260919000044_correction_preserves_shift.sql \
        packages/shared/src/sync-contract.ts packages/shared/src/db.types.ts \
        tests/db/shift-scoped-closeout.test.ts
git commit -m "feat(sync): scope closeout by shift_id, and keep it through a correction

Retires the deferral Phase 3a recorded: close_shift summed every collection
for (collector_id, business_date), which refused an honest closeout when a
collector worked two tablets or opened a second shift the same day. Failed
safe, but refused someone who had done nothing wrong.

Spec E3: resolve_exception_corrected now re-asserts shift_id from the
device's stored payload alongside id and device_id. A corrected receipt is
cash that was in that collector's drawer during that shift; a correction
that moved it would unbalance a closeout that had already balanced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Edge Function payload validation, from a generated contract

Closes Phase 3a's first deferred item. `sync-contract.ts` is imported by none of the three
Edge Functions, so the server accepts arbitrary JSON and a malformed payload returns as a
`server_error` a supervisor must decode from a `detail` string.

**Files:**
- Create: `scripts/generate-edge-contract.mjs`
- Create: `supabase/functions/_shared/contract.ts` (generated)
- Create: `supabase/functions/_shared/validate.ts`
- Modify: `supabase/functions/sync-pull/index.ts`, `sync-push/index.ts`, `closeout/index.ts`
- Modify: `supabase/functions/deno.json`
- Create: `tests/http/contract-validation.test.ts`

**Interfaces:**
- Consumes: `PushRequest`, `PullRequest`, `CloseoutRequest` from
  `packages/shared/src/sync-contract.ts` (Task 4 added `shift_id` to `CollectionPayload`).
- Produces: `validateBody<T>(schema, body): { ok: true; value: T } | { ok: false; response: Response }`.

- [x] **Step 1: Write the failing test**

Create `tests/http/contract-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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
```

- [x] **Step 2: Run it to verify it fails**

```bash
supabase start && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run http/contract-validation.test.ts
```

Expected: FAIL — the first three get 401 (authentication runs first and there is no
validation), not 400.

- [x] **Step 3: Write the generator**

Create `scripts/generate-edge-contract.mjs`:

```js
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
// Run \`node scripts/generate-edge-contract.mjs\` to regenerate from
// packages/shared/src/sync-contract.ts, which is the only source of truth for this
// contract. tests/http/contract-validation.test.ts fails if this copy is stale.
`;

let source = readFileSync(SOURCE, "utf8");

// Two rewrites, and only two. Everything else is copied byte for byte, so a change to the
// contract's meaning cannot be introduced here by accident.
//
//   1. zod resolves from npm: under Deno rather than from node_modules.
//   2. reason-codes.ts is a sibling in packages/shared, so its relative import must become
//      an inline copy -- Deno has no node_modules to walk up into.
source = source.replace(
  /^import \{ z \} from "zod";$/m,
  'import { z } from "npm:zod@4";',
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

source = source.replace(
  /^import \{ REJECT_REASONS, type RejectReason \} from ".\/reason-codes";$/m,
  `${REJECT_REASONS[0]}\ntype RejectReason = (typeof REJECT_REASONS)[number];`,
);

// The re-export of RejectReason has nothing to re-export from once the import is inlined.
source = source.replace(/^export type \{ RejectReason \};$/m, "export type { RejectReason };");

writeFileSync(TARGET, HEADER + source);
console.log(`Wrote ${TARGET}`);
```

- [x] **Step 4: Generate the copy and wire up the npm script**

```bash
node scripts/generate-edge-contract.mjs
```

Add to the root `package.json` `"scripts"`:

```json
    "edge:contract": "node scripts/generate-edge-contract.mjs",
```

Open the generated `supabase/functions/_shared/contract.ts` and read it. If the two rewrites
left anything Deno cannot resolve, fix **the generator**, never the generated file.

- [x] **Step 5: Write the validator**

Create `supabase/functions/_shared/validate.ts`:

```ts
import type { z } from "npm:zod@4";
import { fail, json } from "./respond.ts";

/**
 * Validates a request body, or returns the 400 to send back.
 *
 * WHAT CROSSES THE WIRE ON FAILURE, AND WHY IT IS NOT THE ZodError. This endpoint is
 * reached by an unauthenticated client over the public internet -- the same reason
 * respond.ts keeps its error codes terse. A zod issue carries a path and a message, which
 * is what a device developer needs to fix a payload; it can also carry received values,
 * which is what a payload's own contents would leak straight back out. Only `path` and
 * `message` are forwarded.
 *
 * VALIDATION RUNS BEFORE AUTHENTICATION, deliberately. A malformed body is malformed
 * whoever sent it, and telling a client its payload is wrong reveals nothing a reading of
 * the published contract would not. The reverse order would make every contract bug look
 * like a credential problem to whoever is holding the tablet.
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { ok: true; value: T } | { ok: false; response: Response } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };

  return {
    ok: false,
    response: json(
      {
        error: "invalid_body",
        detail: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    ),
  };
}

export { fail };
```

- [x] **Step 6: Wire the three handlers**

`supabase/functions/sync-push/index.ts` becomes:

```ts
import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";
import { validateBody } from "../_shared/validate.ts";
import { PushRequest } from "../_shared/contract.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  // Before authentication -- see validate.ts on why that order is deliberate.
  const valid = validateBody(PushRequest, body);
  if (!valid.ok) return valid.response;

  const auth = await authenticateDevice(valid.value.credential_id, valid.value.secret);
  if (!auth) return fail("unauthorized", 401);

  const { data, error } = await auth.client.rpc("sync_push", {
    p_device_id: auth.deviceId,
    p_entries: valid.value.entries,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
```

Apply the same three-line shape to `sync-pull/index.ts` with `PullRequest` and to
`closeout/index.ts` with `CloseoutRequest`, reading each file first and changing only the
body-handling and the RPC argument source. **The `Array.isArray(body.entries)` check in
`sync-push` is now dead and must be deleted** — leaving it means a malformed `entries` still
returns the old bare `bad_request` and the new test's field-naming assertion never runs.

- [x] **Step 7: Add zod to the Deno import map**

`supabase/functions/deno.json` becomes:

```json
{
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2",
    "npm:zod@4": "npm:zod@4"
  }
}
```

- [x] **Step 8: Write the staleness test**

Append to `tests/http/contract-validation.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

describe("the generated Deno contract copy", () => {
  it("is identical to what the generator would write right now", () => {
    // The whole justification for generating rather than hand-copying is that drift becomes
    // a red test. This is that test. If it fails, run `pnpm edge:contract` and commit the
    // result -- never edit supabase/functions/_shared/contract.ts by hand.
    const path = "supabase/functions/_shared/contract.ts";
    const before = readFileSync(path, "utf8");
    execFileSync("node", ["scripts/generate-edge-contract.mjs"], { cwd: process.cwd() });
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });
});
```

Note the working directory: this test runs from `tests/`, so adjust the relative paths to
`../supabase/...` and `../scripts/...` if the first run fails on a missing file.

- [x] **Step 9: Run the tests to verify they pass**

```bash
supabase stop && supabase start && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run http/contract-validation.test.ts
```

Expected: PASS, 6 tests. Edge Functions are served from disk by `supabase start`, so a
restart is what picks up the handler changes.

- [x] **Step 10: Verify the staleness test is falsifiable**

Add a stray blank line to `supabase/functions/_shared/contract.ts` and re-run. Expected:
the staleness test FAILS. Regenerate with `pnpm edge:contract` to restore it. A drift
detector that cannot detect drift is the whole point of this task, unmet.

- [x] **Step 11: Run the full HTTP suite**

```bash
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run http/
```

Expected: PASS. `round-trip.test.ts` now pushes through a validating handler — if it fails,
its payloads were relying on the server's former tolerance, and **the payloads are what is
wrong**, not the schema.

- [x] **Step 12: Commit**

```bash
git add scripts/generate-edge-contract.mjs supabase/functions package.json \
        tests/http/contract-validation.test.ts
git commit -m "feat(functions): validate request bodies against a generated contract copy

Closes Phase 3a's first deferred item. The three Edge Functions imported
sync-contract.ts nowhere, so the server accepted arbitrary JSON and a
malformed payload came back as a server_error with a raw detail string.

Generated rather than hand-copied: the contract is the one file whose
purpose is being identical on both ends, so a duplicate would trade a
visible gap for invisible drift. A staleness test makes drift a red build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `packages/db-local` — the device schema

**Files:**
- Create: `packages/db-local/package.json`, `tsconfig.json`, `drizzle.config.ts`
- Create: `packages/db-local/src/schema.ts`, `src/index.ts`
- Create: `packages/db-local/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Drizzle table objects — `syncState`, `outbox`, `localShifts`, `pinAttempts`,
  plus the 17 mirrored pull tables; and `PULLED_TABLES: readonly string[]`, the list a
  reset empties.

- [x] **Step 1: Create the package**

```bash
mkdir -p packages/db-local/src
```

`packages/db-local/package.json`:

```json
{
  "name": "@ceedo/db-local",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "generate": "drizzle-kit generate"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "better-sqlite3": "^11.0.0",
    "@types/better-sqlite3": "^7.6.0"
  },
  "dependencies": { "drizzle-orm": "^0.44.0" }
}
```

`packages/db-local/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

`packages/db-local/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

/**
 * `driver: 'expo'` makes drizzle-kit emit migrations that bundle into the app and apply
 * through `useMigrations` at startup, rather than migrations run against a live URL. The
 * Node test driver replays the same generated SQL, so both ends share one schema history.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
```

- [x] **Step 2: Write the failing test**

Create `packages/db-local/src/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PULLED_TABLES, DEVICE_AUTHORED_TABLES } from "./schema";

describe("the device schema's two halves", () => {
  /**
   * SPEC E8 LIVES OR DIES ON THIS SPLIT. An epoch reset wipes pulled data and pulls from
   * cursor 0. It must NEVER touch device-authored state -- the outbox is a collector's
   * record of cash already taken, and discarding it on a reassignment is precisely the
   * failure spec §6.3 exists to prevent.
   *
   * Encoding the split as two lists, with a test that they cannot overlap, means a table
   * added later has to be classified deliberately rather than defaulting into the wipe.
   */
  it("never lists a table as both pulled and device-authored", () => {
    const overlap = PULLED_TABLES.filter((t) =>
      (DEVICE_AUTHORED_TABLES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });

  it("holds the outbox, local shifts, PIN attempts and sync state as device-authored", () => {
    expect([...DEVICE_AUTHORED_TABLES].sort()).toEqual(
      ["outbox", "local_shifts", "pin_attempts", "sync_state"].sort(),
    );
  });

  it("mirrors all 17 arrays sync_pull returns", () => {
    // Verified against sync_pull's jsonb_build_object key list, migration
    // 20260918000037_sync_pull_truncate.sql. `devices` is deliberately NOT among them:
    // the authenticate heartbeat bumps devices.row_version on every call, and the device
    // never receives its own row, so that churn costs cursor motion and no payload.
    expect([...PULLED_TABLES].sort()).toEqual(
      [
        "facilities", "sections", "stalls", "tenants", "leases",
        "fee_types", "rates", "collectors", "booklets", "booklet_assignments",
        "consumed_serials", "spoiled_forms", "charges", "collections",
        "collection_allocations", "collection_cancellations", "charge_condonations",
      ].sort(),
    );
  });
});
```

- [x] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @ceedo/db-local exec vitest run
```

Expected: FAIL — `Cannot find module './schema'`.

- [x] **Step 4: Write the device-authored tables**

Create `packages/db-local/src/schema.ts`, beginning with the four tables the device writes
itself. These are novel and every column is load-bearing, so they are given in full:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * TYPE CONVENTIONS, AND WHY THEY ARE NOT NEGOTIABLE.
 *
 *   money      -> text. numeric(14,2) through a JS number is a float, and this is a cash
 *                 ledger. packages/shared/src/money.ts is the only thing that does
 *                 arithmetic on these, and it takes strings.
 *   timestamps -> text, ISO 8601 with offset. SQLite has no date type; a text ISO string
 *                 sorts correctly and round-trips to the wire unchanged.
 *   uuid       -> text.
 *   row_version-> integer. It is a bigint server-side, but it is a sequence counter, not
 *                 money -- Number.MAX_SAFE_INTEGER is nine quadrillion and this sequence
 *                 advances a few times per device call.
 *   booleans   -> integer with mode: "boolean".
 */

/**
 * One row, id always 1. Holds the sync cursor, the assignment epoch, and the business date
 * of the last full re-sync (spec E9).
 */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  cursor: integer("cursor").notNull().default(0),
  epoch: integer("epoch").notNull().default(0),
  // E9. A deleted stall is invisible to a cursor delta forever, so a full re-sync on the
  // first sync of each business date bounds any ghost row's life to one working day.
  lastFullSyncDate: text("last_full_sync_date"),
});

/**
 * The outbox. Parent spec §6.4.
 *
 * `collectorId` is on every row and is never derived from the current session: a shared
 * tablet's second collector must not see the first collector's unsynced receipts
 * disappear or be re-attributed. Signing out clears a session, never data.
 */
export const outbox = sqliteTable("outbox", {
  // The client-generated UUID. It is the idempotency key the server keys on, so it is the
  // primary key here too -- a re-push is safe precisely because this value never changes.
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["collection", "spoiled_form", "shift_open", "shift_close"],
  }).notNull(),
  payload: text("payload").notNull(),
  collectorId: text("collector_id").notNull(),
  createdAt: text("created_at").notNull(),
  // `in_flight` means "sent, outcome unknown". Spec E11: these are RE-PUSHED on the next
  // sync, never skipped. The server answers `duplicate` if the first push did commit.
  state: text("state", {
    enum: ["pending", "in_flight", "acked", "rejected"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  reasonCode: text("reason_code"),
  retryable: integer("retryable", { mode: "boolean" }),
  lastResult: text("last_result"),
  // Insertion order, so a shift_open is pushed before any collection carrying its
  // shift_id (migration 20260919000043 made collections.shift_id a foreign key).
  seq: integer("seq").notNull(),
});

/**
 * Shifts as the device knows them. Distinct from the mirrored server `shifts` rows,
 * because a `closed_unsynced` shift exists only here until it pushes.
 */
export const localShifts = sqliteTable("local_shifts", {
  id: text("id").primaryKey(),
  collectorId: text("collector_id").notNull(),
  businessDate: text("business_date").notNull(),
  openedAt: text("opened_at").notNull(),
  // Three states, and the sign-in gate (spec E10) tests for `open` SPECIFICALLY.
  // `closed_unsynced` is finished from the collector's point of view and must not block
  // the next person, while still being pending in the outbox. A gate written as
  // `status <> 'closed'` reads as equivalent, is not, and strands the next collector.
  status: text("status", {
    enum: ["open", "closed_unsynced", "closed"],
  })
    .notNull()
    .default("open"),
  closedAt: text("closed_at"),
  declaredTotal: text("declared_total"),
  deviceCount: integer("device_count"),
  deviceTotal: text("device_total"),
});

/**
 * Five-failed-attempt lock, per collector. Parent spec §11.5.
 *
 * IN SQLITE, NOT IN MEMORY. A lock that resets when the app restarts is not a lock, and
 * force-quitting an app is not a skill a thief has to acquire.
 */
export const pinAttempts = sqliteTable("pin_attempts", {
  collectorId: text("collector_id").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedAt: text("locked_at"),
});

export const DEVICE_AUTHORED_TABLES = [
  "sync_state",
  "outbox",
  "local_shifts",
  "pin_attempts",
] as const;
```

- [x] **Step 5: Write the mirrored tables**

Append to `schema.ts` one `sqliteTable` per pulled array. **Derive the columns from
`packages/shared/src/db.types.ts`**, which `pnpm db:types` generates from the live Postgres
schema — that file is the source of truth, and transcribing its columns into this plan would
create the second copy this phase exists to avoid.

Rules for the transcription, applied to every mirrored table:

1. The primary key matches the server's (`id` for all but `consumed_serials`, which is keyed
   `(booklet_id, or_no)`).
2. **Every non-key column is nullable**, even where Postgres has `NOT NULL`. The device is a
   cache, not an authority; a column added server-side and not yet understood here must land
   rather than abort an apply.
3. Types follow the conventions in Step 4's header comment.
4. Each table carries `rowVersion: integer("row_version")` where the server table has one.

One worked example, which is the pattern for the other sixteen:

```ts
export const charges = sqliteTable("charges", {
  id: text("id").primaryKey(),
  leaseId: text("lease_id"),
  feeTypeId: text("fee_type_id"),
  chargeType: text("charge_type"),
  parentChargeId: text("parent_charge_id"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  dueDate: text("due_date"),
  // text, not real: this is money. See the header comment.
  amount: text("amount"),
  surchargeBps: integer("surcharge_bps"),
  source: text("source"),
  createdAt: text("created_at"),
  createdBy: text("created_by"),
  rowVersion: integer("row_version"),
});
```

Close the file with:

```ts
export const PULLED_TABLES = [
  "facilities", "sections", "stalls", "tenants", "leases",
  "fee_types", "rates", "collectors", "booklets", "booklet_assignments",
  "consumed_serials", "spoiled_forms", "charges", "collections",
  "collection_allocations", "collection_cancellations", "charge_condonations",
] as const;
```

And `packages/db-local/src/index.ts`:

```ts
export * from "./schema";
```

- [x] **Step 6: Run the test to verify it passes**

```bash
pnpm install && pnpm --filter @ceedo/db-local exec vitest run
```

Expected: PASS, 3 tests.

- [x] **Step 7: Generate the migrations**

```bash
pnpm --filter @ceedo/db-local exec drizzle-kit generate
```

Expected: `packages/db-local/drizzle/0000_*.sql` plus `drizzle/meta/`. Read the generated
SQL and confirm it creates all 21 tables.

- [x] **Step 8: Commit**

```bash
git add packages/db-local pnpm-lock.yaml
git commit -m "feat(db-local): Drizzle schema for the device's SQLite

Two halves, kept apart by a test that forbids overlap: PULLED_TABLES, which
an epoch reset empties, and DEVICE_AUTHORED_TABLES, which it must never
touch. The outbox is a record of cash already taken; discarding it on a
reassignment is the failure spec 6.3 exists to prevent.

Money is text throughout. numeric(14,2) through a JS number is a float and
this is a cash ledger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `packages/sync-engine` — interfaces, pull and apply

Spec E1 and E7. The engine is pure TypeScript behind two interfaces; apply and cursor
advance commit together.

**Files:**
- Create: `packages/sync-engine/package.json`, `tsconfig.json`
- Create: `packages/sync-engine/src/driver.ts`, `src/apply.ts`, `src/index.ts`
- Create: `packages/sync-engine/src/testing/better-sqlite-driver.ts`
- Create: `packages/sync-engine/src/apply.test.ts`

**Interfaces:**
- Consumes: `PULLED_TABLES`, `DEVICE_AUTHORED_TABLES` from `@ceedo/db-local`;
  `PullResponse` from `@ceedo/shared`.
- Produces:
  - `interface SqliteDriver { execute(sql, params?): Promise<void>; select<T>(sql, params?): Promise<T[]>; transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T> }`
  - `interface Transport { post(fn: "sync-pull" | "sync-push" | "closeout", body: unknown): Promise<{ status: number; body: unknown }> }`
  - `applyPull(driver: SqliteDriver, response: PullResponse): Promise<void>`
  - `readSyncState(driver: SqliteDriver): Promise<{ cursor: number; epoch: number; lastFullSyncDate: string | null }>`
  - `betterSqliteDriver(db: Database): SqliteDriver` (test-only)

- [x] **Step 1: Create the package**

```bash
mkdir -p packages/sync-engine/src/testing
```

`packages/sync-engine/package.json`:

```json
{
  "name": "@ceedo/sync-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/better-sqlite-driver.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "better-sqlite3": "^11.0.0",
    "@types/better-sqlite3": "^7.6.0"
  },
  "dependencies": {
    "@ceedo/shared": "workspace:*",
    "@ceedo/db-local": "workspace:*"
  }
}
```

`packages/sync-engine/tsconfig.json`: identical to `packages/db-local/tsconfig.json`.

- [x] **Step 2: Write the interfaces**

Create `packages/sync-engine/src/driver.ts`:

```ts
/**
 * THE INTERFACE IS ASYNC-SHAPED BECAUSE THE CONSTRAINED DRIVER IS, NOT BECAUSE NODE IS.
 *
 * Phase 3a found two production-blocking bugs that a 641-test green suite could not see,
 * because the test connection was exempt from things the real caller was not. A driver
 * interface is the same opportunity one level down: `better-sqlite3` is synchronous and
 * `expo-sqlite` is not, and an interface shaped to the convenient driver would let Node
 * tests pass against orderings the tablet cannot produce.
 *
 * So the interface is shaped to `expo-sqlite`. The Node driver wraps its synchronous calls
 * in already-resolved promises, which is strictly the easy direction.
 *
 * This is not sufficient on its own. Spec E1 also requires one on-device test that runs
 * this same engine against `expo-sqlite` -- the local translation of "connect as
 * authenticator, not set role ceedo_app". That test is Task 10.
 */
export interface SqliteDriver {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  select<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /**
   * Runs `fn` inside one transaction, passing a driver bound to it. Commits on resolve,
   * rolls back on throw.
   */
  transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T>;
}

export interface Transport {
  post(
    fn: "sync-pull" | "sync-push" | "closeout",
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
}
```

- [x] **Step 3: Write the failing test**

Create `packages/sync-engine/src/apply.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { applyPull, readSyncState } from "./apply";
import type { SqliteDriver } from "./driver";

/**
 * A schema small enough to reason about, carrying the two properties that matter: a table
 * the pull writes, and the sync_state row it advances alongside.
 */
const SCHEMA = `
  create table sync_state (
    id integer primary key,
    cursor integer not null default 0,
    epoch integer not null default 0,
    last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 0, 0);
  create table charges (
    id text primary key, lease_id text, amount text, row_version integer
  );
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
`;

function pull(cursor: number, charges: unknown[]) {
  return { cursor, epoch: 0, charges };
}

describe("applyPull", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("inserts rows and advances the cursor", async () => {
    await applyPull(driver, pull(42, [{ id: "c1", lease_id: "l1", amount: "100.00", row_version: 7 }]));

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 1 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 42, epoch: 0 });
  });

  it("upserts by primary key rather than failing on a re-delivered row", async () => {
    await applyPull(driver, pull(1, [{ id: "c1", lease_id: "l1", amount: "100.00", row_version: 1 }]));
    await applyPull(driver, pull(2, [{ id: "c1", lease_id: "l1", amount: "250.00", row_version: 2 }]));

    const row = db.prepare("select amount, row_version from charges where id = 'c1'").get();
    expect(row).toEqual({ amount: "250.00", row_version: 2 });
  });

  /**
   * SPEC E7, AND THE REASON IT IS A REQUIREMENT RATHER THAN A PREFERENCE.
   *
   * If apply and the cursor advance are two transactions, a crash between them has two
   * possible outcomes and only one is safe. Cursor-first loses every row in the failed
   * batch permanently -- the next delta starts past them, and nothing but a full re-sync
   * recovers, which may not happen for months. Committing them together makes every crash
   * the redundant kind: the batch is re-delivered and re-applied harmlessly.
   *
   * This test drives a failure mid-apply and asserts the cursor did NOT move. It is the
   * falsifiable form: against a two-transaction implementation the cursor reads 99.
   */
  it("leaves the cursor untouched when the apply fails partway", async () => {
    // POISON FIRST, AND THE ORDER IS load-bearing. insertRows derives its column list from
    // the FIRST row of each chunk, so a bad row in second position contributes no columns,
    // binds nothing, and the insert SUCCEEDS -- the test would pass while proving nothing.
    // First position puts `nonexistent_column` in the statement and SQLite rejects it.
    const poison = { id: "c2", nonexistent_column: "boom" };
    const good = { id: "c1", lease_id: "l1", amount: "100.00", row_version: 1 };

    await expect(applyPull(driver, pull(99, [poison, good]))).rejects.toThrow(
      /no column named nonexistent_column/i,
    );

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 0 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 0 });
  });

  it("chunks a batch larger than SQLite's bound-parameter ceiling", async () => {
    /**
     * SQLITE_MAX_VARIABLE_NUMBER is 999 on older builds and 32766 on newer ones. A first
     * sync of a long-delinquent stall is ~730 charge rows at 4 bound parameters each --
     * 2,920 parameters in one statement, which is over the older ceiling and under the
     * newer one. That is the worst possible position: it works on the developer's machine
     * and fails on some tablets.
     *
     * 1,500 rows is chosen to exceed BOTH ceilings when unchunked (6,000 parameters), so
     * this test fails against an unchunked implementation on every build of SQLite rather
     * than only on the unlucky ones.
     */
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${i}`,
      lease_id: "l1",
      amount: "100.00",
      row_version: i,
    }));

    await applyPull(driver, pull(1500, rows));

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 1500 });
  });

  it("ignores envelope keys that are not tables", async () => {
    // `cursor` and `epoch` are siblings of the table arrays in the same envelope. An apply
    // that walked every key would try to insert into a table named "cursor".
    await applyPull(driver, { cursor: 5, epoch: 2, charges: [] });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 5, epoch: 2 });
  });
});
```

- [x] **Step 4: Run it to verify it fails**

```bash
pnpm install && pnpm --filter @ceedo/sync-engine exec vitest run
```

Expected: FAIL — `Cannot find module './apply'`.

- [x] **Step 5: Write the Node driver**

Create `packages/sync-engine/src/testing/better-sqlite-driver.ts`:

```ts
import type Database from "better-sqlite3";
import type { SqliteDriver } from "../driver";

/**
 * TEST-ONLY. The engine's Node-side driver.
 *
 * better-sqlite3 is synchronous, so every method here wraps a completed call in a resolved
 * promise. That is the easy direction, and it is why driver.ts insists the INTERFACE be
 * shaped to expo-sqlite instead: the reverse -- a synchronous interface with an async
 * implementation squeezed underneath -- is not possible, and an interface shaped to this
 * driver would let Node tests pass against orderings the tablet cannot produce.
 */
export function betterSqliteDriver(db: Database.Database): SqliteDriver {
  const driver: SqliteDriver = {
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
    async transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T> {
      // better-sqlite3's own `transaction()` helper cannot wrap an async function, so the
      // statements are issued directly. Nested transactions are not used by this engine.
      db.prepare("begin").run();
      try {
        const result = await fn(driver);
        db.prepare("commit").run();
        return result;
      } catch (error) {
        db.prepare("rollback").run();
        throw error;
      }
    },
  };
  return driver;
}
```

- [x] **Step 6: Write `apply.ts`**

Create `packages/sync-engine/src/apply.ts`:

```ts
import { PULLED_TABLES } from "@ceedo/db-local";
import type { SqliteDriver } from "./driver";

/**
 * Rows per INSERT statement.
 *
 * SQLITE_MAX_VARIABLE_NUMBER is 999 on older SQLite builds and 32766 on newer ones. At the
 * widest mirrored table (~16 columns) 50 rows is 800 parameters, inside the older ceiling
 * with room to spare. Chunking is not an optimisation here: an unchunked first sync works
 * on a development machine and fails on whichever tablets ship the older limit.
 */
const CHUNK = 50;

export interface SyncStateRow {
  cursor: number;
  epoch: number;
  lastFullSyncDate: string | null;
}

export async function readSyncState(driver: SqliteDriver): Promise<SyncStateRow> {
  const rows = await driver.select<{
    cursor: number;
    epoch: number;
    last_full_sync_date: string | null;
  }>("select cursor, epoch, last_full_sync_date from sync_state where id = 1");
  const row = rows[0];
  if (!row) throw new Error("sync_state row 1 is missing; the device schema is not migrated");
  return { cursor: row.cursor, epoch: row.epoch, lastFullSyncDate: row.last_full_sync_date };
}

/**
 * Applies a pull envelope and advances the cursor IN ONE TRANSACTION (spec E7).
 *
 * Splitting them has two possible outcomes after a crash and only one is safe. Advancing
 * the cursor first loses every row in the failed batch permanently, because the next delta
 * starts past them and only a full re-sync recovers. Committing together makes every crash
 * the redundant kind.
 *
 * Rows upsert by primary key: the cursor can legitimately re-deliver a row (a row whose
 * row_version advanced again between two pulls), and a plain insert would abort the batch.
 */
export async function applyPull(
  driver: SqliteDriver,
  response: Record<string, unknown>,
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const table of PULLED_TABLES) {
      const rows = response[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      await insertRows(tx, table, rows as Record<string, unknown>[]);
    }

    await tx.execute(
      "update sync_state set cursor = ?, epoch = ? where id = 1",
      [Number(response.cursor ?? 0), Number(response.epoch ?? 0)],
    );
  });
}

async function insertRows(
  tx: SqliteDriver,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  // Column names come from the first row of each chunk, so a server that adds a column
  // lands it without a schema change here -- and a server that omits one does not write
  // nulls over data the device already holds.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const first = chunk[0];
    if (!first) continue;
    const columns = Object.keys(first);
    if (columns.length === 0) continue;

    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const sql =
      `insert into ${table} (${columns.join(", ")}) values ` +
      chunk.map(() => placeholders).join(", ") +
      ` on conflict do update set ` +
      columns.map((c) => `${c} = excluded.${c}`).join(", ");

    const params = chunk.flatMap((row) => columns.map((c) => normalise(row[c])));
    await tx.execute(sql, params);
  }
}

/**
 * SQLite binds only null, number, bigint, string and Buffer. A boolean or a nested object
 * from jsonb would throw at bind time, which inside applyPull's transaction means the whole
 * batch rolls back -- correct, but an unhelpful place to discover a type mismatch.
 */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
```

Add `packages/sync-engine/src/index.ts`:

```ts
export type { SqliteDriver, Transport } from "./driver";
export { applyPull, readSyncState, type SyncStateRow } from "./apply";
```

- [x] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run
```

Expected: PASS, 5 tests.

- [x] **Step 8: Verify the E7 test is falsifiable**

Temporarily change `applyPull` to advance the cursor in its own `driver.transaction` call
*before* the row loop, and re-run. Expected: `"leaves the cursor untouched when the apply
fails partway"` FAILS, reading 99. **Revert.** This is the single assertion standing between
the design and permanent silent row loss, and a version of it that passes either way is
worth nothing.

- [x] **Step 9: Commit**

```bash
git add packages/sync-engine pnpm-lock.yaml
git commit -m "feat(sync-engine): async-shaped driver interface, and an atomic apply

The interface is shaped to expo-sqlite, the constrained driver, not to
better-sqlite3, the convenient one. Phase 3a's bug class was a test
connection exempt from what the real caller faced; a driver interface is
the same opportunity one level down.

Apply and cursor advance commit together (spec E7). Split, a crash between
them loses the batch permanently, because the next delta starts past it.

Inserts chunk at 50 rows: SQLITE_MAX_VARIABLE_NUMBER is 999 on older
builds, so an unchunked first sync works in development and fails on
whichever tablets ship the older limit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Reset, the epoch, and the daily full re-sync

Spec E8 and E9. The reset wipes pulled data and never device-authored state; a full re-sync
runs on the first sync of each business date, which bounds the lifetime of a row deleted
server-side.

**Files:**
- Create: `packages/sync-engine/src/reset.ts`
- Create: `packages/sync-engine/src/reset.test.ts`
- Modify: `packages/sync-engine/src/index.ts`

**Interfaces:**
- Consumes: `PULLED_TABLES`, `DEVICE_AUTHORED_TABLES` (`@ceedo/db-local`); `SqliteDriver`,
  `readSyncState` (Task 7).
- Produces:
  - `resetScopedData(driver: SqliteDriver, businessDate: string): Promise<void>`
  - `needsFullSync(state: SyncStateRow, serverEpoch: number | null, businessDate: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/sync-engine/src/reset.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { resetScopedData, needsFullSync } from "./reset";
import { readSyncState } from "./apply";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch) values (1, 500, 3);
  create table charges (id text primary key, amount text);
  create table leases (id text primary key);
  create table outbox (
    id text primary key, type text, payload text, collector_id text,
    created_at text, state text, attempts integer, reason_code text,
    retryable integer, last_result text, seq integer
  );
  create table local_shifts (
    id text primary key, collector_id text, business_date text, opened_at text,
    status text, closed_at text, declared_total text, device_count integer,
    device_total text
  );
  create table pin_attempts (
    collector_id text primary key, failures integer, locked_at text
  );
`;

describe("resetScopedData", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);

    db.exec(`
      insert into charges (id, amount) values ('c1', '100.00'), ('c2', '250.00');
      insert into leases (id) values ('l1');
      insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
        values ('o1', 'collection', '{}', 'col1', '2026-10-05T09:00:00+08:00', 'pending', 0, 1);
      insert into local_shifts (id, collector_id, business_date, opened_at, status)
        values ('s1', 'col1', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open');
      insert into pin_attempts (collector_id, failures) values ('col1', 3);
    `);
  });

  it("empties every pulled table and rewinds the cursor to zero", async () => {
    await resetScopedData(driver, "2026-10-05");

    expect(db.prepare("select count(*) as n from charges").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from leases").get()).toEqual({ n: 0 });
    expect(await readSyncState(driver)).toMatchObject({ cursor: 0 });
  });

  /**
   * SPEC E8, AND THE WHOLE REASON IT IS WRITTEN DOWN AS A DECISION.
   *
   * Phase 3a's D7 says a device whose assignment_epoch differs "discards its scoped data
   * and pulls from cursor 0". Parent spec §6.4 says outbox entries "survive a change of
   * collector" and that signing out "clears a session, never data". Read carelessly, D7
   * destroys what §6.4 protects: a reassignment mid-round would discard a collector's
   * unsynced receipts -- cash taken, no record, which is exactly the failure §6.3 exists
   * to prevent.
   *
   * THIS TEST STAGES A NON-EMPTY OUTBOX ON PURPOSE. The tempting version of it -- reset a
   * device and assert the outbox is still there -- passes against an implementation that
   * wipes the outbox, because an empty table is still empty afterwards. That is the exact
   * shape of Phase 3a's Task 16 tautology (`outstanding >= 0` with no collections posted),
   * which passed against no implementation at all.
   */
  it("never touches device-authored state", async () => {
    await resetScopedData(driver, "2026-10-05");

    expect(db.prepare("select count(*) as n from outbox").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from local_shifts").get()).toEqual({ n: 1 });
    expect(db.prepare("select failures from pin_attempts where collector_id = 'col1'").get())
      .toEqual({ failures: 3 });
  });

  it("records the business date it ran for, so E9 does not repeat it", async () => {
    await resetScopedData(driver, "2026-10-05");
    expect(await readSyncState(driver)).toMatchObject({ lastFullSyncDate: "2026-10-05" });
  });
});

describe("needsFullSync", () => {
  const base = { cursor: 500, epoch: 3, lastFullSyncDate: "2026-10-05" };

  it("is false on a normal delta on the same day with a matching epoch", () => {
    expect(needsFullSync(base, 3, "2026-10-05")).toBe(false);
  });

  it("is true when the server's epoch differs — D7's reassignment", () => {
    expect(needsFullSync(base, 4, "2026-10-05")).toBe(true);
  });

  it("is true on the first sync of a new business date — spec E9", () => {
    // A cursor delta cannot express a deletion: a deleted row has no row_version to
    // report. DELETE is granted to `authenticated` on ten master-data tables the device
    // caches, so an admin deleting a stall leaves a ghost until an epoch bump that may
    // never come. A daily full re-sync bounds that to one working day.
    expect(needsFullSync(base, 3, "2026-10-06")).toBe(true);
  });

  it("is true on a device that has never fully synced", () => {
    expect(needsFullSync({ ...base, lastFullSyncDate: null }, 3, "2026-10-05")).toBe(true);
  });

  it("is false when the server's epoch is unknown, rather than assuming a reset", () => {
    // A pull that failed before returning an envelope tells us nothing about the epoch.
    // Treating unknown as "changed" would wipe and re-pull on every transient error.
    expect(needsFullSync(base, null, "2026-10-05")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run reset
```

Expected: FAIL — `Cannot find module './reset'`.

- [ ] **Step 3: Write `reset.ts`**

```ts
import { PULLED_TABLES, DEVICE_AUTHORED_TABLES } from "@ceedo/db-local";
import type { SqliteDriver } from "./driver";
import type { SyncStateRow } from "./apply";

/**
 * Empties every pulled table and rewinds the cursor. Spec E8.
 *
 * WHAT IS NOT TOUCHED, AND WHY THAT IS THE POINT. The outbox, local shifts and the PIN
 * attempt counter are device-AUTHORED. Nothing the device wrote itself is ever discarded
 * by a sync operation. A reassignment is a supervisor's administrative act; a collector's
 * unsynced receipts are cash already taken from a vendor who is holding a paper receipt.
 *
 * The table list comes from @ceedo/db-local, where a test forbids a table appearing in
 * both halves -- so a table added later is classified deliberately rather than defaulting
 * into the wipe.
 */
export async function resetScopedData(
  driver: SqliteDriver,
  businessDate: string,
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const table of PULLED_TABLES) {
      // `delete from <table>` with no WHERE is correct here and is not the unqualified-
      // DELETE hazard that bit Phase 3a's sync_pull: pg_safeupdate is a Postgres
      // extension loaded for the `authenticator` role, and this runs in SQLite on the
      // device. There is no equivalent guard and nothing to work around.
      await tx.execute(`delete from ${table}`);
    }
    await tx.execute(
      "update sync_state set cursor = 0, last_full_sync_date = ? where id = 1",
      [businessDate],
    );
  });
}

/**
 * Whether the next sync must be a full re-sync rather than a delta.
 *
 * Three reasons, and they are different failures:
 *
 *   epoch changed   -- D7. The device was reassigned and holds a section's worth of data
 *                      it must no longer show. A cursor delta cannot express "this left
 *                      your scope", because nothing about those rows changed.
 *   new day         -- E9. A cursor delta cannot express a deletion either: a deleted row
 *                      has no row_version to report. DELETE is granted to `authenticated`
 *                      on ten master-data tables the device caches, so a ghost row is a
 *                      real possibility and only a full re-sync clears it.
 *   never synced    -- there is no delta to take.
 *
 * A null serverEpoch means the pull did not return one -- a transport failure, not a
 * reassignment. Treating unknown as changed would wipe and re-pull on every flaky moment
 * of a market round, which is the opposite of what an offline-first device needs.
 */
export function needsFullSync(
  state: SyncStateRow,
  serverEpoch: number | null,
  businessDate: string,
): boolean {
  if (state.lastFullSyncDate === null) return true;
  if (state.lastFullSyncDate !== businessDate) return true;
  if (serverEpoch !== null && serverEpoch !== state.epoch) return true;
  return false;
}

export { DEVICE_AUTHORED_TABLES };
```

Add to `packages/sync-engine/src/index.ts`:

```ts
export { resetScopedData, needsFullSync } from "./reset";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Verify the E8 test is falsifiable**

Temporarily add `"outbox"` to the loop in `resetScopedData` (iterate
`[...PULLED_TABLES, "outbox"]`) and re-run. Expected: `"never touches device-authored
state"` FAILS with `{ n: 0 }`. **Revert.**

This check is the whole reason the test stages a non-empty outbox. Confirm by also
temporarily deleting the three `insert into outbox/local_shifts/pin_attempts` lines from the
fixture and re-running with the wipe still in place: the test now **passes** while the
implementation destroys a collector's cash records. That is the tautology shape, seen
directly.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-engine
git commit -m "feat(sync-engine): epoch reset and the daily full re-sync

Spec E8: the reset empties pulled tables and never device-authored state.
D7 says discard scoped data; §6.4 says the outbox survives everything. Read
carelessly the first destroys what the second protects, and a reassignment
mid-round would discard receipts for cash already taken.

Spec E9: a full re-sync on the first sync of each business date. A cursor
delta cannot express a deletion, and DELETE is granted to `authenticated`
on ten master-data tables the device caches.

The reset test stages a NON-EMPTY outbox deliberately. The obvious version
passes against an implementation that wipes it, which is Phase 3a's Task 16
tautology exactly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: The outbox and the sync loop

Spec E11 and parent §6.4. This is the task where the engine becomes a whole round trip.

**Files:**
- Create: `packages/sync-engine/src/outbox.ts`, `src/sync.ts`
- Create: `packages/sync-engine/src/outbox.test.ts`
- Create: `tests/device/round-trip.test.ts`
- Modify: `packages/sync-engine/src/index.ts`
- Modify: `tests/package.json` (add `@ceedo/sync-engine`, `@ceedo/db-local`, `better-sqlite3`)

**Interfaces:**
- Consumes: `SqliteDriver`, `Transport` (Task 7); `resetScopedData`, `needsFullSync`
  (Task 8); `PushEntry`, `PushResult` (`@ceedo/shared`).
- Produces:
  - `enqueue(driver, entry: { id: string; type: PushEntry["type"]; payload: unknown; collectorId: string }): Promise<void>`
  - `pushable(driver): Promise<OutboxRow[]>`
  - `applyResults(driver, rows: OutboxRow[], results: PushResult[]): Promise<void>`
  - `sync(deps: { driver; transport; credentialId; secret; businessDate }): Promise<SyncOutcome>`

- [ ] **Step 1: Write the failing outbox test**

Create `packages/sync-engine/src/outbox.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { enqueue, pushable, applyResults, markInFlight } from "./outbox";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
`;

describe("the outbox", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("preserves insertion order, so a shift_open precedes its collections", async () => {
    /**
     * Migration 20260919000043 made collections.shift_id a foreign key to shifts. A
     * collection pushed before the shift_open that creates its shift fails that key, and
     * the entry is rejected with server_error for a reason that has nothing to do with the
     * receipt.
     */
    await enqueue(driver, { id: "s1", type: "shift_open", payload: {}, collectorId: "c" });
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await enqueue(driver, { id: "r2", type: "collection", payload: {}, collectorId: "c" });

    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["s1", "r1", "r2"]);
  });

  /**
   * SPEC E11. `in_flight` MEANS "SENT, OUTCOME UNKNOWN" -- NOT "SOMEONE ELSE'S PROBLEM".
   *
   * A push whose response is lost leaves entries in this state with a genuinely unknown
   * server outcome: the push may have committed and the ack been dropped. Client-generated
   * UUIDs make a re-push safe by construction -- post_collection answers `duplicate` and
   * the entry settles.
   *
   * An implementation that skips in_flight silently drops exactly the receipts a dropped
   * connection created, which is the one condition guaranteed to occur on a market round.
   */
  it("re-pushes in_flight entries rather than skipping them", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await markInFlight(driver, ["r1"]);

    // Simulates the next sync after a lost response: nothing acked it, so it must come back.
    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
    expect(rows[0]?.state).toBe("in_flight");
  });

  it("does not re-push an acked entry", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      { index: 0, type: "collection", status: "accepted" },
    ]);

    expect(await pushable(driver)).toEqual([]);
  });

  it("settles a duplicate as acked, because the server already has it", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      { index: 0, type: "collection", status: "duplicate" },
    ]);

    const row = db.prepare("select state from outbox where id = 'r1'").get();
    expect(row).toEqual({ state: "acked" });
  });

  it("keeps a retryable rejection pushable and counts the attempt", async () => {
    // stale_allocations is the ONLY retryable reason (invariant 24). The device re-pulls
    // and re-pushes on its own; no supervisor is involved and no exception is filed.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      {
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "stale_allocations",
        retryable: true,
      },
    ]);

    const rows = await pushable(driver);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
    expect(rows[0]?.attempts).toBe(1);
  });

  it("stops re-pushing a retryable rejection after the attempt cap", async () => {
    // An unbounded retry on a reason that keeps recurring is a tablet stuck in a loop with
    // a collector watching it. On exhaustion the entry surfaces like any other unresolved
    // one.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    for (let i = 0; i < 5; i++) {
      await applyResults(driver, await pushable(driver), [
        {
          index: 0,
          type: "collection",
          status: "rejected",
          reason: "stale_allocations",
          retryable: true,
        },
      ]);
    }
    expect(await pushable(driver)).toEqual([]);
    const row = db.prepare("select state, attempts from outbox where id = 'r1'").get();
    expect(row).toEqual({ state: "rejected", attempts: 5 });
  });

  it("keeps a permanent rejection out of the push queue but on the device", async () => {
    // Parent §6.3: "A server rejection must never mean discard the record." The collector
    // has handed a vendor a paper receipt and taken their money; that serial is spent.
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "c" });
    await applyResults(driver, await pushable(driver), [
      {
        index: 0,
        type: "collection",
        status: "rejected",
        reason: "or_already_used",
        retryable: false,
      },
    ]);

    expect(await pushable(driver)).toEqual([]);
    const row = db
      .prepare("select state, reason_code from outbox where id = 'r1'")
      .get();
    expect(row).toEqual({ state: "rejected", reason_code: "or_already_used" });
  });

  it("carries collector_id on every row and never derives it from a session", async () => {
    await enqueue(driver, { id: "r1", type: "collection", payload: {}, collectorId: "alice" });
    await enqueue(driver, { id: "r2", type: "collection", payload: {}, collectorId: "bob" });

    const rows = await pushable(driver);
    expect(rows.map((r) => r.collectorId)).toEqual(["alice", "bob"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run outbox
```

Expected: FAIL — `Cannot find module './outbox'`.

- [ ] **Step 3: Write `outbox.ts`**

```ts
import type { PushResult } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

/**
 * How many times a RETRYABLE rejection is re-pushed before it is surfaced to a person.
 *
 * `stale_allocations` is the only retryable reason (invariant 24) and it resolves itself:
 * the device re-pulls, sees the allocations that won the race, and re-pushes. But a reason
 * that keeps recurring under an unbounded retry is a tablet in a loop with a collector
 * watching it, so the retry is bounded and exhaustion is visible.
 */
const MAX_RETRYABLE_ATTEMPTS = 5;

export interface OutboxRow {
  id: string;
  type: "collection" | "spoiled_form" | "shift_open" | "shift_close";
  payload: unknown;
  collectorId: string;
  state: "pending" | "in_flight" | "acked" | "rejected";
  attempts: number;
  seq: number;
}

export async function enqueue(
  driver: SqliteDriver,
  entry: {
    id: string;
    type: OutboxRow["type"];
    payload: unknown;
    collectorId: string;
  },
): Promise<void> {
  await driver.execute(
    `insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
     values (?, ?, ?, ?, ?, 'pending', 0,
             coalesce((select max(seq) from outbox), 0) + 1)
     on conflict (id) do nothing`,
    [
      entry.id,
      entry.type,
      JSON.stringify(entry.payload),
      entry.collectorId,
      new Date().toISOString(),
    ],
  );
}

/**
 * Everything the next push must carry, in insertion order.
 *
 * TWO STATES, NOT ONE. `pending` is obvious. `in_flight` is spec E11: a push whose response
 * was lost left the entry here with an unknown server outcome, and the only safe reading of
 * unknown is "send it again" -- the client UUID makes that idempotent, and the server
 * answers `duplicate` if the first attempt did commit. Skipping in_flight drops precisely
 * the receipts a dropped connection created.
 *
 * ORDER IS `seq`, NOT `created_at`. Two entries written in the same millisecond have the
 * same timestamp, and a shift_open that sorts after its own collections fails their foreign
 * key.
 */
export async function pushable(driver: SqliteDriver): Promise<OutboxRow[]> {
  const rows = await driver.select<{
    id: string;
    type: OutboxRow["type"];
    payload: string;
    collector_id: string;
    state: OutboxRow["state"];
    attempts: number;
    seq: number;
  }>(
    `select id, type, payload, collector_id, state, attempts, seq
       from outbox
      where state in ('pending', 'in_flight')
      order by seq asc`,
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload) as unknown,
    collectorId: row.collector_id,
    state: row.state,
    attempts: row.attempts,
    seq: row.seq,
  }));
}

export async function markInFlight(driver: SqliteDriver, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await driver.execute(
    `update outbox set state = 'in_flight'
      where id in (${ids.map(() => "?").join(", ")})`,
    ids,
  );
}

/**
 * Settles each pushed entry against the server's answer for it.
 *
 * Results are matched BY `index`, which sync_push assigns from its own loop counter, and
 * the rows are passed in the same order they were pushed. Matching by position in the
 * results array instead would silently mis-attribute every entry if the server ever
 * returned them out of order.
 */
export async function applyResults(
  driver: SqliteDriver,
  rows: OutboxRow[],
  results: PushResult[],
): Promise<void> {
  await driver.transaction(async (tx) => {
    for (const result of results) {
      const row = rows[result.index];
      if (!row) continue;

      const attempts = row.attempts + 1;

      // `closed` and `already_closed` are close_shift's successful answers; `mismatch` is
      // not a rejection of the entry but a refusal to close, and the shift stays open.
      if (
        result.status === "accepted" ||
        result.status === "duplicate" ||
        result.status === "closed" ||
        result.status === "already_closed"
      ) {
        await tx.execute(
          `update outbox set state = 'acked', attempts = ?, last_result = ? where id = ?`,
          [attempts, JSON.stringify(result), row.id],
        );
        continue;
      }

      if (result.status === "mismatch") {
        // Stays pushable: the device will reconcile and try again. It is not an error
        // about this entry, it is the server saying the two sides disagree on records.
        await tx.execute(
          `update outbox set state = 'pending', attempts = ?, last_result = ? where id = ?`,
          [attempts, JSON.stringify(result), row.id],
        );
        continue;
      }

      const retryable = result.retryable === true && attempts < MAX_RETRYABLE_ATTEMPTS;
      await tx.execute(
        `update outbox
            set state = ?, attempts = ?, reason_code = ?, retryable = ?, last_result = ?
          where id = ?`,
        [
          retryable ? "pending" : "rejected",
          attempts,
          result.reason ?? null,
          result.retryable === true ? 1 : 0,
          JSON.stringify(result),
          row.id,
        ],
      );
    }
  });
}
```

- [ ] **Step 4: Run the outbox tests to verify they pass**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run outbox
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the E11 test is falsifiable**

Temporarily change `pushable`'s `where` clause to `state = 'pending'` and re-run. Expected:
`"re-pushes in_flight entries rather than skipping them"` FAILS with `[]`. **Revert.**

- [ ] **Step 6: Add outbox retention**

Spec §5.3 and parent §6.4: `acked` entries are purged after 30 days, `rejected` entries are
retained until resolved. Append to `outbox.ts`:

```ts
/**
 * Parent §6.4: "Acked entries are retained for closeout reconciliation and purged after 30
 * days. Rejected entries are retained until resolved."
 *
 * ACKED ONLY, AND THE ASYMMETRY IS THE POINT. A rejected entry is a paper receipt a vendor
 * is holding and money a collector has taken, waiting on a supervisor in `sync_exceptions`;
 * age is not evidence it stopped mattering. An acked entry has a server-side row that is
 * now the record, so the device's copy is a convenience with a shelf life.
 *
 * `in_flight` and `pending` are never purged at any age -- an entry the server may not have
 * is the one thing that must never be deleted on a timer.
 */
export async function purgeAcked(driver: SqliteDriver, olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const doomed = await driver.select<{ n: number }>(
    "select count(*) as n from outbox where state = 'acked' and created_at < ?",
    [cutoff],
  );
  await driver.execute("delete from outbox where state = 'acked' and created_at < ?", [
    cutoff,
  ]);
  return doomed[0]?.n ?? 0;
}
```

And the test, appended to `outbox.test.ts`:

```ts
describe("retention", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);

    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    const insert = db.prepare(
      `insert into outbox (id, type, payload, collector_id, created_at, state, attempts, seq)
       values (?, 'collection', '{}', 'c', ?, ?, 0, ?)`,
    );
    insert.run("old-acked", old, "acked", 1);
    insert.run("old-rejected", old, "rejected", 2);
    insert.run("old-pending", old, "pending", 3);
    insert.run("new-acked", recent, "acked", 4);
  });

  it("purges only acked entries past the window", async () => {
    expect(await purgeAcked(driver)).toBe(1);
    const left = db
      .prepare("select id from outbox order by seq")
      .all()
      .map((r) => (r as { id: string }).id);
    expect(left).toEqual(["old-rejected", "old-pending", "new-acked"]);
  });

  it("never purges a rejected entry, however old", async () => {
    // It is a paper receipt a vendor is holding and money a collector has taken, waiting on
    // a supervisor. Age is not evidence it stopped mattering.
    await purgeAcked(driver, 1);
    const row = db.prepare("select id from outbox where id = 'old-rejected'").get();
    expect(row).toEqual({ id: "old-rejected" });
  });

  it("never purges a pending entry, however old", async () => {
    await purgeAcked(driver, 1);
    const row = db.prepare("select id from outbox where id = 'old-pending'").get();
    expect(row).toEqual({ id: "old-pending" });
  });
});
```

Add `purgeAcked` to the `outbox.ts` export line in `packages/sync-engine/src/index.ts`, and
import it in the test file alongside the others. Run
`pnpm --filter @ceedo/sync-engine exec vitest run outbox` and expect PASS, 11 tests.

- [ ] **Step 7: Write the sync loop**

Create `packages/sync-engine/src/sync.ts`:

```ts
import { PushResult } from "@ceedo/shared";
import type { SqliteDriver, Transport } from "./driver";
import { applyPull, readSyncState } from "./apply";
import { needsFullSync, resetScopedData } from "./reset";
import { applyResults, markInFlight, pushable } from "./outbox";

export interface SyncDeps {
  driver: SqliteDriver;
  transport: Transport;
  credentialId: string;
  secret: string;
  /** The device's own business date, `YYYY-MM-DD`. Drives spec E9's daily full re-sync. */
  businessDate: string;
}

export interface SyncOutcome {
  pulled: boolean;
  fullResync: boolean;
  pushed: number;
  cursor: number;
  epoch: number;
}

/**
 * One sync: decide whether a full re-sync is due, pull, apply, then push the outbox.
 *
 * PULL BEFORE PUSH, DELIBERATELY. `stale_allocations` -- the one retryable rejection -- is
 * resolved by re-pulling and re-pushing, so a device that pushed first would always be
 * pushing against the world as it was one round ago, and would lose the same race twice
 * before winning it.
 */
export async function sync(deps: SyncDeps): Promise<SyncOutcome> {
  const { driver, transport, credentialId, secret, businessDate } = deps;

  let state = await readSyncState(driver);

  // The epoch is not known until a pull has answered, so a due-by-date full re-sync is
  // decided up front and a due-by-epoch one after the first pull.
  let fullResync = needsFullSync(state, null, businessDate);
  if (fullResync) {
    await resetScopedData(driver, businessDate);
    state = await readSyncState(driver);
  }

  const pullRes = await transport.post("sync-pull", {
    credential_id: credentialId,
    secret,
    cursor: state.cursor,
    epoch: state.epoch,
  });
  if (pullRes.status !== 200) {
    throw new SyncError(`sync-pull failed with ${pullRes.status}`, pullRes.status);
  }
  const envelope = pullRes.body as Record<string, unknown>;

  // D7: the device was reassigned. Its cached world is a section it must no longer show,
  // and no row_version moved, so no delta can tell it that.
  if (!fullResync && needsFullSync(state, Number(envelope.epoch), businessDate)) {
    fullResync = true;
    await resetScopedData(driver, businessDate);
    const again = await transport.post("sync-pull", {
      credential_id: credentialId,
      secret,
      cursor: 0,
      epoch: state.epoch,
    });
    if (again.status !== 200) {
      throw new SyncError(`sync-pull failed with ${again.status}`, again.status);
    }
    await applyPull(driver, again.body as Record<string, unknown>);
  } else {
    await applyPull(driver, envelope);
  }

  const rows = await pushable(driver);
  if (rows.length > 0) {
    await markInFlight(
      driver,
      rows.map((r) => r.id),
    );
    const pushRes = await transport.post("sync-push", {
      credential_id: credentialId,
      secret,
      entries: rows.map((r) => ({ type: r.type, payload: r.payload })),
    });
    if (pushRes.status !== 200) {
      // The entries stay in_flight. Spec E11: the next sync re-pushes them, because a lost
      // response is indistinguishable from a lost request and only one of those is safe to
      // assume.
      throw new SyncError(`sync-push failed with ${pushRes.status}`, pushRes.status);
    }
    await applyResults(driver, rows, PushResult.array().parse(pushRes.body));
  }

  const final = await readSyncState(driver);
  return {
    pulled: true,
    fullResync,
    pushed: rows.length,
    cursor: final.cursor,
    epoch: final.epoch,
  };
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
```

Add to `packages/sync-engine/src/index.ts`:

```ts
export { enqueue, pushable, markInFlight, applyResults, type OutboxRow } from "./outbox";
export { sync, SyncError, type SyncDeps, type SyncOutcome } from "./sync";
```

- [ ] **Step 8: Write the round-trip test over real HTTP**

Add to `tests/package.json` `devDependencies`: `"better-sqlite3": "^11.0.0"` and
`"@types/better-sqlite3": "^7.6.0"`. Add to `dependencies`:
`"@ceedo/sync-engine": "workspace:*"` and `"@ceedo/db-local": "workspace:*"`. Then
`pnpm install`.

Create `tests/device/round-trip.test.ts`:

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { betterSqliteDriver } from "@ceedo/sync-engine/testing";
import { enqueue, sync, readSyncState, pushable } from "@ceedo/sync-engine";
import { POSTGRES_URL, createSyncFixture } from "../helpers/supabase";
import { callFunction } from "../helpers/functions";

/**
 * THE ENGINE, OVER REAL HTTP, INTO THE DEPLOYED EDGE FUNCTIONS.
 *
 * This is the layer Phase 3a's postmortem says is worth having: not a mocked transport
 * agreeing with whoever wrote the mock, but the real wire, the real Deno handlers, the real
 * SQL. The only substitution is the SQLite driver, and spec E1 requires Task 10 to close
 * even that with one on-device run.
 */
describe("the device engine, end to end", () => {
  let db: PgClient;
  let fx: Awaited<ReturnType<typeof createSyncFixture>>;
  let sqlite: Database.Database;
  let driver: ReturnType<typeof betterSqliteDriver>;

  const transport = {
    async post(fn: "sync-pull" | "sync-push" | "closeout", body: unknown) {
      return callFunction(fn, body);
    },
  };

  beforeAll(async () => {
    db = new PgClient({ connectionString: POSTGRES_URL });
    await db.connect();
    fx = await createSyncFixture(db);

    sqlite = new Database(":memory:");
    // The SAME generated migration the tablet applies, replayed. A hand-written test schema
    // would be a second definition of the device's tables, free to drift from the one that
    // ships.
    const migrationPath = "../packages/db-local/drizzle";
    const files = readFileSync(`${migrationPath}/meta/_journal.json`, "utf8");
    for (const entry of JSON.parse(files).entries as { tag: string }[]) {
      sqlite.exec(readFileSync(`${migrationPath}/${entry.tag}.sql`, "utf8"));
    }
    sqlite.exec("insert into sync_state (id, cursor, epoch) values (1, 0, 0)");
    driver = betterSqliteDriver(sqlite);
  }, 120_000);

  afterAll(async () => {
    await db.end();
    sqlite.close();
  });

  it("pulls a scoped world, opens a shift, and settles the outbox", async () => {
    const shiftId = randomUUID();
    await enqueue(driver, {
      id: shiftId,
      type: "shift_open",
      payload: {
        id: shiftId,
        collector_id: fx.collectorId,
        business_date: "2026-10-05",
        opened_at: "2026-10-05T08:00:00+08:00",
      },
      collectorId: fx.collectorId,
    });

    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-05",
    });

    expect(outcome.fullResync).toBe(true);
    expect(outcome.pushed).toBe(1);
    expect(outcome.cursor).toBeGreaterThan(0);

    // The world landed.
    const charges = sqlite.prepare("select count(*) as n from charges").get() as { n: number };
    expect(charges.n).toBeGreaterThan(0);

    // The shift settled and is no longer pushable.
    expect(await pushable(driver)).toEqual([]);
    const { rows } = await db.query(
      "select status from ceedo_collections.shifts where id = $1",
      [shiftId],
    );
    expect(rows[0]?.status).toBe("open");
  }, 60_000);

  it("takes a delta on the second sync, not a full re-sync, on the same day", async () => {
    const before = await readSyncState(driver);
    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-05",
    });

    expect(outcome.fullResync).toBe(false);
    expect(outcome.cursor).toBeGreaterThanOrEqual(before.cursor);
  }, 60_000);

  it("takes a full re-sync on a new business date — spec E9", async () => {
    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-06",
    });

    expect(outcome.fullResync).toBe(true);
    expect(outcome.cursor).toBeGreaterThan(0);
  }, 60_000);

  it("discards scoped data but not the outbox when the epoch changes — spec E8", async () => {
    // A queued entry that has NOT yet been pushed, so the assertion below is about survival
    // and not about an empty table trivially staying empty.
    const orphan = randomUUID();
    await enqueue(driver, {
      id: orphan,
      type: "spoiled_form",
      payload: {
        booklet_id: fx.bookletId,
        or_no: 1999,
        collector_id: fx.collectorId,
        reason: "Torn during a rainy round.",
      },
      collectorId: fx.collectorId,
    });

    // Reassign the tablet. The trigger on device_assignments bumps devices.assignment_epoch
    // (migration 20260918000031), which is the entire mechanism behind D7.
    await db.query(
      `update ceedo_collections.device_assignments set active = false where device_id = $1`,
      [fx.deviceId],
    );

    const outcome = await sync({
      driver,
      transport,
      credentialId: fx.credentialId,
      secret: fx.secret,
      businessDate: "2026-10-06",
    });

    expect(outcome.fullResync).toBe(true);
    const still = sqlite
      .prepare("select count(*) as n from outbox where id = ?")
      .get(orphan) as { n: number };
    expect(still.n).toBe(1);
  }, 60_000);
});
```

- [ ] **Step 9: Run it**

```bash
supabase db reset && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm --filter @ceedo/tests exec vitest run device/round-trip.test.ts
```

Expected: PASS, 4 tests. If the migration replay path is wrong, resolve it relative to
`tests/` — the suite's working directory — rather than hardcoding an absolute path.

- [ ] **Step 10: Commit**

```bash
git add packages/sync-engine tests/device tests/package.json pnpm-lock.yaml
git commit -m "feat(sync-engine): the outbox and the sync loop, proved over real HTTP

Spec E11: in_flight entries are re-pushed, never skipped. A lost response is
indistinguishable from a lost request and only one is safe to assume; the
client UUID makes the re-push idempotent and the server answers duplicate.

Pull before push, because stale_allocations -- the one retryable reason --
resolves by re-pulling, so a push-first device would lose the same race
twice before winning it.

The round-trip test runs the engine against the deployed Edge Functions
rather than a mocked transport, which can only ever agree with whoever
wrote the mock.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: The `expo-sqlite` driver, and the on-device engine run

Spec E1's second rule, and the one that closes the driver-exemption trap. Everything up to
here proved the engine against `better-sqlite3`. This task runs the **same engine** against
`expo-sqlite` on the tablet.

**Files:**
- Create: `apps/collector/src/db/driver.ts`, `src/db/client.ts`
- Create: `apps/collector/app/engine-probe.tsx`
- Modify: `apps/collector/package.json`, `babel.config.js`, `metro.config.js`
- Create: `docs/superpowers/measurements/phase-3b-i-device-smoke.md`

**Interfaces:**
- Consumes: `SqliteDriver` (Task 7); `applyPull`, `sync`, `enqueue` (Tasks 7–9).
- Produces: `expoSqliteDriver(db: SQLiteDatabase): SqliteDriver`; `openDeviceDb(): Promise<SQLiteDatabase>`.

- [ ] **Step 1: Install the device dependencies**

```bash
cd apps/collector
pnpm add expo-sqlite expo-secure-store expo-camera drizzle-orm
pnpm add @ceedo/shared@workspace:* @ceedo/db-local@workspace:* @ceedo/sync-engine@workspace:*
pnpm add -D babel-plugin-inline-import
```

- [ ] **Step 2: Configure metro and babel for bundled migrations**

`apps/collector/babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Lets `import migrations from '../drizzle/migrations'` inline the generated .sql files
    // into the bundle, which is how drizzle-kit's `driver: 'expo'` output reaches the
    // device. Without it the import resolves to nothing and useMigrations silently applies
    // no schema.
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
```

`apps/collector/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// A pnpm workspace hoists dependencies to the root, and metro does not walk up out of the
// app directory by default -- so @ceedo/shared, @ceedo/db-local and @ceedo/sync-engine
// would resolve in Node and fail in the bundler.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.sourceExts.push("sql");

module.exports = config;
```

- [ ] **Step 3: Write the `expo-sqlite` driver**

Create `apps/collector/src/db/driver.ts`:

```ts
import type { SQLiteDatabase } from "expo-sqlite";
import type { SqliteDriver } from "@ceedo/sync-engine";

/**
 * The device's driver. The other implementation of this interface is the Node one in
 * @ceedo/sync-engine/testing, and the two are the reason driver.ts's interface is
 * async-shaped: this one genuinely is.
 *
 * `withTransactionAsync` is used rather than hand-issued BEGIN/COMMIT because expo-sqlite
 * serialises access per connection and its own helper is what respects that. Issuing the
 * statements directly here would work until two syncs overlapped.
 */
export function expoSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  const driver: SqliteDriver = {
    async execute(sql, params = []) {
      await db.runAsync(sql, params as never[]);
    },
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return (await db.getAllAsync(sql, params as never[])) as T[];
    },
    async transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T> {
      let result!: T;
      await db.withTransactionAsync(async () => {
        result = await fn(driver);
      });
      return result;
    },
  };
  return driver;
}
```

Create `apps/collector/src/db/client.ts`:

```ts
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";

let handle: SQLiteDatabase | null = null;

/**
 * One database for the life of the app.
 *
 * `defer_foreign_keys` is set per connection rather than per transaction: the pull applies
 * 17 tables in one transaction, and their foreign keys are only consistent once the whole
 * envelope has landed. The alternative is a hand-maintained topological insert order across
 * seventeen tables, which would have to be corrected every time the server adds one.
 */
export function openDeviceDb(): SQLiteDatabase {
  if (handle) return handle;
  handle = openDatabaseSync("ceedo.db");
  handle.execSync("pragma foreign_keys = on; pragma defer_foreign_keys = on;");
  return handle;
}
```

- [ ] **Step 4: Write the on-device probe screen**

Create `apps/collector/app/engine-probe.tsx`:

```tsx
import { useState } from "react";
import { Button, ScrollView, Text } from "react-native";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import migrations from "../drizzle/migrations";
import { openDeviceDb } from "../src/db/client";
import { expoSqliteDriver } from "../src/db/driver";
import { applyPull, readSyncState, enqueue, pushable } from "@ceedo/sync-engine";

/**
 * SPEC E1's SECOND RULE: one on-device test runs the REAL engine against expo-sqlite.
 *
 * Everything in tests/device runs the engine against better-sqlite3, which is synchronous,
 * has different transaction semantics, and a different bound-parameter ceiling. That is the
 * same structural gap Phase 3a had between `postgres` and `ceedo_app`: the double is exempt
 * from things the real driver is not, and no amount of Node testing closes it.
 *
 * This screen is the local translation of "connect as authenticator". It stays in the app
 * after this task -- it costs one route and it is the only thing that will catch an
 * expo-sqlite behaviour change on an SDK upgrade.
 */
export default function EngineProbe() {
  const db = openDeviceDb();
  const { success, error } = useMigrations(drizzle(db), migrations);
  const [log, setLog] = useState<string[]>([]);

  async function run() {
    const out: string[] = [];
    try {
      const driver = expoSqliteDriver(db);
      await driver.execute(
        "insert or ignore into sync_state (id, cursor, epoch) values (1, 0, 0)",
      );

      // 1,500 rows: over BOTH SQLITE_MAX_VARIABLE_NUMBER ceilings when unchunked, so an
      // unchunked apply fails here on every build rather than only the unlucky ones.
      const rows = Array.from({ length: 1500 }, (_, i) => ({
        id: `probe-${i}`,
        lease_id: "probe-lease",
        amount: "100.00",
        row_version: i,
      }));
      await applyPull(driver, { cursor: 1500, epoch: 0, charges: rows });
      const counted = await driver.select<{ n: number }>(
        "select count(*) as n from charges",
      );
      out.push(`apply 1500 rows: ${counted[0]?.n} present`);
      out.push(`cursor: ${(await readSyncState(driver)).cursor}`);

      // The atomicity guarantee, on the real driver. A failing apply must leave the cursor
      // where it was.
      const before = (await readSyncState(driver)).cursor;
      try {
        await applyPull(driver, {
          cursor: 9999,
          epoch: 0,
          charges: [{ id: "bad", no_such_column: 1 }],
        });
        out.push("ATOMICITY FAILED: a bad apply did not throw");
      } catch {
        const after = (await readSyncState(driver)).cursor;
        out.push(
          after === before
            ? `atomicity: cursor held at ${after}`
            : `ATOMICITY FAILED: cursor moved ${before} -> ${after}`,
        );
      }

      await enqueue(driver, {
        id: "probe-entry",
        type: "spoiled_form",
        payload: { reason: "probe" },
        collectorId: "probe-collector",
      });
      out.push(`outbox pushable: ${(await pushable(driver)).length}`);
    } catch (e) {
      out.push(`THREW: ${String(e)}`);
    }
    setLog(out);
  }

  if (error) return <Text>Migration error: {error.message}</Text>;
  if (!success) return <Text>Migrating…</Text>;

  return (
    <ScrollView style={{ padding: 24 }}>
      <Button title="Run the engine against expo-sqlite" onPress={run} />
      {log.map((line) => (
        <Text key={line} selectable>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 5: Copy the generated migrations into the app**

drizzle-kit's `driver: 'expo'` output lives in `packages/db-local/drizzle`. The app imports
it from `apps/collector/drizzle`. Add to `apps/collector/package.json` `"scripts"`:

```json
    "sync-migrations": "rm -rf drizzle && cp -R ../../packages/db-local/drizzle drizzle"
```

Run it:

```bash
cd apps/collector && pnpm sync-migrations
```

- [ ] **Step 6: Run it on the physical tablet**

```bash
cd apps/collector && pnpm expo run:android --device
```

Navigate to the probe screen and press the button. Expected output:

```
apply 1500 rows: 1500 present
cursor: 1500
atomicity: cursor held at 1500
outbox pushable: 1
```

**Any line reading `ATOMICITY FAILED` or `THREW` is a real finding**, not a probe bug —
it means the Node driver is exempt from something `expo-sqlite` enforces, which is exactly
what this task exists to detect. Record it and fix the engine, not the probe.

- [ ] **Step 7: Start the device smoke checklist**

Create `docs/superpowers/measurements/phase-3b-i-device-smoke.md` with the device model,
Android version, and a table with this run's four results. Tasks 11–13 append to it.

- [ ] **Step 8: Commit**

```bash
git add apps/collector docs/superpowers/measurements/phase-3b-i-device-smoke.md
git commit -m "feat(collector): expo-sqlite driver, and the engine run on the tablet

Spec E1's second rule. Everything in tests/device runs the engine against
better-sqlite3, which is synchronous, has different transaction semantics
and a different bound-parameter ceiling. That is the same structural gap
Phase 3a had between postgres and ceedo_app, and no amount of Node testing
closes it.

The probe screen stays in the app. It is the only thing that will catch an
expo-sqlite behaviour change on a future SDK upgrade.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Enrollment — QR on the web, scan-or-type on the device

Spec E6. The credential reaches Keystore-backed storage and nowhere else.

**Files:**
- Modify: `apps/web/components/devices/device-credential-panel.tsx`
- Create: `apps/web/lib/devices/enrollment-payload.ts` + test
- Create: `apps/collector/src/auth/credential-store.ts`
- Create: `apps/collector/app/enroll.tsx`
- Modify: `apps/web/package.json` (add `qrcode`)

**Interfaces:**
- Consumes: `IssueCredentialResult` (`apps/web/lib/devices/credential-actions.ts:26`).
- Produces:
  - `encodeEnrollment(credentialId: string, secret: string): string`
  - `decodeEnrollment(text: string): { credentialId: string; secret: string } | null`
  - `saveCredential(c): Promise<void>`, `loadCredential(): Promise<Credential | null>`,
    `clearCredential(): Promise<void>`

- [ ] **Step 1: Write the failing test for the payload codec**

Create `apps/web/lib/devices/enrollment-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encodeEnrollment, decodeEnrollment } from "./enrollment-payload";

describe("the enrollment payload", () => {
  const credentialId = "cred-11111111-2222-3333-4444-555555555555";
  const secret = "a".repeat(64);

  it("round-trips", () => {
    expect(decodeEnrollment(encodeEnrollment(credentialId, secret))).toEqual({
      credentialId,
      secret,
    });
  });

  it("carries a checksum that rejects a single mistyped character", () => {
    /**
     * Manual entry is the MANDATORY fallback (parent §9.4 sets this rule for QR in this
     * system and the reasoning is identical for a camera that fails at 5am). Sixty-four hex
     * characters typed by hand at a desk will sometimes be wrong, and a wrong secret fails
     * at the first sync with `unauthorized` -- indistinguishable from a revoked credential,
     * a wrong gateway key, or a server that is down.
     *
     * The checksum turns that into an immediate, local, unambiguous error.
     */
    const encoded = encodeEnrollment(credentialId, secret);
    const corrupted = encoded.replace(secret, "b" + secret.slice(1));
    expect(decodeEnrollment(corrupted)).toBeNull();
  });

  it("rejects text that is not an enrollment payload at all", () => {
    expect(decodeEnrollment("https://example.com")).toBeNull();
    expect(decodeEnrollment("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ceedo/web exec vitest run lib/devices/enrollment-payload.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the codec**

Create `apps/web/lib/devices/enrollment-payload.ts`:

```ts
/**
 * The text a QR code carries, and the text an admin types as the fallback.
 *
 * Shared shape, one definition, deliberately: a QR that encodes something the manual path
 * cannot parse would make the fallback a different feature rather than a fallback.
 *
 * Format: `ceedo1:<credentialId>:<secret>:<checksum>`
 */
const PREFIX = "ceedo1";

/**
 * A 4-hex-digit checksum over credentialId and secret.
 *
 * Not a security control -- the secret is in the payload in plaintext, and it has to be,
 * because that is what the device must store. This exists to catch a typo at the moment of
 * entry rather than at the first sync, where a wrong secret is indistinguishable from a
 * revoked credential or an unreachable server.
 */
function checksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 0xffff).toString(16).padStart(4, "0");
}

export function encodeEnrollment(credentialId: string, secret: string): string {
  const body = `${credentialId}:${secret}`;
  return `${PREFIX}:${body}:${checksum(body)}`;
}

export function decodeEnrollment(
  text: string,
): { credentialId: string; secret: string } | null {
  const parts = text.trim().split(":");
  if (parts.length !== 4) return null;
  const [prefix, credentialId, secret, sum] = parts;
  if (prefix !== PREFIX || !credentialId || !secret || !sum) return null;
  if (checksum(`${credentialId}:${secret}`) !== sum) return null;
  return { credentialId, secret };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @ceedo/web exec vitest run lib/devices/enrollment-payload.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Render the QR on the web**

```bash
pnpm --filter @ceedo/web add qrcode
pnpm --filter @ceedo/web add -D @types/qrcode
```

In `apps/web/components/devices/device-credential-panel.tsx`, inside the existing
`{issued ? (...)}` block and directly after the `<dl>` that shows the credential ID and
secret, add a QR rendered from the same values. Import at the top:

```tsx
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { encodeEnrollment } from "@/lib/devices/enrollment-payload";
```

Add inside the component, after the existing `useState` declarations:

```tsx
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!issued?.credentialId || !issued.secret) {
      setQr(null);
      return;
    }
    // Rendered client-side from state that already holds the secret. It must never be sent
    // anywhere to be turned into an image -- the whole point of `issue_device_credential`
    // returning it once is that it exists in exactly one place for one moment.
    QRCode.toDataURL(encodeEnrollment(issued.credentialId, issued.secret), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    }).then(setQr, () => setQr(null));
  }, [issued]);
```

And in the rendered block, after the `</dl>`:

```tsx
          {qr ? (
            <img
              src={qr}
              alt="Enrollment QR code"
              width={256}
              height={256}
              className="mt-3 rounded bg-white p-2"
            />
          ) : (
            <p className="mt-3 text-xs text-amber-900">
              QR could not be rendered. Type the credential ID and secret into the tablet
              instead — the values above are complete.
            </p>
          )}
```

- [ ] **Step 6: Write the device credential store**

Create `apps/collector/src/auth/credential-store.ts`:

```ts
import * as SecureStore from "expo-secure-store";

export interface Credential {
  credentialId: string;
  secret: string;
}

const KEY = "ceedo.device.credential";

/**
 * KEYSTORE-BACKED STORAGE, NEVER AsyncStorage. Mandatory, per the Phase 3a handover.
 *
 * The device credential is long-lived and has NO expiry (spec D2 -- any expiry
 * reintroduces the failure OAuth was rejected for: a tablet that wakes offline with a dead
 * token cannot record anything until it finds signal). Its secret is checked only by hash
 * server-side (D3). So a leaked plaintext secret is a standing liability with nothing
 * bounding it, and AsyncStorage is unencrypted application-readable disk.
 *
 * expo-secure-store puts it behind the Android Keystore. Revocation is server-side --
 * `revoke_device_credential` -- and takes effect on the device's next contact, which is
 * also the only moment it could do any harm.
 */
export async function saveCredential(credential: Credential): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadCredential(): Promise<Credential | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Credential;
    if (!parsed.credentialId || !parsed.secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Used when a device is re-enrolled, NOT when a collector signs out. Signing out clears a
 * session, never data (parent §6.4), and the credential belongs to the tablet rather than
 * to whoever is holding it.
 */
export async function clearCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
```

- [ ] **Step 7: Write the enrollment screen**

Create `apps/collector/app/enroll.tsx` with two paths: a `CameraView` from `expo-camera`
with `barcodeScannerSettings={{ barcodeTypes: ["qr"] }}`, and a `TextInput` pair for manual
entry. Both feed `decodeEnrollment`, and on a non-null result call `saveCredential` then
immediately run one `sync()`.

The mandatory behaviour, and the reason each line is there:

```tsx
  async function accept(text: string) {
    const decoded = decodeEnrollment(text);
    if (!decoded) {
      // Distinguishable from a network failure on purpose. A checksum mismatch is a typo
      // or a damaged code, and the person holding the tablet can fix it in five seconds if
      // they are told that is what it is.
      setError("That code did not scan cleanly. Re-scan, or type the values instead.");
      return;
    }
    await saveCredential(decoded);

    // ENROLLMENT MUST FORCE A FIRST SYNC BEFORE THE TABLET LEAVES THE OFFICE.
    // Collectors reach the device only through the pull, so an enrolled-but-unsynced tablet
    // has no collectors at all and cannot be signed into. Discovering that at 5am at a
    // market is the failure this line prevents.
    try {
      await sync({ driver, transport, ...decoded, businessDate: today() });
      setStatus("Enrolled and synced. This tablet is ready.");
    } catch {
      setStatus(
        "Enrolled, but the first sync failed. Stay on the office network and retry — " +
          "this tablet cannot be signed into until it syncs once.",
      );
    }
  }
```

- [ ] **Step 8: Run the enrollment end to end on the tablet**

Issue a credential from the web admin screen, scan it with the tablet, and confirm the
device reports "Enrolled and synced". Then **force-quit and reopen the app** and confirm
`loadCredential()` still returns it — that is the Keystore persistence check and it is the
one thing an emulator-only run would have made easy to skip.

Then **type the same credential manually** (revoke and re-issue first, since the previous
secret is gone) and confirm that path works too. A fallback that has never been exercised
is not a fallback.

Append both results to `docs/superpowers/measurements/phase-3b-i-device-smoke.md`.

- [ ] **Step 9: Commit**

```bash
git add apps/web apps/collector docs/superpowers/measurements/phase-3b-i-device-smoke.md
git commit -m "feat(enroll): QR enrollment with a checksummed manual fallback

Spec E6. The web screen shows the secret exactly once with no recovery
path, and nothing specified how 64 hex characters reach the tablet. Typing
them across a fleet is an error-prone ritual whose failure mode is a device
that cannot be enrolled and a secret that cannot be re-read.

Manual entry stays mandatory -- parent §9.4 already sets that rule for QR
in this system, and a camera can fail at 5am. The checksum turns a typo
into an immediate local error rather than an `unauthorized` at first sync,
which is indistinguishable from revocation or an unreachable server.

The credential goes to expo-secure-store, Keystore-backed, never
AsyncStorage: it is long-lived with no expiry and hash-only server-side, so
a plaintext leak has nothing bounding it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Offline sign-in, the five-attempt lock, and the shift gate

Spec E10 and §4.4. PIN verification goes through the native module built in Task 2a
(~482 ms); `bcryptjs` on this path is a 22-second sign-in. Full measurements:
`docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md`.

**Files:**
- Create: `packages/sync-engine/src/signin.ts` + `src/signin.test.ts`
- Create: `apps/collector/src/auth/session.ts`
- Create: `apps/collector/app/sign-in.tsx`
- Modify: `packages/sync-engine/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDriver` (Task 7); `verify(pin, hash)` from
  `apps/collector/modules/ceedo-bcrypt` (Task 2a) — **not** `bcryptjs`.
- Produces:
  - `canSignIn(driver, collectorId): Promise<{ ok: true } | { ok: false; reason: SignInBlock }>`
  - `type SignInBlock = "locked" | "no_pin" | "never_synced" | "other_shift_open"`
  - `recordPinFailure(driver, collectorId): Promise<number>`
  - `clearPinFailures(driver, collectorId): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/sync-engine/src/signin.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { canSignIn, recordPinFailure, clearPinFailures } from "./signin";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table collectors (
    id text primary key, employee_no text, full_name text, pin_hash text, status text
  );
  create table local_shifts (
    id text primary key, collector_id text, business_date text, opened_at text,
    status text, closed_at text, declared_total text, device_count integer,
    device_total text
  );
  create table pin_attempts (
    collector_id text primary key, failures integer not null default 0, locked_at text
  );
`;

describe("canSignIn", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    db.exec(`
      insert into collectors (id, employee_no, full_name, pin_hash, status)
      values ('alice', 'E-1', 'Alice', '$2a$12$abcdefghijklmnopqrstuv', 'active'),
             ('bob',   'E-2', 'Bob',   '$2a$12$abcdefghijklmnopqrstuv', 'active'),
             ('carol', 'E-3', 'Carol', null,                            'active');
    `);
    driver = betterSqliteDriver(db);
  });

  it("permits a synced collector with a PIN and no open shift", async () => {
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });

  it("refuses a device that has never synced, distinguishably", async () => {
    // Collectors reach the device only through the pull. An empty collector list is not
    // "wrong PIN" and must not be reported as one -- at 5am the difference between "your
    // PIN is wrong" and "this tablet was never synced" is the difference between a
    // collector retrying uselessly and one phoning the office.
    db.exec("delete from collectors");
    expect(await canSignIn(driver, "alice")).toEqual({
      ok: false,
      reason: "never_synced",
    });
  });

  it("refuses a collector with no PIN set, distinguishably", async () => {
    // Phase 3a §6.3 records the real failure this prevents: a supervisor who resets a PIN
    // believing it takes effect immediately has sent a collector out unable to work. A
    // generic "incorrect PIN" makes that undiagnosable in the field.
    expect(await canSignIn(driver, "carol")).toEqual({ ok: false, reason: "no_pin" });
  });

  it("refuses a locked collector", async () => {
    db.exec(
      "insert into pin_attempts (collector_id, failures, locked_at) " +
        "values ('alice', 5, '2026-10-05T09:00:00+08:00')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });
  });

  /**
   * SPEC E10, AND THE DISTINCTION THE WHOLE DECISION RESTS ON.
   *
   * Parent §6.5: "A new collector cannot sign in while the previous collector's shift is
   * still open -- the device requires a closeout first, closed_unsynced if there is no
   * signal."
   *
   * A `closed_unsynced` shift is FINISHED from the collector's point of view and must not
   * block the next person; it is ALSO still pending in the outbox and must still push.
   * Both are true at once only if the gate tests `status = 'open'` specifically. A gate
   * written as `status <> 'closed'` reads as equivalent, is not, and strands the next
   * collector at the sign-in screen with a shift nobody can close because the collector
   * who owned it has gone home.
   */
  it("blocks a different collector while a shift is open", async () => {
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'bob', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({
      ok: false,
      reason: "other_shift_open",
    });
  });

  it("lets the shift's own collector resume it", async () => {
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'alice', '2026-10-05', '2026-10-05T08:00:00+08:00', 'open')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });

  it("does NOT block on a closed_unsynced shift belonging to someone else", async () => {
    // The falsifying case for `status <> 'closed'`. Against that implementation this test
    // fails and every other test in this file still passes.
    db.exec(
      "insert into local_shifts (id, collector_id, business_date, opened_at, status) " +
        "values ('s1', 'bob', '2026-10-05', '2026-10-05T08:00:00+08:00', 'closed_unsynced')",
    );
    expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
  });
});

describe("the five-attempt lock", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    db.exec(
      "insert into collectors (id, employee_no, full_name, pin_hash, status) " +
        "values ('alice', 'E-1', 'Alice', '$2a$12$abcdefghijklmnopqrstuv', 'active')",
    );
    driver = betterSqliteDriver(db);
  });

  it("locks on the fifth consecutive failure and not the fourth", async () => {
    for (let i = 1; i <= 4; i++) {
      expect(await recordPinFailure(driver, "alice")).toBe(i);
      expect(await canSignIn(driver, "alice")).toEqual({ ok: true });
    }
    expect(await recordPinFailure(driver, "alice")).toBe(5);
    expect(await canSignIn(driver, "alice")).toEqual({ ok: false, reason: "locked" });
  });

  it("clears the counter on a success", async () => {
    await recordPinFailure(driver, "alice");
    await recordPinFailure(driver, "alice");
    await clearPinFailures(driver, "alice");
    expect(await recordPinFailure(driver, "alice")).toBe(1);
  });

  it("counts per collector, not per device", async () => {
    // A shared tablet: one collector fumbling their PIN must not lock out the next person.
    db.exec(
      "insert into collectors (id, employee_no, full_name, pin_hash, status) " +
        "values ('bob', 'E-2', 'Bob', '$2a$12$abcdefghijklmnopqrstuv', 'active')",
    );
    for (let i = 0; i < 5; i++) await recordPinFailure(driver, "alice");
    expect(await canSignIn(driver, "bob")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run signin
```

Expected: FAIL — `Cannot find module './signin'`.

- [ ] **Step 3: Write `signin.ts`**

```ts
import type { SqliteDriver } from "./driver";

/** Parent spec §11.5: "five failed attempts lock the device until it next syncs". */
const MAX_PIN_FAILURES = 5;

export type SignInBlock = "locked" | "no_pin" | "never_synced" | "other_shift_open";

export async function canSignIn(
  driver: SqliteDriver,
  collectorId: string,
): Promise<{ ok: true } | { ok: false; reason: SignInBlock }> {
  const collectors = await driver.select<{ id: string; pin_hash: string | null }>(
    "select id, pin_hash from collectors",
  );
  if (collectors.length === 0) return { ok: false, reason: "never_synced" };

  const me = collectors.find((c) => c.id === collectorId);
  if (!me) return { ok: false, reason: "never_synced" };
  if (!me.pin_hash) return { ok: false, reason: "no_pin" };

  const locks = await driver.select<{ failures: number }>(
    "select failures from pin_attempts where collector_id = ?",
    [collectorId],
  );
  if ((locks[0]?.failures ?? 0) >= MAX_PIN_FAILURES) return { ok: false, reason: "locked" };

  // `status = 'open'` SPECIFICALLY, never `status <> 'closed'`. See signin.test.ts's
  // "does NOT block on a closed_unsynced shift" for what the other spelling costs.
  const open = await driver.select<{ collector_id: string }>(
    "select collector_id from local_shifts where status = 'open'",
  );
  const other = open.find((s) => s.collector_id !== collectorId);
  if (other) return { ok: false, reason: "other_shift_open" };

  return { ok: true };
}

export async function recordPinFailure(
  driver: SqliteDriver,
  collectorId: string,
): Promise<number> {
  await driver.execute(
    `insert into pin_attempts (collector_id, failures, locked_at)
     values (?, 1, null)
     on conflict (collector_id) do update
       set failures = pin_attempts.failures + 1,
           locked_at = case
             when pin_attempts.failures + 1 >= ? then ?
             else pin_attempts.locked_at
           end`,
    [collectorId, MAX_PIN_FAILURES, new Date().toISOString()],
  );
  const rows = await driver.select<{ failures: number }>(
    "select failures from pin_attempts where collector_id = ?",
    [collectorId],
  );
  return rows[0]?.failures ?? 0;
}

export async function clearPinFailures(
  driver: SqliteDriver,
  collectorId: string,
): Promise<void> {
  await driver.execute("delete from pin_attempts where collector_id = ?", [collectorId]);
}
```

Add to `packages/sync-engine/src/index.ts`:

```ts
export {
  canSignIn,
  recordPinFailure,
  clearPinFailures,
  type SignInBlock,
} from "./signin";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run
```

Expected: PASS, all files.

- [ ] **Step 5: Verify the E10 test is falsifiable**

Temporarily change `canSignIn`'s shift query to `where status <> 'closed'` and re-run.
Expected: `"does NOT block on a closed_unsynced shift belonging to someone else"` FAILS and
every other test in the file still PASSES. **Revert.** That is the whole reason spec E10 is
written down as a decision rather than left to the implementer.

- [ ] **Step 6: Write the session and the sign-in screen**

`apps/collector/src/auth/session.ts` holds the signed-in collector **in memory only**:

```ts
import type { Collector } from "./types";

let current: Collector | null = null;

export function signedIn(): Collector | null {
  return current;
}

export function setSession(collector: Collector): void {
  current = collector;
}

/**
 * SIGNING OUT CLEARS A SESSION, NEVER DATA. Parent §6.4, and it is not a nicety: on a
 * shared tablet the next collector must never see the previous one's unsynced receipts
 * disappear or be re-attributed. Nothing in this function touches SQLite.
 */
export function signOut(): void {
  current = null;
}
```

`apps/collector/app/sign-in.tsx`: a collector picker populated from the local `collectors`
table, a 6-digit PIN field, and this order of operations —

```tsx
  async function submit(collectorId: string, pin: string) {
    const gate = await canSignIn(driver, collectorId);
    if (!gate.ok) {
      setError(MESSAGES[gate.reason]);
      return;
    }
    setVerifying(true);
    const collector = collectors.find((c) => c.id === collectorId)!;
    // NATIVE, never bcrypt.compareSync. Measured on the target tablet in a release build:
    // bcryptjs under Hermes takes 22,666 ms for this call and the native module takes
    // ~482 ms -- a 47x difference, and the whole reason Task 2a exists. An import of
    // `bcryptjs` on this path is a 22-second sign-in.
    const ok = nativeVerify(pin, collector.pin_hash!);
    setVerifying(false);

    if (!ok) {
      const failures = await recordPinFailure(driver, collectorId);
      setError(
        failures >= 5
          ? MESSAGES.locked
          : `Incorrect PIN. ${5 - failures} attempts left before this collector is locked.`,
      );
      return;
    }
    await clearPinFailures(driver, collectorId);
    setSession(collector);
  }
```

with these messages, which are the point of `SignInBlock` being four values rather than a
boolean:

```tsx
const MESSAGES: Record<SignInBlock, string> = {
  never_synced:
    "This tablet has not synced yet, so it has no collectors. Connect to the office " +
    "network and sync before the round.",
  no_pin:
    "No PIN is set for this collector. An administrator sets it on the web, and it " +
    "reaches this tablet on the next sync.",
  locked:
    "Locked after five incorrect PINs. This clears on the next successful sync.",
  other_shift_open:
    "Another collector's shift is still open on this tablet. Close it out first — " +
    "that works without signal.",
};
```

Import it as
`import { verify as nativeVerify } from "../../modules/ceedo-bcrypt";` (relative, not the
`@/modules/...` alias the Expo docs show -- this project maps `@/*` to `./src/*`, so that
alias resolves to `src/modules/` and silently misses).

Measured at ~482 ms, which is under the 800 ms line, so a progress indicator is **not
required**. It is still perceptible; a subtle one is a reasonable design choice, not an
obligation. `verifying` is kept in the signature either way so adding one costs nothing.

- [ ] **Step 7: Exercise sign-in on the tablet**

With the tablet in **airplane mode**, sign in as a synced collector. Then: fail the PIN five
times and confirm the lock message; sign in as a second collector and confirm the gate
message while the first has a shift open. Append the results, and the observed verification
latency, to the device smoke checklist.

- [ ] **Step 8: Commit**

```bash
git add packages/sync-engine apps/collector docs/superpowers/measurements/phase-3b-i-device-smoke.md
git commit -m "feat(collector): offline PIN sign-in, five-attempt lock, and the shift gate

Spec E10: the gate tests status = 'open' specifically, never
status <> 'closed'. A closed_unsynced shift is finished from the
collector's point of view and must not block the next person, while still
being pending in the outbox. The two spellings read as equivalent; the
second strands the next collector with a shift nobody can close.

Four distinguishable refusals rather than one. At 5am the difference
between 'your PIN is wrong' and 'this tablet was never synced' is the
difference between retrying uselessly and phoning the office.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: The shift lifecycle and closeout

**Files:**
- Create: `packages/sync-engine/src/shift.ts` + `src/shift.test.ts`
- Create: `apps/collector/app/shift.tsx`, `app/closeout.tsx`
- Modify: `packages/sync-engine/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDriver`, `enqueue`, `sync` (Tasks 7–9); `reconciles`, `shiftVariance`
  (`@ceedo/shared`, `src/shifts.ts`).
- Produces:
  - `openShift(driver, { collectorId, businessDate }): Promise<string>`
  - `deviceTotals(driver, shiftId): Promise<{ count: number; total: string }>`
  - `closeShift(driver, deps, { shiftId, declaredTotal }): Promise<CloseOutcome>`
  - `type CloseOutcome = { status: "closed" | "mismatch" | "closed_unsynced"; ... }`

- [ ] **Step 1: Write the failing test**

Create `packages/sync-engine/src/shift.test.ts` covering, at minimum, these five properties.
Each needs a non-trivial fixture — a shift with **at least one** collection in it — for the
same reason Task 8's reset test stages a non-empty outbox:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { openShift, deviceTotals, closeShift } from "./shift";
import { pushable } from "./outbox";
import type { SqliteDriver, Transport } from "./driver";

const SCHEMA = `
  create table sync_state (
    id integer primary key, cursor integer not null default 0,
    epoch integer not null default 0, last_full_sync_date text
  );
  insert into sync_state (id, cursor, epoch, last_full_sync_date)
    values (1, 10, 0, '2026-10-05');
  create table local_shifts (
    id text primary key, collector_id text not null, business_date text not null,
    opened_at text not null, status text not null default 'open', closed_at text,
    declared_total text, device_count integer, device_total text
  );
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
  create table collections (
    id text primary key, shift_id text, gross_amount text, collector_id text
  );
`;

function transportReturning(body: unknown, status = 200): Transport {
  return { async post() { return { status, body }; } };
}

const OFFLINE: Transport = {
  async post() {
    throw new Error("Network request failed");
  },
};

describe("the shift lifecycle", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    driver = betterSqliteDriver(db);
  });

  it("queues a shift_open entry when a shift opens", async () => {
    const id = await openShift(driver, {
      collectorId: "alice",
      businessDate: "2026-10-05",
    });
    const rows = await pushable(driver);
    expect(rows.map((r) => r.type)).toEqual(["shift_open"]);
    expect(rows[0]?.id).toBe(id);
  });

  it("sums the device's own collections for that shift", async () => {
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    db.prepare(
      "insert into collections (id, shift_id, gross_amount, collector_id) values (?, ?, ?, ?)",
    ).run("c1", id, "150.00", "alice");
    db.prepare(
      "insert into collections (id, shift_id, gross_amount, collector_id) values (?, ?, ?, ?)",
    ).run("c2", id, "75.50", "alice");

    // String arithmetic, not float. 150.00 + 75.50 must be exactly "225.50".
    expect(await deviceTotals(driver, id)).toEqual({ count: 2, total: "225.50" });
  });

  it("closes with a recorded variance when the cash is short", async () => {
    /**
     * PHASE 3A §5.1, AND CONFLATING THE TWO COMPARISONS WOULD BE A REAL BUG.
     *
     *   device count/sum vs server -> RECORDS missing -> BLOCKS closeout
     *   declared cash vs server    -> the DRAWER short -> RECORDED, never blocks
     *
     * A collector P50 short still closes their shift, with the P50 on the record. Blocking
     * would be worse than useless: it gives a collector who is short a direct incentive to
     * adjust the declaration until it matched.
     */
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    db.prepare(
      "insert into collections (id, shift_id, gross_amount, collector_id) values (?, ?, ?, ?)",
    ).run("c1", id, "200.00", "alice");

    const outcome = await closeShift(
      driver,
      { transport: transportReturning([
          { index: 0, type: "shift_close", status: "closed",
            system_count: 1, system_total: 200, variance: -50 },
        ]), credentialId: "c", secret: "s", businessDate: "2026-10-05" },
      { shiftId: id, declaredTotal: "150.00" },
    );

    expect(outcome.status).toBe("closed");
    const row = db.prepare("select status, declared_total from local_shifts where id = ?").get(id);
    expect(row).toEqual({ status: "closed", declared_total: "150.00" });
  });

  it("leaves the shift OPEN on a records mismatch", async () => {
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });
    db.prepare(
      "insert into collections (id, shift_id, gross_amount, collector_id) values (?, ?, ?, ?)",
    ).run("c1", id, "200.00", "alice");

    const outcome = await closeShift(
      driver,
      { transport: transportReturning([
          { index: 0, type: "shift_close", status: "mismatch",
            device_count: 1, device_total: 200, system_count: 2, system_total: 350 },
        ]), credentialId: "c", secret: "s", businessDate: "2026-10-05" },
      { shiftId: id, declaredTotal: "200.00" },
    );

    expect(outcome.status).toBe("mismatch");
    const row = db.prepare("select status from local_shifts where id = ?").get(id);
    expect(row).toEqual({ status: "open" });
  });

  it("writes closed_unsynced with no signal, and still queues the push", async () => {
    /**
     * Parent §3: "Blocking a collector over bad signal is unworkable." This is the entire
     * reason closed_unsynced exists -- it lets the collector leave and the next one sign in.
     * The shift_close entry stays in the outbox and reconciles whenever the tablet next
     * reaches the network.
     */
    const id = await openShift(driver, { collectorId: "alice", businessDate: "2026-10-05" });

    const outcome = await closeShift(
      driver,
      { transport: OFFLINE, credentialId: "c", secret: "s", businessDate: "2026-10-05" },
      { shiftId: id, declaredTotal: "0.00" },
    );

    expect(outcome.status).toBe("closed_unsynced");
    const row = db.prepare("select status from local_shifts where id = ?").get(id);
    expect(row).toEqual({ status: "closed_unsynced" });

    const queued = await pushable(driver);
    expect(queued.map((r) => r.type)).toContain("shift_close");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run shift
```

Expected: FAIL — `Cannot find module './shift'`.

- [ ] **Step 3: Write `shift.ts`**

Implement the four exported functions. The rules that must hold, each traceable to a test
above:

- `openShift` inserts a `local_shifts` row with `status = 'open'` and enqueues a
  `shift_open` entry under the **same** id. One id, so the server's idempotency on the
  client-generated shift id works.
- `deviceTotals` sums `gross_amount` **as strings**, using `packages/shared/src/money.ts`.
  A float sum of a cash ledger is the bug this project has been avoiding since Phase 1.
- `closeShift` enqueues the `shift_close` entry **before** attempting the network, so an
  offline close is already durable when the push fails.
- A transport throw or non-200 becomes `closed_unsynced`, never an exception the UI has to
  interpret. A `mismatch` result leaves `status = 'open'` and reports both sides.
- A `closed` or `already_closed` result writes `status = 'closed'`, `declared_total`, and
  the device's own count and total.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ceedo/sync-engine exec vitest run
```

Expected: PASS, all files.

- [ ] **Step 5: Verify the closeout tests are falsifiable**

Temporarily make `closeShift` write `status = 'closed'` on a `mismatch` result. Expected:
`"leaves the shift OPEN on a records mismatch"` FAILS. **Revert.**

Then temporarily make it refuse to close when `declaredTotal` differs from the system total.
Expected: `"closes with a recorded variance when the cash is short"` FAILS. **Revert.** These
two are the pair §5.1 warns about, and a test suite that cannot tell them apart is exactly
how they get conflated.

- [ ] **Step 6: Write the shift and closeout screens**

`apps/collector/app/shift.tsx`: shows the open shift, its device count and total, a
**Sync now** button, and a **Close out** button. The close button is disabled while any
outbox entry is `pending` or `in_flight` — that is §6.5 step 1, "force sync; outbox must
reach zero pending", enforced in the UI rather than assumed.

`apps/collector/app/closeout.tsx`: a declared-cash field, then the outcome. On `mismatch`,
show the device's count and total beside the server's, and say plainly that the shift is
still open and a supervisor is needed. On `closed`, show the variance **with its sign** —
over and short are different problems. On `closed_unsynced`, say the shift is closed on this
tablet and will reconcile at the next sync.

- [ ] **Step 7: Commit**

```bash
git add packages/sync-engine apps/collector
git commit -m "feat(collector): shift lifecycle, closeout, and closed_unsynced

Keeps Phase 3a §5.1's two comparisons structurally apart: a records
mismatch blocks and leaves the shift open; a cash variance is recorded and
never blocks. Blocking on a cash variance would give a collector who is
short a direct incentive to adjust the declaration until it matched.

closed_unsynced is written locally when the push fails, with the
shift_close entry already queued before the network is attempted -- so an
offline close is durable at the moment it is made, and the collector can
leave.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: The exit criterion, on the tablet

Spec §1.1. Nothing in this phase is complete until this runs.

**Files:**
- Modify: `docs/superpowers/measurements/phase-3b-i-device-smoke.md`
- Create: `docs/superpowers/phase-3b-i-handover.md`

- [ ] **Step 1: Run the whole automated suite from a clean database**

```bash
supabase db reset && \
API_URL=http://127.0.0.1:54321 \
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 \
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
pnpm test
```

Record the file and test counts. Do not proceed on a red suite.

- [ ] **Step 2: Run the exit criterion on the physical tablet, in order**

Each line is a checkbox in the smoke document, and each records what was observed rather
than that it was attempted:

- [ ] An admin issues a credential on the web and the tablet enrolls by **scanning the QR**
- [ ] The tablet's forced first sync succeeds; the collector list is non-empty
- [ ] **Airplane mode on.** A collector signs in with their PIN. Note the latency.
- [ ] The collector opens a shift. The outbox shows one pending entry.
- [ ] **Airplane mode off.** Sync. The shift appears on the web supervisor screen as `open`.
- [ ] The collector declares cash and closes out. The variance shows with its sign.
- [ ] The web shift screen shows the shift `closed` with the same variance.
- [ ] The collector signs out.
- [ ] **A second collector signs in** and is not blocked.
- [ ] The second collector cannot see the first collector's shift.
- [ ] The first collector's outbox rows are **still present** in the device database.

- [ ] **Step 3: Run the offline closeout path as well**

- [ ] A collector opens a shift, then **airplane mode on**, then closes out.
- [ ] The shift reads `closed_unsynced` on the tablet and a second collector can sign in.
- [ ] **Airplane mode off.** Sync. The shift reconciles to `closed` on the web.

- [ ] **Step 4: Force-quit between every stage at least once**

The failure this catches has no automated equivalent: an app that holds a shift or an outbox
entry only in React state loses it here, and nothing in Vitest would notice. Record which
stages were interrupted.

- [ ] **Step 5: Write the handover**

Create `docs/superpowers/phase-3b-i-handover.md` following the structure of
`docs/superpowers/phase-3a-handover.md`. It must contain, at minimum:

- What exists: packages, screens, migrations, test counts.
- **The two measurements** — Hermes bcrypt and first-sync duration — with their numbers and
  the decisions they drove.
- **Anything the device smoke found that Node testing did not.** If that section is empty,
  say so explicitly and note it as surprising rather than reassuring: spec E1 predicts the
  driver gap is real, and an empty finding means either the interface held or the smoke was
  too shallow. Say which you believe and why.
- **Vacuous tests found by the falsifiability steps**, enumerated. Phase 3a's handover
  listed eight and that list was its most valuable section.
- Mandatory items for 3b-ii, carried forward.
- Known limitations, each with a measurement or an explicit "not measured".

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/measurements/phase-3b-i-device-smoke.md \
        docs/superpowers/phase-3b-i-handover.md
git commit -m "docs: Phase 3b-i handover, and the exit criterion run on the tablet

A collector enrolls a tablet, signs in offline, works a shift containing no
receipts, closes out with a recorded variance, and hands the tablet to a
second collector whose sign-in is not blocked and whose predecessor's
outbox is intact.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Appendix — Falsifiability checks, collected

Phase 3a shipped eight tests that passed whether or not the thing they named worked, found
only by mutation. Every one had the same shape: a test that *errors* gets read immediately;
a test that *passes vacuously* gets a green tick and is never looked at again.

These steps are the mutation pass for this phase. **None is optional, and each is a step in
its own task rather than a note at the end, because a checklist at the end of a plan is a
checklist nobody runs.**

| Task | Step | Mutation | Test that must fail |
| --- | --- | --- | --- |
| 1 | 6 | Connect on `POSTGRES_URL` | Five of the six (measured). Only the RLS test survives — `set role` genuinely does reproduce that one, which is the thesis in miniature |
| 5 | 10 | Add a blank line to the generated contract | The staleness test |
| 7 | 8 | Advance the cursor in its own transaction, first | `"leaves the cursor untouched when the apply fails partway"` |
| 8 | 5 | Add `outbox` to the reset loop | `"never touches device-authored state"` |
| 8 | 5 | Empty the outbox fixture, wipe still in place | Nothing fails — **the tautology, seen directly** |
| 9 | 5 | `pushable` selects only `pending` | `"re-pushes in_flight entries rather than skipping them"` |
| 12 | 5 | Gate on `status <> 'closed'` | `"does NOT block on a closed_unsynced shift"` — and nothing else |
| 13 | 5 | Close the shift on `mismatch` | `"leaves the shift OPEN on a records mismatch"` |
| 13 | 5 | Refuse to close on a cash variance | `"closes with a recorded variance when the cash is short"` |

If a mutation does **not** produce the expected failure, the test is vacuous. Fix the test
before continuing — that finding is worth more than the task it interrupted.
