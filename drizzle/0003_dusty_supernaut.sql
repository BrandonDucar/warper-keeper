CREATE TABLE `trapper_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`trapper_id` text NOT NULL,
	`keeper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `trapper_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`trapper_id` text NOT NULL,
	`source_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `snapshot_json` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `content_excerpt` text;