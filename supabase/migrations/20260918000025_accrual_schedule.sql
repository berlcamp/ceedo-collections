-- Fails loudly if pg_cron is not available, rather than skipping the schedule.
--
-- A silently unscheduled accrual is invisible: no error, no log line, no missing table --
-- just charges that quietly never appear, discovered a month later when arrears are
-- wrong. Refusing to apply is far cheaper than that.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise exception
      'pg_cron is not available on this instance. Enable it in the Supabase dashboard '
      '(Database -> Extensions) before applying this migration. The nightly accrual '
      'cannot be scheduled without it, and an unscheduled accrual fails silently.';
  end if;
end;
$$;

create extension if not exists pg_cron;

-- One entry point for the nightly work, so the cron entry stays a single call and the
-- ordering (accrual, then surcharge on what it raised) lives in SQL rather than in a
-- schedule string.
create or replace function ceedo_collections.run_nightly()
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_run_id uuid;
  v_date   date;
begin
  v_date := ceedo_collections.business_date();
  v_run_id := ceedo_collections.run_accrual(v_date);

  -- Only surcharge if the accrual succeeded. Surcharging against a half-built day would
  -- penalise charges that were never raised.
  if exists (
    select 1 from ceedo_collections.accrual_runs
    where id = v_run_id and status = 'succeeded'
  ) then
    -- CATCH, LOG, RETURN -- for exactly the reason run_accrual's own handler does.
    --
    -- cron invokes run_nightly() as one statement, so the whole night is one transaction.
    -- An unguarded `perform run_surcharge` propagating an exception rolls back not only
    -- the surcharges but the charges run_accrual just raised AND the accrual_runs row
    -- recording them -- leaving no row at all for the business date, which accrual_health
    -- reports as 'missing', indistinguishable from cron never having fired. That is
    -- precisely the failure run_accrual's handler exists to prevent, reintroduced one
    -- level up.
    --
    -- This subtransaction rolls back the surcharge attempt only. The accrual's charges are
    -- already committed work inside this transaction and survive, so the run is recorded
    -- as 'failed' with the real sqlerrm while the night's rentals stand. charges_raised is
    -- left alone rather than zeroed: unlike run_accrual's own handler, whose rollback DOES
    -- discard the charges it counted, this one discards only the surcharge attempt, so the
    -- count already on the row is still true.
    begin
      perform ceedo_collections.run_surcharge(v_date, v_run_id);
    exception
      when others then
        update ceedo_collections.accrual_runs
           set finished_at = now(), status = 'failed', error = sqlerrm
         where id = v_run_id;
        raise warning 'run_surcharge failed for %: %', v_date, sqlerrm;
        return v_run_id;
    end;
  end if;

  return v_run_id;
end;
$$;

revoke execute on function ceedo_collections.run_nightly() from public;
grant execute on function ceedo_collections.run_nightly() to service_role;

-- 18:00 UTC is 02:00 Manila: after the business day has closed, before a 5am market
-- round. pg_cron schedules in UTC, so this is written in UTC deliberately -- the
-- function itself derives the business date in Asia/Manila.
select cron.schedule(
  'ceedo_nightly_accrual',
  '0 18 * * *',
  $cron$select ceedo_collections.run_nightly()$cron$
);

-- The monitoring surface. run_accrual logs a failure and returns rather than raising, so
-- a failed night is a row with status 'failed'; a night that never ran at all is no row,
-- which this view reports as 'missing'. Both are alerts.
create view ceedo_collections.accrual_health
with (security_invoker = true)
as
select
  d::date as business_date,
  coalesce(r.status, 'missing') as status,
  r.charges_raised,
  r.surcharges_raised,
  r.finished_at,
  r.error
from generate_series(
       ceedo_collections.business_date() - 14,
       ceedo_collections.business_date(),
       interval '1 day') d
left join lateral (
  select * from ceedo_collections.accrual_runs a
  where a.business_date = d::date
  order by a.started_at desc limit 1
) r on true
order by d desc;

grant select on ceedo_collections.accrual_health to authenticated;
