import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const keepers = sqliteTable("keepers", {
  id: text("id").primaryKey(),
  ownerFid: integer("owner_fid").notNull().unique(),
  name: text("name").notNull(),
  template: text("template").notNull(),
  createdAt: text("created_at").notNull(),
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
