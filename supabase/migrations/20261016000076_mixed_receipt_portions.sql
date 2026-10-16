-- supabase/migrations/20261016000076_mixed_receipt_portions.sql
-- receipt_account_lines (from 070): a receipt may carry BOTH allocations and lines
-- (post_collection accepts it; the balance trigger checks allocations + lines = gross).
-- 070 classified a receipt with lines only through its lines, so the allocated part of a
-- mixed receipt reached no account. Now:
--   * every line is a base portion, matched on its fee type and rate class (unchanged);
--   * every LEASE receipt also gives a surcharge portion (its surcharge allocations) and a
--     base portion = gross - lines - surcharge (rent, opening balance, advance). For a
--     receipt with no lines that is 070's figure; for an occupancy fee (lease + line, no
--     allocations) it is 0 and, like every zero row, is not emitted;
--   * a live cash ticket: one base portion (unchanged).
-- So the portions of every receipt sum to its gross.

create or replace function ceedo_collections.receipt_account_lines(p_from date, p_to date)
returns table (
  source         text,
  collection_id  uuid,
  cash_ticket_id uuid,
  line_id        uuid,
  or_no          integer,
  booklet_id     uuid,
  shift_id       uuid,
  business_date  date,
  collector_id   uuid,
  lease_id       uuid,
  payer_ref      text,
  fee_type_id    uuid,
  facility_id    uuid,
  section_id     uuid,
  rate_class     text,
  quantity       integer,
  portion        text,
  account_id     uuid,
  payment_mode   text,
  amount         numeric(14,2),
  cancelled      boolean
)
language sql
stable
security invoker
set search_path = ceedo_collections, pg_temp
as $$
  with recv as (
    select c.id, c.or_no, c.booklet_id, c.shift_id, c.business_date, c.collector_id, c.lease_id,
           c.payer_ref, c.fee_type_id, c.payment_mode, c.gross_amount,
           s.facility_id as lease_facility_id, st.section_id as lease_section_id,
           exists (select 1 from ceedo_collections.standing_cancellations x
                    where x.collection_id = c.id) as cancelled,
           exists (select 1 from ceedo_collections.collection_lines li
                    where li.collection_id = c.id) as has_lines,
           coalesce((select sum(li.amount) from ceedo_collections.collection_lines li
                        where li.collection_id = c.id), 0) as lines_total
      from ceedo_collections.collections c
      left join ceedo_collections.leases   l  on l.id = c.lease_id
      left join ceedo_collections.stalls   st on st.id = l.stall_id
      left join ceedo_collections.sections s  on s.id = st.section_id
     where c.business_date between p_from and p_to
  ),
  portions as (
    select 'receipt'::text as source, r.id as collection_id, null::uuid as cash_ticket_id,
           null::uuid as line_id, r.or_no, r.booklet_id, r.shift_id, r.business_date,
           r.collector_id, r.lease_id, r.payer_ref, r.fee_type_id,
           r.lease_facility_id as facility_id, r.lease_section_id as section_id,
           null::text as rate_class, null::integer as quantity, p.portion, r.payment_mode,
           p.amount::numeric(14,2) as amount, r.cancelled
      from recv r
      cross join lateral (
        select coalesce(sum(a.amount), 0) as sur
          from ceedo_collections.collection_allocations a
          join ceedo_collections.charges ch on ch.id = a.charge_id
         where a.collection_id = r.id and ch.charge_type = 'surcharge'
      ) s
      cross join lateral (values ('surcharge', s.sur), ('base', r.gross_amount - r.lines_total - s.sur)) as p(portion, amount)
     where r.lease_id is not null and p.amount <> 0

    union all
    select 'receipt', r.id, null, li.id, r.or_no, r.booklet_id, r.shift_id, r.business_date,
           r.collector_id, r.lease_id, r.payer_ref, li.fee_type_id,
           coalesce(r.lease_facility_id, ft.facility_id), r.lease_section_id,
           li.rate_class, li.quantity, 'base', r.payment_mode, li.amount, r.cancelled
      from recv r
      join ceedo_collections.collection_lines li on li.collection_id = r.id
      join ceedo_collections.fee_types ft on ft.id = li.fee_type_id

    union all
    select 'cash_ticket', null, t.id, null, null, null, t.shift_id, t.business_date,
           t.collector_id, null, null, t.fee_type_id, ft.facility_id, null,
           null, null, 'base', 'cash', t.amount, false
      from ceedo_collections.cash_ticket_sales t
      join ceedo_collections.fee_types ft on ft.id = t.fee_type_id
     where t.business_date between p_from and p_to and t.cancelled_at is null
  ),
  numbered as (
    select row_number() over () as pk, p.* from portions p
  ),
  chosen as (
    select n.pk, (
      select r.id
        from ceedo_collections.account_rules r
       where r.fee_type_id = n.fee_type_id
         and r.portion = n.portion
         and (r.facility_id is null or r.facility_id = n.facility_id)
         and (r.section_id is null or r.section_id = n.section_id)
         and (r.rate_class is null or r.rate_class = n.rate_class)
         and n.business_date >= r.effective_from
         and (r.effective_to is null or n.business_date <= r.effective_to)
       order by (r.section_id is not null) desc, (r.facility_id is not null) desc,
                (r.rate_class is not null) desc
       limit 1
    ) as rule_id
    from numbered n
  ),
  -- Largest remainder, in centavos: each share is floored to the centavo, then the
  -- centavos left over go one each to the shares with the largest fractional remainder
  -- (ties: the larger share, then the account code). The rows sum exactly to the portion
  -- and none moves more than one centavo from its exact share, so none goes negative.
  split as (
    select n.*, sh.account_id,
           floor(n.amount * 100 * sh.share_bps / 10000) as cents,
           n.amount * 100 * sh.share_bps / 10000 - floor(n.amount * 100 * sh.share_bps / 10000) as frac,
           sh.share_bps, a.code as account_code
      from numbered n
      join chosen c on c.pk = n.pk
      join ceedo_collections.account_rule_shares sh on sh.rule_id = c.rule_id
      join ceedo_collections.collection_accounts a on a.id = sh.account_id
  ),
  ranked as (
    select s.*,
           row_number() over (partition by s.pk order by s.frac desc, s.share_bps desc, s.account_code) as rk,
           round(s.amount * 100) - sum(s.cents) over (partition by s.pk) as leftover
      from split s
  ),
  placed as (
    select s.source, s.collection_id, s.cash_ticket_id, s.line_id, s.or_no, s.booklet_id,
           s.shift_id, s.business_date, s.collector_id, s.lease_id, s.payer_ref, s.fee_type_id,
           s.facility_id, s.section_id, s.rate_class, s.quantity, s.portion, s.account_id,
           s.payment_mode,
           ((s.cents + case when s.rk <= s.leftover then 1 else 0 end) / 100)::numeric(14,2) as amount,
           s.cancelled
      from ranked s
    union all
    select n.source, n.collection_id, n.cash_ticket_id, n.line_id, n.or_no, n.booklet_id,
           n.shift_id, n.business_date, n.collector_id, n.lease_id, n.payer_ref, n.fee_type_id,
           n.facility_id, n.section_id, n.rate_class, n.quantity, n.portion,
           (select id from ceedo_collections.collection_accounts where code = 'UNCLASSIFIED'),
           n.payment_mode, n.amount, n.cancelled
      from numbered n
      join chosen c on c.pk = n.pk
     where c.rule_id is null
  )
  select * from placed where amount <> 0;
$$;

revoke execute on function ceedo_collections.receipt_account_lines(date, date) from public;
grant execute on function ceedo_collections.receipt_account_lines(date, date) to authenticated;
