import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { receiptHistory } from "./history";
import type { SqliteDriver } from "./driver";

const SCHEMA = `
  create table outbox (
    id text primary key, type text not null, payload text not null,
    collector_id text not null, created_at text not null,
    state text not null default 'pending', attempts integer not null default 0,
    reason_code text, retryable integer, last_result text, seq integer not null
  );
  create table local_shifts (
    id text primary key, collector_id text not null, business_date text not null,
    opened_at text not null, status text not null default 'open', closed_at text,
    declared_total text, device_count integer, device_total text
  );
  create table local_collections (
    id text primary key, or_no integer not null, booklet_id text not null,
    collector_id text not null, shift_id text not null, collected_at text not null,
    fee_type_id text not null, lease_id text, gross_amount text not null,
    payer_ref text, notes text, created_at text not null
  );
  create table local_lines (
    id text primary key, collection_id text not null, fee_type_id text not null,
    rate_class text, quantity integer not null, unit_rate text not null, amount text not null
  );
  create table collections (
    id text primary key, or_no integer, booklet_id text, collector_id text, device_id text,
    collected_at text, business_date text, fee_type_id text, lease_id text, payer_ref text,
    gross_amount text, notes text, shift_id text, synced_at text, posted_at text,
    posted_by text, row_version integer
  );
  create table collection_cancellations (
    id text primary key, collection_id text, cancelled_by text, cancelled_at text,
    reason text, row_version integer
  );
  create table collection_reinstatements (
    id text primary key, cancellation_id text, reason text, reinstated_by text,
    reinstated_at text, row_version integer
  );
  create table booklets (id text primary key, serial_prefix text);
  create table fee_types (id text primary key, name text);
  create table leases (id text primary key, stall_id text, tenant_id text);
  create table stalls (id text primary key, stall_no text);
  create table tenants (id text primary key, full_name text);

  insert into booklets values ('bk', 'A');
  insert into fee_types values ('rent', 'Stall rental'), ('hog', 'Slaughter fee');
  insert into stalls values ('st', 'B-12');
  insert into tenants values ('tn', 'Maria Santos');
  insert into leases values ('ls', 'st', 'tn');
  insert into local_shifts (id, collector_id, business_date, opened_at)
    values ('sh1', 'me', '2026-10-02', '2026-10-02T00:00:00.000Z');
`;

let db: Database.Database;
let driver: SqliteDriver;
let seq = 0;

function server(id: string, o: Partial<Record<string, string | number | null>> = {}) {
  db.prepare(
    `insert into collections (id, or_no, booklet_id, collector_id, collected_at, business_date,
       fee_type_id, lease_id, gross_amount)
     values (@id, @or_no, 'bk', @collector_id, @collected_at, @business_date, @fee_type_id,
       @lease_id, @gross_amount)`,
  ).run({
    id,
    or_no: 1001,
    collector_id: "me",
    collected_at: "2026-10-01T02:00:00+00:00",
    business_date: "2026-10-01",
    fee_type_id: "rent",
    lease_id: "ls",
    gross_amount: "100.00",
    ...o,
  });
}

function device(id: string, o: Partial<Record<string, string | number | null>> = {}, outbox?: string) {
  db.prepare(
    `insert into local_collections (id, or_no, booklet_id, collector_id, shift_id, collected_at,
       fee_type_id, lease_id, gross_amount, created_at)
     values (@id, @or_no, 'bk', @collector_id, 'sh1', @collected_at, @fee_type_id, @lease_id,
       @gross_amount, @collected_at)`,
  ).run({
    id,
    or_no: 1002,
    collector_id: "me",
    collected_at: "2026-10-02T03:00:00.000Z",
    fee_type_id: "hog",
    lease_id: null,
    gross_amount: "50.00",
    ...o,
  });
  if (outbox) {
    db.prepare(
      `insert into outbox (id, type, payload, collector_id, created_at, state, reason_code, seq)
       values (?, 'collection', '{}', 'me', '2026-10-02', ?, ?, ?)`,
    ).run(id, outbox, outbox === "rejected" ? "or_spent" : null, ++seq);
  }
}

const all = async () => (await receiptHistory(driver, "me")).days.flatMap((d) => d.rows);

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  driver = betterSqliteDriver(db);
});

