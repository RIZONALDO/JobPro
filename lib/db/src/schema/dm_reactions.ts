import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { directMessagesTable } from "./direct_messages";
import { usersTable } from "./users";

export const dmReactionsTable = pgTable("te_dm_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => directMessagesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.messageId, t.userId, t.emoji)]);
