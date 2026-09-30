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

describe("office_close_shift", () => {
  // record_variance_settlement refuses a received date in the future relative to
  // business_date() (the real wall clock) and before the shift's own date.
  // BUSINESS_DATE (2026-10-05) is itself in the future relative to that clock, so the one
  // test here that settles a shortage uses a date safely in the past instead.
  const CLOSE_DATE = "2026-09-20";
  const SETTLE_RECEIVED_AT = "2026-09-25";

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
    await db.query(`select ceedo_collections.run_accrual($1::date)`, [CLOSE_DATE]);
    const { data: shiftId } = await recoveryShift(admin, fx, CLOSE_DATE);
    const rate = Number(fx.perHeadRate);
    const cashReceipt = (or_no: number, quantity: number) => ({
      or_no, booklet_id: fx.bookletId, collected_at: `${CLOSE_DATE}T02:00:00+00:00`,
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
    // Cancel through the real RPC so standing_cancellations sees it. cancel_collection
    // (migration 0023) allows a supervisor or an administrator; admin is used here since
    // this whole describe block is otherwise admin-only.
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
      p_shift_id: shiftId, p_amount: 10, p_reference: "OR-123", p_received_at: SETTLE_RECEIVED_AT,
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
