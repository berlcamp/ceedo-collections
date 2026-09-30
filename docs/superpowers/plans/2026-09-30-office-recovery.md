# Office Recovery of Lost Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin re-enters receipts lost with a wiped tablet into that collector's open shift, then closes the shift against the cash handed over.

**Architecture:** One migration adds `collection_recoveries` and three admin-only `security definer` functions. `recover_collection` hands every receipt to the existing `post_collection`, so a recovered receipt passes exactly the checks a tablet receipt does. The web adds a Ledger → Recovery page (server component + client forms + server actions), an Office-encoded badge on receipts and shifts, and an open-shift warning on the device credential panel.

**Tech Stack:** Postgres/PL/pgSQL (Supabase), vitest + `pg` + supabase-js (`tests/db`), Next.js App Router server actions, zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-30-office-recovery-design.md`

## Global Constraints

- Admin only: every function checks `ceedo_collections.is_admin()` first and raises with `errcode = 'insufficient_privilege'`; every server action checks `staff.role === "admin"`.
- Functions: `language plpgsql security definer set search_path = ceedo_collections, pg_temp`; `revoke execute ... from public; grant execute ... to authenticated`.
- A written reason is required by every function (`length(trim(reason)) > 0`).
- Money is never taken from the admin: `post_collection` prices the receipt; the stub total is only compared.
- `id`, `collector_id`, `device_id`, `shift_id` of a recovered receipt come from the server/shift, never from the admin's input.
- `authenticated` gets `SELECT` only on `collection_recoveries` (D6).
- Business dates are Asia/Manila.
- Error text raised by SQL is a sentence for the operator; the web shows it as-is (`failure(error.message)`).
- Migration file: `supabase/migrations/20260930000060_office_recovery.sql`.
- Comments: match the repo — WHY-comments in plain sentences, capital-led lead-ins for the non-obvious ones.

## Review Focus

1. **A second, lost shift on a day the collector already closed one** — recovery must open a new shift, not refuse because a closed one exists (the spec's §3.2 refusal is narrowed; see Task 1). Test in Task 1.
2. **Admin tries to smuggle `collector_id`/`device_id`/`shift_id`/`id` in the receipt JSON** — they must be overwritten from the shift. Test in Task 2.
3. **Same lease, two stubs entered newest first** — the refusal must name the problem (oldest months first), and the first stub must still post afterwards. Test in Task 2.
4. **Stub total mismatch after `post_collection` already inserted** — nothing may survive (collection, allocations, lines, recovery row). Test in Task 2.
5. **Office close includes receipts from both the tablet and recovery, minus standing cancellations** — and a short result is settleable through `record_variance_settlement`. Test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260930000060_office_recovery.sql` (create) | Table, three functions, grants. Built up across Tasks 1–3. |
| `tests/db/recovery.test.ts` (create) | DB behaviour of all three functions. |
| `packages/shared/src/db.types.ts` (regenerate) | Types for the new table and RPCs. |
| `apps/web/lib/recovery/months.ts` (create) | Pure: which unpaid months may be ticked; ticked → `group_rank`s. |
| `apps/web/lib/recovery/months.test.ts` (create) | Unit tests for the above. |
| `apps/web/lib/recovery/queries.ts` (create) | Reads for the page: collectors, devices, the shift and its receipts, booklets held, leases, unpaid groups, fee types. |
| `apps/web/lib/recovery/actions.ts` (create) | Server actions: open shift, recover receipt, close shift. |
| `apps/web/app/(admin)/ledger/recovery/page.tsx` (create) | The page. |
| `apps/web/components/recovery/*.tsx` (create) | Shift picker, receipt form, close form. |
| `apps/web/lib/nav/modules.ts` (modify) | Recovery tab under Collections. |
| `apps/web/lib/ledger/queries.ts`, `components/ledger/collections-table.tsx`, `lib/ledger/shifts.ts`, `components/ledger/shifts-table.tsx` (modify) | Office-encoded badge. |
| `apps/web/components/devices/device-credential-panel.tsx`, `apps/web/app/(admin)/[resource]/page.tsx` (modify) | Open-shift warning. |
| `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md` (modify) | D7 amendment. |

---

### Task 1: `collection_recoveries` table and `recovery_shift`

**Files:**
- Create: `supabase/migrations/20260930000060_office_recovery.sql`
- Create: `tests/db/recovery.test.ts`
- Modify: `docs/superpowers/specs/2026-09-30-office-recovery-design.md` (§3.2 refusal narrowed)

**Interfaces:**
- Produces: table `ceedo_collections.collection_recoveries(collection_id uuid pk, reason text, recorded_by uuid, recorded_at timestamptz)`; `ceedo_collections.recovery_shift(p_collector_id uuid, p_device_id uuid, p_business_date date, p_reason text) returns uuid`.

**Spec deviation (record it in the spec):** §3.2 refuses when a closed shift exists for that collector/device/date. That blocks the real case "shift 1 closed and synced, shift 2 lost entirely". The refusal that matters — never adding to a closed shift — is enforced by `recover_collection` (Task 2). So `recovery_shift` returns the device's open shift if it belongs to this collector and date, refuses if it belongs to anyone/any day else, and otherwise creates a new one. Edit §3.2's first refusal bullet to: "a closed shift is never reopened; if none is open, a new one is created even when a closed shift exists that day (a second, lost shift)."

- [ ] **Step 1: Write the failing tests**

`tests/db/recovery.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  POSTGRES_URL,
  createAppUser,
  createCollectionFixture,
  resetCutover,
  type CollectionFixture,
  type TestClient,
} from "../helpers/supabase";

/**
 * Office recovery (spec 2026-09-30): an admin re-enters receipts a wiped tablet lost, into
 * the collector's open shift, and closes it. is_admin() resolves through auth.uid(), so the
 * RPCs go through signed-in supabase-js clients; fixtures and assertions use the owner `db`.
 */
let db: Client;
let admin: TestClient;
let adminId: string;
let supervisor: TestClient;
const BUSINESS_DATE = "2026-10-05";
const REASON = "Tablet data cleared before sync; entered from booklet stubs";

beforeAll(async () => {
  db = new Client({ connectionString: POSTGRES_URL });
  await db.connect();
  ({ client: admin, userId: adminId } = await createAppUser({ email: "recovery-admin", role: "admin" }));
  ({ client: supervisor } = await createAppUser({ email: "recovery-supervisor", role: "supervisor" }));
});

afterAll(async () => {
  await resetCutover(db);
  await db.end();
});

async function openShiftFor(fx: CollectionFixture, status = "open"): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into ceedo_collections.shifts
       (id, collector_id, device_id, business_date, opened_at, status)
     values ($1, $2, $3, $4::date, now(), $5)`,
    [id, fx.collectorId, fx.deviceId, BUSINESS_DATE, status],
  );
  return id;
}

async function recoveryShift(client: TestClient, fx: CollectionFixture, date = BUSINESS_DATE) {
  return client.rpc("recovery_shift", {
    p_collector_id: fx.collectorId,
    p_device_id: fx.deviceId,
    p_business_date: date,
    p_reason: REASON,
  });
}

