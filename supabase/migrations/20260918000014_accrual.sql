-- The business date, in Manila, always.
--
-- The server runs in UTC. For eight hours of every day the UTC date and the Manila date
-- differ, and a job scheduled at 18:00 UTC runs on the NEXT UTC day. Deriving the
-- business date from current_date would then skip a day's charges roughly a third of the
-- time, and the symptom -- randomly missing charges -- looks nothing like a timezone bug.
create or replace function ceedo_collections.business_date()
returns date
language sql
stable
set search_path = ceedo_collections, pg_temp
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

revoke execute on function ceedo_collections.business_date() from public;
grant execute on function ceedo_collections.business_date() to authenticated, service_role;

-- The SQL twin of packages/shared generatePeriods(). Task 15's parity test runs both
-- against the same fixtures and fails if they ever disagree.
--
-- Only FULLY ELAPSED periods are returned: a week that has not finished is not yet owed.
--
-- Ruling 11: no period may begin before greatest(p_lease_start, p_cutover). Both bounds
-- constrain independently and the max enforces both at once. This guard only bites monthly
-- periods -- the cursor there is floored to the 1st of the month regardless of where in the
-- month v_start actually falls, so v_cursor (== period_start) can land before v_start.
-- Daily and weekly periods start exactly on v_start itself, so this branch never fires for
-- them. Concretely: a monthly lease starting 2026-09-15 with a cutover of 2026-10-20 must
-- produce November as its first period, not a 1-31 October charge that both precedes the
-- cutover and overlaps the opening balance.
create or replace function ceedo_collections.lease_periods(
  p_accrual_period ceedo_collections.accrual_period,
  p_lease_start    date,
  p_lease_end      date,
  p_cutover        date,
  p_through        date,
  p_due_day        smallint
)
returns table (period_start date, period_end date, due_date date)
language plpgsql
immutable
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_start  date := greatest(p_lease_start, p_cutover);
  v_cursor date;
  v_end    date;
  v_due    date;
begin
  if p_accrual_period = 'monthly' and p_due_day is null then
    raise exception 'A monthly lease needs a due day';
  end if;

  v_cursor := case p_accrual_period
                when 'monthly' then date_trunc('month', v_start)::date
                else v_start
              end;

  while v_cursor <= p_through loop
    if p_accrual_period = 'daily' then
      v_end := v_cursor;
      v_due := v_cursor;
    elsif p_accrual_period = 'weekly' then
      v_end := v_cursor + 6;
      v_due := v_end;
    else
      v_end := (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date;
      -- No clamping: leases.due_day is constrained to 1..28, so this date always exists.
      v_due := date_trunc('month', v_cursor)::date + (p_due_day - 1);
    end if;

    -- Skip a monthly period whose start falls before the cutover/lease-start floor (see
    -- the function comment). v_cursor is advanced first so this loop always terminates.
    if v_cursor < v_start then
      v_cursor := case p_accrual_period
                    when 'monthly' then (date_trunc('month', v_cursor) + interval '1 month')::date
                    else v_end + 1
                  end;
      continue;
    end if;

    exit when v_end > p_through;
    exit when p_lease_end is not null and v_end > p_lease_end;

    period_start := v_cursor;
    period_end   := v_end;
    due_date     := v_due;
    return next;

    v_cursor := case p_accrual_period
                  when 'monthly' then (date_trunc('month', v_cursor) + interval '1 month')::date
                  else v_end + 1
                end;
  end loop;
end;
$$;

revoke execute on function ceedo_collections.lease_periods(
  ceedo_collections.accrual_period, date, date, date, date, smallint) from public;
grant execute on function ceedo_collections.lease_periods(
  ceedo_collections.accrual_period, date, date, date, date, smallint) to service_role;

-- Walks active leases and raises rental charges for every elapsed period from the cutover
-- date through p_business_date.
--
-- IDEMPOTENT BY INDEX. This function does not ask whether a period has already been
-- charged; it inserts every period it computes and lets charges_one_rental_per_period
-- refuse the duplicates. That is deliberate: a check-then-insert has a race between the
-- check and the insert, and this job will be re-run concurrently with a manual catch-up
-- after an outage. The index cannot race with itself.
create or replace function ceedo_collections.run_accrual(p_business_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_run_id   uuid;
  v_date     date;
  v_cutover  date;
  v_fee_type uuid;
  v_raised   integer := 0;
  v_lease    record;
  v_period   record;
begin
  v_date := coalesce(p_business_date, ceedo_collections.business_date());

  insert into ceedo_collections.accrual_runs (business_date, status)
  values (v_date, 'running')
  returning id into v_run_id;

  begin
    v_cutover := ceedo_collections.cutover_date();

    for v_lease in
      select l.id, l.start_date, l.end_date, l.accrual_period, l.due_day, l.rate_amount
      from ceedo_collections.leases l
      where l.status = 'active'
        and l.rate_amount > 0
        and (l.end_date is null or l.end_date >= v_cutover)
        and l.start_date <= v_date
    loop
      -- Resolved per lease, not hoisted above the loop: different leases in the same run
      -- can have different accrual periods, and each maps to its own MKT_* fee type
      -- (rental_fee_type(), added in migration 0013).
      v_fee_type := ceedo_collections.rental_fee_type(v_lease.accrual_period);

      for v_period in
        select * from ceedo_collections.lease_periods(
          v_lease.accrual_period, v_lease.start_date, v_lease.end_date,
          v_cutover, v_date, v_lease.due_day)
      loop
        insert into ceedo_collections.charges (
          lease_id, fee_type_id, charge_type, period_start, period_end, due_date,
          amount, surcharge_bps, source
        )
        values (
          v_lease.id, v_fee_type, 'rental',
          v_period.period_start, v_period.period_end, v_period.due_date,
          v_lease.rate_amount, 0, 'accrual'
        )
        on conflict do nothing;

        if found then
          v_raised := v_raised + 1;
        end if;
      end loop;
    end loop;

    update ceedo_collections.accrual_runs
       set finished_at = now(), status = 'succeeded', charges_raised = v_raised
     where id = v_run_id;

    return v_run_id;
  exception
    when others then
      -- Catch, log, RETURN. Do not re-raise.
      --
      -- This is the one place the obvious code is wrong. Re-raising propagates out of the
      -- function, and because the whole call is a single transaction, the rollback takes
      -- the accrual_runs row with it -- including the failure this handler just recorded.
      -- A failed night would then leave no row at all, which reads identically to a night
      -- that was never scheduled.
      --
      -- Returning normally commits the 'failed' row, so the failure is durable and
      -- visible. The raise warning puts it in the Postgres log as well, for whoever is
      -- tailing it. Task 14's monitoring query treats both a 'failed' row and a MISSING
      -- row for a business date as an alert, which is what makes this safe.
      update ceedo_collections.accrual_runs
         set finished_at = now(), status = 'failed', error = sqlerrm, charges_raised = v_raised
       where id = v_run_id;
      raise warning 'run_accrual failed for %: %', v_date, sqlerrm;
      return v_run_id;
  end;
end;
$$;

revoke execute on function ceedo_collections.run_accrual(date) from public;
grant execute on function ceedo_collections.run_accrual(date) to service_role;
