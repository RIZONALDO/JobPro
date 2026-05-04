import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { feedItemsTable } from "./feed_items";
import { usersTable } from "./users";

export const feedCommentsTable = pgTable("te_feed_comments", {
  id: serial("id").primaryKey(),
  feedItemId: integer("feed_item_id").notNull().references(() => feedItemsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedComment = typeof feedCommentsTable.$inferSelect;
export type InsertFeedComment = typeof feedCommentsTable.$inferInsert;
