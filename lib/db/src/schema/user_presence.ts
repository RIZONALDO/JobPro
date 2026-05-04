import { pgTable, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userPresenceTable = pgTable("te_user_presence", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  isOnline: boolean("is_online").notNull().default(false),
});

export type UserPresence = typeof userPresenceTable.$inferSelect;
export type InsertUserPresence = typeof userPresenceTable.$inferInsert;
