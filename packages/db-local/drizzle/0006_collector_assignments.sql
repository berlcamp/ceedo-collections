CREATE TABLE `collector_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`collector_id` text,
	`facility_id` text,
	`section_id` text,
	`active` integer,
	`row_version` integer
);
