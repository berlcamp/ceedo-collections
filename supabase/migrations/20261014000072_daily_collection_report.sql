-- Collection reports phase 4 (spec report 1, Daily Collection Report).
--   * report_signatories: the names under "Prepared by" / "Noted by". Seeded WITHOUT
--     names -- real names never enter the repo; an admin types them in.
--   * collections (business_date): every daily report reads one date of receipts.
--   * clear_all_data keeps the signatories: they are configuration, not test data.

create table ceedo_collections.report_signatories (
  id          uuid primary key default gen_random_uuid(),
  report_key  text not null,
  label       text not null,
  name        text,
  title       text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0,
  unique (report_key, label)
);

select ceedo_collections.apply_master_data_policies('report_signatories');
select ceedo_collections.attach_audit('report_signatories');

insert into ceedo_collections.report_signatories (report_key, label, sort_order) values
  ('daily-collection', 'Prepared by', 10),
  ('daily-collection', 'Noted by',    20)
on conflict (report_key, label) do nothing;

create index if not exists collections_business_date_idx
  on ceedo_collections.collections (business_date);

-- ---------------------------------------------------------------------------------------
-- clear_all_data (from 071) now also keeps the signatories.

create or replace function ceedo_collections.clear_all_data()
returns integer
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_tables text;
  v_count  integer;
begin
  if not ceedo_collections.is_super_admin() then
    raise exception 'Only a super administrator may clear the data'
      using errcode = 'insufficient_privilege';
  end if;

  select string_agg(format('ceedo_collections.%I', c.relname), ', '), count(*)
    into v_tables, v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ceedo_collections'
     and c.relkind in ('r', 'p')
     and c.relname not in ('app_users', 'settings', 'super_admins', 'deployed_migrations',
                           'report_signatories');

  if v_tables is not null then
    execute 'truncate ' || v_tables || ' restart identity';
  end if;

  -- The chart and catalogue are configuration, not test data.
  perform ceedo_collections.install_account_catalogue();

  return v_count;
end;
$$;

revoke execute on function ceedo_collections.clear_all_data() from public, anon;
grant execute on function ceedo_collections.clear_all_data() to authenticated;
