import { fromCentavos, parsePesoInput, toDecimalString, type Centavos } from "@ceedo/shared";
import type { SqliteDriver } from "./driver";

export type HistoryStatus = "waiting" | "synced" | "refused" | "cancelled";

export interface HistoryRow {
  id: string;
  orNo: number | null;
  serialPrefix: string | null;
  collectedAt: string | null;
  businessDate: string;
  grossAmount: string | null;
  status: HistoryStatus;
  detail: string | null;
  stallNo: string | null;
  tenantName: string | null;
  feeTypeName: string | null;
  quantity: number | null;
}

export interface HistoryDay {
  businessDate: string;
  count: number;
  total: string;
  rows: HistoryRow[];
}

/**
 * Every receipt the signed-in collector has: the server's (mirrored `collections`, which
 * sync_pull fills with each collector's own receipts since migration 0061) and this
 * tablet's that the server has not sent back yet.
 *
 * THE SERVER'S ROW WINS. A receipt in both tables is shown once, from `collections`,
 * because only the server knows it was cancelled. A device row with no outbox entry was
 * acked and purged (purgeAcked), so it is synced, and its server copy arrives next pull.
 *
 * PAGED BY WHOLE BUSINESS DAYS, so a day's total is never cut across two pages.
 *
 * `at` normalises timestamps to UTC through strftime: the device writes `...000Z` and
 * Postgres sends `...+00:00`, and comparing those as strings misorders the same second.
 */
const HISTORY = `
  with h as (
    select c.id, c.or_no, c.booklet_id, c.collected_at,
           coalesce(c.business_date, substr(c.collected_at, 1, 10)) as business_date, c.gross_amount,
           c.lease_id, c.fee_type_id,
           case when exists (
                  select 1 from collection_cancellations cc
                   where cc.collection_id = c.id
                     and not exists (select 1 from collection_reinstatements r
                                      where r.cancellation_id = cc.id))
                then 'cancelled' else 'synced' end as status,
           null as detail
      from collections c
     where c.collector_id = ?
    union all
    select lc.id, lc.or_no, lc.booklet_id, lc.collected_at,
           coalesce(ls.business_date, substr(lc.collected_at, 1, 10)) as business_date, lc.gross_amount,
           lc.lease_id, lc.fee_type_id,
           case o.state when 'pending' then 'waiting' when 'in_flight' then 'waiting'
                        when 'rejected' then 'refused' else 'synced' end,
           case when o.state = 'rejected' then coalesce(o.reason_code, o.last_result) end
      from local_collections lc
      left join local_shifts ls on ls.id = lc.shift_id
      left join outbox o on o.id = lc.id
     where lc.collector_id = ?
       and not exists (select 1 from collections c where c.id = lc.id)
  )
  select h.id, h.or_no, b.serial_prefix, h.collected_at, h.business_date, h.gross_amount,
         h.status, h.detail, st.stall_no, t.full_name as tenant_name, ft.name as fee_type_name,
         (select sum(quantity) from local_lines ll where ll.collection_id = h.id) as quantity,
         strftime('%Y-%m-%dT%H:%M:%f', h.collected_at) as at
    from h
    left join booklets b on b.id = h.booklet_id
    left join leases l on l.id = h.lease_id
    left join stalls st on st.id = l.stall_id
    left join tenants t on t.id = l.tenant_id
    left join fee_types ft on ft.id = h.fee_type_id
`;

interface Raw {
  id: string;
  or_no: number | null;
  serial_prefix: string | null;
  collected_at: string | null;
  business_date: string;
  gross_amount: string | number | null;
  status: HistoryStatus;
  detail: string | null;
  stall_no: string | null;
  tenant_name: string | null;
  fee_type_name: string | null;
  quantity: number | null;
}

function centavos(amount: string | number | null): Centavos {
  if (amount === null || amount === undefined || String(amount).trim() === "") return fromCentavos(0);
  try {
    return parsePesoInput(String(amount));
  } catch {
    return fromCentavos(0);
  }
}

export async function receiptHistory(
  driver: SqliteDriver,
  collectorId: string,
  opts: { beforeDate?: string; days?: number } = {},
): Promise<{ days: HistoryDay[]; nextBeforeDate: string | null }> {
  const days = opts.days ?? 14;
  const before = opts.beforeDate ?? "9999-12-31";

  const dates = await driver.select<{ business_date: string }>(
    `select distinct business_date from (${HISTORY}) where business_date < ?
      order by business_date desc limit ?`,
    [collectorId, collectorId, before, days + 1],
  );
  const page = dates.slice(0, days).map((d) => d.business_date);
  if (page.length === 0) return { days: [], nextBeforeDate: null };

  const rows = await driver.select<Raw>(
    `select * from (${HISTORY})
      where business_date in (${page.map(() => "?").join(", ")})
      order by business_date desc, at desc, id desc`,
    [collectorId, collectorId, ...page],
  );

  const byDate = new Map<string, HistoryDay>(
    page.map((date) => [date, { businessDate: date, count: 0, total: "0.00", rows: [] }]),
  );
  const totals = new Map<string, Centavos>();
  for (const raw of rows) {
    const date = raw.business_date;
    const day = byDate.get(date);
    if (!day) continue;
    day.rows.push({
      id: raw.id,
      orNo: raw.or_no,
      serialPrefix: raw.serial_prefix,
      collectedAt: raw.collected_at,
      businessDate: date,
      grossAmount: raw.gross_amount === null ? null : String(raw.gross_amount),
      status: raw.status,
      detail: raw.detail,
      stallNo: raw.stall_no,
      tenantName: raw.tenant_name,
      feeTypeName: raw.fee_type_name,
      quantity: raw.quantity,
    });
    if (raw.status !== "cancelled") {
      day.count += 1;
      totals.set(date, fromCentavos((totals.get(date) ?? 0) + centavos(raw.gross_amount)));
    }
  }
  for (const [date, total] of totals) byDate.get(date)!.total = toDecimalString(total);

  return {
    days: page.map((date) => byDate.get(date)!),
    nextBeforeDate: dates.length > days ? page[page.length - 1]! : null,
  };
}
