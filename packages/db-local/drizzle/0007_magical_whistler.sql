ALTER TABLE `fee_types` ADD `amount_mode` text;--> statement-breakpoint
ALTER TABLE `fee_types` ADD `facility_id` text;--> statement-breakpoint
-- Re-pull everything once. Rows pulled before these columns existed had them dropped by
-- applyPull (it skips unknown columns), and the cursor has already moved past them.
UPDATE `sync_state` SET `cursor` = 0 WHERE `id` = 1;
