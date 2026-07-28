CREATE TABLE `keeper_personalization` (
	`keeper_id` text PRIMARY KEY NOT NULL,
	`owner_fid` integer NOT NULL,
	`theme` text NOT NULL,
	`tagline` text NOT NULL,
	`stickers_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keeper_personalization_owner_fid_unique` ON `keeper_personalization` (`owner_fid`);