# Collection Reports, Phase 7: Collector App Keyed Amounts and Facility Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collectors can issue keyed-amount receipts (electricity bill payments and their surcharge, certification, misc fees, citation tickets, City Gym rental) from the tablet. The tablet offers only the fees of the collector's own facilities, plus facility-less fees for their kind of facility.

**Architecture:**
- **Server:** no SQL change. `post_collection` already takes a keyed line's amount from `lines[].amount` (migration 067). But the sync contract's line object does not declare `amount`, so zod strips it at the Edge Function and the server refuses the receipt as `amount_mismatch`. The contract gains an optional 2-decimal `amount` on lines, and the Edge Functions' generated copy is regenerated.
- **Tablet database:** local migration `0007` adds `fee_types.amount_mode` and `fee_types.facility_id` and rewinds the sync cursor. Rows already pulled lost these columns (`applyPull` skips unknown ones), so a full re-pull is needed, exactly as `0002` did for `facility_type`.
- **Sync engine** (`packages/sync-engine`):
  - `feeChoices` picks fees by facility id or type and includes keyed fees, which have no rates.
  - Two pure helpers: `keyedAmount` (parse a typed amount) and `addFeeRefusal` (which fees may share a receipt).
  - `commitReceipt` sends `amount` for keyed lines.
- **Screen:** `apps/collector/src/app/ambulant.tsx` shows an Amount field for a keyed fee in place of Quantity.

**Tech Stack:** Expo SDK 57 / React Native (`apps/collector`), drizzle (expo driver) and better-sqlite3 for tests, zod 4, vitest, Supabase Edge Functions (Deno).

**Spec:** `docs/superpowers/specs/2026-10-07-collection-reports-design.md`:
- "Changes to existing tables": `amount_mode`, `fee_types.facility_id`;
- "Seed migration": electricity as two lines on one OR;
- Rollout step 7: "Collector app: keyed amounts and facility-filtered fees".

## Global Constraints

- **Keyed fee (spec):** "A keyed fee's amount is typed by whoever issues the receipt. It is stored as one `collection_lines` row with quantity 1 × the typed amount, and the amount must be above 0." The server refuses anything else as `amount_mismatch`. Its upper bound is `< 1,000,000,000,000`, at most 12 integer digits.
- **Facility filter (spec):** "The tablet offers only fee types for its own facility, or those with no facility."
- **Electricity (spec):** "The two are issued as two lines on the same OR, as the abstracts show ('EBP' + 'Surcharge/EBP')."
- **Payment mode:** field collectors take cash only (`sync_push` refuses `check`). Nothing changes here.
- **Money:** `Centavos` in TypeScript; the payload carries decimal strings (`toDecimalString`). Never send `gross_amount` or `device_id`: the contract declares them `never`.
- **Local migrations:**
  - Generate with `pnpm --filter @ceedo/db-local generate` (output: `packages/db-local/drizzle`).
  - Then copy them into the app with `pnpm --filter @ceedo/collector sync-migrations`.
  - Commit both copies.
- **Edge contract:** after any change to `packages/shared/src/sync-contract.ts`, run `pnpm edge:contract` and commit `supabase/functions/_shared/contract.ts`. `tests/http/contract-validation.test.ts` fails on a stale copy.
- **Tests:**
  - Run from the repo root: `set -a; eval "$(supabase status -o env)"; set +a; pnpm vitest run <files>`.
  - The full suite (`pnpm test`) needs the edge runtime container up. If every `http/` test fails with ECONNREFUSED, run `docker start supabase_edge_runtime_ceedo-collections`.
  - Run `supabase db reset` before any full-suite run you intend to trust.
- **Release order (production):**
  1. Deploy the Edge Functions (their `contract.ts` changes).
  2. Then publish the OTA.

  A tablet on the new JS talking to the old `sync-push` loses the amount, and every keyed receipt becomes a sync exception. Both steps are the user's, with go-ahead. Tablets are on the `production` channel; always pass `--platform android` (memory).
- **Real names never enter the repo.**

### Spec deviations and decisions (state them in the PR description)

