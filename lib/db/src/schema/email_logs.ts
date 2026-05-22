import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const emailLogsTable = pgTable("te_email_logs", {
  id:            serial("id").primaryKey(),
  sentAt:        timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  weekStart:     text("week_start").notNull(),
  weekEnd:       text("week_end").notNull(),
  recipients:    jsonb("recipients").notNull().$type<string[]>(),
  status:        text("status").notNull(),        // "sent" | "failed"
  errorMessage:  text("error_message"),
  trigger:       text("trigger").notNull(),       // "manual" | "auto"
  senderName:    text("sender_name"),
  smtpMessageId: text("smtp_message_id"),
});

export type EmailLog = typeof emailLogsTable.$inferSelect;