describe("recovery_shift", () => {
  it("refuses anyone but an admin", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await recoveryShift(supervisor, fx);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("returns the collector's open shift on that tablet and day", async () => {
    const fx = await createCollectionFixture(db);
    const shiftId = await openShiftFor(fx);
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    expect(data).toBe(shiftId);
  });

  it("creates the shift when the tablet never synced its opening, and audits it", async () => {
    const fx = await createCollectionFixture(db);
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select collector_id, device_id, business_date::text as d, status
         from ceedo_collections.shifts where id = $1`,
      [data],
    );
    expect(rows[0]).toEqual({
      collector_id: fx.collectorId, device_id: fx.deviceId, d: BUSINESS_DATE, status: "open",
    });
    const audit = await db.query(
      `select actor_id, after ->> 'reason' as reason from ceedo_collections.audit_log
        where action = 'recovery_shift' and entity_id = $1`,
      [data],
    );
    expect(audit.rows).toEqual([{ actor_id: adminId, reason: REASON }]);
  });

  it("opens a second shift when the day's first one is already closed", async () => {
    const fx = await createCollectionFixture(db);
    const closed = await openShiftFor(fx, "closed");
    const { data, error } = await recoveryShift(admin, fx);
    expect(error).toBeNull();
    expect(data).not.toBe(closed);
  });

  it("refuses when the tablet holds an open shift for another day", async () => {
    const fx = await createCollectionFixture(db);
    await openShiftFor(fx);
    const { error } = await recoveryShift(admin, fx, "2026-10-06");
    expect(error?.message).toMatch(/already has an open shift/);
  });

  it("refuses without a reason", async () => {
    const fx = await createCollectionFixture(db);
    const { error } = await admin.rpc("recovery_shift", {
      p_collector_id: fx.collectorId, p_device_id: fx.deviceId,
      p_business_date: BUSINESS_DATE, p_reason: "  ",
    });
    expect(error?.message).toMatch(/reason/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/recovery.test.ts`
Expected: FAIL — `Could not find the function ceedo_collections.recovery_shift`.

- [ ] **Step 3: Write the migration (first part)**

`supabase/migrations/20260930000060_office_recovery.sql`:

```sql
-- Office recovery of receipts lost with a wiped tablet (spec 2026-09-30-office-recovery).
--
-- A NARROW EXCEPTION TO D7 ("no web payment path at all"). A receipt lives only in the
-- tablet's outbox until a sync, and clearing the app's data before that sync destroys the
-- only copy but the paper stub. An admin re-enters it here, into that collector's still-open
-- shift, and closes the shift against the cash handed over. Every receipt goes through
-- post_collection -- the booklet, serial, oldest-months-first and rate rules are the
-- tablet's own, not a second copy of them.

create table ceedo_collections.collection_recoveries (
  collection_id uuid primary key references ceedo_collections.collections (id),
  reason        text not null check (length(trim(reason)) > 0),
  recorded_by   uuid not null references ceedo_collections.app_users (id),
  recorded_at   timestamptz not null default now()
);

select ceedo_collections.attach_audit('collection_recoveries');

alter table ceedo_collections.collection_recoveries enable row level security;

create policy collection_recoveries_read on ceedo_collections.collection_recoveries
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

revoke insert, update, delete on ceedo_collections.collection_recoveries
  from anon, authenticated, service_role;
grant select on ceedo_collections.collection_recoveries to authenticated, service_role;

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.assert_recovery_admin(p_reason text)
returns void
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may recover lost receipts'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Recovering receipts needs a written reason';
  end if;
end;
$$;

-- The shift a recovery goes into. A wiped tablet usually left its shift OPEN on the server
-- (the opening synced, the close never did), and sometimes left none at all (the wipe came
-- before the shift's first sync). A CLOSED SHIFT IS NEVER REOPENED: if none is open, a new
-- one is created even when the collector closed another that day -- the lost shift may be
-- the day's second.
create or replace function ceedo_collections.recovery_shift(
  p_collector_id  uuid,
  p_device_id     uuid,
  p_business_date date,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_open    ceedo_collections.shifts;
  v_id      uuid;
  v_pg_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);

  if not exists (select 1 from ceedo_collections.devices where id = p_device_id and active) then
    raise exception 'That tablet is not an active device';
  end if;
  if not exists (select 1 from ceedo_collections.app_users
                  where id = p_collector_id and role = 'collector') then
    raise exception 'That person is not a collector';
  end if;
  if p_business_date is null or p_business_date > ceedo_collections.business_date() then
    raise exception 'The shift date cannot be in the future';
  end if;

  select * into v_open from ceedo_collections.shifts
   where device_id = p_device_id and status = 'open'
   for update;
  if found then
    if v_open.collector_id = p_collector_id and v_open.business_date = p_business_date then
      return v_open.id;
    end if;
    raise exception 'That tablet already has an open shift from % for another collector or day. Recover and close that one first.',
      to_char(v_open.business_date, 'Mon DD, YYYY');
  end if;

  v_id := gen_random_uuid();
  insert into ceedo_collections.shifts
    (id, collector_id, device_id, business_date, opened_at, status)
  values
    (v_id, p_collector_id, p_device_id, p_business_date,
     p_business_date::timestamp at time zone 'Asia/Manila', 'open');

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'recovery_shift', 'shifts', v_id, null,
          jsonb_build_object('reason', trim(p_reason), 'collector_id', p_collector_id,
                             'device_id', p_device_id, 'business_date', p_business_date));
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.assert_recovery_admin(text) from public;
revoke execute on function ceedo_collections.recovery_shift(uuid, uuid, date, text) from public;
grant execute on function ceedo_collections.recovery_shift(uuid, uuid, date, text) to authenticated;
```

Before running: confirm `audit_log` has exactly the columns used (`grep -n "create table ceedo_collections.audit_log" -A15 supabase/migrations/20260917000010*.sql`) and that `ceedo_collections.business_date()` exists (`grep -rn "function ceedo_collections.business_date()" supabase/migrations`). Adjust to the real names if they differ.

- [ ] **Step 4: Apply and run**

Run: `npx supabase migration up --local && pnpm --filter @ceedo/tests exec vitest run db/recovery.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Edit spec §3.2 as described above, then commit**

```bash
git add supabase/migrations/20260930000060_office_recovery.sql tests/db/recovery.test.ts docs/superpowers/specs/2026-09-30-office-recovery-design.md
git commit -m "feat(db): recovery_shift opens or finds the shift a wiped tablet left behind"
```

---

### Task 2: `recover_collection`

**Files:**
- Modify: `supabase/migrations/20260930000060_office_recovery.sql` (append)
- Modify: `tests/db/recovery.test.ts` (append)

**Interfaces:**
- Consumes: `recovery_shift` (Task 1); existing `post_collection(jsonb) returns jsonb` (`status` = `accepted` | `duplicate` | `rejected`, `reason`, `collection_id`).
- Produces: `ceedo_collections.recover_collection(p_shift_id uuid, p_receipt jsonb, p_stub_total numeric, p_reason text) returns uuid` (the new collection id).

- [ ] **Step 1: Write the failing tests** (append to `tests/db/recovery.test.ts`)

```ts
describe("recover_collection", () => {
  let orNo = 1500;
  const COLLECTED_AT = `${BUSINESS_DATE}T02:00:00+00:00`; // 10:00 Manila

  async function unpaid(leaseId: string) {
    const { rows } = await db.query(
      `select group_rank, outstanding::text from ceedo_collections.unpaid_period_groups($1)`,
      [leaseId],
    );
    return rows as { group_rank: number; outstanding: string }[];
  }

  async function setup() {
    const fx = await createCollectionFixture(db);
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
    const { data: shiftId } = await recoveryShift(admin, fx);
    return { fx, shiftId: shiftId as string };
  }

  function leaseReceipt(fx: CollectionFixture, ranks: number[], extra: object = {}) {
    return {
      or_no: orNo++, booklet_id: fx.bookletId, collected_at: COLLECTED_AT,
      fee_type_id: fx.feeTypeId, lease_id: fx.leaseId,
      allocations: ranks.map((group_rank) => ({ group_rank })), lines: [], ...extra,
    };
  }

  const recover = (shiftId: string, receipt: object, stubTotal: string | number, client = admin) =>
    client.rpc("recover_collection", {
      p_shift_id: shiftId, p_receipt: receipt, p_stub_total: stubTotal, p_reason: REASON,
    });

  it("refuses anyone but an admin", async () => {
    const { fx, shiftId } = await setup();
    const { error } = await recover(shiftId, leaseReceipt(fx, [1]), 0, supervisor);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("posts a lease receipt into the shift, marked office-encoded", async () => {
    const { fx, shiftId } = await setup();
    const [first] = await unpaid(fx.leaseId);
    const { data: id, error } = await recover(shiftId, leaseReceipt(fx, [1]), first.outstanding);
    expect(error).toBeNull();
    const { rows } = await db.query(
      `select c.shift_id, c.collector_id, c.device_id, c.posted_by, c.gross_amount::text as gross,
              r.reason, r.recorded_by
         from ceedo_collections.collections c
         join ceedo_collections.collection_recoveries r on r.collection_id = c.id
        where c.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      shift_id: shiftId, collector_id: fx.collectorId, device_id: fx.deviceId,
      posted_by: adminId, gross: first.outstanding, reason: REASON, recorded_by: adminId,
    });
    const audit = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where entity = 'collection_recoveries' and entity_id = $1`,
      [id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("posts a cash-fee receipt priced by the day's rate", async () => {
    const { fx, shiftId } = await setup();
    const expected = (3 * Number(fx.perHeadRate)).toFixed(2);
    const { error } = await recover(shiftId, {
      or_no: orNo++, booklet_id: fx.bookletId, collected_at: COLLECTED_AT,
      fee_type_id: fx.perHeadFeeTypeId, lease_id: null, payer_ref: "Walk-in",
      allocations: [], lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity: 3 }],
    }, expected);
    expect(error).toBeNull();
  });

  it("takes id, collector, tablet and shift from the shift, never from the receipt", async () => {
    const { fx, shiftId } = await setup();
    const [first] = await unpaid(fx.leaseId);
    const other = await createCollectionFixture(db);
    const smuggled = randomUUID();
    const { data: id, error } = await recover(shiftId, leaseReceipt(fx, [1], {
      id: smuggled, collector_id: other.collectorId, device_id: other.deviceId, shift_id: randomUUID(),
    }), first.outstanding);
    expect(error).toBeNull();
    expect(id).not.toBe(smuggled);
    const { rows } = await db.query(
      `select shift_id, collector_id, device_id from ceedo_collections.collections where id = $1`, [id],
    );
    expect(rows[0]).toEqual({ shift_id: shiftId, collector_id: fx.collectorId, device_id: fx.deviceId });
  });

  it("refuses a stub total that disagrees, and leaves nothing behind", async () => {
    const { fx, shiftId } = await setup();
    const receipt = leaseReceipt(fx, [1]);
    const { error } = await recover(shiftId, receipt, "1.00");
    expect(error?.message).toMatch(/The stub says ₱1\.00/);
    const { rows } = await db.query(
      `select count(*)::int as n from ceedo_collections.collections
        where booklet_id = $1 and or_no = $2`,
      [fx.bookletId, receipt.or_no],
    );
    expect(rows[0].n).toBe(0);
  });

  it("names the problem when a later month is entered first, then accepts the earlier stub", async () => {
    const { fx, shiftId } = await setup();
    const groups = await unpaid(fx.leaseId);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const later = await recover(shiftId, leaseReceipt(fx, [2]), groups[1].outstanding);
    expect(later.error?.message).toMatch(/oldest unpaid/);
    const earlier = await recover(shiftId, leaseReceipt(fx, [1]), groups[0].outstanding);
    expect(earlier.error).toBeNull();
  });

  it("refuses a serial already used, e.g. one the tablet synced before the wipe", async () => {
    const { fx, shiftId } = await setup();
    const groups = await unpaid(fx.leaseId);
    const receipt = leaseReceipt(fx, [1]);
    await recover(shiftId, receipt, groups[0].outstanding);
    const again = await recover(shiftId, { ...receipt, allocations: [{ group_rank: 1 }] }, groups[1].outstanding);
    expect(again.error?.message).toMatch(/already been used/);
  });

  it("refuses a receipt dated off the shift's day", async () => {
    const { fx, shiftId } = await setup();
    const { error } = await recover(shiftId, leaseReceipt(fx, [1], {
      collected_at: "2026-10-04T02:00:00+00:00",
    }), "0");
    expect(error?.message).toMatch(/must be dated/);
  });

  it("refuses a closed shift", async () => {
    const { fx, shiftId } = await setup();
    await db.query(`update ceedo_collections.shifts set status = 'closed' where id = $1`, [shiftId]);
    const { error } = await recover(shiftId, leaseReceipt(fx, [1]), "0");
    expect(error?.message).toMatch(/closed/);
  });
});
```

The test "a later month first" needs a lease with two unpaid groups on `BUSINESS_DATE`. If `createCollectionFixture` + one accrual yields only one, give the fixture an earlier start (check `createLeaseFixture`'s options, e.g. a `startDate` one month before cutover) or run `run_accrual` for a second period; keep the `toBeGreaterThanOrEqual(2)` guard so a fixture change fails loudly instead of passing vacuously.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/recovery.test.ts`
Expected: the new `recover_collection` tests FAIL (function not found); Task 1's still pass.

- [ ] **Step 3: Append the function to the migration**

```sql
-- ---------------------------------------------------------------------------------------

-- post_collection's reason codes, as sentences for the admin holding the stub.
create or replace function ceedo_collections.recovery_refusal(p_result jsonb)
returns text
language sql
immutable
set search_path = ceedo_collections, pg_temp
as $$
  select case p_result ->> 'reason'
    when 'booklet_not_assigned'  then 'That booklet was not held by this collector on that day'
    when 'or_out_of_range'       then 'That serial is outside the booklet''s range'
    when 'or_already_used'       then 'That serial has already been used (it may have synced before the tablet was wiped)'
    when 'or_spoiled'            then 'That serial was recorded as spoiled'
    when 'no_parts'              then 'Tick at least one month, or add a fee line'
    when 'lease_not_found'       then 'No such lease'
    when 'allocation_not_prefix' then 'The months ticked are not the oldest unpaid ones. Enter the receipt that paid the earlier month first'
    when 'rate_not_found'        then 'No rate is in effect for that fee on that date'
    when 'stale_allocations'     then 'The unpaid months changed while this was saving. Try again'
    else 'The receipt was refused (' || coalesce(p_result ->> 'reason', p_result ->> 'status') || ')'
  end;
$$;

create or replace function ceedo_collections.recover_collection(
  p_shift_id   uuid,
  p_receipt    jsonb,
  p_stub_total numeric,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift  ceedo_collections.shifts;
  v_result jsonb;
  v_id     uuid := gen_random_uuid();
  v_gross  numeric(14,2);
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  -- A closed shift's system_total and variance are frozen (close_shift), and a shortage may
  -- already be settled against them. A receipt added now would be counted by nothing.
  if v_shift.status <> 'open' then
    raise exception 'That shift is already closed. Its totals are frozen; a receipt cannot be added to it';
  end if;
  if ((p_receipt ->> 'collected_at')::timestamptz at time zone 'Asia/Manila')::date
     is distinct from v_shift.business_date then
    raise exception 'The receipt must be dated %, the shift''s day',
      to_char(v_shift.business_date, 'Mon DD, YYYY');
  end if;

  -- Which receipt, which collector, which tablet, which shift are facts of the recovery,
  -- not claims on the stub: applied AFTER the admin's input so none of them can be
  -- overridden. The same rule resolve_exception_corrected applies.
  v_result := ceedo_collections.post_collection(
    p_receipt || jsonb_build_object('id', v_id,
                                    'collector_id', v_shift.collector_id,
                                    'device_id', v_shift.device_id,
                                    'shift_id', v_shift.id));
  if v_result ->> 'status' <> 'accepted' then
    raise exception '%', ceedo_collections.recovery_refusal(v_result);
  end if;

  -- The stub is a cross-check, never the amount. A raise here rolls back the collection,
  -- its allocations and its lines with it.
  select gross_amount into v_gross from ceedo_collections.collections where id = v_id;
  if p_stub_total is null or p_stub_total <> v_gross then
    raise exception 'The stub says ₱%; what was ticked comes to ₱%. Check the months or quantities',
      to_char(coalesce(p_stub_total, 0), 'FM999,999,990.00'), to_char(v_gross, 'FM999,999,990.00');
  end if;

  insert into ceedo_collections.collection_recoveries (collection_id, reason, recorded_by)
  values (v_id, trim(p_reason), auth.uid());
  return v_id;
end;
$$;

revoke execute on function ceedo_collections.recovery_refusal(jsonb) from public;
revoke execute on function ceedo_collections.recover_collection(uuid, jsonb, numeric, text) from public;
grant execute on function ceedo_collections.recover_collection(uuid, jsonb, numeric, text) to authenticated;
```

- [ ] **Step 4: Re-apply and run**

The local DB already has the file's first part. Run: `npx supabase db reset --local && pnpm --filter @ceedo/tests exec vitest run db/recovery.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260930000060_office_recovery.sql tests/db/recovery.test.ts
git commit -m "feat(db): recover_collection re-enters a lost receipt through post_collection"
```

---

### Task 3: `office_close_shift`

**Files:**
- Modify: `supabase/migrations/20260930000060_office_recovery.sql` (append)
- Modify: `tests/db/recovery.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–2; existing `record_variance_settlement(uuid, numeric, text, date)`, `cancel_collection` (check its exact signature with `grep -rn "function ceedo_collections.cancel_collection" supabase/migrations | tail -1`).
- Produces: `ceedo_collections.office_close_shift(p_shift_id uuid, p_declared_total numeric, p_reason text) returns jsonb` → `{status:'closed', system_count, system_total, variance}`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe("office_close_shift", () => {
  const close = (shiftId: string, declared: string, client = admin) =>
    client.rpc("office_close_shift", { p_shift_id: shiftId, p_declared_total: declared, p_reason: REASON });

  it("refuses anyone but an admin", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await recoveryShift(admin, fx);
    const { error } = await close(shiftId as string, "0", supervisor);
    expect(error?.message).toMatch(/Only an administrator/);
  });

  it("closes on the server's totals, counting tablet and recovered receipts but not cancelled ones", async () => {
    const fx = await createCollectionFixture(db);
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [BUSINESS_DATE]);
    const { data: shiftId } = await recoveryShift(admin, fx);
    const rate = Number(fx.perHeadRate);
    const cashReceipt = (or_no: number, quantity: number) => ({
      or_no, booklet_id: fx.bookletId, collected_at: `${BUSINESS_DATE}T02:00:00+00:00`,
      fee_type_id: fx.perHeadFeeTypeId, lease_id: null, payer_ref: "Walk-in", allocations: [],
      lines: [{ fee_type_id: fx.perHeadFeeTypeId, rate_class: "hog", quantity }],
    });
    // A "tablet" receipt: posted directly with the shift, no recovery row.
    const tablet = await db.query(`select ceedo_collections.post_collection($1::jsonb) as r`, [
      JSON.stringify({ ...cashReceipt(1700, 2), id: randomUUID(), collector_id: fx.collectorId,
                       device_id: fx.deviceId, shift_id: shiftId }),
    ]);
    expect(tablet.rows[0].r.status).toBe("accepted");
    const kept = await admin.rpc("recover_collection", {
      p_shift_id: shiftId, p_receipt: cashReceipt(1701, 1), p_stub_total: rate.toFixed(2), p_reason: REASON,
    });
    const cancelled = await admin.rpc("recover_collection", {
      p_shift_id: shiftId, p_receipt: cashReceipt(1702, 5), p_stub_total: (5 * rate).toFixed(2), p_reason: REASON,
    });
    expect(kept.error).toBeNull();
    expect(cancelled.error).toBeNull();
    // Cancel through the real RPC so standing_cancellations sees it; adjust to its signature.
    const cancel = await admin.rpc("cancel_collection", { p_collection_id: cancelled.data, p_reason: "Wrong stub" });
    expect(cancel.error).toBeNull();

    const system = (3 * rate).toFixed(2);
    const declared = (3 * rate - 10).toFixed(2);
    const { data, error } = await close(shiftId as string, declared);
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "closed", system_count: 2 });
    expect(Number(data.system_total)).toBe(Number(system));
    expect(Number(data.variance)).toBe(-10);

    // Short, so it enters the existing settlement flow unchanged.
    const settle = await supervisor.rpc("record_variance_settlement", {
      p_shift_id: shiftId, p_amount: 10, p_reference: "OR-123", p_received_at: BUSINESS_DATE,
    });
    expect(settle.error).toBeNull();

    const audit = await db.query(
      `select count(*)::int as n from ceedo_collections.audit_log
        where action = 'office_close_shift' and entity_id = $1`, [shiftId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("refuses a shift that is not open", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await recoveryShift(admin, fx);
    await close(shiftId as string, "0");
    const { error } = await close(shiftId as string, "0");
    expect(error?.message).toMatch(/not open/);
  });

  it("refuses without a declared cash figure", async () => {
    const fx = await createCollectionFixture(db);
    const { data: shiftId } = await recoveryShift(admin, fx);
    const { error } = await admin.rpc("office_close_shift", {
      p_shift_id: shiftId, p_declared_total: null, p_reason: REASON,
    });
    expect(error?.message).toMatch(/cash/);
  });
});
```

Note `record_variance_settlement` refuses a received date before the shift date and in the future relative to `business_date()`; if the local clock's business date is before `2026-10-05`, use today's Manila date for both `BUSINESS_DATE`-based shift and `p_received_at`, or pick a `BUSINESS_DATE` in the past. Check `resolve-exception.test.ts`/`close-shift.test.ts` for how they cope (they use `2026-10-05` too) and match.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ceedo/tests exec vitest run db/recovery.test.ts`
Expected: `office_close_shift` tests FAIL (function not found).

- [ ] **Step 3: Append the function**

```sql
-- ---------------------------------------------------------------------------------------

-- Closes a shift from the office. Written for recovery, and also the missing action
-- migration 0059 names ("a supervisor must close it") for any shift a tablet can no longer
-- close. The totals are the server's own, computed exactly as close_shift computes them;
-- there are no device figures to compare, so there is no `mismatch`. A short variance
-- enters the settlement flow (0058) like any other.
create or replace function ceedo_collections.office_close_shift(
  p_shift_id       uuid,
  p_declared_total numeric,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_shift        ceedo_collections.shifts;
  v_system_count integer;
  v_system_total numeric(14,2);
  v_pg_role      text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  perform ceedo_collections.assert_recovery_admin(p_reason);
  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Enter the cash that was handed over for this shift';
  end if;

  select * into v_shift from ceedo_collections.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'No such shift';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'That shift is not open (it is %)', v_shift.status;
  end if;

  -- Same scope and exclusion as close_shift (migration 0051).
  select count(*), coalesce(sum(c.gross_amount), 0)
    into v_system_count, v_system_total
    from ceedo_collections.collections c
   where c.shift_id = p_shift_id
     and not exists (select 1 from ceedo_collections.standing_cancellations cc
                      where cc.collection_id = c.id);

  update ceedo_collections.shifts
     set status = 'closed', closed_at = now(), declared_total = p_declared_total,
         system_total = v_system_total, system_count = v_system_count,
         variance = p_declared_total - v_system_total
   where id = p_shift_id;

  insert into ceedo_collections.audit_log
    (actor_id, pg_role, action, entity, entity_id, before, after)
  values (auth.uid(), v_pg_role, 'office_close_shift', 'shifts', p_shift_id, to_jsonb(v_shift),
          jsonb_build_object('reason', trim(p_reason), 'declared_total', p_declared_total,
                             'system_total', v_system_total, 'system_count', v_system_count));

  return jsonb_build_object('status', 'closed', 'system_count', v_system_count,
                            'system_total', v_system_total,
                            'variance', p_declared_total - v_system_total);
end;
$$;

revoke execute on function ceedo_collections.office_close_shift(uuid, numeric, text) from public;
grant execute on function ceedo_collections.office_close_shift(uuid, numeric, text) to authenticated;
```

- [ ] **Step 4: Re-apply and run the whole DB suite**

Run: `npx supabase db reset --local && pnpm --filter @ceedo/tests exec vitest run db`
Expected: PASS, including existing privilege tests. If `tests/db/ledger-privileges.test.ts` or a function-grant inventory test enumerates every function `authenticated` may execute, add the three new functions to it (that is the test doing its job, not a regression).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260930000060_office_recovery.sql tests/db
git commit -m "feat(db): office_close_shift closes a shift against the cash handed over"
```

---

### Task 4: Types, month rules, queries and server actions

**Files:**
- Regenerate: `packages/shared/src/db.types.ts`
- Create: `apps/web/lib/recovery/months.ts`, `apps/web/lib/recovery/months.test.ts`, `apps/web/lib/recovery/queries.ts`, `apps/web/lib/recovery/actions.ts`

**Interfaces:**
- Consumes: the three RPCs; `requireStaff()` (`@/lib/supabase/session`), `getServerClient()` (`@/lib/supabase/server`), `ledgerClient()` and `selectByIds` (`@/lib/ledger/queries`), `SaveResult`/`toSaveResult` (`@/lib/admin/save-result`).
- Produces:
  - `months.ts`: `type UnpaidGroup = { groupRank: number; periodStart: string; periodEnd: string; outstanding: number /* centavos */ }`; `canTick(groups: UnpaidGroup[], ticked: number[], rank: number): boolean`; `tickedRanks(ticked: number[]): number[]` (sorted, validated contiguous from 1, throws otherwise); `tickedTotal(groups, ticked): number`.
  - `queries.ts`: `getRecoveryChoices(): Promise<{ collectors: {id,name}[]; devices: {id,label,lastSeenAt: string|null}[] }>`; `getRecoveryShift(shiftId): Promise<RecoveryShift | null>` where `RecoveryShift = { id; collectorId; collectorName; deviceId; deviceLabel; lastSeenAt; businessDate; status; receipts: { id; orNo; stallOrPayer; grossAmount: number; officeEncoded: boolean }[] }`; `getHeldBooklets(collectorId, date)`; `getCollectorLeases(collectorId)`; `getUnpaidGroups(leaseId): Promise<UnpaidGroup[]>`; `getCashFeeTypes(date)`.
  - `actions.ts` (`"use server"`): `openRecoveryShift(formData): Promise<SaveResult>` (id = shift id); `recoverReceipt(formData): Promise<SaveResult>`; `closeRecoveredShift(formData): Promise<SaveResult & { variance?: number }>`.

- [ ] **Step 1: Regenerate DB types**

Run: `pnpm db:types && pnpm --filter @ceedo/shared build` (skip `build` if the package has no build script — check `packages/shared/package.json`).
Expected: `db.types.ts` now contains `collection_recoveries`, `recovery_shift`, `recover_collection`, `office_close_shift`.

- [ ] **Step 2: Write the failing month-rule tests**

`apps/web/lib/recovery/months.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canTick, tickedRanks, tickedTotal, type UnpaidGroup } from "./months";

const groups: UnpaidGroup[] = [
  { groupRank: 1, periodStart: "2026-07-01", periodEnd: "2026-07-31", outstanding: 150000 },
  { groupRank: 2, periodStart: "2026-08-01", periodEnd: "2026-08-31", outstanding: 150000 },
  { groupRank: 3, periodStart: "2026-09-01", periodEnd: "2026-09-30", outstanding: 165000 },
];

describe("unpaid months on a recovered lease receipt", () => {
  it("allows only the next month after a contiguous run from the oldest", () => {
    expect(canTick(groups, [], 1)).toBe(true);
    expect(canTick(groups, [], 2)).toBe(false);
    expect(canTick(groups, [1], 2)).toBe(true);
    expect(canTick(groups, [1], 3)).toBe(false);
  });

  it("allows unticking only the newest ticked month", () => {
    expect(canTick(groups, [1, 2], 2)).toBe(true);
    expect(canTick(groups, [1, 2], 1)).toBe(false);
  });

  it("maps ticked months to sorted group ranks and refuses a gap", () => {
    expect(tickedRanks([2, 1])).toEqual([1, 2]);
    expect(() => tickedRanks([1, 3])).toThrow(/oldest/);
    expect(() => tickedRanks([])).toThrow(/at least one/);
  });

  it("totals the ticked months in centavos", () => {
    expect(tickedTotal(groups, [1, 2])).toBe(300000);
  });
});
```

Run: `pnpm --filter web exec vitest run lib/recovery/months.test.ts` (check the web package name in `apps/web/package.json`).
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `months.ts`**

```ts
/**
 * Which unpaid months a recovered lease receipt may pay. post_collection settles whole
 * period groups, oldest first, as a contiguous run from rank 1 (`allocation_not_prefix`).
 * The form enforces the same rule so an admin cannot tick a pattern the server will refuse.
 */
export interface UnpaidGroup {
  groupRank: number;
  periodStart: string;
  periodEnd: string;
  /** Centavos. */
  outstanding: number;
}

/** Whether `rank` may be toggled given what is ticked now. */
export function canTick(groups: UnpaidGroup[], ticked: number[], rank: number): boolean {
  if (!groups.some((g) => g.groupRank === rank)) return false;
  const newest = ticked.length === 0 ? 0 : Math.max(...ticked);
  return ticked.includes(rank) ? rank === newest : rank === newest + 1;
}

export function tickedRanks(ticked: number[]): number[] {
  if (ticked.length === 0) throw new Error("Tick at least one month");
  const sorted = [...ticked].sort((a, b) => a - b);
  sorted.forEach((rank, i) => {
    if (rank !== i + 1) throw new Error("Months must run from the oldest unpaid one");
  });
  return sorted;
}

export function tickedTotal(groups: UnpaidGroup[], ticked: number[]): number {
  return groups.filter((g) => ticked.includes(g.groupRank)).reduce((a, g) => a + g.outstanding, 0);
}
```

Run the test again. Expected: PASS.

- [ ] **Step 4: Write `queries.ts`**

Follow `apps/web/lib/ledger/queries.ts` exactly (same `ledgerClient()`, `selectByIds`, `centavos` from `@ceedo/shared`). Contents:

```ts
import { centavos } from "@ceedo/shared";
import { ledgerClient, selectByIds } from "@/lib/ledger/queries";
import type { UnpaidGroup } from "./months";

export interface RecoveryReceipt {
  id: string; orNo: number; stallOrPayer: string; grossAmount: number; officeEncoded: boolean;
}
export interface RecoveryShift {
  id: string; collectorId: string; collectorName: string; deviceId: string; deviceLabel: string;
  lastSeenAt: string | null; businessDate: string; status: string; receipts: RecoveryReceipt[];
}

export async function getRecoveryChoices() {
  const supabase = await ledgerClient();
  const [collectors, devices] = await Promise.all([
    supabase.from("app_users").select("id, full_name").eq("role", "collector").eq("status", "active").order("full_name"),
    supabase.from("devices").select("id, label, last_seen_at").eq("active", true).order("label"),
  ]);
  if (collectors.error) throw collectors.error;
  if (devices.error) throw devices.error;
  return {
    collectors: collectors.data.map((c) => ({ id: c.id, name: c.full_name })),
    devices: devices.data.map((d) => ({ id: d.id, label: d.label, lastSeenAt: d.last_seen_at })),
  };
}

export async function getRecoveryShift(shiftId: string): Promise<RecoveryShift | null> {
  const supabase = await ledgerClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, collector_id, device_id, business_date, status, collector:app_users!shifts_collector_id_fkey(full_name), device:devices!shifts_device_id_fkey(label, last_seen_at)")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw error;
  if (!shift) return null;

  const { data: rows, error: rowsError } = await supabase
    .from("collections")
    .select("id, or_no, lease_id, payer_ref, gross_amount")
    .eq("shift_id", shiftId)
    .order("or_no");
  if (rowsError) throw rowsError;
  const ids = (rows ?? []).map((r) => r.id);
  const leaseIds = [...new Set((rows ?? []).map((r) => r.lease_id).filter((x): x is string => x !== null))];
  const [recovered, leases] = await Promise.all([
    selectByIds(ids, (chunk) => supabase.from("collection_recoveries").select("collection_id").in("collection_id", chunk)),
    selectByIds(leaseIds, (chunk) => supabase.from("leases").select("id, stalls(stall_no)").in("id", chunk)),
  ]);
  const officeEncoded = new Set(recovered.map((r) => r.collection_id));
  const stallByLease = new Map(leases.map((l) => [l.id, l.stalls?.stall_no ?? "—"]));

  return {
    id: shift.id,
    collectorId: shift.collector_id,
    collectorName: shift.collector?.full_name ?? "—",
    deviceId: shift.device_id,
    deviceLabel: shift.device?.label ?? "—",
    lastSeenAt: shift.device?.last_seen_at ?? null,
    businessDate: shift.business_date,
    status: shift.status,
    receipts: (rows ?? []).map((r) => ({
      id: r.id,
      orNo: r.or_no,
      stallOrPayer: r.lease_id ? (stallByLease.get(r.lease_id) ?? "—") : (r.payer_ref ?? "—"),
      grossAmount: centavos(r.gross_amount),
      officeEncoded: officeEncoded.has(r.id),
    })),
  };
}

/** Booklets the collector held on that date: the same test post_collection applies. */
export async function getHeldBooklets(collectorId: string, date: string) {
  const supabase = await ledgerClient();
  const { data, error } = await supabase
    .from("booklet_assignments")
    .select("booklet_id, assigned_at, returned_at, booklets(serial_prefix, start_no, end_no)")
    .eq("collector_id", collectorId)
    .lte("assigned_at", date)
    .or(`returned_at.is.null,returned_at.gte.${date}`);
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.booklet_id,
    label: `${a.booklets?.serial_prefix ?? ""} ${a.booklets?.start_no}–${a.booklets?.end_no}`.trim(),
  }));
}

export async function getUnpaidGroups(leaseId: string): Promise<UnpaidGroup[]> {
  const supabase = await ledgerClient();
  const { data, error } = await supabase.rpc("unpaid_period_groups", { p_lease_id: leaseId });
  if (error) throw error;
  return (data ?? []).map((g) => ({
    groupRank: g.group_rank, periodStart: g.period_start, periodEnd: g.period_end,
    outstanding: centavos(g.outstanding),
  }));
}
```

Add `getCollectorLeases(collectorId)` (active leases in the facilities of the collector's active `collector_assignments`, labelled `stall_no · tenant`) and `getCashFeeTypes(date)` (fee types with `accrues = false` and their rate classes with a rate in effect on `date`), each modelled on the reads above; look at how the ledger lease pages select `leases` with `stalls` and `tenants`, and at `rates` columns in `db.types.ts`. If the embedded-relationship names (`shifts_collector_id_fkey`, etc.) differ, take the real ones from `db.types.ts` `Relationships`. If `selectByIds` is not exported from `lib/ledger/queries.ts`, export it (one-word change).

- [ ] **Step 5: Write `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toSaveResult, type SaveResult } from "@/lib/admin/save-result";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";
import { tickedRanks } from "./months";

/**
 * Office recovery (spec 2026-09-30). Each RPC checks is_admin() itself and raises a sentence
 * written for the operator, shown as-is; the check here only spares a non-admin the round trip.
 */
function failure(message: string): SaveResult {
  return { ok: false, fieldErrors: {}, formError: message };
}

async function adminOnly(): Promise<SaveResult | null> {
  const staff = await requireStaff();
  return staff.role === "admin" ? null : failure("Only an administrator may recover lost receipts.");
}

function refresh() {
  revalidatePath("/ledger/recovery");
  revalidatePath("/ledger/shifts");
  revalidatePath("/ledger/collections");
}

const reason = z.string().trim().min(1, "Write why these receipts are being recovered");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

const openSchema = z.object({
  collectorId: z.guid("Choose the collector"),
  deviceId: z.guid("Choose the tablet"),
  businessDate: date,
  reason,
});

export async function openRecoveryShift(formData: FormData): Promise<SaveResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = openSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("recovery_shift", {
    p_collector_id: parsed.data.collectorId,
    p_device_id: parsed.data.deviceId,
    p_business_date: parsed.data.businessDate,
    p_reason: parsed.data.reason,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id: data };
}

const receiptSchema = z.object({
  shiftId: z.guid(),
  reason,
  bookletId: z.guid("Choose the booklet"),
  orNo: z.coerce.number().int().positive("Enter the serial on the stub"),
  businessDate: date,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  kind: z.enum(["lease", "cash"]),
  leaseId: z.string().optional(),
  months: z.string().optional(), // comma-separated group ranks
  feeTypeId: z.string().optional(),
  rateClass: z.string().optional(),
  quantity: z.coerce.number().int().positive().optional(),
  payerRef: z.string().trim().optional(),
  stubTotal: z.coerce.number().nonnegative("Enter the total on the stub"),
});

export async function recoverReceipt(formData: FormData): Promise<SaveResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = receiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const r = parsed.data;

  // Stubs rarely carry a time. Noon Manila keeps the receipt inside its business day.
  const collectedAt = `${r.businessDate}T${r.time || "12:00"}:00+08:00`;
  let receipt: Record<string, unknown>;
  if (r.kind === "lease") {
    if (!r.leaseId) return { ok: false, fieldErrors: { leaseId: "Choose the lease" } };
    let ranks: number[];
    try {
      ranks = tickedRanks((r.months ?? "").split(",").filter(Boolean).map(Number));
    } catch (e) {
      return { ok: false, fieldErrors: { months: (e as Error).message } };
    }
    const { data: lease } = await (await getServerClient())
      .from("leases").select("fee_type_id").eq("id", r.leaseId).maybeSingle();
    receipt = {
      or_no: r.orNo, booklet_id: r.bookletId, collected_at: collectedAt,
      fee_type_id: lease?.fee_type_id, lease_id: r.leaseId,
      allocations: ranks.map((group_rank) => ({ group_rank })), lines: [],
    };
  } else {
    if (!r.feeTypeId) return { ok: false, fieldErrors: { feeTypeId: "Choose the fee" } };
    if (!r.quantity) return { ok: false, fieldErrors: { quantity: "Enter the quantity" } };
    receipt = {
      or_no: r.orNo, booklet_id: r.bookletId, collected_at: collectedAt,
      fee_type_id: r.feeTypeId, lease_id: null, payer_ref: r.payerRef || null,
      allocations: [],
      lines: [{ fee_type_id: r.feeTypeId, ...(r.rateClass ? { rate_class: r.rateClass } : {}), quantity: r.quantity }],
    };
  }

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("recover_collection", {
    p_shift_id: r.shiftId, p_receipt: receipt, p_stub_total: r.stubTotal, p_reason: r.reason,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, id: data };
}

const closeSchema = z.object({
  shiftId: z.guid(),
  reason,
  declaredTotal: z.coerce.number().nonnegative("Enter the cash handed over"),
  confirmLost: z.literal("on", { message: "Confirm that this tablet's data was lost" }),
});

export async function closeRecoveredShift(formData: FormData): Promise<SaveResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = closeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toSaveResult(parsed, null);
  const supabase = await getServerClient();
  const { error } = await supabase.rpc("office_close_shift", {
    p_shift_id: parsed.data.shiftId,
    p_declared_total: parsed.data.declaredTotal,
    p_reason: parsed.data.reason,
  });
  if (error) return failure(error.message);
  refresh();
  revalidatePath("/ledger/shortages");
  return { ok: true, id: parsed.data.shiftId };
}
```

Confirm the lease's fee-type column name (`grep -n "leases: {" -A25 packages/shared/src/db.types.ts`); the tablet takes the lease receipt's `fee_type_id` from the lease the same way (`packages/sync-engine/src/collect.ts`).

- [ ] **Step 6: Typecheck, lint, test**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web exec vitest run lib/recovery && pnpm --filter web lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/db.types.ts apps/web/lib/recovery
git commit -m "feat(web): recovery queries, month rules and server actions"
```

---

### Task 5: The Recovery page

**Files:**
- Create: `apps/web/app/(admin)/ledger/recovery/page.tsx`
- Create: `apps/web/components/recovery/shift-picker.tsx`, `receipt-form.tsx`, `close-form.tsx`, `recovered-receipts.tsx`
- Modify: `apps/web/lib/nav/modules.ts` (tab)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: route `/ledger/recovery?shift=<id>`; lease month data fetched by the receipt form through a small server action `unpaidGroupsFor(leaseId)` added to `lib/recovery/actions.ts` (returns `UnpaidGroup[]`, admin only).

- [ ] **Step 1: Page**

```tsx
import { notFound, redirect } from "next/navigation";
import { ScreenHeader } from "@/components/shell/screen-header";
import { CloseForm } from "@/components/recovery/close-form";
import { ReceiptForm } from "@/components/recovery/receipt-form";
import { RecoveredReceipts } from "@/components/recovery/recovered-receipts";
import { ShiftPicker } from "@/components/recovery/shift-picker";
import {
  getCashFeeTypes, getCollectorLeases, getHeldBooklets, getRecoveryChoices, getRecoveryShift,
} from "@/lib/recovery/queries";
import { manilaToday } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * Recovery: receipts lost with a wiped tablet, re-entered from the booklet stubs into the
 * collector's open shift, then the shift closed against the cash handed over. Spec
 * 2026-09-30-office-recovery; the one exception to D7's "no web payment path". Admin only.
 */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ shift?: string }>;
}) {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/");
  const { shift: shiftId } = await searchParams;

  if (!shiftId) {
    const choices = await getRecoveryChoices();
    return (
      <div>
        <ScreenHeader
          title="Recovery"
          note="For a tablet whose data was cleared before it synced. Pick the collector, tablet and day; enter each missing receipt from the booklet stubs; then close the shift with the cash that was handed over. Every receipt is checked exactly as a tablet receipt is, and marked Office-encoded."
        />
        <ShiftPicker {...choices} today={manilaToday()} />
      </div>
    );
  }

  const shift = await getRecoveryShift(shiftId);
  if (!shift) notFound();
  const [booklets, leases, fees] = await Promise.all([
    getHeldBooklets(shift.collectorId, shift.businessDate),
    getCollectorLeases(shift.collectorId),
    getCashFeeTypes(shift.businessDate),
  ]);

  return (
    <div>
      <ScreenHeader title="Recovery" note={`${shift.collectorName} · ${shift.deviceLabel} · shift of ${shift.businessDate}`} />
      <RecoveredReceipts shift={shift} />
      {shift.status === "open" ? (
        <>
          <ReceiptForm shift={shift} booklets={booklets} leases={leases} fees={fees} />
          <CloseForm shift={shift} />
        </>
      ) : (
        <p className="mt-6 text-sm text-ink-2">This shift is closed. Its totals are final.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Components**

Build each as a client component in the style of `components/shortages/settle-dialog.tsx` (`useSubmit`, `FieldShell`, `TextInput`, `Select`, `Button`, `SaveResult` errors per field and `formError` in a `Notice`). Behaviour:

- `shift-picker.tsx`: selects for collector and tablet (tablet options show "last heard from <date>" from `lastSeenAt`), a date input defaulting to `today`, a reason textarea. On success `router.push("/ledger/recovery?shift=" + result.id)`.
- `recovered-receipts.tsx` (server-safe, no hooks): table of `shift.receipts` — serial, stall/payer, amount (`Money`), and a badge **From tablet** or **Office-encoded**; footer with count and total. Above it, a `Notice`: "This tablet was last heard from <lastSeenAt>. Recover only if its data was lost; a tablet still in use would send these receipts again." when `lastSeenAt` is after the shift's business date start.
- `receipt-form.tsx`: hidden `shiftId`, `businessDate`, and the reason (prefilled from a `reason` prop the page reads from the audit row, or a text field the admin fills once and that persists in component state across submissions); booklet select; serial; optional time; a `lease | cash` toggle. **Lease:** lease select → call `unpaidGroupsFor(leaseId)` → render the months as checkboxes, each `disabled={!canTick(groups, ticked, g.groupRank)}`, a hidden `months` input with `ticked.join(",")`, and "Ticked months come to ₱X" from `tickedTotal`. **Cash:** fee select, rate-class select when the fee has classes, quantity, payer. Stub total input. On success: clear serial/months/quantity/stub total, keep booklet, reason and kind, and `router.refresh()`; on failure keep every value and show `formError`.
- `close-form.tsx`: shows the system total of the listed receipts, a cash-handed-over input, reason, required checkbox `confirmLost` labelled "This tablet's data was lost; it will not send this shift's receipts", submit "Close shift". On success show the variance ("Balanced", "Short ₱X — record repayments under Shortages" with a link to `/ledger/shortages`, or "Over ₱X") and `router.refresh()`.

- [ ] **Step 3: Nav**

In `apps/web/lib/nav/modules.ts`, add `{ href: "/ledger/recovery", label: "Recovery" }` after the Exceptions tab. If tabs are shown to every web role, check how `match.ts`/the sidebar hides admin-only screens (search for another admin-only fixed tab, e.g. `super-admin`) and apply the same gating; the page itself redirects non-admins regardless.

- [ ] **Step 4: Verify in the browser**

Run the web app (`pnpm --filter web dev`) against the local stack with an admin user. Walk the full flow on a fixture collector: open a shift for a device with none, recover one lease receipt (tick two months, try ticking the third first — it must be disabled), recover one cash receipt, enter a wrong stub total (refusal shown, values kept), close short by ₱10 and follow the link to Shortages. Also load the page as a supervisor (redirected).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
git add apps/web/app/\(admin\)/ledger/recovery apps/web/components/recovery apps/web/lib/recovery apps/web/lib/nav/modules.ts
git commit -m "feat(web): Recovery screen re-enters receipts lost with a wiped tablet"
```

---

### Task 6: Office-encoded badges and the open-shift warning

**Files:**
- Modify: `apps/web/lib/ledger/queries.ts` (`CollectionRow.officeEncoded`, fetched with `selectByIds` from `collection_recoveries`)
- Modify: `apps/web/components/ledger/collections-table.tsx` (badge next to the serial)
- Modify: `apps/web/lib/ledger/shifts.ts` + `apps/web/components/ledger/shifts-table.tsx` (`officeEncodedCount` per shift; badge "N office-encoded")
- Modify: `apps/web/lib/ledger/shifts.test.ts` if the shifts mapping is unit-tested there
- Modify: `apps/web/app/(admin)/[resource]/page.tsx` and `apps/web/components/devices/device-credential-panel.tsx` (open-shift warning)

**Interfaces:**
- Consumes: `collection_recoveries` (types from Task 4).
- Produces: `DeviceOption` gains `openShiftDate: string | null`.

- [ ] **Step 1: Failing test for the shifts mapping**

Open `apps/web/lib/ledger/shifts.test.ts`, find the function it tests that turns rows into shift rows, and add a case: given two collections on a shift of which one id is in the recovered set, the row reports `officeEncodedCount: 1`. Run `pnpm --filter web exec vitest run lib/ledger/shifts.test.ts`; expect FAIL.

- [ ] **Step 2: Implement the badges**

- `getCollections`: add a fourth `selectByIds(collectionIds, (chunk) => supabase.from("collection_recoveries").select("collection_id").in("collection_id", chunk))` and set `officeEncoded: recovered.has(r.id)`.
- `collections-table.tsx`: after the serial, `{row.officeEncoded ? <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-xs text-ink-2">Office-encoded</span> : null}` — reuse whatever badge/pill component the table already uses for "Cancelled" if there is one.
- `shifts.ts`/`shifts-table.tsx`: count recovered collections per shift the same way; show the badge when > 0.

- Reports (spec §4.2): `grep -rln "or_no" apps/web/lib/reports apps/web/components/reports` to find each report that lists individual receipts, and add the same badge there. Totals do not change.

Run the shifts test; expect PASS.

- [ ] **Step 3: Open-shift warning on the credential panel**

In `[resource]/page.tsx`, where `devices` is built for `DeviceCredentialPanel`, also select open shifts: `supabase.from("shifts").select("device_id, business_date").eq("status", "open")`, and set `openShiftDate` on each `DeviceOption`. In `device-credential-panel.tsx`, when the selected device has `openShiftDate`, render above the Issue button:

```tsx
<Notice tone="warning">
  This tablet has an open shift from {formatDate(selected.openShiftDate)}. If its data was
  lost, recover and close that shift first (Collections → Recovery); otherwise the new
  registration cannot open a shift.
</Notice>
```

(Use the `Notice` props the file already uses; check `components/ui/panel.tsx` for the tone prop name.)

- [ ] **Step 4: Typecheck, lint, test, commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web exec vitest run
git add apps/web
git commit -m "feat(web): mark office-encoded receipts and warn before re-registering a tablet with an open shift"
```

---

### Task 7: D7 amendment, full verification, deployment bundle

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md` (D7 row)

- [ ] **Step 1: Amend D7**

Append to the D7 row's rationale cell exactly:

> **Amended 2026-09-30 (office recovery spec).** One exception: an admin may re-enter a receipt whose tablet copy was destroyed before it synced, through `recover_collection`, only into that collector's still-open shift, with a written reason, validated by `post_collection` exactly as a tablet receipt, marked office-encoded, and reconciled against cash by `office_close_shift`. Everyday posting stays on the tablet.

- [ ] **Step 2: Full verification**

Run: `npx supabase db reset --local && pnpm --filter @ceedo/tests test && pnpm --filter web exec vitest run && pnpm --filter web exec tsc --noEmit && pnpm --filter @ceedo/sync-engine test`
Expected: all pass. Report the real counts.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-18-phase-2-ledger-design.md
git commit -m "docs: amend D7 for office recovery of lost receipts"
```

- [ ] **Step 4: Production bundle (hand to the user, do not run)**

Ask the user for `select max(version) from ceedo_collections.deployed_migrations;` on production, then `node scripts/bundle-migrations.mjs --after <that version>` and give them the output path. The web deploys when `main` is pushed — push only after the user has applied the bundle, or the Recovery page will call functions production does not have yet.
