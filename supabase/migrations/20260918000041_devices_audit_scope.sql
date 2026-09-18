-- devices: stop auditing the sync heartbeat. Parent spec §12.3 (the audit trail).
--
-- WHAT WAS WRONG. `authenticate_device()` (migration 0026) ends with
-- `update ceedo_collections.devices set last_seen_at = now()` on every successful
-- authentication, and `devices` carries the blanket AFTER INSERT OR UPDATE OR DELETE audit
-- trigger that migration 0010's `attach_audit()` puts on every master-data table. Each of
-- those writes an `audit_log` row holding the full before/after image of the device row.
--
-- Every Edge Function authenticates independently, so a device that pulls, pushes and then
-- closes out has authenticated three times and written three audit rows — none of which
-- records a decision anyone made. This local database already held thousands of them from
-- the test suite alone. Thirty tablets syncing through an eight-hour round would produce
-- tens of thousands a day, in the one table that exists so a person can answer "who
-- changed this, and when" — burying the rows that carry that answer under a heartbeat.
--
-- THE FIX. Scope the UPDATE side of the trigger to the columns that represent an actual
-- decision. `AFTER UPDATE OF <cols>` fires on whether a column is named as a TARGET of the
-- UPDATE statement, not on whether its value changed — so `set last_seen_at = now()` no
-- longer fires it, while `set active = false` (deactivating a stolen tablet, §4.1) still
-- does. INSERT and DELETE stay unconditional: registering or removing a device is exactly
-- what this trail is for.
--
-- `row_version` is in the list even though `devices_row_version` (a BEFORE trigger) rewrites
-- it on every update including the heartbeat: the column-list test is against the
-- statement's target list, which a BEFORE trigger does not join, so the heartbeat still
-- does not fire this. It is listed so that a statement which explicitly targets
-- `row_version` is not a silent way to touch the row unaudited.
--
-- THE LIST IS EVERY COLUMN BUT `last_seen_at`, and it has to be read that way rather than
-- as "the columns from migration 0007". `assignment_epoch` was added later, by migration
-- 0031, and a first draft of this list -- enumerated from 0007's `create table` -- left it
-- out, which would have made it a second unaudited column by accident. Nothing is lost
-- today, because its only writer is `bump_assignment_epoch()` and `device_assignments`
-- carries its own unconditional audit trigger. But `update devices set assignment_epoch =
-- assignment_epoch + 1` by hand, to force a fleet re-sync, is exactly the statement the
-- `row_version` argument above says must not pass unaudited.
--
-- Anything added to `devices` from here belongs in this list unless there is a written
-- reason it does not.
--
-- NOT FIXED HERE, and stated so it is not mistaken for fixed: the heartbeat still bumps
-- `devices.row_version` from `row_version_seq` on every authentication, because that
-- BEFORE trigger is installed schema-wide by migration 0003's master-data installer and
-- `row_version` is what `sync_pull`'s cursor reads. Changing it is a cursor-semantics
-- change, not an audit-noise fix, and belongs with the Phase 3b sync work.
--
-- Every other table keeps `attach_audit()`'s unconditional trigger. `devices` is the only
-- one a machine writes to on a timer.

drop trigger devices_audit on ceedo_collections.devices;

create trigger devices_audit
  after insert or delete
     or update of id, label, credential_id, registered_at, active, created_at,
               assignment_epoch, row_version
  on ceedo_collections.devices
  for each row execute function ceedo_collections.write_audit();
