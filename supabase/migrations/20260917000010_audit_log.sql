create table ceedo_collections.audit_log (
  id        bigint primary key generated always as identity,
  actor_id  uuid references ceedo_collections.app_users (id),
  action    text not null,
  entity    text not null,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);

create index audit_log_entity_idx on ceedo_collections.audit_log (entity, entity_id);
create index audit_log_actor_idx on ceedo_collections.audit_log (actor_id, at desc);

-- security definer so the trigger can write the log while the caller's own policies
-- deny them any write to it. An audit trail the actor can edit is not an audit trail.
--
-- The body is wrapped in its own exception handler, the same pattern claim_staff_invite()
-- (migration 0009) already uses for the same reason: a secondary, observational effect
-- must never abort the primary operation it is attached to. Verified directly (see
-- task-14-report.md) that without this, attaching the trigger to a hypothetical table
-- whose `id` is not uuid-castable raises "invalid input syntax for type uuid" and aborts
-- the audited statement entirely — every table Task 14 actually attaches this to has a
-- uuid id, so this never fires today, but the whole point of an append-only log is that it
-- must not become a new way to break the operations it watches, including ones added
-- later. A failure here is downgraded to a warning and the audited statement still
-- commits with no log entry, rather than silently succeeding with a wrong one or aborting
-- outright.
create or replace function ceedo_collections.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  row_id uuid;
begin
  begin
    row_id := case tg_op when 'DELETE' then (to_jsonb(old) ->> 'id')::uuid
                         else (to_jsonb(new) ->> 'id')::uuid end;

    insert into ceedo_collections.audit_log (actor_id, action, entity, entity_id, before, after)
    values (
      auth.uid(),
      lower(tg_op),
      tg_table_name,
      row_id,
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    );
  exception
    when others then
      raise warning 'write_audit failed for % on %: %', tg_op, tg_table_name, sqlerrm;
  end;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create or replace function ceedo_collections.attach_audit(table_name text)
returns void
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  execute format(
    'create trigger %I after insert or update or delete on ceedo_collections.%I
       for each row execute function ceedo_collections.write_audit()',
    table_name || '_audit', table_name);
end;
$$;

-- Every master-data table from Tasks 5-9, plus staff_invites (added after this brief was
-- written): an invite is a grant of future access, so who created one is exactly the sort
-- of thing an auditor asks about.
select ceedo_collections.attach_audit(t) from unnest(array[
  'app_users', 'facilities', 'sections', 'stalls', 'tenants', 'leases',
  'fee_types', 'rates', 'form_types', 'booklets', 'booklet_assignments',
  'spoiled_forms', 'devices', 'device_assignments', 'collector_assignments',
  'staff_invites'
]) as t;

alter table ceedo_collections.audit_log enable row level security;

create policy audit_log_read on ceedo_collections.audit_log
  for select to authenticated
  using (ceedo_collections.has_role('admin', 'supervisor', 'accounting'));

-- Append-only, enforced by withheld privilege rather than by policy. The same
-- principle the ledger will use in Phase 2: nobody can grant themselves what was
-- never granted.
grant select on ceedo_collections.audit_log to authenticated;
revoke insert, update, delete on ceedo_collections.audit_log from authenticated, anon;
