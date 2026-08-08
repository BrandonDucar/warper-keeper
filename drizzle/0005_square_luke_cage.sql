CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`keeper_id` text NOT NULL,
	`trapper_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`content_hash` text NOT NULL,
	`uri` text,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_trapper_idx` ON `agent_artifacts` (`trapper_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_grant_events` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`receipt_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_grant_events_owner_idx` ON `agent_grant_events` (`owner_fid`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grant_events_idempotency_unique` ON `agent_grant_events` (`owner_fid`,`action`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_fid` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`keeper_ids_json` text NOT NULL,
	`permissions_json` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_grants_owner_idx` ON `agent_grants` (`owner_fid`,`issued_at`);--> statement-breakpoint
CREATE INDEX `agent_grants_identity_idx` ON `agent_grants` (`tenant_id`,`agent_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `agent_rate_limits` (
	`window_key` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`mode` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_rate_limits_expiry_idx` ON `agent_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `agent_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`owner_fid` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`receipt_json` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_receipts_idempotency_unique` ON `agent_receipts` (`grant_id`,`action`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_receipts_owner_idx` ON `agent_receipts` (`owner_fid`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_spore_nonces` (
	`request_id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash_unique` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_grant_idx` ON `agent_tokens` (`grant_id`,`issued_at`);