1. **Two fee types are never offered on the tablet:**
   - `OCCUPANCY`, which belongs to a lease (spec: `lease_id` "may be set on a keyed occupancy-fee receipt"). Rules place it by the lease's section, and without a lease it would land on `UNCLASSIFIED`. The office posts it from Office receipt.
   - Fee types whose code ends in `_CR`, the comfort-room cash tickets. Spec: "Cash-ticket sales … are entered on the web by the office … They are cash the collector remits but are not ORs." An OR for them would be counted twice once the office enters the lump.
   - Both are matched by code. No flag exists, and adding one is a server migration that this phase does not need.
2. **What shares a receipt.** The existing rule (review R12) stays for rate fees: one fee type per receipt. Keyed fees may share a receipt with other keyed fees, which is how "EBP" and "Surcharge/EBP" go on one OR. A rate fee and a keyed fee never share one. The receipt's header `fee_type_id` stays the first line's.
   - Known effect: the legacy monthly *Abstract of Collections* totals by the header fee type, so it counts an electricity surcharge under the bill. The new reports (1, 2, 4 and 5) classify each line by its own fee type.
3. **Facility match:**
   - A fee with a `facility_id` is offered only to collectors with an active area at that facility.
   - A fee without one is offered by `facility_type`, as today. So Citation, whose facility type is `other`, reaches only collectors at an `other` facility.
   - `FacilityType` gains `"other"` (spec: "`facility_type` gains `other`").
4. **A keyed fee is one choice** (no rate classes), even if rate rows exist for it.

## Review Focus

1. **A tablet that synced before the OTA.** Its `fee_types` rows have `amount_mode` and `facility_id` null until the forced re-pull lands. A null `amount_mode` must read as `rate`, and a null `facility_id` as facility-less, so nothing crashes or becomes keyed by accident. (Task 2 test.)
2. **A typed amount with a comma, a peso sign, three decimals, zero, a negative or 13 digits.** `1,234.50` and `₱1234.5` are accepted. `12.345` rounds to `12.35`. `0`, `-5`, `abc` and `1000000000000` are refused with a sentence. (Task 2 test.)
3. **Adding a rate fee after a keyed line, or the reverse.** Refused with a sentence naming the receipt's kind. Removing the last line releases the lock, as today. (Task 2 test.)
4. **A keyed line round-tripping through the real `sync-push`.** It is accepted and the server's gross equals the typed amount. A keyed line with no `amount` is refused `amount_mismatch`, not silently priced. (Task 1 HTTP test.)
5. **A collector assigned to two facilities.** Each facility's specific fees are offered, and no third facility's. (Task 2 test.)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/sync-contract.ts` (+ `sync-contract.test.ts`) | `lines[].amount` |
| `supabase/functions/_shared/contract.ts` | regenerated |
| `tests/http/functions.test.ts` | keyed line over `sync-push` |
| `packages/db-local/src/schema.ts`, `packages/db-local/drizzle/0007_*.sql` (+ `migrations.test.ts`) | local `fee_types.amount_mode`, `.facility_id`; cursor rewind |
| `apps/collector/drizzle/` | synced copy of the migrations |
| `packages/sync-engine/src/site.ts` (+ `site.test.ts`) | `CollectorSite.id`, `FacilityType` + `other`, `feeChoices` by facility, `FeeChoice.amount_mode` |
| `packages/sync-engine/src/fees.ts` (+ `fees.test.ts`) | `keyedAmount`, `addFeeRefusal` |
| `packages/sync-engine/src/collect.ts` (+ `collect.test.ts`) | `DraftLine.keyed`; payload `amount` |
| `packages/sync-engine/src/index.ts` | exports |
| `apps/collector/src/app/ambulant.tsx` | Amount field, the lock, line display |

---

### Task 1: The contract carries a keyed line's amount

**Files:**
- Modify: `packages/shared/src/sync-contract.ts:96-102`, `packages/shared/src/sync-contract.test.ts`
- Modify: `supabase/functions/_shared/contract.ts` (regenerated)
- Test: `tests/http/functions.test.ts`

**Interfaces:**
- Produces: `CollectionPayload.lines[].amount?: string`, matching `/^\d{1,12}\.\d{2}$/`.

- [ ] **Step 1: Write the failing tests**

In `sync-contract.test.ts`, alongside the existing CollectionPayload tests, using its valid-payload fixture:

```ts
it("accepts a keyed line's amount as a 2dp decimal string", () => {
  const p = { ...valid, lines: [{ fee_type_id: UUID, quantity: 1, amount: "1234.50" }] };
  expect(CollectionPayload.parse(p).lines[0]).toEqual({ fee_type_id: UUID, quantity: 1, amount: "1234.50" });
});

