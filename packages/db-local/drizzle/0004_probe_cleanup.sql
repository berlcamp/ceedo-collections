-- Undo the engine-probe dev screen on a tablet where it was run. It was reachable from the
-- production home screen until 826fbb5, and tapping it wrote 1,500 fake charges
-- (`probe-0`..`probe-1499`, lease `probe-lease`) into the real mirror and moved the sync
-- cursor to 1500, which can make the next delta skip real rows.
--
-- Deletes only rows that cannot be real: the probe's own ids on its own fake lease. Pulled
-- data only; nothing device-authored (outbox, local shifts) is touched.
DELETE FROM `charges` WHERE `id` LIKE 'probe-%' AND `lease_id` = 'probe-lease';
--> statement-breakpoint
-- Rewind the cursor so the next sync re-delivers every row (applyPull upserts), filling in
-- anything a moved cursor skipped. Epoch and last_full_sync_date are left alone, so the
-- staleness register keeps telling the truth about when this tablet last fully synced.
UPDATE `sync_state` SET `cursor` = 0 WHERE `id` = 1;
