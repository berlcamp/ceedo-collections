-- Collection reports phase 3: the account chart and its dated rules (spec "Data model").
-- Every receipt portion is placed on an account by the most specific rule in force on its
-- business date (receipt_account_lines, 070); a portion no rule places goes to UNCLASSIFIED.

create table ceedo_collections.treasurer_lines (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  sort_order     integer not null,
  subtotal_group smallint not null check (subtotal_group in (1, 2)),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  row_version    bigint not null default 0
);

create table ceedo_collections.rcd_columns (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  row_version bigint not null default 0
);

create table ceedo_collections.collection_accounts (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  -- Null for cross-facility groups (Surcharges, Non-Income).
  facility_id       uuid references ceedo_collections.facilities (id),
  group_name        text not null,
  sort_order        integer not null,
  kind              text not null check (kind in ('income', 'non_income')),
  -- Both required: no peso may fall off the Treasurer page or the per-collector matrix.
  treasurer_line_id uuid not null references ceedo_collections.treasurer_lines (id),
  rcd_column_id     uuid not null references ceedo_collections.rcd_columns (id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  row_version       bigint not null default 0
);

create index collection_accounts_facility_idx on ceedo_collections.collection_accounts (facility_id);

select ceedo_collections.apply_master_data_policies('treasurer_lines');
select ceedo_collections.apply_master_data_policies('rcd_columns');
select ceedo_collections.apply_master_data_policies('collection_accounts');
select ceedo_collections.attach_audit('collection_accounts');

-- The built-ins. receipt_account_lines sends every unplaced portion to UNCLASSIFIED, so it
-- must always exist and keep its code.
create or replace function ceedo_collections.assert_builtin_account_kept()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  if old.code = 'UNCLASSIFIED' and (tg_op = 'DELETE' or new.code <> old.code) then
    raise exception 'UNCLASSIFIED is a built-in account; it cannot be deleted or recoded'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger collection_accounts_builtin
  before update or delete on ceedo_collections.collection_accounts
  for each row execute function ceedo_collections.assert_builtin_account_kept();
revoke execute on function ceedo_collections.assert_builtin_account_kept() from public;

-- ---------------------------------------------------------------------------------------
-- Rules. One account_rules row is a RULE SET: a key (fee type, facility, section, rate
-- class, portion) and a date range. Its accounts and shares are account_rule_shares rows.
-- A set is never edited: replace_account_rule ends it and starts the next, so a month
-- already reported is never restated.

create table ceedo_collections.account_rules (
  id             uuid primary key default gen_random_uuid(),
  fee_type_id    uuid not null references ceedo_collections.fee_types (id),
  facility_id    uuid references ceedo_collections.facilities (id),
  section_id     uuid,
  -- Null: any rate class. Never '' -- that would be a second spelling of "any".
  rate_class     text check (rate_class is null or length(rate_class) > 0),
  portion        text not null check (portion in ('base', 'surcharge')),
  effective_from date not null,
  effective_to   date,
  created_by     uuid references ceedo_collections.app_users (id),
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  -- A section names its facility; the composite key from migration 0007 checks they agree.
  check (section_id is null or facility_id is not null),
  constraint account_rules_section_in_facility
    foreign key (section_id, facility_id)
    references ceedo_collections.sections (id, facility_id),
  constraint account_rules_no_overlap exclude using gist (
    fee_type_id with =,
    (coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(rate_class, '')) with =,
    portion with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index account_rules_fee_type_idx on ceedo_collections.account_rules (fee_type_id, portion);

create table ceedo_collections.account_rule_shares (
  id         uuid primary key default gen_random_uuid(),
  rule_id    uuid not null references ceedo_collections.account_rules (id),
  account_id uuid not null references ceedo_collections.collection_accounts (id),
  share_bps  integer not null check (share_bps between 1 and 10000),
  unique (rule_id, account_id)
);

-- Checked at commit: a set and its shares are inserted in one transaction, so a per-
-- statement check would see the set with no shares yet.
create or replace function ceedo_collections.assert_rule_shares_whole()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_rule  uuid;
  v_total integer;
begin
  -- IF, not CASE: PL/pgSQL resolves record fields in any expression it plans, and
  -- account_rules rows have no rule_id; an untaken IF branch is never planned.
  if tg_table_name = 'account_rules' then
    v_rule := new.id;
  else
    v_rule := new.rule_id;
  end if;
  if not exists (select 1 from ceedo_collections.account_rules where id = v_rule) then
    return null;
  end if;
  select coalesce(sum(share_bps), 0) into v_total
    from ceedo_collections.account_rule_shares where rule_id = v_rule;
  if v_total <> 10000 then
    -- The percent sign travels in the argument: in RAISE, "%%" is a literal and "%" a
    -- placeholder, so a literal sign after a placeholder cannot be written in the format.
    raise exception 'The shares of a rule must add up to 100%% (this one adds up to %)',
      to_char(v_total / 100.0, 'FM990.00') || '%'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger account_rules_shares_whole
  after insert on ceedo_collections.account_rules
  deferrable initially deferred
  for each row execute function ceedo_collections.assert_rule_shares_whole();

create constraint trigger account_rule_shares_whole
  after insert on ceedo_collections.account_rule_shares
  deferrable initially deferred
  for each row execute function ceedo_collections.assert_rule_shares_whole();

revoke execute on function ceedo_collections.assert_rule_shares_whole() from public;

select ceedo_collections.attach_audit('account_rules');
select ceedo_collections.attach_audit('account_rule_shares');

alter table ceedo_collections.account_rules enable row level security;
alter table ceedo_collections.account_rule_shares enable row level security;
create policy account_rules_read on ceedo_collections.account_rules
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
create policy account_rule_shares_read on ceedo_collections.account_rule_shares
  for select to authenticated using (ceedo_collections.has_role('supervisor', 'accounting', 'admin'));
revoke insert, update, delete on ceedo_collections.account_rules from anon, authenticated, service_role;
revoke insert, update, delete on ceedo_collections.account_rule_shares from anon, authenticated, service_role;
grant select on ceedo_collections.account_rules, ceedo_collections.account_rule_shares to authenticated, service_role;

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.install_chart_builtins()
returns void
language sql
security definer
set search_path = ceedo_collections, pg_temp
as $$
  insert into ceedo_collections.treasurer_lines (code, name, sort_order, subtotal_group)
  values ('TL_OTHER', 'Other collections', 110, 1)
  on conflict (code) do nothing;

  insert into ceedo_collections.rcd_columns (code, name, sort_order)
  values ('RC_OTHER', 'Other collections', 120)
  on conflict (code) do nothing;

  insert into ceedo_collections.collection_accounts
    (code, name, group_name, sort_order, kind, treasurer_line_id, rcd_column_id)
  select 'UNCLASSIFIED', 'Unclassified', 'Unclassified', 99999, 'income', t.id, r.id
    from ceedo_collections.treasurer_lines t, ceedo_collections.rcd_columns r
   where t.code = 'TL_OTHER' and r.code = 'RC_OTHER'
  on conflict (code) do nothing;
$$;

revoke execute on function ceedo_collections.install_chart_builtins() from public;
select ceedo_collections.install_chart_builtins();

-- ---------------------------------------------------------------------------------------

create or replace function ceedo_collections.replace_account_rule(
  p_fee_type_id    uuid,
  p_facility_id    uuid,
  p_section_id     uuid,
  p_rate_class     text,
  p_portion        text,
  p_effective_from date,
  p_shares         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  v_facility uuid := p_facility_id;
  v_class    text := nullif(trim(coalesce(p_rate_class, '')), '');
  v_current  ceedo_collections.account_rules;
  v_id       uuid;
  v_total    integer;
begin
  if not ceedo_collections.is_admin() then
    raise exception 'Only an administrator may change the account rules'
      using errcode = 'insufficient_privilege';
  end if;
  if p_fee_type_id is null or p_effective_from is null then
    raise exception 'Choose the fee and the date the rule starts';
  end if;
  if p_portion not in ('base', 'surcharge') then
    raise exception 'The portion must be base or surcharge';
  end if;
  if p_section_id is not null then
    select facility_id into v_facility from ceedo_collections.sections where id = p_section_id;
  end if;

  -- One writer at a time: two admins replacing the same key must queue, not both end it.
  perform pg_advisory_xact_lock(hashtext('ceedo_collections.account_rules'));

  if exists (
    select 1 from ceedo_collections.account_rules r
     where r.fee_type_id = p_fee_type_id and r.portion = p_portion
       and r.facility_id is not distinct from v_facility
       and r.section_id is not distinct from p_section_id
       and r.rate_class is not distinct from v_class
       and r.effective_from >= p_effective_from
  ) then
    raise exception 'A rule for this fee already starts on or after %. Rules are never rewritten; choose a later start date',
      to_char(p_effective_from, 'Mon DD, YYYY');
  end if;

  select * into v_current from ceedo_collections.account_rules r
   where r.fee_type_id = p_fee_type_id and r.portion = p_portion
     and r.facility_id is not distinct from v_facility
     and r.section_id is not distinct from p_section_id
     and r.rate_class is not distinct from v_class
     and (r.effective_to is null or r.effective_to >= p_effective_from)
   for update;
  if found then
    update ceedo_collections.account_rules
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  if jsonb_array_length(coalesce(p_shares, '[]'::jsonb)) = 0 then
    if v_current.id is null then
      raise exception 'Add at least one account to the rule';
    end if;
    return null;  -- ended, not replaced
  end if;

  select coalesce(sum((s ->> 'share_bps')::integer), 0) into v_total
    from jsonb_array_elements(p_shares) s;
  if v_total <> 10000 then
    raise exception 'The shares of a rule must add up to 100%% (these add up to %)',
      to_char(v_total / 100.0, 'FM990.00') || '%';
  end if;

  insert into ceedo_collections.account_rules
    (fee_type_id, facility_id, section_id, rate_class, portion, effective_from, created_by)
  values (p_fee_type_id, v_facility, p_section_id, v_class, p_portion, p_effective_from, auth.uid())
  returning id into v_id;

  insert into ceedo_collections.account_rule_shares (rule_id, account_id, share_bps)
  select v_id, (s ->> 'account_id')::uuid, (s ->> 'share_bps')::integer
    from jsonb_array_elements(p_shares) s;

  return v_id;
end;
$$;

revoke execute on function ceedo_collections.replace_account_rule(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function ceedo_collections.replace_account_rule(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------
-- clear_all_data (from 052) now reinstalls the chart's built-ins after the wipe.

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
     and c.relname not in ('app_users', 'settings', 'super_admins', 'deployed_migrations');

  if v_tables is not null then
    execute 'truncate ' || v_tables || ' restart identity';
  end if;

  -- The chart's built-ins are part of the schema, not test data: receipt_account_lines
  -- cannot place an unclassified portion without them.
  perform ceedo_collections.install_chart_builtins();

  return v_count;
end;
$$;

revoke execute on function ceedo_collections.clear_all_data() from public, anon;
grant execute on function ceedo_collections.clear_all_data() to authenticated;
