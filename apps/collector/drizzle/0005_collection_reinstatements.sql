CREATE TABLE `collection_reinstatements` (
	`id` text PRIMARY KEY NOT NULL,
	`cancellation_id` text,
	`reason` text,
	`reinstated_by` text,
	`reinstated_at` text,
	`row_version` integer
);