it("refuses a line amount that is not a 2dp decimal string", () => {
  for (const amount of ["12.5", "abc", "-1.00", "1e3", 12.5, "1000000000000.00"]) {
    expect(() => CollectionPayload.parse({ ...valid, lines: [{ fee_type_id: UUID, quantity: 1, amount }] })).toThrow();
  }
});
```

(`valid` and `UUID`: use whatever names the file's existing fixture has.)

In `tests/http/functions.test.ts`, in the `sync-push over HTTP` describe:

```ts
it("accepts a keyed line and records the typed amount", async () => {
  // a keyed fee type: insert into fee_types (code, name, accrues, facility_type, amount_mode)
  //   values (uniqueCode('KEY'), 'Keyed test fee', false, 'market', 'keyed') returning id
  // push a collection with lease_id null, allocations [], lines [{ fee_type_id, quantity: 1, amount: "1234.50" }]
  // expect status 200, body[0].status "accepted"
  // select gross_amount from collections where id = $1 → "1234.50"
});

it("refuses a keyed line without an amount as amount_mismatch", async () => {
  // same, with lines [{ fee_type_id, quantity: 1 }]
  // expect body[0] toMatchObject({ status: "rejected", reason: "amount_mismatch" })
});
```

Use the file's `collectionEntry(...)` helper for the payload and an OR in the fixture's range that no other test uses (e.g. 1310 and 1311).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/shared/src/sync-contract.test.ts tests/http/functions.test.ts -t "keyed|line amount"`
Expected:
- The contract test FAILs, because zod strips `amount`, so `toEqual` misses it.
- The HTTP "accepts" test FAILs with `amount_mismatch`.
- The "refuses" test may already PASS. That is fine: it pins today's behaviour.

- [ ] **Step 3: Add `amount` to the line object**

In `sync-contract.ts`, add `amount: z.string().regex(/^\d{1,12}\.\d{2}$/).optional()` to the line object. Add a comment: present exactly on a keyed fee's line, and the server takes the amount from it (migration 067) instead of the rate table. Then run `pnpm edge:contract`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run packages/shared/src/sync-contract.test.ts tests/http/functions.test.ts tests/http/contract-validation.test.ts`
Expected: PASS. The edge runtime serves `supabase/functions` from disk, so a regenerated `contract.ts` is live without a restart. If the HTTP test still sees the old contract, run `docker restart supabase_edge_runtime_ceedo-collections` and rerun.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sync-contract.ts packages/shared/src/sync-contract.test.ts supabase/functions/_shared/contract.ts tests/http/functions.test.ts
git commit -m "feat(sync): the contract carries a keyed line's amount"
```

---

### Task 2: Tablet fee list by facility, keyed amounts, and the receipt lock

**Files:**
- Modify: `packages/db-local/src/schema.ts` (`feeTypes`: `amountMode: text("amount_mode")`, `facilityId: text("facility_id")`)
- Create: `packages/db-local/drizzle/0007_*.sql` (generated, plus the cursor rewind), with `meta/` updated by drizzle-kit
- Modify: `packages/db-local/src/migrations.test.ts`
- Modify: `packages/sync-engine/src/site.ts`, `packages/sync-engine/src/site.test.ts`
- Create: `packages/sync-engine/src/fees.ts`, `packages/sync-engine/src/fees.test.ts`
- Modify: `packages/sync-engine/src/collect.ts`, `packages/sync-engine/src/collect.test.ts`, `packages/sync-engine/src/index.ts`
- Modify: `apps/collector/drizzle/` (via `sync-migrations`)

**Interfaces:**
- Consumes: Task 1's `lines[].amount`.
- Produces:

```ts
// site.ts
export type FacilityType = "market" | "terminal" | "parking" | "slaughterhouse" | "other";
export interface CollectorSite { id: string; name: string; type: FacilityType; }
export interface FeeChoice {
  fee_type_id: string;
  fee_name: string;
  rate_class: string | null;          // always null for a keyed fee
  amount_mode: "rate" | "keyed";
}
export async function feeChoices(driver: SqliteDriver, sites: readonly CollectorSite[]): Promise<FeeChoice[]>;

