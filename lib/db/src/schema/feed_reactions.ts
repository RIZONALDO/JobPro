import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { feedItemsTable } from "./feed_items";
import { usersTable } from "./users";

export const feedReactionsTable = pgTable("te_feed_reactions", {
  id: serial("id").primaryKey(),
  feedItemId: integer("feed_item_id").notNull().references(() => feedItemsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedReaction = typeof feedReactionsTable.$inferSelect;
export type InsertFeedReaction = typeof feedReactionsTable.$inferInsert;
