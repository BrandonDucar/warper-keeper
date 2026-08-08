import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const keepers = sqliteTable("keepers", {
  id: text("id").primaryKey(),
  ownerFid: integer("owner_fid").notNull().unique(),
  name: text("name").notNull(),
  template: text("template").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const keeperPersonalization = sqliteTable("keeper_personalization", {
  keeperId: text("keeper_id").primaryKey(),
  ownerFid: integer("owner_fid").notNull().unique(),
  theme: text("theme").notNull(),
  tagline: text("tagline").notNull(),
  stickersJson: text("stickers_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trappers = sqliteTable("trappers", {
  id: text("id").primaryKey(),
  keeperId: text("keeper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  riskLevel: text("risk_level").notNull(),
  status: text("status").notNull(),
  contextCount: integer("context_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  closedAt: text("closed_at"),
});

export const contextItems = sqliteTable("context_items", {
  id: text("id").primaryKey(),
  trapperId: text("trapper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  trapperId: text("trapper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  hash: text("hash").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  keeperId: text("keeper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  url: text("url"),
  commitSha: text("commit_sha"),
  snapshotJson: text("snapshot_json"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  contentExcerpt: text("content_excerpt"),
  createdAt: text("created_at").notNull(),
});

export const trapperSources = sqliteTable(
  "trapper_sources",
  {
    id: text("id").primaryKey(),
    trapperId: text("trapper_id").notNull(),
    sourceId: text("source_id").notNull(),
    ownerFid: integer("owner_fid").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trapper_sources_pair_unique").on(
      table.trapperId,
      table.sourceId,
    ),
  ],
);

export const trapperShares = sqliteTable("trapper_shares", {
  token: text("token").primaryKey(),
  trapperId: text("trapper_id").notNull(),
  keeperId: text("keeper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const sourceRelations = sqliteTable("source_relations", {
  id: text("id").primaryKey(),
  keeperId: text("keeper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  fromSourceId: text("from_source_id").notNull(),
  toSourceId: text("to_source_id").notNull(),
  label: text("label").notNull(),
  createdAt: text("created_at").notNull(),
});

export const proofDrops = sqliteTable("proof_drops", {
  id: text("id").primaryKey(),
  keeperId: text("keeper_id").notNull(),
  ownerFid: integer("owner_fid").notNull(),
  title: text("title").notNull(),
  purpose: text("purpose").notNull(),
  sourceIdsJson: text("source_ids_json").notNull(),
  hash: text("hash").notNull(),
  envelopeJson: text("envelope_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentGrants = sqliteTable(
  "agent_grants",
  {
    id: text("id").primaryKey(),
    ownerFid: integer("owner_fid").notNull(),
    tenantId: text("tenant_id").notNull(),
    agentId: text("agent_id").notNull(),
    keeperIdsJson: text("keeper_ids_json").notNull(),
    permissionsJson: text("permissions_json").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("agent_grants_owner_idx").on(table.ownerFid, table.issuedAt),
    index("agent_grants_identity_idx").on(table.tenantId, table.agentId, table.expiresAt),
  ],
);

export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("agent_tokens_hash_unique").on(table.tokenHash),
    index("agent_tokens_grant_idx").on(table.grantId, table.issuedAt),
  ],
);

export const agentGrantEvents = sqliteTable(
  "agent_grant_events",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id").notNull(),
    ownerFid: integer("owner_fid").notNull(),
    action: text("action").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    receiptJson: text("receipt_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("agent_grant_events_owner_idx").on(table.ownerFid, table.createdAt),
    uniqueIndex("agent_grant_events_idempotency_unique").on(
      table.ownerFid,
      table.action,
      table.idempotencyKey,
    ),
  ],
);

export const agentSporeNonces = sqliteTable("agent_spore_nonces", {
  requestId: text("request_id").primaryKey(),
  grantId: text("grant_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentArtifacts = sqliteTable(
  "agent_artifacts",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id").notNull(),
    keeperId: text("keeper_id").notNull(),
    trapperId: text("trapper_id").notNull(),
    ownerFid: integer("owner_fid").notNull(),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    contentHash: text("content_hash").notNull(),
    uri: text("uri"),
    summary: text("summary").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agent_artifacts_trapper_idx").on(table.trapperId, table.createdAt)],
);

export const agentReceipts = sqliteTable(
  "agent_receipts",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id").notNull(),
    ownerFid: integer("owner_fid").notNull(),
    tenantId: text("tenant_id").notNull(),
    agentId: text("agent_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    receiptJson: text("receipt_json").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_receipts_idempotency_unique").on(
      table.grantId,
      table.action,
      table.idempotencyKey,
    ),
    index("agent_receipts_owner_idx").on(table.ownerFid, table.createdAt),
  ],
);

export const agentRateLimits = sqliteTable(
  "agent_rate_limits",
  {
    windowKey: text("window_key").primaryKey(),
    grantId: text("grant_id").notNull(),
    mode: text("mode").notNull(),
    windowStart: text("window_start").notNull(),
    count: integer("count").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("agent_rate_limits_expiry_idx").on(table.expiresAt)],
);