// fees.ts
export const MAX_KEYED_CENTAVOS: Centavos;  // 999_999_999_999_99: the server's < 1e12 pesos bound
export function keyedAmount(input: string): { amount: Centavos } | { refusal: string };
export function addFeeRefusal(
  lines: readonly DraftLine[],
  choice: FeeChoice,
  feeName: (feeTypeId: string) => string,
): string | null;

// collect.ts
export interface DraftLine { feeTypeId; rateClass; quantity; unitRate; amount; keyed?: boolean }
```

- [ ] **Step 1: Write the failing migration test**

In `migrations.test.ts`, modelled on the "0002 adds fee_types.facility_type and forces one full re-pull" test:

```ts
it("0007 adds fee_types.amount_mode and facility_id and forces one full re-pull", () => {
  // run files < "0007"; set sync_state cursor 900, epoch 4; run 0007
  // pragma_table_info('fee_types') contains amount_mode and facility_id
  // sync_state → { cursor: 0, epoch: 4 }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run packages/db-local/src/migrations.test.ts`
Expected: FAIL. There is no 0007.

- [ ] **Step 3: Generate 0007, then add the rewind**

- Add the two columns to `feeTypes` in `schema.ts`, with comments: migration 067/071 server columns; null until the re-pull, read as `rate` / facility-less.
- Run `pnpm --filter @ceedo/db-local generate`.
- Append to the generated SQL, after a `--> statement-breakpoint`, the same two comment lines and `UPDATE` that `0002` uses: `UPDATE \`sync_state\` SET \`cursor\` = 0 WHERE \`id\` = 1;`
- Run `pnpm --filter @ceedo/collector sync-migrations`.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm vitest run packages/db-local/src`
Expected: PASS, including `schema.test.ts`.

- [ ] **Step 5: Write the failing sync-engine tests**

**`site.test.ts`:**
- Extend the fixture: `fee_types` gains `code`, `amount_mode`, `facility_id`; `facilities` gains `('f3', 'City Gym', 'other', 1, 7)`; `collectorSites` returns `id`.
- Add these fee types:
  - `('elec-cpm', 'ELEC_CPM', 'Electricity bill payment (Public Mall)', 0, 1, null, 'keyed', 'f2')`
  - `('elec-ibjt', 'ELEC_IBJT', 'Electricity bill payment (IBJT)', 0, 1, null, 'keyed', 'f1')`
  - `('cr-cpm', 'CPM_CR', 'Public Mall CR (cash ticket)', 0, 1, null, 'keyed', 'f2')`
  - `('occ', 'OCCUPANCY', 'Occupancy fee', 0, 1, 'market', 'keyed', null)`
  - `('cit', 'CITATION', 'Citation ticket', 0, 1, 'other', 'keyed', null)`
- Keyed fees get no rates.

```ts
it("offers a facility's own fees only at that facility", async () => {
  // sites [CPM market f2] → includes elec-cpm, excludes elec-ibjt
});
it("offers each assigned facility's own fees to a collector at two facilities", async () => {
  // sites [f1 terminal, f2 market] → includes elec-cpm AND elec-ibjt, and term (bus, jeepney) and amb
});
it("offers a keyed fee once, with no rate class, though it has no rates", async () => {
  // elec-cpm appears exactly once: { rate_class: null, amount_mode: "keyed" }
});
it("never offers the occupancy fee or a cash-ticket fee", async () => {
  // sites [f2 market] → no 'occ', no 'cr-cpm'
});
it("offers a facility-less fee by facility type, Citation at an 'other' facility", async () => {
  // sites [f3 other] → includes cit; sites [f2 market] → excludes cit
});
it("reads a fee pulled before 0007 (null amount_mode, null facility_id) as a facility-less rate fee", async () => {
  // existing 'amb' row has null amount_mode and facility_id → offered at market as amount_mode "rate"
});
```

Update the existing `feeChoices` tests to the new signature by passing sites, and add `id` to the expected `collectorSites` rows.

**`fees.test.ts`:**

```ts
describe("keyedAmount", () => {
  it("accepts commas, a peso sign and one decimal", () => {
    expect(keyedAmount("1,234.50")).toEqual({ amount: 123450 });
    expect(keyedAmount("₱1234.5")).toEqual({ amount: 123450 });
  });
  it("rounds to the centavo", () => expect(keyedAmount("12.345")).toEqual({ amount: 1235 }));
  it("refuses zero, negatives, garbage and too much", () => {
    for (const s of ["", "0", "0.00", "-5", "abc", "1000000000000"]) {
      expect(keyedAmount(s)).toEqual({ refusal: expect.stringMatching(/^Enter an amount/) });
    }
  });
});

describe("addFeeRefusal", () => {
  const keyed = (id: string): FeeChoice => ({ fee_type_id: id, fee_name: id, rate_class: null, amount_mode: "keyed" });
  const rate = (id: string): FeeChoice => ({ fee_type_id: id, fee_name: id, rate_class: "", amount_mode: "rate" });
  const line = (feeTypeId: string, keyed?: boolean): DraftLine =>
    ({ feeTypeId, rateClass: null, quantity: 1, unitRate: 100 as Centavos, amount: 100 as Centavos, ...(keyed ? { keyed } : {}) });
  const name = (id: string) => `«${id}»`;

  it("allows anything on an empty receipt", () => {
    expect(addFeeRefusal([], rate("a"), name)).toBeNull();
    expect(addFeeRefusal([], keyed("k"), name)).toBeNull();
  });
  it("keeps a rate receipt to one fee type", () => {
    expect(addFeeRefusal([line("a")], rate("a"), name)).toBeNull();
    expect(addFeeRefusal([line("a")], rate("b"), name)).toBe("This receipt is already for «a». «b» needs its own receipt -- add it after this one is recorded.");
  });
  it("lets keyed fees share a receipt (electricity and its surcharge)", () => {
    expect(addFeeRefusal([line("ebp", true)], keyed("sur"), name)).toBeNull();
  });
  it("never mixes a keyed fee with a rate fee", () => {
    expect(addFeeRefusal([line("a")], keyed("k"), name)).toBe("This receipt is for «a», a fee with a set rate. «k» is typed in and needs its own receipt.");
    expect(addFeeRefusal([line("k", true)], rate("a"), name)).toBe("This receipt is for typed-in amounts. «a» has a set rate and needs its own receipt.");
  });
});
```

**`collect.test.ts`:**

```ts
it("sends a keyed line's amount, and no amount on a rate line", async () => {
  // lines: [{ feeTypeId: "f-elec", rateClass: null, quantity: 1, unitRate: 123450, amount: 123450, keyed: true },
  //         { feeTypeId: "f-sur", rateClass: null, quantity: 1, unitRate: 3700, amount: 3700, keyed: true }]
  // payload.lines → [{ fee_type_id: "f-elec", quantity: 1, amount: "1234.50" },
  //                  { fee_type_id: "f-sur", quantity: 1, amount: "37.00" }]
  // and in "writes lines with their ids and sends quantities only", the rate line still has no amount key
});
```

Extend "produces a payload the shared contract accepts" with a second run using one keyed line (real UUIDs).

- [ ] **Step 6: Run them and see them fail**

Run: `pnpm vitest run packages/sync-engine/src/site.test.ts packages/sync-engine/src/fees.test.ts packages/sync-engine/src/collect.test.ts`
Expected: FAIL. There is no `fees.ts`, `feeChoices` has the old signature, and there is no `amount` in the payload.

- [ ] **Step 7: Implement**

- **`collectorSites`:** also select `f.id`.
- **`feeChoices(driver, sites)`:**
  - Empty sites → `[]`.
  - One query with `left join rates`:
    - keep `f.accrues = 0 and f.active = 1`;
    - `coalesce(f.amount_mode, 'rate')` is `'keyed'` or a rate row exists;
    - `f.facility_id in (<site ids>)`, or `f.facility_id is null and f.facility_type in (<site types>)`;
    - `coalesce(f.code, '') <> 'OCCUPANCY'` and `coalesce(f.code, '') not like '%\_CR' escape '\'`.
  - `rate_class`: `null` when keyed. Select `distinct`, order by name, then rate class.
  - Rewrite the doc comment to state the facility rule and the two exclusions (decisions 1 and 3).
- **`fees.ts`:**
  - `keyedAmount` wraps `parsePesoInput`. A throw, or a value ≤ 0 or > `MAX_KEYED_CENTAVOS`, becomes `{ refusal: "Enter an amount above zero, in pesos (for example 1,234.50)." }`.
  - `addFeeRefusal` implements decision 2 with the three sentences in the tests. A line is keyed when `line.keyed === true`.
- **`collect.ts`:** add `keyed?: boolean` to `DraftLine`. The payload line adds `amount: toDecimalString(line.amount)` when `line.keyed`. Update the "NEVER an amount" comment: the gross is still never sent, and a keyed line's amount is the typed price the server cannot know.
- **`index.ts`:** export `keyedAmount`, `addFeeRefusal`, `MAX_KEYED_CENTAVOS`.

- [ ] **Step 8: Run them and see them pass**

Run: `pnpm vitest run packages/sync-engine packages/db-local packages/shared`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db-local packages/sync-engine apps/collector/drizzle
git commit -m "feat(sync-engine): fees by facility, keyed amounts, keyed fees share a receipt"
```

---

### Task 3: The on-the-spot screen takes a typed amount

**Files:**
- Modify: `apps/collector/src/app/ambulant.tsx`

**Interfaces:**
- Consumes: `feeChoices(driver, sites)`, `FeeChoice.amount_mode`, `keyedAmount`, `addFeeRefusal`, `DraftLine.keyed` (Task 2).

- [ ] **Step 1: Wire the screen**

- `load()` calls `feeChoices(driver, here)`.
- **Field:** when `pick?.amount_mode === "keyed"`, the Quantity field is replaced by an Amount field: label "Amount", `voice="figure"`, icon `cash`, `keyboardType="decimal-pad"`, its own state `amountText`, cleared after each add.
- **`addLine`:** run `addFeeRefusal(lines, pick, nameOf)` first and show its refusal. Then:
  - keyed: `keyedAmount(amountText)` → refusal, or a line `{ feeTypeId, rateClass: null, quantity: 1, unitRate: amount, amount, keyed: true }`;
  - rate: today's path, unchanged.
- **Fee list:** a slot is `suppressed` when `addFeeRefusal(lines, choice, nameOf) !== null`. Tapping a suppressed slot shows that refusal, replacing the current R12 message and lock logic, which `addFeeRefusal` now owns.
- **Lines on the receipt:** a keyed line shows the fee name over its amount, not `1 × …`. A rate line is unchanged.
- **Header:** the subtitle names the first line's fee and, if there are more fee types, adds " +n".
- **Comments:** update the R12 comment block to point at `addFeeRefusal` and decision 2.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @ceedo/collector typecheck && pnpm --filter @ceedo/collector lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/collector/src/app/ambulant.tsx
git commit -m "feat(collector): typed amounts on the on-the-spot screen"
```

---

### Task 4: Verify; hand over the release order

**Files:** none new.

- [ ] **Step 1: Full suite on a fresh database, then typecheck everything**

```bash
supabase db reset
set -a; eval "$(supabase status -o env)"; set +a; pnpm test
pnpm typecheck
```
Expected: everything passes.

- [ ] **Step 2: Check the screen on a device or emulator, if one is attached**

Run `adb devices`. If a device is listed:
- Run the app (`pnpm --filter @ceedo/collector start`) against the local stack.
- Sign in as a collector with an area at Public Mall.
- Check that "Electricity bill payment (Public Mall)" shows an Amount field.
- Enter `1,234.50`, add "Electricity surcharge (Public Mall)" at `37`, record, and sync.
- Then check the receipt locally: `select gross_amount from ceedo_collections.collections order by synced_at desc limit 1` → `1271.50`.

If no device is attached, say so in the hand-over. Do not claim the screen was checked.

- [ ] **Step 3: Hand over**

Report to the user:
- what was built, and decisions 1–4 for the PR description;
- **the release order:**
  1. Deploy the Edge Functions to production. `sync-push` and `closeout` import `_shared/contract.ts`; `sync-push` is the one that matters.
  2. Then OTA: `pnpm ota:production --platform android --message "Typed amounts and facility fees"` from `apps/collector`.
- that the OTA carries local migration 0007, which rewinds every tablet's cursor. Each tablet's next sync is a full re-pull, the same as after 0002.
- that there is no server migration, so no SQL bundle.

Leave pushing, the PR and both deploys to `superpowers:finishing-a-development-branch` and the user's go-ahead.
