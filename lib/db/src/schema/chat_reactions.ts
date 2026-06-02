import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { chatMessagesTable } from "./chat_messages";
import { usersTable } from "./users";

export const chatReactionsTable = pgTable("te_chat_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => chatMessagesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.messageId, t.userId, t.emoji)]);
