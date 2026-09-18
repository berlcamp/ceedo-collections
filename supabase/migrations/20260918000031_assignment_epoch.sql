-- The re-sync trigger for a reassigned tablet.
--
-- The sync cursor is row_version_seq (parent spec §5.7). A cursor delta answers "what
-- changed?" It cannot answer "what is no longer yours?"
--
-- When a supervisor moves a tablet from the fish section to the vegetable section, the
-- fish section's leases, stalls and charges do not change -- so no row_version moves, so
-- the next delta is EMPTY, and the tablet keeps a section's worth of tenants it must no
-- longer show. Nothing in a cursor protocol can detect this; it is a property of deltas,
-- not a bug in the query.
--
-- §3 of the parent spec says reassignment "forces a re-sync before it is used elsewhere."
-- This makes that a mechanism rather than a hope: the epoch changes, every pull response
-- carries it, and a device whose stored epoch differs discards its scoped data and pulls
-- from cursor 0.

alter table ceedo_collections.devices
  add column assignment_epoch integer not null default 0;

create or replace function ceedo_collections.bump_assignment_epoch()
returns trigger
language plpgsql
set search_path = ceedo_collections, pg_temp
as $$
begin
  -- Fires on DELETE too, where NEW is null. A device_assignments row is never deleted
  -- today -- deactivation is `active = false` -- but a trigger that silently skips the
  -- delete path is a trap for whoever changes that.
  update ceedo_collections.devices
     set assignment_epoch = assignment_epoch + 1
   where id = coalesce(new.device_id, old.device_id);

  return coalesce(new, old);
end;
$$;

-- FOR EACH ROW on all three verbs. An UPDATE that flips `active` is the ordinary case;
-- INSERT is a first assignment; DELETE is covered for the reason above.
create trigger device_assignments_bump_epoch
  after insert or update or delete on ceedo_collections.device_assignments
  for each row execute function ceedo_collections.bump_assignment_epoch();

-- CREATE FUNCTION grants EXECUTE to PUBLIC implicitly. This function is only ever invoked
-- by the trigger, never called directly, so no role needs it -- but the implicit PUBLIC
-- grant is exactly the unclosed gap Task 1 found across 14 Phase 1 functions. Close it here
-- rather than leaving it for a later hygiene migration to find.
revoke execute on function ceedo_collections.bump_assignment_epoch() from public;
