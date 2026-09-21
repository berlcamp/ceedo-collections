CREATE TABLE `local_allocations` (
	`collection_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount` text NOT NULL,
	PRIMARY KEY(`collection_id`, `charge_id`)
);
--> statement-breakpoint
CREATE TABLE `local_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`or_no` integer NOT NULL,
	`booklet_id` text NOT NULL,
	`collector_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`collected_at` text NOT NULL,
	`fee_type_id` text NOT NULL,
	`lease_id` text,
	`gross_amount` text NOT NULL,
	`payer_ref` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`fee_type_id` text NOT NULL,
	`rate_class` text,
	`quantity` integer NOT NULL,
	`unit_rate` text NOT NULL,
	`amount` text NOT NULL
);