describe("receiptHistory", () => {
  it("shows a server receipt as synced with its stall and tenant", async () => {
    server("s1");
    expect(await all()).toMatchObject([
      { id: "s1", status: "synced", stallNo: "B-12", tenantName: "Maria Santos", serialPrefix: "A" },
    ]);
  });

  it("shows a device-only on-the-spot receipt with its fee and quantity", async () => {
    device("d1", {}, "pending");
    db.prepare(
      `insert into local_lines values ('l1', 'd1', 'hog', 'hog', 3, '16.67', '50.00')`,
    ).run();
    expect(await all()).toMatchObject([
      { id: "d1", status: "waiting", feeTypeName: "Slaughter fee", quantity: 3, businessDate: "2026-10-02" },
    ]);
  });

  it("in-flight is waiting, rejected is refused with its reason, purged is synced", async () => {
    device("a", { collected_at: "2026-10-02T01:00:00.000Z" }, "in_flight");
    device("b", { collected_at: "2026-10-02T02:00:00.000Z" }, "rejected");
    device("c", { collected_at: "2026-10-02T03:00:00.000Z" });
    const rows = await all();
    expect(rows.map((r) => [r.id, r.status])).toEqual([["c", "synced"], ["b", "refused"], ["a", "waiting"]]);
    expect(rows.find((r) => r.id === "b")?.detail).toBe("or_spent");
  });

  it("a synced receipt appears once, with the server's status", async () => {
    device("x", {}, "acked");
    server("x", { business_date: "2026-10-02", collected_at: "2026-10-02T03:00:00+00:00" });
    db.prepare(`insert into collection_cancellations (id, collection_id) values ('cc', 'x')`).run();
    expect((await all()).map((r) => [r.id, r.status])).toEqual([["x", "cancelled"]]);
  });

  it("excludes cancelled receipts from the day total; reinstated counts", async () => {
    server("k", { gross_amount: "100.00" });
    server("c", { gross_amount: "40.00", or_no: 1003 });
    server("r", { gross_amount: "10.00", or_no: 1004 });
    db.prepare(`insert into collection_cancellations (id, collection_id) values ('c1', 'c'), ('c2', 'r')`).run();
    db.prepare(`insert into collection_reinstatements (id, cancellation_id) values ('r1', 'c2')`).run();
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]).toMatchObject({ businessDate: "2026-10-01", count: 2, total: "110.00" });
    expect(days[0]!.rows.find((r) => r.id === "r")?.status).toBe("synced");
  });

  it("never shows another collector's receipts", async () => {
    server("theirs", { collector_id: "them" });
    device("theirs-d", { collector_id: "them" }, "pending");
    expect(await all()).toEqual([]);
  });

  it("server receipt with null business_date falls back to collected_at date", async () => {
    db.prepare(
      `insert into collections (id, or_no, booklet_id, collector_id, collected_at, business_date,
         fee_type_id, lease_id, gross_amount)
       values (?, ?, 'bk', 'me', '2026-10-02T02:00:00+00:00', null, 'rent', 'ls', '100.00')`,
    ).run("s_null_bd", 1001);
    expect(await all()).toMatchObject([
      { id: "s_null_bd", status: "synced", businessDate: "2026-10-02" },
    ]);
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]!.total).toBe("100.00");
  });

  it("orders mixed timestamp formats newest first, using UTC normalisation", async () => {
    server("utc_z_form", { business_date: "2026-10-02", collected_at: "2026-10-02T03:00:00.000Z", or_no: 1005 });
    server("offset_form", { business_date: "2026-10-02", collected_at: "2026-10-02T10:59:59+08:00", or_no: 1006 });
    const rows = await all();
    expect(rows.map((r) => r.id)).toEqual(["utc_z_form", "offset_form"]);
  });

  it("tolerates odd amounts", async () => {
    server("a", { gross_amount: "1250" });
    server("b", { gross_amount: "0.5", or_no: 1003 });
    server("c", { gross_amount: null, or_no: 1004 });
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]!.total).toBe("1250.50");
  });

  it("unparseable amounts contribute 0 to total without throwing", async () => {
    server("valid", { gross_amount: "100.00" });
    server("invalid", { gross_amount: "abc", or_no: 1003 });
    const { days } = await receiptHistory(driver, "me");
    expect(days[0]!.total).toBe("100.00");
    expect(days[0]!.count).toBe(2);
    expect(days[0]!.rows.find((r) => r.id === "invalid")?.grossAmount).toBe("abc");
  });

  it("pages by whole business days", async () => {
    for (let d = 1; d <= 5; d++) {
      const date = `2026-09-0${d}`;
      server(`s${d}a`, { business_date: date, collected_at: `${date}T01:00:00+00:00`, or_no: 1100 + d });
      server(`s${d}b`, { business_date: date, collected_at: `${date}T02:00:00+00:00`, or_no: 1200 + d });
    }
    const first = await receiptHistory(driver, "me", { days: 2 });
    expect(first.days.map((d) => d.businessDate)).toEqual(["2026-09-05", "2026-09-04"]);
    expect(first.nextBeforeDate).toBe("2026-09-04");
    const second = await receiptHistory(driver, "me", { days: 2, beforeDate: first.nextBeforeDate! });
    expect(second.days.map((d) => d.businessDate)).toEqual(["2026-09-03", "2026-09-02"]);
    const last = await receiptHistory(driver, "me", { days: 2, beforeDate: second.nextBeforeDate! });
    expect(last.days.map((d) => d.businessDate)).toEqual(["2026-09-01"]);
    expect(last.nextBeforeDate).toBeNull();
    expect([...first.days, ...second.days, ...last.days].flatMap((d) => d.rows)).toHaveLength(10);
  });
});
