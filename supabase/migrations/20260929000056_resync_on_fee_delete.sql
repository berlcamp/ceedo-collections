-- Deleting a fee type or a rate re-syncs every tablet.
--
-- The web app now offers Delete on fee types and rates. Tablets hold both (sync_pull sends
-- them whole), and a cursor delta cannot say "this row is gone" (migration 0031's header):
-- a deleted rate would keep pricing receipts on every tablet that already pulled it, and a
-- deleted fee type would keep being offered on the fee screen. Bumping every device's
-- assignment_epoch makes each one empty its pulled tables and pull from cursor 0 on its
-- next sync; device-authored receipts and the outbox are untouched.
--
-- Statement-level with a transition table, so a delete that matched nothing does not
-- re-sync the fleet, and a delete of many rows re-syncs it once. The epoch writes are
-- audited by devices_audit (migration 0041), which is the trail this should leave.

create or replace function ceedo_collections.resync_all_devices_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if exists (select 1 from gone) then
    update ceedo_collections.devices
       set assignment_epoch = assignment_epoch + 1
     where true;
  end if;
  return null;
end;
$$;

-- Only ever invoked by the triggers below; see migration 0031 on the implicit PUBLIC grant.
revoke execute on function ceedo_collections.resync_all_devices_after_delete() from public;

create trigger fee_types_resync_on_delete
  after delete on ceedo_collections.fee_types
  referencing old table as gone
  for each statement execute function ceedo_collections.resync_all_devices_after_delete();

create trigger rates_resync_on_delete
  after delete on ceedo_collections.rates
  referencing old table as gone
  for each statement execute function ceedo_collections.resync_all_devices_after_delete();
