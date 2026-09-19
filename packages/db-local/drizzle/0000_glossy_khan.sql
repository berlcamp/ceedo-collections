CREATE TABLE `booklet_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`booklet_id` text,
	`collector_id` text,
	`assigned_at` text,
	`returned_at` text,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `booklets` (
	`id` text PRIMARY KEY NOT NULL,
	`form_type_id` text,
	`serial_prefix` text,
	`start_no` integer,
	`end_no` integer,
	`received_date` text,
	`status` text,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `charge_condonations` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text,
	`amount` text,
	`reason` text,
	`authority_ref` text,
	`condoned_by` text,
	`condoned_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`lease_id` text,
	`fee_type_id` text,
	`charge_type` text,
	`parent_charge_id` text,
	`period_start` text,
	`period_end` text,
	`due_date` text,
	`amount` text,
	`surcharge_bps` integer,
	`source` text,
	`created_at` text,
	`created_by` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `collection_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text,
	`charge_id` text,
	`amount` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `collection_cancellations` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text,
	`cancelled_by` text,
	`cancelled_at` text,
	`reason` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`or_no` integer,
	`booklet_id` text,
	`collector_id` text,
	`device_id` text,
	`collected_at` text,
	`business_date` text,
	`fee_type_id` text,
	`lease_id` text,
	`payer_ref` text,
	`gross_amount` text,
	`notes` text,
	`shift_id` text,
	`synced_at` text,
	`posted_at` text,
	`posted_by` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `collectors` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_no` text,
	`full_name` text,
	`pin_hash` text,
	`status` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `consumed_serials` (
	`booklet_id` text NOT NULL,
	`or_no` integer NOT NULL,
	PRIMARY KEY(`booklet_id`, `or_no`)
);
--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text,
	`type` text,
	`active` integer,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `fee_types` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text,
	`accrues` integer,
	`surcharge_bps` integer,
	`active` integer,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`stall_id` text,
	`tenant_id` text,
	`start_date` text,
	`end_date` text,
	`rate_amount` text,
	`accrual_period` text,
	`due_day` integer,
	`status` text,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `local_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`collector_id` text NOT NULL,
	`business_date` text NOT NULL,
	`opened_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_at` text,
	`declared_total` text,
	`device_count` integer,
	`device_total` text
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`collector_id` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`reason_code` text,
	`retryable` integer,
	`last_result` text,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pin_attempts` (
	`collector_id` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_at` text
);
--> statement-breakpoint
CREATE TABLE `rates` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_type_id` text,
	`rate_class` text,
	`effective_from` text,
	`effective_to` text,
	`amount` text,
	`basis` text,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text,
	`name` text,
	`default_accrual_period` text,
	`active` integer,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `spoiled_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`booklet_id` text,
	`or_no` integer,
	`reason` text,
	`recorded_at` text,
	`recorded_by` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `stalls` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text,
	`stall_no` text,
	`area_sqm` text,
	`active` integer,
	`created_at` text,
	`row_version` integer
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	`last_full_sync_date` text
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`contact_no` text,
	`address` text,
	`active` integer,
	`created_at` text,
	`row_version` integer
);
