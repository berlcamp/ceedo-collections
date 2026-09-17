create table ceedo_collections.audit_log (
  id        bigint primary key generated always as identity,
  actor_id  uuid references ceedo_collections.app_users (id),
  -- The Postgres role in effect for the write (e.g. 'authenticated', 'service_role',
  -- 'anon', or the login role for a direct connection), captured alongside actor_id so a
  -- null actor is explainable rather than merely ambiguous — a legitimate service-role
  -- write and a bug that lost auth context both leave actor_id null, and this is what
  -- tells them apart.
  --
  -- Deliberately NOT `current_user`: write_audit() below is security definer, and inside
  -- a security definer function `current_user` always reads back the function's owner,
  -- not the caller's role — confirmed by inspection (a throwaway security definer probe
  -- function returned 'postgres' regardless of `set role authenticated` /
  -- `set role service_role` beforehand). `current_setting('role', true)` is unaffected by
  -- the security-definer context switch and reports the role PostgREST actually set for
  -- the request, which is what this column exists to record.
  pg_role   text not null,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  -- Populated only for an 'audit_failed' marker row (see write_audit()'s exception
  -- handler): a short note of what went wrong, since the row that would otherwise explain
  -- it never made it in.
  note      text,
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
--
-- `raise warning` alone only reaches the Postgres server log, invisible to anyone not
-- tailing it, so the handler also attempts a minimal 'audit_failed' marker row in the log
-- itself — the place people already look — naming the entity, entity_id if it was
-- recovered, and sqlerrm. That attempt has its own nested exception handler: if even the
-- marker insert fails, the function still returns normally and the audited statement
-- still commits. The warning is kept alongside the marker, not replaced by it.
create or replace function ceedo_collections.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
declare
  row_id      uuid;
  before_data jsonb;
  after_data  jsonb;
  caller_role text;
begin
  caller_role := coalesce(nullif(current_setting('role', true), 'none'), session_user);

  begin
    row_id := case tg_op when 'DELETE' then (to_jsonb(old) ->> 'id')::uuid
                         else (to_jsonb(new) ->> 'id')::uuid end;

    -- Columns never recorded. This log is append-only by withheld privilege, so anything
    -- written here is permanent — a secret stored once can never be removed. pin_hash in
    -- particular was deliberately excluded from app_users' column grants in migration
    -- 0002; capturing whole rows here would hand it back, permanently, to every role that
    -- can read the log. Applied unconditionally rather than per table — no table in this
    -- schema should ever record a pin_hash, and a blanket rule survives someone adding the
    -- column elsewhere. `jsonb - text` is a no-op where the key is absent.
    before_data := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'pin_hash' end;
    after_data  := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'pin_hash' end;

    insert into ceedo_collections.audit_log
      (actor_id, pg_role, action, entity, entity_id, before, after)
    values (
      auth.uid(),
      caller_role,
      lower(tg_op),
      tg_table_name,
      row_id,
      before_data,
      after_data
    );
  exception
    when others then
      raise warning 'write_audit failed for % on %: %', tg_op, tg_table_name, sqlerrm;

      begin
        insert into ceedo_collections.audit_log
          (actor_id, pg_role, action, entity, entity_id, note)
        values (auth.uid(), caller_role, 'audit_failed', tg_table_name, row_id, sqlerrm);
      exception
        when others then
          raise warning 'write_audit failure marker also failed for % on %: %',
            tg_op, tg_table_name, sqlerrm;
      end;
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

-- Most audit history is exactly what supervisors and accounting need. Entries about user
-- accounts and pending invitations are not: even with pin_hash redacted, an app_users
-- entry is still a readable list of who has which role and status, and a staff_invites
-- entry names an address that, until claimed, confers the role it carries — migration
-- 0009 made staff_invites admin-only reading precisely to close that escalation, and a
-- blanket audit-log policy would have quietly reopened it. Admins only for those two
-- entities; everything else stays visible to supervisor/accounting as before.
create policy audit_log_read on ceedo_collections.audit_log
  for select to authenticated
  using (
    ceedo_collections.is_admin()
    or (
      entity not in ('app_users', 'staff_invites')
      and ceedo_collections.has_role('supervisor', 'accounting')
    )
  );

-- Append-only, enforced by withheld privilege rather than by policy. The same
-- principle the ledger will use in Phase 2: nobody can grant themselves what was
-- never granted.
grant select on ceedo_collections.audit_log to authenticated;
revoke insert, update, delete on ceedo_collections.audit_log from authenticated, anon;
