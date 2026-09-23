ALTER TABLE `fee_types` ADD `facility_type` text;--> statement-breakpoint
-- Re-pull everything once. Rows pulled before this column existed had it dropped by
-- applyPull (it skips unknown columns), and the cursor has already moved past them.
UPDATE `sync_state` SET `cursor` = 0 WHERE `id` = 1;
