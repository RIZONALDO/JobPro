import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const feedItemsTable = pgTable("te_feed_items", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  // task_completed | job_completed | project_completed | project_created | manual_post
  title: text("title").notNull(),
  content: text("content"),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityId: integer("entity_id"),
  entityType: text("entity_type"), // 'task' | 'job' | 'project'
  jobId: integer("job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedItem = typeof feedItemsTable.$inferSelect;
export type InsertFeedItem = typeof feedItemsTable.$inferInsert;
