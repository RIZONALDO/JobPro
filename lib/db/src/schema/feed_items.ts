import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const feedItemsTable = pgTable("te_feed_items", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  // manual_post (recado) | kudos (reconhecimento) | task_completed (entrega). Outros tipos antigos ficam fora do mural.
  title: text("title").notNull(),
  content: text("content"),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityId: integer("entity_id"),
  entityType: text("entity_type"), // 'task' | 'job' | 'project'
  jobId: integer("job_id"),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  pinnedById: integer("pinned_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetUserId: integer("target_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedItem = typeof feedItemsTable.$inferSelect;
export type InsertFeedItem = typeof feedItemsTable.$inferInsert;
