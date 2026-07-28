CREATE TABLE `proof_drops` (
	`id` text PRIMARY KEY NOT NULL,
	`keeper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`title` text NOT NULL,
	`purpose` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`hash` text NOT NULL,
	`envelope_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`keeper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`from_source_id` text NOT NULL,
	`to_source_id` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`keeper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`url` text,
	`commit_sha` text,
	`created_at` text NOT NULL
);
