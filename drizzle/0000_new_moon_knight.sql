CREATE TABLE `context_items` (
	`id` text PRIMARY KEY NOT NULL,
	`trapper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `keepers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_fid` integer NOT NULL,
	`name` text NOT NULL,
	`template` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keepers_owner_fid_unique` ON `keepers` (`owner_fid`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`trapper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trappers` (
	`id` text PRIMARY KEY NOT NULL,
	`keeper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`risk_level` text NOT NULL,
	`status` text NOT NULL,
	`context_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text
);
