import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: text("created_at").notNull(),
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
